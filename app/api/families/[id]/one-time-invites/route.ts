import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  FAMILY_INVITE_TTL_HOURS,
  createInviteCredentials,
  deriveInviteCredentials,
  inviteUrl,
} from "@/lib/familyInvites/oneTimeInvite";
import { requireActiveAccount } from "@/lib/auth/requireActiveAccount";

export const runtime = "nodejs";

async function requireOwner(familyId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const activeCheck = await requireActiveAccount(user.id);
  if (activeCheck) return { error: activeCheck };
  const service = createServiceClient();
  const { data: member } = await service
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (member?.role !== "owner_parent") {
    return { error: NextResponse.json({ error: "가족 오너만 초대할 수 있습니다." }, { status: 403 }) };
  }
  return { user, service };
}

function appOrigin(request: NextRequest): string {
  if (process.env.VERCEL_ENV === "production") return "https://app.k-bestie.com";
  const origin = request.nextUrl.origin.replace("//0.0.0.0", "//localhost").replace(/\/$/, "");
  const hostname = new URL(origin).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app")) return origin;
  throw new Error("Untrusted family invite origin");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  const auth = await requireOwner(familyId);
  if ("error" in auth) return auth.error;
  const { service } = auth;
  let origin: string;
  try {
    origin = appOrigin(request);
  } catch {
    return NextResponse.json({ error: "허용되지 않은 요청 주소입니다." }, { status: 400 });
  }

  await service
    .from("family_join_requests")
    .update({ status: "expired" })
    .eq("family_id", familyId)
    .eq("invite_kind", "one_time_link")
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString());

  const { data, error } = await service
    .from("family_join_requests")
    .select("id,status,created_at,expires_at,token_nonce")
    .eq("family_id", familyId)
    .eq("invite_kind", "one_time_link")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invites = (data ?? []).map((row) => {
    const credentials = deriveInviteCredentials(row.id, row.token_nonce);
    return {
      id: row.id,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      invite_url: inviteUrl(origin, credentials.token),
    };
  });
  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  const auth = await requireOwner(familyId);
  if ("error" in auth) return auth.error;
  const { user, service } = auth;
  let origin: string;
  try {
    origin = appOrigin(request);
  } catch {
    return NextResponse.json({ error: "허용되지 않은 요청 주소입니다." }, { status: 400 });
  }

  const { count } = await service
    .from("family_members")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId)
    .in("role", ["owner_parent", "parent"])
    .is("deleted_at", null);
  if ((count ?? 0) >= 2) {
    return NextResponse.json({ error: "보호자가 이미 2명입니다." }, { status: 409 });
  }

  await service
    .from("family_join_requests")
    .update({ status: "expired" })
    .eq("family_id", familyId)
    .eq("invite_kind", "one_time_link")
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString());
  const { data: existing } = await service
    .from("family_join_requests")
    .select("id,invite_kind")
    .eq("family_id", familyId)
    .eq("direction", "owner_invite")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      error: existing.invite_kind === "legacy_email"
        ? "기존 이메일 초대를 먼저 취소한 뒤 1회용 링크를 발급해 주세요."
        : "이미 사용 가능한 초대 링크가 있습니다.",
    }, { status: 409 });
  }

  const configuredTtl = Number(process.env.FAMILY_INVITE_TTL_HOURS || FAMILY_INVITE_TTL_HOURS);
  const ttl = Number.isFinite(configuredTtl) ? Math.min(168, Math.max(1, configuredTtl)) : FAMILY_INVITE_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();
  const credential = createInviteCredentials();
  const { data: invite, error } = await service
    .from("family_join_requests")
    .insert({
      id: credential.inviteId,
      family_id: familyId,
      requester_user_id: user.id,
      requester_email: null,
      target_user_id: null,
      direction: "owner_invite",
      status: "pending",
      invite_kind: "one_time_link",
      token_hash: credential.tokenHash,
      code_hash: credential.codeHash,
      token_nonce: credential.nonce,
      expires_at: expiresAt,
    })
    .select("id,status,created_at,expires_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 사용 가능한 초대 링크가 있습니다." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    invite: {
      ...invite,
      invite_url: inviteUrl(origin, credential.token),
    },
  }, { status: 201 });
}
