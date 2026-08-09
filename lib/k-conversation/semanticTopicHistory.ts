// K Conversation Engine — Semantic Topic History (071 §9).
// 질문 ID가 달라도 의미가 같으면(semantic_group) 반복으로 본다. K가 먼저 같은 주제를
// 다시 꺼내는 것만 제한하고, 아이가 먼저 같은 주제를 다시 꺼내는 건 절대 제한하지 않는다.
// 테이블/RPC: supabase/migrations/20260809110000_k_conversation_topic_history.sql
// (record_conversation_topic_usage — INSERT ... ON CONFLICT로 원자적 upsert, read-modify-write
// race를 피한다).
import type { SupabaseClient } from "@supabase/supabase-js";

export type TopicInitiator = "child" | "k" | "parent_question";
export type TopicMode = "mission" | "free_chat";

const DEFAULT_COOLDOWN_DAYS = 3;

/** 아이가 이번에 어떤 semantic_group을 언급했는지(누가 먼저 꺼냈는지 포함) 기록한다.
 * child/parent_question이 꺼낸 경우에도 cooldown_until은 갱신한다 — "최근에 다룬 주제"라는
 * 사실 자체는 누가 꺼냈든 동일하고, 이 값을 K의 재질문 판단에만 쓰기 때문에 안전하다.
 * child_frequency/k_frequency/parent_question_frequency는 RPC 내부에서 원자적으로 증가한다. */
export async function recordTopicUsage(
  db: SupabaseClient,
  childId: string,
  semanticGroup: string,
  mode: TopicMode,
  initiatedBy: TopicInitiator,
  cooldownDays: number = DEFAULT_COOLDOWN_DAYS,
): Promise<void> {
  const { error } = await db.rpc("record_conversation_topic_usage", {
    p_child_id: childId,
    p_semantic_group: semanticGroup,
    p_mode: mode,
    p_initiated_by: initiatedBy,
    p_cooldown_days: cooldownDays,
  });
  if (error) {
    // 기록 실패가 대화 자체를 막아서는 안 된다 — cooldown 갱신 실패는 다음 턴에 재시도됨.
    console.error("[k-conversation/semanticTopicHistory] recordTopicUsage RPC failed", error.message);
  }
}

/** K가 이 semantic_group을 지금 먼저 꺼내도 되는지 판단한다.
 * codex-rv 2차 지적 반영: cooldown_until은 child가 그 주제를 계속 이어가기만 해도 계속
 * 갱신되므로, "최근에 이 주제가 쓰였다"만으로 판단하면 아이가 스스로 이어가는 대화까지
 * TOPIC_SHIFT로 끊어버리는 회귀가 생긴다. 반드시 last_initiated_by가 'k'이고 그 K의
 * 발화가 아직 cooldown 안에 있을 때만 true를 반환한다 — 아이가 먼저/계속 꺼내는 주제는
 * 이 함수가 절대 제한하지 않는다(071 §9 원칙). */
export async function isTopicOnCooldownForK(
  db: SupabaseClient,
  childId: string,
  semanticGroup: string,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("conversation_topics")
      .select("cooldown_until, last_initiated_by")
      .eq("child_id", childId)
      .eq("semantic_group", semanticGroup)
      .maybeSingle();
    if (error) {
      console.error("[k-conversation/semanticTopicHistory] isTopicOnCooldownForK query failed", error.message);
      return false; // fail-open — 조회 실패로 대화가 막히면 안 됨
    }
    if (!data?.cooldown_until || data.last_initiated_by !== "k") return false;
    return new Date(data.cooldown_until).getTime() > Date.now();
  } catch (error) {
    console.error("[k-conversation/semanticTopicHistory] isTopicOnCooldownForK failed", (error as Error).message);
    return false;
  }
}

export interface RecentTopic {
  semanticGroup: string;
  lastUsedAt: string;
  childFrequency: number;
  kFrequency: number;
  lastInitiatedBy: TopicInitiator;
  mode: TopicMode;
}

/** Boredom Detection·Action Selector가 최근 반복 패턴을 참고할 수 있도록 최근 topic 목록을 제공한다. */
export async function fetchRecentTopics(
  db: SupabaseClient,
  childId: string,
  limit: number = 10,
): Promise<RecentTopic[]> {
  try {
    const { data, error } = await db
      .from("conversation_topics")
      .select("semantic_group, last_used_at, child_frequency, k_frequency, last_initiated_by, mode")
      .eq("child_id", childId)
      .order("last_used_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data.map((row) => ({
      semanticGroup: row.semantic_group,
      lastUsedAt: row.last_used_at,
      childFrequency: row.child_frequency,
      kFrequency: row.k_frequency,
      lastInitiatedBy: row.last_initiated_by as TopicInitiator,
      mode: row.mode as TopicMode,
    }));
  } catch (error) {
    console.error("[k-conversation/semanticTopicHistory] fetchRecentTopics failed", (error as Error).message);
    return [];
  }
}
