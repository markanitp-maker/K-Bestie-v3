// requests/request-parent-question-feature.md §9 "부모 리포트 반영"
// status === ANSWERED(=confirmed) AND confirmation_completed_at(=confirmed_at) IS NOT NULL
// 인 부모 질문 답변만, 해당 날짜 일일 리포트에 요약형으로 반영한다. 거부·미확인 답변은
// 절대 반영하지 않는다(§9 마지막 문장) — 이 함수는 status='confirmed'만 조회하므로
// 자연히 그 조건을 만족한다.
//
// 리포트 생성 프롬프트 자체를 바꾸지 않고, 저장 직후 후처리로 recurring_stories에
// 짧게 덧붙이는 방식을 택했다 — 이미 세밀하게 튜닝된 리포트 생성 프롬프트/스키마를
// 건드리지 않고 낮은 위험으로 반영하기 위함.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function appendConfirmedParentAnswersToReport(
  db: SupabaseClient,
  childId: string,
  businessDate: string,
  reportId: string,
): Promise<void> {
  try {
    const startOfDayKst = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
    const endOfDayKst = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();

    const { data: confirmedQuestions, error } = await db
      .from("parent_questions")
      .select("child_answer_summary")
      .eq("child_id", childId)
      .eq("status", "confirmed")
      .gte("confirmed_at", startOfDayKst)
      .lte("confirmed_at", endOfDayKst)
      .not("child_answer_summary", "is", null);

    if (error) {
      console.error("[parentQuestionReportIntegration] 확정 답변 조회 실패:", error.message);
      return;
    }
    const summaries = (confirmedQuestions ?? [])
      .map((q) => (q.child_answer_summary ?? "").trim())
      .filter(Boolean);
    if (summaries.length === 0) return;

    const { data: existing, error: fetchErr } = await db
      .from("daily_reports")
      .select("recurring_stories")
      .eq("id", reportId)
      .maybeSingle();
    if (fetchErr) {
      console.error("[parentQuestionReportIntegration] 리포트 조회 실패:", fetchErr.message);
      return;
    }

    const merged = [existing?.recurring_stories?.trim(), ...summaries].filter(Boolean).join(" ");
    const { error: updateErr } = await db.from("daily_reports").update({ recurring_stories: merged }).eq("id", reportId);
    if (updateErr) {
      console.error("[parentQuestionReportIntegration] 리포트 갱신 실패:", updateErr.message);
    }
  } catch (e) {
    console.error("[parentQuestionReportIntegration] 예외:", e);
  }
}
