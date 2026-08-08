import { credentialHash } from "./oneTimeInvite";

type ServiceClient = {
  from: (table: string) => any;
};

export type OneTimeInviteState = "pending" | "consumed" | "revoked" | "expired" | "invalid";

export async function resolveOneTimeInvite(
  service: ServiceClient,
  input: { token?: unknown; code?: unknown },
  options: { markExpired?: boolean } = {},
): Promise<{
  state: OneTimeInviteState;
  inviteId?: string;
  familyId?: string;
  familyName?: string;
  inviterName?: string;
  expiresAt?: string;
  consumedByUserId?: string | null;
  credentialHash?: string;
}> {
  const hash = credentialHash(input);
  if (!hash) return { state: "invalid" };

  const { data: invite, error } = await service
    .from("family_join_requests")
    .select("id,family_id,requester_user_id,status,expires_at,revoked_at,consumed_by_user_id")
    .eq("invite_kind", "one_time_link")
    .or(`token_hash.eq.${hash},code_hash.eq.${hash}`)
    .maybeSingle();
  if (error || !invite) return { state: "invalid" };

  if (invite.status === "approved") {
    return {
      state: "consumed",
      inviteId: invite.id,
      familyId: invite.family_id,
      consumedByUserId: invite.consumed_by_user_id,
      credentialHash: hash,
    };
  }
  if (invite.status === "cancelled" || invite.revoked_at) {
    return { state: "revoked", inviteId: invite.id, credentialHash: hash };
  }

  const expired = invite.status === "expired" || !invite.expires_at || Date.parse(invite.expires_at) <= Date.now();
  if (expired) {
    if (options.markExpired && invite.status === "pending") {
      await service.from("family_join_requests").update({ status: "expired" }).eq("id", invite.id).eq("status", "pending");
    }
    return { state: "expired", inviteId: invite.id, credentialHash: hash };
  }
  if (invite.status !== "pending") return { state: "invalid" };

  const { data: family } = await service.from("families").select("name").eq("id", invite.family_id).maybeSingle();
  const { data: inviter } = await service.from("parents").select("name").eq("id", invite.requester_user_id).maybeSingle();
  return {
    state: "pending",
    inviteId: invite.id,
    familyId: invite.family_id,
    familyName: family?.name || "가족",
    inviterName: inviter?.name || "가족 대표",
    expiresAt: invite.expires_at,
    credentialHash: hash,
  };
}
