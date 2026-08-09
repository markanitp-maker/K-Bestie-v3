import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { createServiceClient } from "@/lib/supabase/server";
import { sendMissionStartPushToChild, type MissionPushType } from "@/lib/mission/missionPushService";
import { isPushTestChild } from "@/lib/admin/pushTestEligibility";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id")?.slice(0, 100) || crypto.randomUUID();
  const { denied, actor } = await requireAdminActor("admin_mission_push_test", requestId);
  if (denied) return denied;

  let body: { childId?: unknown; missionType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const childId = typeof body.childId === "string" ? body.childId.trim() : "";
  const missionType = body.missionType;
  if (!UUID_PATTERN.test(childId)) return NextResponse.json({ error: "아이 정보가 올바르지 않습니다." }, { status: 400 });
  if (missionType !== 1 && missionType !== 2) return NextResponse.json({ error: "미션은 1 또는 2만 선택할 수 있습니다." }, { status: 400 });

  const db = createServiceClient();
  const { data: child, error: childError } = await db
    .from("child_profiles")
    .select("id,name,family_id,is_internal_test,is_test_account")
    .eq("id", childId)
    .maybeSingle();
  if (childError) return NextResponse.json({ error: "아이 정보를 확인하지 못했습니다." }, { status: 500 });
  if (!child) return NextResponse.json({ error: "아이를 찾을 수 없습니다." }, { status: 404 });

  let testFamilyIds: Set<string>;
  try {
    testFamilyIds = await getTestFamilyIds(db);
  } catch (error) {
    console.error("[admin/push-test/send] test family lookup failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "테스트 계정 여부를 확인하지 못했습니다." }, { status: 500 });
  }
  if (!isPushTestChild(child, testFamilyIds)) return NextResponse.json({ error: "테스트 계정만 발송할 수 있습니다." }, { status: 403 });

  const { data: audit, error: auditError } = await db.from("admin_audit_log").insert({
    admin_user_id: actor.id,
    admin_email: actor.email,
    action: "ADMIN_MISSION_PUSH_TEST",
    child_id: childId,
    resource_type: "mission_push_test",
    resource_id: `${childId}:${missionType}`,
    before_snapshot: null,
    after_snapshot: { missionType, result: "pending" },
    request_id: requestId,
    source: actor.source,
  }).select("id").single();
  if (auditError || !audit) {
    console.error("[admin/push-test/send] audit insert failed", auditError?.code ?? "missing");
    return NextResponse.json({ error: "감사 로그를 기록하지 못해 발송을 중단했습니다." }, { status: 500 });
  }

  try {
    const result = await sendMissionStartPushToChild({ childId, missionType: missionType as MissionPushType, source: "admin_test" });
    await db.from("admin_audit_log").update({ after_snapshot: { missionType, result: result.outcome, successfulSubscriptions: result.successfulSubscriptions, failedSubscriptions: result.failedSubscriptions } }).eq("id", audit.id);
    if (result.outcome === "duplicate") return NextResponse.json({ error: "같은 발송 요청이 이미 처리 중입니다.", code: "duplicate_request" }, { status: 409 });
    if (result.outcome === "no_subscription") return NextResponse.json({ error: "활성 푸시 구독이 없습니다.", code: "NO_SUBSCRIPTION", childName: child.name, missionType }, { status: 409 });
    if (result.outcome === "failed") return NextResponse.json({ error: "푸시 발송에 실패했습니다.", code: result.errorCode, childName: child.name, missionType, successfulSubscriptions: result.successfulSubscriptions, failedSubscriptions: result.failedSubscriptions }, { status: 502 });
    return NextResponse.json({ ok: true, childName: child.name, missionType, successfulSubscriptions: result.successfulSubscriptions, failedSubscriptions: result.failedSubscriptions });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    await db.from("admin_audit_log").update({ after_snapshot: { missionType, result: "error", code } }).eq("id", audit.id);
    console.error("[admin/push-test/send] send failed", code);
    return NextResponse.json({ error: "푸시 발송 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
