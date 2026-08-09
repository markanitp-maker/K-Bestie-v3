import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { FAMILY_INVITE_COOKIE, decodeInviteContext } from "@/lib/familyInvites/oneTimeInvite";
import { resolveOneTimeInvite } from "@/lib/familyInvites/resolveInvite";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
  const cookieStore = await cookies();
  const context = decodeInviteContext(cookieStore.get(FAMILY_INVITE_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "초대 정보가 없습니다." }, { status: 404 });
  const result = await resolveOneTimeInvite(createServiceClient(), context, { markExpired: true });
  return NextResponse.json({
    authenticated: true,
    state: result.state,
    familyName: result.state === "pending" ? result.familyName : undefined,
    inviterName: result.state === "pending" ? result.inviterName : undefined,
    alreadyConsumedByMe: result.state === "consumed" && result.consumedByUserId === user.id,
  });
}
