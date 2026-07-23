import { createServiceClient } from '../supabase/server';
import { getSupabaseTarget } from '../supabase/env';

export interface BehaviorEventInput {
  eventName: string;
  actorType: "parent" | "child" | "system" | "admin";
  actorId?: string | null;
  familyId?: string | null;
  childId?: string | null;
  sessionId?: string | null;
  feature:
    | "auth" | "home" | "mission" | "freechat" | "play" | "daily_report"
    | "weekly_report" | "monthly_report" | "conversation_topic"
    | "child_management" | "guardian_settings" | "subscription";
  route?: string | null;
  conversationMode?: "A" | "B" | "C" | "D" | "E" | "F" | null;
  playType?: "comic_book" | "quiz" | "hairstyle" | "mbti" | null;
  occurredAt?: string; // ISO — 미지정 시 DB now()에 맡김(필드 자체를 안 보냄)
  durationSeconds?: number | null;
  appVersion?: string | null;
  isTestAccount?: boolean;
  properties?: Record<string, unknown>;
}

/**
 * 부모/아이/가족 행동 이벤트를 DB(behavior_events)에 기록하는 서버 전용 헬퍼.
 * 
 * @warning `properties` 객체에는 절대 대화 원문, 음성 데이터, 리포트 본문, 친구 이름 등 민감한 자유 텍스트를 넣지 마세요.
 *          이 테이블은 분석 목적이므로 식별이나 디버깅에 필요한 최소한의 메타데이터만 담아야 합니다.
 */
export async function logBehaviorEvent(input: BehaviorEventInput): Promise<void> {
  try {
    const supabase = createServiceClient();
    const environment = getSupabaseTarget(); // 'dev' 또는 'prod' (fallback to 'dev')

    const payload: Record<string, any> = {
      event_name: input.eventName,
      actor_type: input.actorType,
      feature: input.feature,
      environment,
    };

    if (input.actorId !== undefined) payload.actor_id = input.actorId;
    if (input.familyId !== undefined) payload.family_id = input.familyId;
    if (input.childId !== undefined) payload.child_id = input.childId;
    if (input.sessionId !== undefined) payload.session_id = input.sessionId;
    if (input.route !== undefined) payload.route = input.route;
    if (input.conversationMode !== undefined) payload.conversation_mode = input.conversationMode;
    if (input.playType !== undefined) payload.play_type = input.playType;
    if (input.occurredAt !== undefined) payload.occurred_at = input.occurredAt;
    if (input.durationSeconds !== undefined) payload.duration_seconds = input.durationSeconds;
    if (input.appVersion !== undefined) payload.app_version = input.appVersion;
    if (input.isTestAccount !== undefined) payload.is_test_account = input.isTestAccount;
    if (input.properties !== undefined) payload.properties = input.properties;

    const { error } = await supabase.from('behavior_events').insert(payload);

    if (error) {
      console.error("[logBehaviorEvent] Insert failed:", error.message, error.details, error.hint);
      // 의도적: 분석 로깅 실패가 실제 기능(미션 완료 등)을 막지 않도록 throw하지 않음
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[logBehaviorEvent] Unexpected error:", message);
    // 의도적: 조용히 반환
  }
}
