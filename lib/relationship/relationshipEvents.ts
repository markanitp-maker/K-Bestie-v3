import type { SupabaseClient } from "@supabase/supabase-js";
import { logBehaviorEvent } from "../analytics/logBehaviorEvent";
import { loadRelationshipReturnGapDays } from "./returnGapConfig";

/**
 * [V1 정책: memory_used 이벤트 미기록 사유]
 * 기억 주입은 매 턴(turn) 대화 경로에서 발생하므로, 매 발화마다 DB 쓰기를 발생시키면
 * §29(성능 / 매 턴 DB 쓰기 금지)를 정면으로 위반하게 된다. 또한 세션 시작 시점에는
 * 어떤 기억이 실제로 주입/활용될지 미리 알 수 없다.
 * 따라서 V1에서는 memory_used 전용 기록 헬퍼를 두지 않고 런타임에 기록하지 않는다.
 * 단, RELATIONSHIP_EVENT_NAMES 상수의 "memory_used"는 DB CHECK 제약 조건과의 일치 및
 * 향후 확장을 위해 보존한다.
 */

/** DB 허용 8종 이벤트 이름 화이트리스트 (CHECK 제약 조건과 일치) */
export const RELATIONSHIP_EVENT_NAMES = [
  "memory_used",
  "memory_acknowledged",
  "child_referenced_past",
  "direct_open",
  "notification_entry",
  "reward_entry",
  "play_to_chat",
  "returned_after_gap",
] as const;

export type RelationshipEventName = typeof RELATIONSHIP_EVENT_NAMES[number];

/**
 * event_key 규약: relationship:<event>:<childId>:<logicalId>
 * logicalId는 랜덤/타임스탬프가 아니라 논리적 식별자여야 한다(§30 멱등성).
 */
export function buildRelationshipEventKey(
  eventName: RelationshipEventName,
  childId: string,
  logicalId: string,
): string {
  return `relationship:${eventName}:${childId}:${logicalId}`;
}

export interface RecordRelationshipEventInput {
  eventName: RelationshipEventName;
  childId: string;
  sessionId: string;
  logicalId: string;
  familyId?: string | null;
  actorType?: "parent" | "child" | "system" | "admin";
  properties?: Record<string, unknown>;
}

/**
 * 실패해도 절대 throw 하지 않는다. 이벤트 기록이 대화를 막으면 안 된다(§27 fail-safe).
 */
export async function recordRelationshipEvent(
  input: RecordRelationshipEventInput,
): Promise<void> {
  try {
    if (!RELATIONSHIP_EVENT_NAMES.includes(input.eventName)) {
      console.error(
        `[recordRelationshipEvent] 허용되지 않은 eventName: ${input.eventName}`,
      );
      return;
    }

    const eventKey = buildRelationshipEventKey(
      input.eventName,
      input.childId,
      input.logicalId,
    );

    await logBehaviorEvent({
      eventName: input.eventName,
      actorType: input.actorType ?? "child",
      childId: input.childId,
      familyId: input.familyId,
      sessionId: input.sessionId,
      feature: "relationship",
      eventKey,
      properties: input.properties,
    });
  } catch (error) {
    console.error(
      "[recordRelationshipEvent] 이벤트 기록 예외 발생 (대화 진행 유지):",
      error,
    );
  }
}

/**
 * 두 날짜(YYYY-MM-DD) 사이의 일수 차이를 계산한다.
 * 미래 날짜이거나 잘못된 형식이면 null 반환.
 */
export function calculateReturnGapDays(
  prevBusinessDate: string,
  currentBusinessDate: string,
): number | null {
  const prevTime = Date.parse(prevBusinessDate);
  const currentTime = Date.parse(currentBusinessDate);
  if (Number.isNaN(prevTime) || Number.isNaN(currentTime)) {
    return null;
  }
  const diffMs = currentTime - prevTime;
  if (diffMs < 0) {
    return null;
  }
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * 세션 시작 1회 경로에서 직전 대화일과의 간격(gap)을 확인하고 임계 이상이면 returned_after_gap 기록.
 * 매 턴 호출 금지. 세션 생성 1회 경로에서만 사용.
 */
export async function checkAndRecordReturnedAfterGap(input: {
  db: SupabaseClient;
  childId: string;
  sessionId: string;
  currentBusinessDate: string;
  familyId?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<boolean> {
  try {
    const threshold = loadRelationshipReturnGapDays(input.env);

    const { data, error } = await input.db
      .from("chat_sessions")
      .select("business_date")
      .eq("child_id", input.childId)
      .neq("id", input.sessionId)
      .lt("business_date", input.currentBusinessDate)
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        "[checkAndRecordReturnedAfterGap] 직전 세션 일자 조회 실패:",
        error,
      );
      return false;
    }

    if (!data?.business_date) {
      // 이전 대화 기록이 없으면 복귀(return)가 아님 (첫 대화)
      return false;
    }

    const gapDays = calculateReturnGapDays(
      data.business_date,
      input.currentBusinessDate,
    );

    if (gapDays === null || gapDays < threshold) {
      return false;
    }

    await recordRelationshipEvent({
      eventName: "returned_after_gap",
      childId: input.childId,
      sessionId: input.sessionId,
      logicalId: input.sessionId,
      familyId: input.familyId,
      properties: {
        gapDays,
        threshold,
        prevBusinessDate: data.business_date,
        currentBusinessDate: input.currentBusinessDate,
      },
    });

    return true;
  } catch (error) {
    console.error("[checkAndRecordReturnedAfterGap] 예외 발생:", error);
    return false;
  }
}
