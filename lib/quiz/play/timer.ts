import type { QuizAttemptStatus } from "./types";

// 퀴즈마스터 프로젝트에서 포팅 — 서버 권위 타이머 계산의 순수 로직 미러(실제 소스오브트루스는
// Postgres RPC(quiz_apply_signal/quiz_enter_background/quiz_submit_attempt)이고, 이 파일은
// 그 계산식을 DB 없이 테스트하기 위한 미러일 뿐이다).
//
// 규칙: 백그라운드 경과 시간은 절대 봐주지 않는다(항상 전액 과금). 오직 진짜 무응답
// 연결끊김(status='in_progress'인데 delta>90초)만 budget 한도 내에서 제외한다.

export const SILENT_DISCONNECT_THRESHOLD_SECONDS = 90;
export const BACKGROUND_BUDGET_DEFAULT_SECONDS = 180;

export interface TimerChargeInput {
  status: QuizAttemptStatus;
  deltaSeconds: number;
  budgetRemaining: number;
}

export interface TimerChargeResult {
  charged: number;
  excluded: number;
  newBudget: number;
}

export function computeTimerCharge({
  status,
  deltaSeconds,
  budgetRemaining,
}: TimerChargeInput): TimerChargeResult {
  const excluded =
    status === "in_progress" && deltaSeconds > SILENT_DISCONNECT_THRESHOLD_SECONDS
      ? Math.min(deltaSeconds, budgetRemaining)
      : 0;

  const charged = Math.max(0, deltaSeconds - excluded);
  const newBudget = Math.max(0, budgetRemaining - excluded);

  return { charged, excluded, newBudget };
}
