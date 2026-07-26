/**
 * POST /api/quiz-play/start — requests/021: 퀴즈마스터 app/api/quiz/start/route.ts에서
 * 포팅. {grade, subject}로 새 attempt를 시작한다: 서버에서 10문항을 무작위 추첨하고
 * 그 문항+문항별 표시순서를 attempt row에 고정, 기기잠금용 session_token 쿠키를
 * 발급, 클라이언트로 답안key를 제거한 재생 페이로드를 반환한다.
 *
 * 인증만 K-Bestie 세션(@/lib/quiz/play/auth)으로 교체 - RPC(quiz_draw_questions/
 * quiz_claim_handoff_entry)와 quiz_attempts 삽입 로직은 원본과 동일하다.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { createClient } from "@/lib/supabase/server";
import { buildDisplayQuestion, generateOptionOrder } from "@/lib/quiz/play/questions";
import {
  generateDeviceId,
  generateSessionToken,
  setSessionToken,
} from "@/lib/quiz/play/session-cookie";
import { apiError, computeExpiresAt, parseJson } from "@/lib/quiz/play/route-helpers";
import type {
  QuizPlayQuestion,
  QuizStartRequest,
  QuizStartResponse,
} from "@/lib/quiz/play/api-contracts";
import type { QuizGrade, QuizOptionOrder, QuizSubject } from "@/lib/quiz/play/types";
import type { ClaimHandoffEntryRow, DrawnQuestionRow } from "@/lib/quiz/play/rpc-types";

export const runtime = "nodejs";

const SUBJECTS: readonly QuizSubject[] = ["국어", "영어", "수학", "과학", "사회", "창의", "상식"];
const QUESTIONS_PER_ATTEMPT = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return apiError("UNAUTHENTICATED");

  const body = await parseJson<QuizStartRequest>(req);
  if (
    !body ||
    typeof body.childId !== "string" ||
    typeof body.grade !== "number" ||
    !Number.isInteger(body.grade) ||
    body.grade < 1 ||
    body.grade > 6 ||
    typeof body.subject !== "string" ||
    !SUBJECTS.includes(body.subject as QuizSubject)
  ) {
    return apiError("INVALID_REQUEST", "childId, grade (1-6), subject are required");
  }

  const access = await requireChildAccess(authClient, user.id, body.childId);
  if (!access.allowed) return apiError("FORBIDDEN");

  const approvalBlocked = await checkApprovalForChild(body.childId);
  if (approvalBlocked) return NextResponse.json({ error: "FORBIDDEN", message: "베타 승인 대기 중" }, { status: 403 });

  const grade = body.grade as QuizGrade;
  const subject = body.subject as QuizSubject;
  const userId = user.id;

  const supabase = createServiceClient();

  // 학년 잠금: 클라이언트 값이 아니라 handoff token에 미리 기록된 값과 일치해야 한다.
  const { data: lockedGradeRow, error: lockedGradeErr } = await supabase
    .from("quiz_handoff_tokens")
    .select("grade")
    .eq("user_id", userId)
    .eq("status", "consumed")
    .not("grade", "is", null)
    .not("reward_transaction_id", "is", null)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lockedGradeErr) return apiError("INTERNAL", lockedGradeErr.message);
  if (!lockedGradeRow || lockedGradeRow.grade === null) {
    return apiError("INTERNAL", "no grade on file for this entry");
  }
  if (lockedGradeRow.grade !== grade) {
    return apiError("FORBIDDEN", "requested grade does not match the locked grade");
  }

  const { data: drawnData, error: drawError } = await supabase.rpc("quiz_draw_questions", {
    p_grade: grade,
    p_subject: subject,
  });
  if (drawError) return apiError("INTERNAL", drawError.message);

  const drawn = (drawnData ?? []) as DrawnQuestionRow[];
  if (drawn.length < QUESTIONS_PER_ATTEMPT) return apiError("QUESTION_POOL_EMPTY");

  const { data: claimData, error: claimError } = await supabase.rpc("quiz_claim_handoff_entry", {
    p_user_id: userId,
  });
  if (claimError) return apiError("INTERNAL", claimError.message);

  const claimed = ((claimData ?? []) as ClaimHandoffEntryRow[])[0];
  if (!claimed) return apiError("INTERNAL", "no unclaimed reward entry for this user");
  if (claimed.grade !== grade) {
    return apiError("INTERNAL", "claimed entry grade mismatch");
  }

  const selected = drawn.slice(0, QUESTIONS_PER_ATTEMPT);
  const optionOrder: QuizOptionOrder = {};
  for (const q of selected) optionOrder[q.id] = generateOptionOrder();

  const sessionToken = generateSessionToken();
  const deviceId = generateDeviceId();

  const { data: inserted, error: insertError } = await supabase
    .from("quiz_attempts")
    .insert({
      user_id: userId,
      device_id: deviceId,
      session_token: sessionToken,
      grade,
      subject,
      selected_questions: selected.map((q) => q.id),
      option_order: optionOrder,
      reward_transaction_id: claimed.reward_transaction_id,
      child_id: claimed.child_id,
    })
    .select(
      "id, status, current_position, completed_count, submitted_answers, accumulated_time_seconds, started_at"
    )
    .single();
  if (insertError || !inserted) {
    return apiError("INTERNAL", insertError?.message ?? "attempt insert failed");
  }

  await setSessionToken(sessionToken);

  const questions: QuizPlayQuestion[] = selected.map((q) =>
    buildDisplayQuestion(q, optionOrder[q.id])
  );

  const response: QuizStartResponse = {
    attemptId: inserted.id,
    grade,
    subject,
    status: inserted.status,
    current_position: inserted.current_position,
    completed_count: inserted.completed_count,
    submitted_answers: inserted.submitted_answers,
    accumulated_time_seconds: inserted.accumulated_time_seconds,
    started_at: inserted.started_at,
    expires_at: computeExpiresAt(inserted.started_at),
    questions,
  };
  return NextResponse.json(response);
}
