import type { SupabaseClient } from "@supabase/supabase-js";

import {
  calculateRelationshipCalendarStage,
  type RelationshipCalendarStage,
} from "./calendarStage";

export type RelationshipStageKey = "MEET" | "REMEMBER" | "SHARED_HISTORY" | "VOLUNTARY_RETURN";

export interface StageRuleThreshold {
  stageKey: RelationshipStageKey;
  stageOrder: number;
  minConversationCount: number;
  minConversationDays: number;
  minUsableMemoryCount: number;
  minSharedMemoryCount: number;
  minRelationshipEventCount: number;
}

export interface ActivitySignals {
  conversationCount: number;
  conversationDays: number;
  usableMemoryCount: number;
  sharedMemoryCount: number;
  relationshipEventCount: number;
}

type ChildProfileRow = { relationship_started_at: string | null };
type RelationshipStateRow = { effective_stage: RelationshipStageKey };
type StageRuleRow = {
  stage_key: RelationshipStageKey;
  min_conversation_count: number;
  min_conversation_days: number;
  min_usable_memory_count: number;
  min_shared_memory_count: number;
  min_relationship_event_count: number;
};
type ChatMessageRow = { created_at: string };

const STAGE_ORDER: Record<RelationshipStageKey, number> = {
  MEET: 1,
  REMEMBER: 2,
  SHARED_HISTORY: 3,
  VOLUNTARY_RETURN: 4,
};

const STAGE_BY_ORDER: Record<number, RelationshipStageKey> = {
  1: "MEET",
  2: "REMEMBER",
  3: "SHARED_HISTORY",
  4: "VOLUNTARY_RETURN",
};

const CALENDAR_STAGE_ORDER: Record<RelationshipCalendarStage, number> = {
  W1: 1,
  W2: 2,
  W3: 3,
  W4: 4,
};

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const meetsThreshold = (activity: ActivitySignals, rule: StageRuleThreshold): boolean => (
  activity.conversationCount >= rule.minConversationCount
  && activity.conversationDays >= rule.minConversationDays
  && activity.usableMemoryCount >= rule.minUsableMemoryCount
  && activity.sharedMemoryCount >= rule.minSharedMemoryCount
  && activity.relationshipEventCount >= rule.minRelationshipEventCount
);

/**
 * calendar_stage를 넘지 않는 범위에서 행동 신호로 관계 단계를 계산한다.
 * Rule이 전혀 없으면 운영 설정이 아직 준비되지 않은 상태이므로, 안전 기본값으로
 * calendar_stage를 그대로 사용한다. 개별 단계 rule이 없을 때도 그 단계는 통과시킨다.
 */
export const calculateEffectiveStage = (
  calendarStage: RelationshipCalendarStage | null,
  currentEffectiveStageKey: RelationshipStageKey | null,
  activity: ActivitySignals,
  rules: StageRuleThreshold[],
): RelationshipStageKey | null => {
  if (calendarStage === null || activity.conversationCount <= 0) return null;

  const calendarStageOrder = CALENDAR_STAGE_ORDER[calendarStage];
  const sortedRules = [...rules].sort((left, right) => left.stageOrder - right.stageOrder);
  let calculatedOrder = 1; // MEET is available after the first actual conversation.

  if (sortedRules.length === 0) {
    calculatedOrder = calendarStageOrder;
  } else {
    for (let stageOrder = 2; stageOrder <= calendarStageOrder; stageOrder += 1) {
      const stageKey = STAGE_BY_ORDER[stageOrder];
      const rule = sortedRules.find((candidate) => candidate.stageKey === stageKey);
      if (rule && !meetsThreshold(activity, rule)) break;
      calculatedOrder = stageOrder;
    }
  }

  const currentOrder = currentEffectiveStageKey === null
    ? 0
    : STAGE_ORDER[currentEffectiveStageKey];
  // A persisted value can only be preserved while it remains below the calendar cap.
  // This keeps the invariant effective_stage <= calendar_stage even for stale/corrupt rows.
  const effectiveOrder = currentOrder > calculatedOrder && currentOrder <= calendarStageOrder
    ? currentOrder
    : calculatedOrder;

  return STAGE_BY_ORDER[effectiveOrder];
};

const toStageRuleThreshold = (row: StageRuleRow): StageRuleThreshold => ({
  stageKey: row.stage_key,
  stageOrder: STAGE_ORDER[row.stage_key],
  minConversationCount: row.min_conversation_count,
  minConversationDays: row.min_conversation_days,
  minUsableMemoryCount: row.min_usable_memory_count,
  minSharedMemoryCount: row.min_shared_memory_count,
  minRelationshipEventCount: row.min_relationship_event_count,
});

const toKstDay = (value: string): string | null => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return KST_DATE_FORMATTER.format(date);
};

