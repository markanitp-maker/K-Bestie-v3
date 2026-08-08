import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/family-join-requests
 * Body: { owner_email: string }
 *
 * 소셜 로그인 부모가 오너 이메일로 가족 합류 신청.
 * 메일 발송 없음 — 앱 내부 신청/승인 전용.
 *
 * Response:
 *   201 { request: { id, family_id, family_name, status } }
 *   400 owner_email 누락
 *   404 해당 이메일의 오너 가족 없음
 *   409 이미 신청 중 | 이미 가족 구성원
 *   403 보호자 정원(2명) 초과
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let owner_email: string;
  try {
    ({ owner_email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!owner_email?.trim()) {
    return NextResponse.json({ error: "owner_email 필수" }, { status: 400 });
  }

  const normalizedOwnerEmail = owner_email.trim().toLowerCase();
  const svc = createServiceClient();

  // ── 신청자가 이미 어떤 가족의 구성원인지 확인 ──────────────────────
  const { data: existingMembership } = await svc
    .from("family_members")
    .select("id, family_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingMembership) {
    return NextResponse.json(
      { error: "이미 가족 구성원입니다. 한 가족에만 소속될 수 있습니다." },
      { status: 409 }
    );
  }

  // ── 오너 이메일로 가족 찾기 (parents → families 순서) ──────────────
  // 실제 스키마에서 families와 parents의 관계 조인을 가정하지 않고, 기존 created_by
  // 외래키를 명시적으로 사용한다. 이메일은 Supabase Auth가 소문자로 정규화해 저장한다.
  // kbestie.local 내부 이메일은 오너 조회 대상에서 제외한다.
  const { data: ownerParent, error: ownerLookupError } = await svc
    .from("parents")
    .select("id")
    .eq("email", normalizedOwnerEmail)
    .not("email", "ilike", "%@kbestie.local")
    .maybeSingle();

  if (ownerLookupError) {
    return NextResponse.json({ error: ownerLookupError.message }, { status: 500 });
  }

  const { data: familyRow, error: familyLookupError } = ownerParent
    ? await svc
        .from("families")
        .select("id, name, created_by")
        .eq("created_by", ownerParent.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };

  if (familyLookupError) {
    return NextResponse.json({ error: familyLookupError.message }, { status: 500 });
  }

  if (!familyRow) {
    return NextResponse.json(
      { error: "해당 이메일로 등록된 가족을 찾을 수 없습니다. 오너의 이메일을 다시 확인해주세요." },
      { status: 404 }
    );
  }

  // 자기 자신의 가족에 신청 방지
  if (familyRow.created_by === user.id) {
    return NextResponse.json(
      { error: "자신이 만든 가족에는 합류 신청할 수 없습니다." },
      { status: 400 }
    );
  }

  const familyId = familyRow.id;

  // ── 이미 pending/approved 신청이 있는지 확인 ─────────────────────
  const { data: existingRequest } = await svc
    .from("family_join_requests")
    .select("id, status")
    .eq("family_id", familyId)
    .eq("requester_user_id", user.id)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (existingRequest) {
    if (existingRequest.status === "approved") {
      return NextResponse.json(
        { error: "이미 승인된 신청이 있습니다." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "이미 대기 중인 합류 신청이 있습니다. 오너의 승인을 기다려주세요." },
      { status: 409 }
    );
  }

  // ── 보호자 정원 확인 (현재 2명이면 신청 차단) ────────────────────
  const { count: parentCount } = await svc
    .from("family_members")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .in("role", ["owner_parent", "parent"]);

  if ((parentCount ?? 0) >= 2) {
    return NextResponse.json(
      { error: "이 가족에는 이미 보호자가 2명 등록되어 있어 신청할 수 없습니다." },
      { status: 403 }
    );
  }

  // ── 합류 신청 생성 ────────────────────────────────────────────────
  const requesterEmail = (user.email ?? "").trim().toLowerCase();

  const { data: request, error: insertErr } = await svc
    .from("family_join_requests")
    .insert({
      family_id: familyId,
      requester_user_id: user.id,
      requester_email: requesterEmail,
      direction: "member_request",
      target_user_id: null,
      status: "pending",
    })
    .select("id, family_id, status, created_at")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      request: {
        id: request.id,
        family_id: request.family_id,
        family_name: familyRow.name,
        status: request.status,
        created_at: request.created_at,
      },
    },
    { status: 201 }
  );
}
