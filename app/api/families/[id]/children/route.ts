import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/plan/consentDocument";

export const runtime = "nodejs";

/*
 * [UPDATED - 베타 최종: 아이디+비밀번호 계정 발급 방식]
 * 이전 흐름 (비활성화됨):
 *   - 이메일 예약 저장 + 구글 소셜 로그인 후 auto-join
 * 새 흐름:
 *   오너가 아이의 username + 임시 비밀번호를 직접 발급.
 *   아이는 아이디+비밀번호로 로그인, 첫 로그인 시 비밀번호 변경 안내.
 *   내부 Auth 이메일: username@kbestie.local (사용자에게 절대 노출 금지)
 */

// username → Supabase Auth 내부 이메일 (절대 노출 금지)
const FAKE_DOMAIN = "kbestie.local";
const toAuthEmail = (username: string) => `${username}@${FAKE_DOMAIN}`;
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
    name?: string;
    familyName?: string;
    givenName?: string;
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
  let name = body.name || "";
  let familyName = body.familyName;
  let givenName = body.givenName;

  if (typeof familyName === "string" && typeof givenName === "string") {
    if (!givenName.trim()) {
      return NextResponse.json({ error: "이름을 입력해주세요" }, { status: 400 });
    }
    name = (familyName.trim() + givenName.trim()).trim();
  }

  if (!username?.trim() || !password || !name.trim() || !grade ||
      !Array.isArray(interests) || interests.length === 0) {
    return NextResponse.json({ error: "username, password, name, grade, interests 필수" }, { status: 400 });
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
    return NextResponse.json({ error: "가족 오너만 아이 계정을 발급할 수 있습니다" }, { status: 403 });
  }

  // 2. username 전역 유일성 확인
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

  // 3. Supabase Auth 계정 생성 (내부 email: username@kbestie.local)
  const { data: authData, error: authError } = await svc.auth.admin.createUser({
    email: toAuthEmail(username.trim()),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim(), username: username.trim(), is_member_account: true },
  });
  if (authError) {
    return NextResponse.json({ error: `계정 생성 실패: ${authError.message}` }, { status: 500 });
  }
  const newUserId = authData.user.id;

  // 4. family_members 등록
  const { data: familyMember, error: fmError } = await svc
    .from("family_members")
    .insert({ family_id: familyId, user_id: newUserId, role: "child" })
    .select("id")
    .single();
  if (fmError) {
    await svc.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `가족 등록 실패: ${fmError.message}` }, { status: 500 });
  }

  // 5. member_accounts 등록
  const { error: accError } = await svc.from("member_accounts").insert({
    id: newUserId,
    username: username.trim(),
    email: null,
    display_name: name.trim(),
    family_id: familyId,
    role: "child",
    created_by: user.id,
    must_change_password: true,
  });
  if (accError) {
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `계정 정보 저장 실패: ${accError.message}` }, { status: 500 });
  }

  // 6. child_profiles 생성
  const { data: child, error: childErr } = await svc
    .from("child_profiles")
    .insert({
      family_id: familyId,
      member_id: familyMember.id,
      name: name.trim(),
      family_name: typeof familyName === "string" ? familyName.trim() : null,
      given_name: typeof givenName === "string" ? givenName.trim() : null,
      grade,
      interests,
      email: null,
      guardian_consent: true,
      guardian_consent_at: new Date().toISOString(),
      guardian_consent_version: CONSENT_DOCUMENT_VERSION,
    })
    .select("id, name, grade, interests, created_at")
    .single();
  if (childErr) {
    await svc.from("member_accounts").delete().eq("id", newUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `아이 프로필 생성 실패: ${childErr.message}` }, { status: 500 });
  }

  return NextResponse.json(
    {
      child,
      member: { id: newUserId, username: username.trim(), must_change_password: true },
    },
    { status: 201 }
  );
}
