import { SupabaseClient } from "@supabase/supabase-js";

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

export async function checkAndDeductQuota(supabase: SupabaseClient, childId: string): Promise<{ allowed: boolean, reason?: string }> {
  const nowMs = Date.now();
  const currentWeekReset = getWeeklyResetAtKST(nowMs);
  const todayStr = getKSTDateString(nowMs);

  const { data: quota, error } = await supabase
    .from("parent_question_quota")
    .select("*")
    .eq("child_id", childId)
    .maybeSingle();

  if (error) throw error;

  if (!quota) {
    const { error: insErr } = await supabase.from("parent_question_quota").insert({
      child_id: childId,
      daily_used_at: todayStr,
      weekly_used_count: 1,
      weekly_reset_at: currentWeekReset
    });
    if (insErr) throw insErr;
    return { allowed: true };
  }

  let { daily_used_at, weekly_used_count, weekly_reset_at } = quota;

  if (weekly_reset_at < currentWeekReset) {
    weekly_used_count = 0;
    weekly_reset_at = currentWeekReset;
  }

  if (weekly_used_count >= 2) {
    return { allowed: false, reason: "주 2회 한도를 초과했습니다." };
  }

  if (daily_used_at === todayStr) {
    return { allowed: false, reason: "하루 1회만 질문할 수 있습니다." };
  }

  const { error: upErr } = await supabase.from("parent_question_quota")
    .update({
      daily_used_at: todayStr,
      weekly_used_count: weekly_used_count + 1,
      weekly_reset_at: currentWeekReset
    })
    .eq("child_id", childId);
  
  if (upErr) throw upErr;
  return { allowed: true };
}

export async function refundQuota(supabase: SupabaseClient, childId: string) {
  const { data: quota } = await supabase
    .from("parent_question_quota")
    .select("weekly_used_count")
    .eq("child_id", childId)
    .maybeSingle();
    
  if (quota && quota.weekly_used_count > 0) {
    await supabase.from("parent_question_quota")
      .update({ weekly_used_count: quota.weekly_used_count - 1 })
      .eq("child_id", childId);
  }
}
