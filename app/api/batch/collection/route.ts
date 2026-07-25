import { NextRequest, NextResponse } from "next/server";
import { runContextCorrectionPipeline } from "@/lib/batch/contextCorrection";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * requests/018 — Raw 대화 수집 + Gemini 맥락 보정 배치.
 * pg_cron이 18:00/23:59(KST) 두 번 호출하는 실제 스케줄 진입점(app/api/batch/daily/route.ts와
 * 동일하게 BATCH_SECRET Bearer 인증). 같은 날짜에 여러 번 실행돼도 raw_daily_conversations.
 * chat_message_id UNIQUE + corrected_daily_conversations.raw_conversation_id UNIQUE 제약으로
 * 멱등적으로 동작한다(이미 수집/보정된 건은 건너뜀).
 *
 * POST /api/batch/collection
 * Headers: Authorization: Bearer <BATCH_SECRET>
 * Body (선택): { "date": "YYYY-MM-DD" } — 생략 시 오늘 KST 날짜.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body 없으면 기본값 */
  }

  const targetDate =
    body.date ??
    (() => {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      return kst.toISOString().slice(0, 10);
    })();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await runContextCorrectionPipeline(targetDate);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[batch/collection] 실패:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
