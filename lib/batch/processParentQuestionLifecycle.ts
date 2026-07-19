import { createServiceClient } from "@/lib/supabase/server";
import { refundQuota } from "@/lib/plan/parentQuestionQuota";

export async function processParentQuestionLifecycle() {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  
  const { data: questions, error } = await supabase
    .from("parent_questions")
    .select("*")
    .lt("deadline_at", now)
    .not("status", "in", "('confirmed','declined','mission_incomplete','failed_system','failed_recovered')");

  if (error) {
    console.error("Failed to fetch overdue parent questions:", error);
    return { processed: 0, failedRecovered: 0 };
  }

  const results = await Promise.allSettled((questions || []).map(async (q) => {
    const attempts = (q.retry_count || 0) + 1;
    
    if (attempts >= 3) {
      // Mark as failed_recovered and refund quota
      await supabase.from("parent_questions").update({
        status: "failed_recovered",
        retry_count: attempts,
        last_retry_at: new Date().toISOString()
      }).eq("id", q.id);
      
      await refundQuota(supabase, q.child_id);
      console.log(`[Batch] Question ${q.id} failed completely. Quota refunded.`);
      return true;
    } else {
      // Increment retry
      await supabase.from("parent_questions").update({
        retry_count: attempts,
        last_retry_at: new Date().toISOString()
      }).eq("id", q.id);
      console.log(`[Batch] Question ${q.id} retry ${attempts}/3`);
      return false;
    }
  }));

  const processed = questions?.length || 0;
  const failedRecovered = results.filter(
    (r) => r.status === "fulfilled" && r.value === true
  ).length;

  return { processed, failedRecovered };
}
