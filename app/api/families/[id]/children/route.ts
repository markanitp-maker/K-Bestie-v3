import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/plan/consentDocument";
import { getChildApprovalEncryptionKey } from "@/lib/plan/childApprovalEncryption";

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
// Body: { username, password, name, grade, interests[], guardian_consent: true }
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
    interests: string[];
    guardian_consent: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, grade, interests, guardian_consent } = body;
  const familyName = body.familyName;
  const givenName = body.givenName;
  const gender = typeof body.gender === "string" ? body.gender.trim() : "";

  if (!familyName?.trim() || !givenName?.trim() || !["male", "female"].includes(gender)) {
    return NextResponse.json({ error: "성, 이름, 성별을 모두 입력해주세요" }, { status: 400 });
  }
  if (!username?.trim() || !password || !grade ||
      !Array.isArray(interests) || interests.length === 0) {
    return NextResponse.json({ error: "username, password, grade, interests 필수" }, { status: 400 });
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

  // 2. username 전역 유일성 확인 (실제 계정 + 대기 중인 요청 모두 - RPC 내부에서도 재검증됨)
  const { data: existingUsername } = await svc
    .from("member_accounts")
    .select("id")
    .eq("username", username.trim())
    .maybeSingle();
  if (existingUsername) {
    return NextResponse.json(
      { error: "이미 사용 중인 아이디입니다. 다른 아이디를 사용하세요" },
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
    p_guardian_consent: guardian_consent,
    p_guardian_consent_version: CONSENT_DOCUMENT_VERSION,
  });

  if (error) {
    console.error("[api/families/:id/children] create_child_approval_request error:", error);
    return NextResponse.json({ error: "승인 요청 생성에 실패했습니다" }, { status: 500 });
  }

  const result = data?.[0] as { success: boolean; reason: string | null; request_id: string | null } | undefined;
  if (!result?.success) {
    if (result?.reason === "username_taken") {
      return NextResponse.json(
        { error: "이미 사용 중이거나 승인 대기 중인 아이디입니다. 다른 아이디를 사용하세요" },
        { status: 409 }
      );
    }
    if (result?.reason === "guardian_consent_required") {
      return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
    }
    return NextResponse.json({ error: "승인 요청 생성에 실패했습니다" }, { status: 400 });
  }

  return NextResponse.json(
    { request: { id: result.request_id, status: "pending" } },
    { status: 201 }
  );
}
