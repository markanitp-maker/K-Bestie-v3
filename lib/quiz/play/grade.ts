import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { QuizGrade } from "./types";

/**
 * requests/021 — 퀴즈마스터 프로젝트 lib/quiz/grade.ts에서 포팅(createAdminClient()
 * → createServiceClient()만 교체, 나머지 로직/조건 동일).
 *
 * K-Bestie(메인 앱)가 quiz_handoff_tokens.grade에 handoff token 발급 시점에 이미
 * 학년을 써 넣어두므로(lib/quiz/handoffToken.ts), 여기서는 그 값을 읽기만 한다 -
 * 클라이언트가 보낸 학년을 신뢰하지 않는다.
 *
 * status='consumed'인 가장 최근 항목만 조회한다 - /api/quiz-play/start가 그 항목을
 * claim(quiz_claim_handoff_entry)하고 나면(status='claimed') 더 이상 여기서 조회되지
 * 않는다(이미 quiz_attempts 쪽에 학년이 남아있으므로 재조회할 필요가 없어짐).
 */
export async function getUserGrade(userId: string): Promise<QuizGrade | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quiz_handoff_tokens")
    .select("grade")
    .eq("user_id", userId)
    .eq("status", "consumed")
    .not("grade", "is", null)
    .not("reward_transaction_id", "is", null)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getUserGrade: ${error.message}`);
  if (!data || data.grade === null) return null;

  return data.grade as QuizGrade;
}
