/**
 * 관리자 콘텐츠 API 인증.
 *
 * 이 저장소의 기존 관리자 판정을 그대로 쓴다 — K-Toon 때문에 새 권한 체계를
 * 만들지 않는다(계획 §1.5 "계획에 없는 리팩터링 금지").
 */
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminCheck =
  | { ok: true; service: SupabaseClient }
  | { ok: false; status: 401 | 403; reason: string };

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireComicAdmin(): Promise<AdminCheck> {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  if (!user) return { ok: false, status: 401, reason: "unauthenticated" };

  const email = user.email?.toLowerCase() ?? "";
  if (!email || !adminEmails().includes(email)) {
    return { ok: false, status: 403, reason: "not_admin" };
  }

  return { ok: true, service: createServiceClient() };
}
