import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const APPROVAL_PENDING_MESSAGE = "현재 베타 승인 대기 중입니다. 승인 완료 후 서비스를 이용할 수 있습니다.";

async function isApprovalPending(childId: string): Promise<boolean> {
  const service = createServiceClient();
  // 1. child_profiles.family_id 조회
  const { data: childProfile } = await service
    .from("child_profiles")
    .select("family_id, is_test_account")
    .eq("id", childId)
    .maybeSingle();
    
  // 이 가드는 라우트가 requireChildAccess 등으로 이미 유효성을 확인한 childId로만
  // 호출되므로, 여기서 child_profiles/family_members 조회가 비면(DB 조회 실패나
  // 데이터 정합성 문제) 정상 상황이 아니다. 비용 보호가 목적인 가드가 조회 실패 시
  // 허용 방향으로 fail-open하면 보호 목적 자체가 무의미해지므로, 세 조회 지점 전부
  // 실패 시 차단(fail-closed) 방향으로 통일한다.
  if (!childProfile) return true;
  if (childProfile.is_test_account) return false; // 테스트 계정 무조건 통과 (백도어 성격의 안전장치)

  // 2. family_members에서 role='owner_parent'인 user_id 조회
  const { data: familyMember } = await service
    .from("family_members")
    .select("user_id")
    .eq("family_id", childProfile.family_id)
    .eq("role", "owner_parent")
    .maybeSingle();

  if (!familyMember) return true;

  // 3. parents.approval_status 조회
  const { data: parent } = await service
    .from("parents")
    .select("approval_status")
    .eq("id", familyMember.user_id)
    .maybeSingle();

  // approved가 아니면 차단
  return parent?.approval_status !== 'approved';
}

export async function checkApprovalForChild(childId: string): Promise<NextResponse | null> {
  if (await isApprovalPending(childId)) {
    return NextResponse.json({ error: APPROVAL_PENDING_MESSAGE }, { status: 403 });
  }
  return null;
}

export async function checkApprovalForSession(sessionId: string): Promise<NextResponse | null> {
  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.child_id) return null;
  return checkApprovalForChild(session.child_id);
}
