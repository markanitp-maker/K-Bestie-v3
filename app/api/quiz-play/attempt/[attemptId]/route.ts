/**
 * GET /api/quiz-play/attempt/[attemptId] — requests/021: 퀴즈마스터에서 포팅.
 * 재생 페이지 로드/이어하기/기기전환 시 hydrate한다. 이중 게이트(인증+소유권+기기잠금+
 * 6시간만료) 통과 후 고정된 문항셋(표시순서 적용, 답안key 제거)+현재 진행률을 반환한다.
 * 읽기 전용.
 */

import "server-only";

import { NextResponse } from "next/server";
import { buildHydrationPayload, resolveAttempt } from "@/lib/quiz/play/route-helpers";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ attemptId: string }> }
): Promise<NextResponse> {
  const { attemptId } = await ctx.params;

  const resolved = await resolveAttempt(attemptId);
  if (!resolved.ok) return resolved.response;

  const hydration = await buildHydrationPayload(resolved.attempt);
  if (!hydration.ok) return hydration.response;

  return NextResponse.json(hydration.payload);
}
