import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getLlmStatusList } from "@/lib/admin/llmStatus";

export const runtime = "nodejs";
// no-store to prevent caching on vercel
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const entries = getLlmStatusList();

  const total = entries.length;
  const normal = entries.filter((e) => e.status === "정상" || e.status === "기본값 사용").length;
  const missing = entries.filter((e) => e.status === "미설정").length;
  const mismatch = entries.filter((e) => e.status === "설정 불일치").length;

  return NextResponse.json({
    summary: {
      environment: process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "Production" : "Development",
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || "Unknown",
      buildTime: process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE || "Unknown",
      lastCheckTime: new Date().toISOString(),
      total,
      normal,
      missing,
      mismatch,
    },
    entries,
  });
}
