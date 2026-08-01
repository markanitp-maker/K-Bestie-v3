import { NextRequest, NextResponse } from "next/server";
import { runContextCorrectionPipeline } from "@/lib/batch/contextCorrection";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date?: string; sessionIds?: string[] } = {};
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

  try {
    const result = await runContextCorrectionPipeline(targetDate, body.sessionIds);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[batch/correction] 실패:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
