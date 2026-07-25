import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAttemptAuth } from "./auth";
import { buildDisplayQuestion } from "./questions";
import { readSessionToken } from "./session-cookie";
import type {
  QuizApiErrorBody,
  QuizApiErrorCode,
  QuizAttemptHydrateResponse,
  QuizPlayQuestion,
} from "./api-contracts";
import type { QuizAttemptRow } from "./types";
import type { DrawnQuestionRow } from "./rpc-types";

// requests/021 — 퀴즈마스터 프로젝트에서 포팅(createAdminClient→createServiceClient만 교체).

export const ATTEMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const STATUS_BY_CODE: Record<QuizApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ATTEMPT_NOT_FOUND: 404,
  FORBIDDEN: 403,
  DEVICE_TAKEOVER: 409,
  ATTEMPT_ALREADY_SUBMITTED: 409,
  ATTEMPT_EXPIRED: 410,
  INVALID_REQUEST: 400,
  QUESTION_POOL_EMPTY: 422,
  TOKEN_INVALID: 400,
  GRADE_LOOKUP_FAILED: 500,
  INTERNAL: 500,
};

export function apiError(code: QuizApiErrorCode, message?: string): NextResponse<QuizApiErrorBody> {
  const body: QuizApiErrorBody = message ? { code, message } : { code };
  return NextResponse.json(body, { status: STATUS_BY_CODE[code] });
}

export async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function computeExpiresAt(startedAt: string): string {
  return new Date(new Date(startedAt).getTime() + ATTEMPT_MAX_AGE_MS).toISOString();
}

export type ResolveAttemptResult =
  | { ok: true; userId: string; attempt: QuizAttemptRow }
  | { ok: false; response: NextResponse<QuizApiErrorBody> };

export async function resolveAttempt(attemptId: string): Promise<ResolveAttemptResult> {
  const sessionToken = (await readSessionToken()) ?? "";
  const auth = await requireAttemptAuth({ attemptId, sessionToken });

  if (!auth.ok) {
    const body: QuizApiErrorBody = { code: auth.code };
    return { ok: false, response: NextResponse.json(body, { status: auth.status }) };
  }

  return { ok: true, userId: auth.userId, attempt: auth.attempt };
}

export type HydrationPayloadResult =
  | { ok: true; payload: QuizAttemptHydrateResponse }
  | { ok: false; response: NextResponse<QuizApiErrorBody> };

export async function buildHydrationPayload(
  attempt: QuizAttemptRow
): Promise<HydrationPayloadResult> {
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from("quiz_question_bank")
    .select("id, question_text, options")
    .in("id", attempt.selected_questions);
  if (error) return { ok: false, response: apiError("INTERNAL", error.message) };

  const byId = new Map<string, DrawnQuestionRow>();
  for (const r of (rows ?? []) as DrawnQuestionRow[]) byId.set(r.id, r);

  const questions: QuizPlayQuestion[] = [];
  for (const questionId of attempt.selected_questions) {
    const row = byId.get(questionId);
    const order = attempt.option_order[questionId];
    if (!row || !order) continue;
    questions.push(buildDisplayQuestion(row, order));
  }

  const payload: QuizAttemptHydrateResponse = {
    attempt: {
      id: attempt.id,
      grade: attempt.grade,
      subject: attempt.subject,
      status: attempt.status,
      current_position: attempt.current_position,
      completed_count: attempt.completed_count,
      submitted_answers: attempt.submitted_answers,
      accumulated_time_seconds: attempt.accumulated_time_seconds,
      started_at: attempt.started_at,
      expires_at: computeExpiresAt(attempt.started_at),
      score: attempt.score,
    },
    questions,
  };
  return { ok: true, payload };
}
