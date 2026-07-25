/**
 * POST /api/quiz/start-handoff — 퀴즈마스터 시작 진입점 (requests/010 작업1)
 *
 * 로그인한 아이의 실제 학년을 조회하고 황금열쇠 1개를 차감한 뒤, 퀴즈마스터
 * `/api/auth/handoff`로 이동할 redirectUrl을 돌려준다. 골드키 소비는 MBTI 등 놀이
 * 세션 인프라(consume_play_access/k_play_sessions)가 아니라 기존 범용 경로
 * (lib/goldkey/ledger.ts의 consumeKeys)를 그대로 재사용한다 — lib/quiz/handoffToken.ts
 * 참고. MBTI 쪽 라우트/스키마는 이 경로에서 전혀 건드리지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { createQuizHandoffToken } from "@/lib/quiz/handoffToken";

export const runtime = "nodejs";

interface StartHandoffRequestBody {
  childId?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: StartHandoffRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const childId = typeof body.childId === "string" ? body.childId : "";
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const { allowed } = await requireChildAccess(supabase, user.id, childId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await createQuizHandoffToken(childId);

  if (!result.ok) {
    const status =
      result.reason === "insufficient_balance"
        ? 402
        : result.reason === "invalid_grade"
          ? 400
          : result.reason === "child_not_found"
            ? 404
            : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const quizmasterBaseUrl = process.env.QUIZMASTER_BASE_URL;
  if (!quizmasterBaseUrl) {
    console.error("[POST /api/quiz/start-handoff] QUIZMASTER_BASE_URL env not set");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const redirectUrl = `${quizmasterBaseUrl.replace(/\/$/, "")}/api/auth/handoff?handoff=${encodeURIComponent(result.token)}`;

  return NextResponse.json({ redirectUrl });
}
