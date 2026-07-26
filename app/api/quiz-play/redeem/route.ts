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
 * RPC가 돌려준 user_id는 handoff token 발급 시점(lib/quiz/handoffToken.ts)에 저장된
 * "아이 본인의 family_members.user_id"다 - 호출자의 세션 user_id(부모가 child_id를
 * 지정해 아이 화면을 대신 조작하는 경우 부모 자신의 user_id)와 다를 수 있다. 도용
 * 방지 목적의 비교는 유지하되, 비교 대상을 호출자 세션이 아니라 body.childId가
 * 실제로 가리키는 아이 본인의 user_id로 잡아야 한다 - 그렇지 않으면 requireChildAccess로
 * 이미 허용된 "부모가 아이 화면 조작" 정상 케이스까지 TOKEN_INVALID로 막힌다
 * (실제로 재현: 부모 세션+child_id 접근 시 400, 아이 본인 세션 접근 시 정상 200 - 두
 * 경우의 유일한 차이가 이 비교였음을 실측 확인).
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

  // handoff token은 "아이 본인의 user_id"로 발급된다(lib/quiz/handoffToken.ts) - 도용
  // 방지 비교는 호출자 세션이 아니라 이 값과 맞춰야 한다.
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", body.childId)
    .maybeSingle();
  if (childErr || !child) return apiError("FORBIDDEN");

  const { data: member, error: memberErr } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();
  if (memberErr || !member) return apiError("FORBIDDEN");

  const { data: consumedUserId, error: consumeErr } = await service.rpc(
    "consume_quiz_handoff_token",
    { p_token: body.token }
  );
  if (consumeErr) return apiError("INTERNAL", consumeErr.message);
  if (!consumedUserId || consumedUserId !== member.user_id) {
    return apiError("TOKEN_INVALID");
  }

  const grade = await getUserGrade(member.user_id);
  if (grade === null) return apiError("GRADE_LOOKUP_FAILED");

  const response: QuizRedeemResponse = { grade };
  return NextResponse.json(response);
}
