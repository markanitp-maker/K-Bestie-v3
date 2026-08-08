import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveOneTimeInvite } from "@/lib/familyInvites/resolveInvite";
import { allowFamilyInviteLookup, familyInviteRequestKey } from "@/lib/familyInvites/oneTimeInvite";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowFamilyInviteLookup(familyInviteRequestKey(request, "resolve"))) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await resolveOneTimeInvite(createServiceClient(), body, { markExpired: true });
  if (result.state === "invalid") return NextResponse.json({ state: "invalid" }, { status: 404 });
  if (result.state !== "pending") return NextResponse.json({ state: result.state });
  return NextResponse.json({
    state: result.state,
    familyName: result.familyName,
    inviterName: result.inviterName,
    expiresAt: result.expiresAt,
  });
}
