import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { LIVE_VOICE_NAMES } from "@/lib/plan/liveVoices";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await supabase
      .from("child_profiles")
      .select("id, name, given_name, family_name, grade, interests, tier, live_voice_name")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    name?: string;
    familyName?: string;
    givenName?: string;
    grade?: string;
    interests?: string[];
    liveVoiceName?: string;
    withdrawConsent?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  // 법정대리인 동의 철회 — RLS(child_profiles_update)가 이미 owner_parent/parent만 허용하므로
  // 여기서 별도 role 체크는 하지 않는다. 철회 시 guardian_consent를 false로 되돌리고
  // 철회 시각을 남긴다(재동의 시에는 children/members 등록 플로우를 다시 타야 하므로 별도 API 없음).
  if (body.withdrawConsent === true) {
    updateData.guardian_consent = false;
    updateData.guardian_consent_withdrawn_at = new Date().toISOString();
  }
  
  if (typeof body.familyName === "string" && typeof body.givenName === "string") {
    updateData.family_name = body.familyName.trim();
    updateData.given_name = body.givenName.trim();
    updateData.name = (body.familyName.trim() + body.givenName.trim()).trim();

    if (Array.isArray(body.interests) && body.interests.length === 0) {
      return NextResponse.json({ error: "관심사를 한 개 이상 선택해 주세요." }, { status: 400 });
    }
  } else if (body.name?.trim()) {
    updateData.name = body.name.trim();
  }
  
  if (body.grade) updateData.grade = body.grade;
  if (Array.isArray(body.interests)) updateData.interests = body.interests;
  if (body.liveVoiceName) {
    if (!LIVE_VOICE_NAMES.includes(body.liveVoiceName)) {
      return NextResponse.json({ error: "지원하지 않는 목소리입니다" }, { status: 400 });
    }
    updateData.live_voice_name = body.liveVoiceName;
  }
  // 요금제(tier)는 이 라우트로 즉시 변경할 수 없다 — requests/027 결정에 따라 요금제 변경은
  // /api/child/[id]/plan-change-request로 요청을 생성하고 관리자 승인 시에만 실제 반영된다
  // (admin_approve_plan_change_request RPC). 여기서 tier를 다시 받으면 승인 절차를 우회하게
  // 되므로 body.tier는 의도적으로 읽지 않는다.

  // child 역할(자녀 본인)은 자기 프로필에서 목소리(live_voice_name)만 바꿀 수 있다.
  // RLS(child_profiles_update)가 child 역할의 UPDATE를 조용히 0-row로 막으므로 아래 실제
  // 쓰기는 서비스 클라이언트로 수행한다 — 그만큼 여기서 필드를 명시적으로 제한해 자녀가
  // tier/동의철회/이름/학년/관심사 등 부모 전용 필드를 바꾸지 못하게 한다(권한 상승 방지).
  if (authCheck.role === "child") {
    const disallowed = Object.keys(updateData).filter((k) => k !== "live_voice_name");
    if (disallowed.length > 0) {
      return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "수정할 항목 없음" }, { status: 400 });
  }

  // 소유권 확인은 전용 SELECT로 선수행(TOCTOU 안전) — 아래 update()의 rowcount/에러 유무로
  // 소유권을 추론하지 않는다. .update().eq('id', id)는 소유 아닌 id에도 에러 없이 0 rows로
  // 조용히 성공하므로, 반드시 이 SELECT 결과(행 존재 여부)만으로 판정한다.
  const { data: existing, error: fetchErr } = await supabase
    .from("child_profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 403 });
  }

  try {
    // 실제 쓰기는 서비스 클라이언트로 수행한다 — child 역할은 RLS(child_profiles_update)가
    // UPDATE를 조용히 0-row로 막기 때문(부모만 허용). 인가는 위에서 requireChildAccess +
    // 소유권 SELECT로 이미 끝났고, child 역할은 위에서 live_voice_name 외 필드를 차단했다.
    const serviceClient = createServiceClient();
    const { error } = await serviceClient
      .from("child_profiles")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "업데이트 실패" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const serviceClient = createServiceClient();

    // 자녀가 삭제되기 전에 family_id를 미리 조회해 둡니다. (감사로그 기록용)
    let familyId: string | null = null;
    try {
      const { data: childData } = await serviceClient
        .from("child_profiles")
        .select("family_id")
        .eq("id", id)
        .maybeSingle();
      if (childData) {
        familyId = childData.family_id;
      }
    } catch (err) {
      console.error("[child/route/DELETE] Pre-fetch family_id failed:", err);
    }

    const { data: rpcResult, error: rpcError } = await serviceClient.rpc("delete_child_profile", {
      p_child_id: id,
      p_user_id: user.id,
    });

    if (rpcError || !rpcResult || rpcResult.length === 0) {
      console.error("[child/route/DELETE] RPC Error or empty result:", rpcError, rpcResult);
      return NextResponse.json({ error: "아이를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }

    const { success, reason, deleted_user_id } = rpcResult[0] as {
      success: boolean;
      reason: string | null;
      deleted_user_id: string | null;
    };

    if (!success) {
      if (reason === "not_found") {
        return NextResponse.json({ error: "아이 정보를 찾을 수 없습니다." }, { status: 404 });
      }
      if (reason === "not_authorized") {
        return NextResponse.json({ error: "아이 삭제는 가족 오너만 가능합니다." }, { status: 403 });
      }
      return NextResponse.json({ error: "아이를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }

    // 자녀의 auth 계정이 있는 경우 최대 3회 재시도로 auth.users 계정 삭제
    let authDeleteSuccess = false;
    if (deleted_user_id) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { error: authDelErr } = await serviceClient.auth.admin.deleteUser(deleted_user_id);
          if (!authDelErr) {
            authDeleteSuccess = true;
            break;
          }
          console.error(`[child/route/DELETE] (Attempt ${attempt}/3) Failed to delete auth user ${deleted_user_id}:`, authDelErr);
        } catch (authErr) {
          console.error(`[child/route/DELETE] (Attempt ${attempt}/3) Exception while deleting auth user ${deleted_user_id}:`, authErr);
        }
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    } else {
      authDeleteSuccess = true;
    }

    if (!authDeleteSuccess) {
      // 3회 실패 시 감사 로그에 실패 사실 기록 (action: delete_child, reason: auth_delete_failed)
      try {
        const { error: auditError } = await serviceClient
          .from("account_management_audit_log")
          .insert({
            actor_user_id: user.id,
            actor_email: user.email || "",
            action: "delete_child",
            child_id: id,
            family_id: familyId,
            reason: "auth_delete_failed",
          });
        if (auditError) {
          console.error("[child/route/DELETE] Failed to insert audit log for auth delete failure:", auditError);
        }
      } catch (e) {
        console.error("[child/route/DELETE] Audit log insert exception:", e);
      }

      return NextResponse.json({ ok: true, authCleanupPending: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[child/route/DELETE] Exception:", err);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
