import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/plan/consentDocument";
import { getChildApprovalEncryptionKey } from "@/lib/plan/childApprovalEncryption";
import { getServicePhase } from "@/lib/plan/servicePhase";
import { autoApproveChildRequest } from "@/lib/plan/autoApproveChildRequest";

export const runtime = "nodejs";

/*
 * [UPDATED - 053: 아이별 관리자 승인 체계]
 * 이전 흐름 (비활성화됨, 20260609~20260716 사이):
 *   - 오너가 아이의 username + 임시 비밀번호를 직접 발급하면 그 즉시 실제 로그인 계정과
 *     child_profiles가 생성됨.
 * 새 흐름:
 *   오너가 폼을 제출하면 실제 계정/프로필을 만들지 않고 child_approval_requests에 pending
 *   요청만 생성한다. 관리자가 승인해야만 실제 계정+프로필이 생성된다(app/api/admin/
 *   child-approval-requests/[id]/approve/route.ts). 아이디 형식·비밀번호 길이 검증은
 *   기존과 동일하게 유지 — 나중에 승인 처리 시 그대로 재사용된다.
 *   내부 Auth 이메일: username@kbestie.local (사용자에게 절대 노출 금지, 승인 시점에만 생성)
 */

const USERNAME_REGEX = /^[a-zA-Z0-9가-힣_-]{2,20}$/;

// GET /api/families/[id]/children — 가족 아이 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("child_profiles")
    .select("id, name, grade, interests, created_at")
    .eq("family_id", id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ children: data ?? [] });
}

