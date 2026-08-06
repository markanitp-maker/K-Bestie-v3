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
  const normal = entries.filter((e) => e.status === "정상").length;
  const error = entries.filter((e) => e.status === "오류").length;

  return NextResponse.json({
    summary: {
      environment: process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "Production" : "Development",
      lastCheckTime: new Date().toISOString(),
      total,
      normal,
      error,
    },
    entries,
  });
}
