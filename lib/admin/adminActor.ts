import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin/isAdminEmail";
import type { SoftDeleteActor } from "@/lib/admin/softDeleteService";

/**
 * 관리자 인증을 확인하고 "누가 수행했는지"까지 함께 돌려준다.
 *
 * 기존 requireAdmin()은 통과 여부만 알려주고 수행자를 돌려주지 않아, 삭제/복구처럼
 * 감사 로그에 수행자를 남겨야 하는 라우트가 매번 createClient()를 다시 호출하고 있었다.
 * 그 중복을 한 곳으로 모은다. requireAdmin()과 판정 기준(ADMIN_EMAILS 화이트리스트)은 동일하다.
 */
export async function requireAdminActor(
  source: string,
  requestId: string | null = null
): Promise<{ denied: NextResponse; actor: null } | { denied: null; actor: SoftDeleteActor }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), actor: null };
  }
  if (!isAdminEmail(user.email)) {
    return { denied: NextResponse.json({ error: "Forbidden" }, { status: 403 }), actor: null };
  }

  return {
    denied: null,
    actor: { id: user.id, email: user.email ?? "", source, requestId },
  };
}
