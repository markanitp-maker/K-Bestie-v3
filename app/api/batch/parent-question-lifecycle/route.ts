import { NextRequest, NextResponse } from "next/server";
import { processParentQuestionLifecycle } from "@/lib/batch/processParentQuestionLifecycle";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 인증 검증
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processParentQuestionLifecycle();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Parent Question Lifecycle Batch Error]", err);
    return NextResponse.json({ error: "Internal server error", message: err.message }, { status: 500 });
  }
}
