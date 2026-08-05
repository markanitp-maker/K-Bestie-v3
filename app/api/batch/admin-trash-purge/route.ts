import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { SOFT_DELETE_RETENTION_DAYS, purgeExpired } from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 관리자 휴지통 30일 경과분 자동 영구 삭제 (requests/066 §6)
 *
 * Vercel Cron이 GET으로 호출하고, 수동 실행은 POST로도 가능하다.
 * 인증: Authorization: Bearer <BATCH_SECRET | CRON_SECRET> — 시크릿이 설정돼 있지
 * 않으면 fail-closed로 401을 반환한다(기존 배치 라우트와 동일한 패턴).
 *
 * 대상은 softDeleteService의 화이트리스트(관리자 운영 요청/처리 이력)뿐이다.
 * 부모·아이·가족·대화·미션·리포트·원장 데이터는 이 경로로 삭제되지 않는다.
 * 감사 로그(admin_audit_log)는 영구 삭제 대상이 아니며 그대로 보존한다.
 */
async function handle(req: NextRequest) {
  const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  const authHeader = req.headers.get("authorization") ?? "";

  if (configuredSecrets.length === 0 || !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await purgeExpired(
      createServiceClient(),
      { id: null, email: "system@k-bestie.batch", source: "cron" },
      { retentionDays: SOFT_DELETE_RETENTION_DAYS }
    );

    const purgedTotal = results.reduce((sum, r) => sum + r.purged, 0);
    const errors = results.flatMap((r) => r.errors.map((message) => `${r.resource}: ${message}`));

    console.log("[batch/admin-trash-purge] 완료:", {
      retentionDays: SOFT_DELETE_RETENTION_DAYS,
      purgedTotal,
      byResource: results.map((r) => ({ resource: r.resource, purged: r.purged })),
      errorCount: errors.length,
    });

    return NextResponse.json({ ok: true, retentionDays: SOFT_DELETE_RETENTION_DAYS, purgedTotal, results, errors });
  } catch (err) {
    console.error("[batch/admin-trash-purge] error:", err);
    return NextResponse.json({ error: "영구 삭제 배치 실행 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