// POST /api/families/[id]/children — 아이 아이디+비밀번호 계정 발급
// Body: { username, password, name, grade, guardian_consent: true }.
// interests는 기존 설정 화면과 레거시 호출의 선택 입력으로만 호환한다.
// Returns: { child, member: { id, username, must_change_password: true } }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    username: string;
    password: string;
    familyName?: string;
    givenName?: string;
    gender: string;
    grade: string;
    interests?: string[];
    guardian_consent: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, grade, guardian_consent } = body;
  const interests = Array.isArray(body.interests) ? body.interests : [];
  const familyName = body.familyName;
  const givenName = body.givenName;
  const gender = typeof body.gender === "string" ? body.gender.trim() : "";

  if (!familyName?.trim() || !givenName?.trim() || !["male", "female"].includes(gender)) {
    return NextResponse.json({ error: "성, 이름, 성별을 모두 입력해주세요" }, { status: 400 });
  }
  if (!username?.trim() || !password || !grade) {
    return NextResponse.json({ error: "username, password, grade 필수" }, { status: 400 });
  }
  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      { error: "아이디는 영문·숫자·한글·_·- 2~20자만 사용할 수 있습니다" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다" }, { status: 400 });
  }
  if (!guardian_consent) {
    return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
  }

  const svc = createServiceClient();

  // 1. 오너 권한 확인 (owner_parent만 발급 가능)
  const { data: parentMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .single();
  if (!parentMember || parentMember.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 아이 계정 승인 요청을 보낼 수 있습니다" }, { status: 403 });
  }

  // 2. username 전역 유일성 확인 (실제 계정 + 승인/요청 목록)
  const { data: existingUsername } = await svc
    .from("member_accounts")
    .select("id")
    .eq("username", username.trim())
    .maybeSingle();

  const { data: existingRequest } = await svc
    .from("child_approval_requests")
    .select("id")
    .eq("username", username.trim())
    .maybeSingle();

  if (existingUsername || existingRequest) {
    return NextResponse.json(
      { error: "이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.", code: "CHILD_LOGIN_ID_ALREADY_EXISTS" },
      { status: 409 }
    );
  }

  // 3. 가족 생성자(오너) 정보 조회 - 요청자 본인이 곧 생성자인 것이 일반적이나, 스키마상 명시적으로 저장한다
  const { data: familyRow } = await svc
    .from("families")
    .select("created_by")
    .eq("id", familyId)
    .single();
  const familyCreatorId = familyRow?.created_by ?? user.id;
  const { data: familyCreatorParent } = await svc
    .from("parents")
    .select("email")
    .eq("id", familyCreatorId)
    .maybeSingle();

  // 4. 승인 요청 생성 (실제 계정/프로필은 관리자 승인 시에만 생성됨 - 053)
  const { data, error } = await svc.rpc("create_child_approval_request", {
    p_family_id: familyId,
    p_requested_by: user.id,
    p_family_creator_id: familyCreatorId,
    p_requester_email: (user.email ?? "").trim().toLowerCase(),
    p_family_creator_email: (familyCreatorParent?.email ?? user.email ?? "").trim().toLowerCase(),
    p_family_name: familyName.trim(),
    p_given_name: givenName.trim(),
    p_gender: gender,
    p_username: username.trim(),
    p_password: password,
    p_encryption_key: getChildApprovalEncryptionKey(),
    p_grade: grade,
    p_interests: interests,
    p_guardian_consent: Boolean(guardian_consent),
    p_guardian_consent_version: CONSENT_DOCUMENT_VERSION,
    p_status: getServicePhase() === "PAID" ? "PENDING_PAYMENT" : "pending",
  });

  if (error) {
    console.error("[api/families/:id/children] create_child_approval_request error:", error);
    return NextResponse.json(
      { error: "아이 등록을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  const result = data?.[0] as { success: boolean; reason: string | null; request_id: string | null } | undefined;
  if (!result?.success) {
    if (result?.reason === "username_taken") {
      return NextResponse.json(
        { error: "이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.", code: "CHILD_LOGIN_ID_ALREADY_EXISTS" },
        { status: 409 }
      );
    }
    if (result?.reason === "guardian_consent_required") {
      return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "아이 등록을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 400 }
    );
  }

  // Handle Acquisition Attribution CHILD_ADDED
  const cookieStore = await cookies();
  const firstTouch = cookieStore.get("first_touch_link_id")?.value;
  const signupTouch = cookieStore.get("signup_touch_link_id")?.value;
  const visitorId = cookieStore.get("k_visitor_id")?.value || user.id;

  const activeLink = signupTouch || firstTouch;
  if (activeLink) {
    await svc.from("acquisition_events").insert({
      event_type: "CHILD_ADDED",
      attribution_id: visitorId,
      visitor_id: visitorId,
      link_id: activeLink,
      parent_user_id: user.id
    });
  }

  // 5. 베타 기간 자동 승인 (요청서 §7.1) — 관리자 수동 승인을 기다리지 않고 즉시 확정한다.
  if (getServicePhase() === "BETA" && result.request_id) {
    const approval = await autoApproveChildRequest(
      result.request_id,
      user.id,
      (user.email ?? "").trim().toLowerCase()
    );
    if (approval.success) {
      return NextResponse.json(
        {
          request: { id: result.request_id, status: "approved" },
          child: { id: approval.childId },
          autoApproved: true,
        },
        { status: 201 }
      );
    }
    // 자동 승인이 실패했을 경우 클라이언트에 실패 사유를 명시적으로 반환.
    // approval.error는 이제 사용자에게 그대로 보여줄 문구가 아니라 코드다(Supabase 원문 등
    // 내부 사유는 서버 로그에만 남긴다) — CHILD_LOGIN_ID_ALREADY_EXISTS만 화면에 구분해
    // 보여주고, 그 외 모든 코드는 동일한 일반 안내문으로 뭉뚱그린다.
    console.error("[api/families/:id/children] auto-approve failed:", approval.error);
    if (approval.error === "CHILD_LOGIN_ID_ALREADY_EXISTS") {
      return NextResponse.json(
        { error: "이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.", code: approval.error },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "아이 계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", code: approval.error },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { request: { id: result.request_id, status: getServicePhase() === "PAID" ? "PENDING_PAYMENT" : "pending" } },
    { status: 201 }
  );
}
