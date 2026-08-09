import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { FAMILY_INVITE_COOKIE, allowFamilyInviteLookup, encodeInviteContext, familyInviteRequestKey } from "@/lib/familyInvites/oneTimeInvite";
import { resolveOneTimeInvite } from "@/lib/familyInvites/resolveInvite";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowFamilyInviteLookup(familyInviteRequestKey(request, "context"))) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await resolveOneTimeInvite(createServiceClient(), body, { markExpired: true });
  if (result.state === "invalid") return NextResponse.json({ error: "유효하지 않은 초대 링크입니다." }, { status: 404 });
  if (result.state === "expired") return NextResponse.json({ error: "이 초대 링크는 만료되었습니다." }, { status: 410 });
  if (result.state === "revoked") return NextResponse.json({ error: "취소된 초대 링크입니다." }, { status: 410 });

  const response = NextResponse.json({ ok: true, state: result.state });
  response.cookies.set(FAMILY_INVITE_COOKIE, encodeInviteContext(body), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 72 * 60 * 60,
  });
  return response;
}
