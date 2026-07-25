/**
 * POST /api/quiz-play/redeem — requests/021: 퀴즈마스터 handoff token을 K-Bestie
 * 내부 세션에서 직접 소비한다.
 *
 * 기존(외부 리다이렉트) 흐름의 /api/auth/handoff가 하던 일 중 "token 소비"(Postgres
 * consume_quiz_handoff_token RPC, status pending/mint_failed → consumed 전이,
 * 만료·재시도예산 체크 포함) 부분만 그대로 재사용한다. 그 다음 단계였던
 * generateLink+verifyOtp(퀴즈마스터 전용 세션 발급)는 하지 않는다 - 이제 아이는
 * 이미 K-Bestie 자신의 세션으로 로그인돼 있으므로 별도 세션을 만들 필요가 없다.
 *
 * RPC가 돌려준 user_id가 현재 K-Bestie 세션의 user_id와 다르면(변조/재사용 의심)
 * 거부한다 - token 자체가 "issued to this user_id"라는 사실을 실어 나르므로, 이
 * 검증이 없으면 A 아이가 B 아이의 token을 훔쳐 자기 세션에 redeem할 수 있게 된다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getUserGrade } from "@/lib/quiz/play/grade";
import { apiError, parseJson } from "@/lib/quiz/play/route-helpers";
import type { QuizRedeemRequest, QuizRedeemResponse } from "@/lib/quiz/play/api-contracts";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return apiError("UNAUTHENTICATED");

  const body = await parseJson<QuizRedeemRequest>(req);
  if (!body || typeof body.token !== "string" || typeof body.childId !== "string") {
    return apiError("INVALID_REQUEST", "token, childId required");
  }

  const access = await requireChildAccess(authClient, user.id, body.childId);
  if (!access.allowed) return apiError("FORBIDDEN");

  const service = createServiceClient();
  const { data: consumedUserId, error: consumeErr } = await service.rpc(
    "consume_quiz_handoff_token",
    { p_token: body.token }
  );
  if (consumeErr) return apiError("INTERNAL", consumeErr.message);
  if (!consumedUserId || consumedUserId !== user.id) {
    return apiError("TOKEN_INVALID");
  }

  const grade = await getUserGrade(user.id);
  if (grade === null) return apiError("GRADE_LOOKUP_FAILED");

  const response: QuizRedeemResponse = { grade };
  return NextResponse.json(response);
}