/**
 * DB I/O를 순수 계산에서 분리한 fail-open wrapper다. vectorRetrieval에는 전체 fact
 * 수를 반환하는 함수가 없으므로 usable memory는 해당 아이의 active memory_facts 수로
 * 보수적으로 근사한다. shared memory는 memory 관련 relationship event 수로 근사한다.
 */
export const evaluateAndPersistEffectiveStage = async (
  db: SupabaseClient,
  childId: string,
): Promise<{ calendarStage: RelationshipCalendarStage; effectiveStage: RelationshipStageKey } | null> => {
  try {
    const [profileResult, stateResult, rulesResult, messagesResult, memoryResult, eventsResult, sharedEventsResult] =
      await Promise.allSettled([
        db.from("child_profiles").select("relationship_started_at").eq("id", childId).maybeSingle<ChildProfileRow>(),
        db.from("child_relationship_state").select("effective_stage").eq("child_id", childId).maybeSingle<RelationshipStateRow>(),
        db.from("relationship_stage_rules")
          .select("stage_key, min_conversation_count, min_conversation_days, min_usable_memory_count, min_shared_memory_count, min_relationship_event_count")
          .eq("active", true)
          .returns<StageRuleRow[]>(),
        db.from("chat_messages")
          .select("created_at, chat_sessions!inner(child_id, deleted_at)")
          .eq("chat_sessions.child_id", childId)
          .eq("role", "child")
          .eq("turn_status", "finalized")
          .is("deleted_at", null)
          .is("chat_sessions.deleted_at", null)
          .returns<ChatMessageRow[]>(),
        db.from("memory_facts").select("id", { count: "exact", head: true }).eq("child_id", childId).eq("status", "active"),
        db.from("relationship_events").select("id", { count: "exact", head: true }).eq("child_id", childId),
        db.from("relationship_events").select("id", { count: "exact", head: true }).eq("child_id", childId).ilike("event_type", "%memory%"),
      ]);

    const settled = [profileResult, stateResult, rulesResult, messagesResult, memoryResult, eventsResult, sharedEventsResult];
    if (settled.some((result) => result.status === "rejected")) {
      console.error("[effectiveStage] 관계 단계 조회 실패:", settled.find((result) => result.status === "rejected"));
      return null;
    }

    if (
      profileResult.status !== "fulfilled" || stateResult.status !== "fulfilled"
      || rulesResult.status !== "fulfilled" || messagesResult.status !== "fulfilled"
      || memoryResult.status !== "fulfilled" || eventsResult.status !== "fulfilled"
      || sharedEventsResult.status !== "fulfilled"
    ) return null;

    const responses = [
      profileResult.value,
      stateResult.value,
      rulesResult.value,
      messagesResult.value,
      memoryResult.value,
      eventsResult.value,
      sharedEventsResult.value,
    ];
    const failedResponse = responses.find((response) => response.error);
    if (failedResponse?.error) {
      console.error("[effectiveStage] 관계 단계 조회 실패:", failedResponse.error.message);
      return null;
    }

    const calendarStage = calculateRelationshipCalendarStage({
      relationship_started_at: profileResult.value.data?.relationship_started_at ?? null,
    });
    if (calendarStage === null) return null;

    const messages = messagesResult.value.data ?? [];
    const conversationDays = new Set(messages.map((message) => toKstDay(message.created_at)).filter((day): day is string => day !== null)).size;
    const effectiveStage = calculateEffectiveStage(
      calendarStage,
      stateResult.value.data?.effective_stage ?? null,
      {
        conversationCount: messages.length,
        conversationDays,
        usableMemoryCount: memoryResult.value.count ?? 0,
        sharedMemoryCount: sharedEventsResult.value.count ?? 0,
        relationshipEventCount: eventsResult.value.count ?? 0,
      },
      (rulesResult.value.data ?? []).map(toStageRuleThreshold),
    );
    if (effectiveStage === null) return null;

    const effectiveStageChanged = stateResult.value.data?.effective_stage !== effectiveStage;
    const now = new Date().toISOString();
    const statePayload = {
      child_id: childId,
      calendar_stage: calendarStage,
      effective_stage: effectiveStage,
      last_evaluated_at: now,
      ...(effectiveStageChanged ? { effective_stage_started_at: now } : {}),
    };
    const { error: upsertError } = await db.from("child_relationship_state").upsert(statePayload, { onConflict: "child_id" });
    if (upsertError) {
      console.error("[effectiveStage] 관계 단계 저장 실패:", upsertError.message);
      return null;
    }

    return { calendarStage, effectiveStage };
  } catch (error) {
    console.error("[effectiveStage] 관계 단계 평가 예외:", error);
    return null;
  }
};
