import { closeFreeSessions, type CloseResult } from "./closeFreeSessions";
import { generateDailyReports, type DailyReportResult } from "./generateDailyReports";
import { generateWeeklySummary, type WeeklySummaryResult } from "./generateWeeklySummary";

export interface BatchResult {
  date: string;
  step1_close: CloseResult;
  step2_reports: DailyReportResult;
  step3_weekly: WeeklySummaryResult;
  durationMs: number;
}

/**
 * ⚠️ 로컬 수동 테스트 전용 — 운영 스케줄 경로 아님.
 *    운영 배치의 소스오브트루스는 Supabase Edge Function(supabase/functions/daily-batch, weekly-batch).
 *    이 모듈은 개발 편의용으로만 유지하며, 로직 수정 시 Edge Function(_shared/batch.ts)과 함께 맞출 것.
 *
 * 새벽 4시 배치 진입점 — 반드시 (1)→(2)→(3) 순서로 실행
 *
 * @param targetDate  "YYYY-MM-DD" (KST 기준 배치 실행일)
 * @param forceWeekly 토요일이 아니어도 직전 완료 주간 요약 강제 실행
 */
export async function runDailyBatch(
  targetDate: string,
  forceWeekly = false,
): Promise<BatchResult> {
  const start = Date.now();

  // ── Step 1: 자유 대화 세션 마감 ──────────────────────────────
  // 리포트 생성 전에 반드시 실행 — 아직 안 닫힌 세션이 리포트에서 빠지는 일 방지
  const step1 = await closeFreeSessions(targetDate);

  // ── Step 2: 일일 리포트 생성 ──────────────────────────────────
  // Step 1이 완료된 뒤 targetDate에 ended_at 찍힌 세션 전체 대상
  const step2 = await generateDailyReports(targetDate);

  // ── Step 3: 직전 완료 주간 요약 (토요일 또는 forceWeekly=true) ─
  const step3 = await generateWeeklySummary(targetDate, forceWeekly);

  return {
    date: targetDate,
    step1_close: step1,
    step2_reports: step2,
    step3_weekly: step3,
    durationMs: Date.now() - start,
  };
}
