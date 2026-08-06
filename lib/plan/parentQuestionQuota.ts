import { SupabaseClient } from "@supabase/supabase-js";

// requests/request-parent-question-feature.md §2.1/§11
// 정책 변경: "주 2회 + 일 1회"(비원자적, 애플리케이션 레벨 체크-then-업데이트) →
// "주 3회만"(일일 제한 없음), 반드시 DB에서 원자적으로 처리. 실제 차감/환불은
// supabase/migrations/20260804120000_parent_question_reconfirm_quota.sql의
// try_deduct_parent_question_quota / refund_parent_question_quota RPC(행 잠금으로
// 동시 요청 직렬화)가 담당하고, 이 파일은 그 RPC를 호출하는 얇은 래퍼로만 남는다.

export function getWeeklyResetAtKST(nowMs: number): string {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0: Sun, 1: Mon
  const diff = day === 0 ? 6 : day - 1;
  kst.setUTCDate(kst.getUTCDate() - diff);
  kst.setUTCHours(0, 0, 0, 0);
  return kst.toISOString();
}

export function getKSTDateString(nowMs: number): string {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}

export const WEEKLY_QUESTION_LIMIT = 3;

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  weeklyUsedCount?: number;
  weeklyResetAt?: string;
  dailyLimitReached?: boolean;
}

export async function checkAndDeductQuota(supabase: SupabaseClient, childId: string): Promise<QuotaCheckResult> {
  const { data, error } = await supabase.rpc("try_deduct_parent_question_quota", { p_child_id: childId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("try_deduct_parent_question_quota returned no rows");

  if (!row.allowed) {
    // requests/request-parent-query-router-grade4-v1.md §3/§15.5 — 같은 날 두 번째 질문은
    // 별도 사유로 안내한다(주간 소진과 구분).
    if (row.daily_limit_reached) {
      return {
        allowed: false,
        reason: "오늘은 이미 아이에게 질문을 등록했어요. 내일 다시 이용할 수 있어요.",
        weeklyUsedCount: row.weekly_used_count,
        weeklyResetAt: row.weekly_reset_at,
        dailyLimitReached: true,
      };
    }
    return {
      allowed: false,
      reason: `이번 주 질문 ${WEEKLY_QUESTION_LIMIT}회를 모두 사용했어요. 다음 주 월요일에 다시 이용할 수 있어요.`,
      weeklyUsedCount: row.weekly_used_count,
      weeklyResetAt: row.weekly_reset_at,
      dailyLimitReached: false,
    };
  }
  return { allowed: true, weeklyUsedCount: row.weekly_used_count, weeklyResetAt: row.weekly_reset_at };
}

/** 등록 전 남은 횟수를 미리 보여줄 때(질문 초안 모달) 차감 없이 현재 사용량만 조회한다. */
export async function peekQuota(
  supabase: SupabaseClient,
  childId: string,
): Promise<{ weeklyUsedCount: number; weeklyResetAt: string | null; dailyUsedToday: boolean }> {
  const nowMs = Date.now();
  const currentWeekReset = getWeeklyResetAtKST(nowMs);
  const todayKST = getKSTDateString(nowMs);
  const { data: quota, error } = await supabase
    .from("parent_question_quota")
    .select("weekly_used_count, weekly_reset_at, daily_used_at")
    .eq("child_id", childId)
    .maybeSingle();
  if (error) throw error;
  const dailyUsedToday = !!quota?.daily_used_at && getKSTDateString(new Date(quota.daily_used_at).getTime()) === todayKST;
  if (!quota || quota.weekly_reset_at < currentWeekReset) {
    return { weeklyUsedCount: 0, weeklyResetAt: currentWeekReset, dailyUsedToday };
  }
  return { weeklyUsedCount: quota.weekly_used_count, weeklyResetAt: quota.weekly_reset_at, dailyUsedToday };
}

export async function refundQuota(supabase: SupabaseClient, childId: string) {
  const { error } = await supabase.rpc("refund_parent_question_quota", { p_child_id: childId });
  if (error) throw error;
}
