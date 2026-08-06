// requests/request_parent_child_profile_sync.md
// 승인 완료된 child_approval_requests 행에 child_profiles의 현재 값을 덮어씌운다.
// 부모 화면(app/api/families/[id]/child-approval-requests)과 관리자 화면
// (app/api/admin/child-approval-requests)이 동일한 로직을 쓰도록 공유한다 — 각자
// 복제하면 한쪽만 고치고 나머지가 어긋나는 회귀가 생기기 쉽다.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChildApprovalRequestRow {
  status: string;
  created_child_id: string | null;
  family_name?: string | null;
  given_name?: string | null;
  grade?: string | null;
  gender?: string | null;
  interests?: string[] | null;
  [key: string]: unknown;
}

interface CurrentProfile {
  id: string;
  name: string;
  family_name: string | null;
  given_name: string | null;
  grade: string;
  gender: string | null;
  interests: string[] | null;
}

export async function mergeCurrentChildProfiles<T extends ChildApprovalRequestRow>(
  service: SupabaseClient,
  rows: T[],
): Promise<Array<T & { profileMissing: boolean }>> {
  const approvedChildIds = rows
    .filter((r) => r.status === "approved" && r.created_child_id)
    .map((r) => r.created_child_id as string);

  let profileById = new Map<string, CurrentProfile>();
  if (approvedChildIds.length > 0) {
    // child_profiles에는 소프트 삭제 컬럼(deleted_at)이 없다(사전 확인 완료) — id로
    // 조회해 행이 없으면 그 자체가 "프로필 연결이 끊어짐"(FK는 있으나 대상이 사라짐)이다.
    const { data: profiles, error } = await service
      .from("child_profiles")
      .select("id, name, family_name, given_name, grade, gender, interests")
      .in("id", approvedChildIds);
    if (error) {
      console.error("[mergeCurrentChildProfiles] profile lookup error:", error.message);
      // 조회 자체가 실패하면 과거 값을 조용히 대신 보여주지 않는다 — 아래에서
      // profileById가 비어있으므로 승인 완료 행은 전부 profileMissing:true가 된다.
    } else {
      profileById = new Map((profiles ?? []).map((p) => [p.id, p as CurrentProfile]));
    }
  }

  return rows.map((r) => {
    if (r.status !== "approved") {
      return { ...r, profileMissing: false };
    }
    // 승인 완료인데 FK 자체가 비어있는 레거시 행도 "프로필 연결이 끊어진" 경우와
    // 동일하게 취급한다(§11.5 — 조용히 과거 스냅샷을 정답처럼 보여주지 않는다).
    const profile = r.created_child_id ? profileById.get(r.created_child_id) : undefined;
    if (!profile) {
      // 신청 당시 값을 그대로 노출하지 않는다 — 확인 전까지는 "확인 중" 플레이스홀더만 보여준다.
      return { ...r, family_name: "", given_name: "", grade: "확인 중", profileMissing: true };
    }
    return {
      ...r,
      family_name: profile.family_name ?? r.family_name,
      given_name: profile.given_name ?? r.given_name,
      grade: profile.grade,
      gender: profile.gender ?? r.gender,
      interests: profile.interests ?? r.interests,
      profileMissing: false,
    };
  });
}
