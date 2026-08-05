/**
 * POST /api/quiz/start-handoff — 퀴즈마스터 시작 진입점 (requests/010 작업1)
 *
 * 로그인한 아이의 실제 학년을 조회하고 황금열쇠 2개를 차감한 뒤 handoff token을
 * 돌려준다. 골드키 소비는 MBTI 등 놀이 세션 인프라(consume_play_access/
 * k_play_sessions)가 아니라 기존 범용 경로(lib/goldkey/ledger.ts의 consumeKeys)를
 * 그대로 재사용한다 — lib/quiz/handoffToken.ts 참고. MBTI 쪽 라우트/스키마는 이
 * 경로에서 전혀 건드리지 않는다.
 *
 * requests/021(퀴즈마스터 인앱 모달 전환) 이후: 외부 quizmaster 배포로의 redirectUrl
 * 대신 token 자체를 반환한다 - 클라이언트(app/child/play/page.tsx)가 sessionStorage로
 * /play/quiz에 전달하고, 그 화면이 /api/quiz-play/redeem에서 이 token을 직접
 * 소비한다(더 이상 외부 URL 이동이 없으므로 QUIZMASTER_BASE_URL을 참조하지 않는다).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { createQuizHandoffToken } from "@/lib/quiz/handoffToken";

export const runtime = "nodejs";

interface StartHandoffRequestBody {
  childId?: string;
  mode?: "start" | "restart";
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

  const { allowed, child } = await requireChildAccess(supabase, user.id, childId);
  if (!allowed || !child) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // requests/023 "새로 시작하기": 기존 진행 attempt 종료는 여기서 하지 않는다.
  // 차감보다 먼저 종료하면 잔액 부족으로 시작이 실패했을 때 진행하던 퀴즈만 사라진다.
  // begin_quiz_start_charge RPC가 같은 트랜잭션 안에서 (차감 → 종료) 순서로 처리한다.
  const result = await createQuizHandoffToken(childId, user.id, child.grade, {
    isRestart: body.mode === "restart",
  });

  if (!result.ok) {
    const status =
      result.reason === "insufficient_balance"
        ? 402
        : result.reason === "invalid_grade"
          ? 400
          : result.reason === "child_not_found"
            ? 404
            : // 이미 같은 아이의 시작 요청이 처리 중(더블클릭·다중 탭) — 차감은 일어나지 않았다.
              result.reason === "already_starting"
              ? 409
              : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ token: result.token });
}
