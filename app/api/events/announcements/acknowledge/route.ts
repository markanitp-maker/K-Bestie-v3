import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { APP_EVENTS_ANNOUNCEMENT_KEY, APP_EVENTS_ANNOUNCEMENT_VERSION } from "@/lib/events/announcementConfig";

export const runtime = "nodejs";

// POST /api/events/announcements/acknowledge — "이벤트 확인했어요" 버튼. audience는
// status와 동일하게 서버가 family_members.role로 직접 판별한다(클라이언트 주장 무시).
export async function POST(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const childInfo = await resolveChildForUser(service, user.id);
  const audience: "child" | "parent" = childInfo ? "child" : "parent";

  const row = {
    announcement_key: APP_EVENTS_ANNOUNCEMENT_KEY,
    announcement_version: APP_EVENTS_ANNOUNCEMENT_VERSION,
    audience_type: audience,
    child_id: audience === "child" ? childInfo!.childId : null,
    parent_user_id: audience === "parent" ? user.id : null,
  };

  // 유니크 인덱스가 partial index(audience_type별 WHERE 조건)라 supabase-js의
  // upsert(onConflict)가 인식하지 못한다(단순 컬럼 목록으로는 partial index를
  // 매칭할 수 없음 — 42P10). 그냥 insert하고 unique violation(23505)만 "이미
  // 확인함"으로 성공 취급한다 — 같은 버전 재확인 클릭이 여러 번 와도 안전하다.
  const { error } = await service
    .from("event_announcement_acknowledgements")
    .insert(row);

  if (error && error.code !== "23505") {
    console.error("[announcements/acknowledge] insert failed:", error.message);
    return NextResponse.json({ error: "ack_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
