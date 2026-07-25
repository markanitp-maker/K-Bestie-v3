import { NextRequest, NextResponse } from "next/server";
import { runContextCorrectionPipeline } from "@/lib/batch/contextCorrection";
import { isAdminEmail } from "@/lib/admin/isAdminEmail";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date?: string; sessionIds?: string[] } = {};
  try { body = await req.json(); } catch { }

  const targetDate = body.date ?? (() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  })();

  try {
    const result = await runContextCorrectionPipeline(targetDate, body.sessionIds);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[context-correction] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
