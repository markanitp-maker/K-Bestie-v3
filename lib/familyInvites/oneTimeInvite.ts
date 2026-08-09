import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

export const FAMILY_INVITE_COOKIE = "kb_family_invite";
export const FAMILY_INVITE_TTL_HOURS = 72;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const inviteRateLimits = new Map<string, { count: number; resetAt: number }>();

export function allowFamilyInviteLookup(key: string, now = Date.now()): boolean {
  const current = inviteRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    inviteRateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

export function familyInviteRequestKey(request: Request, action: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${action}:${forwarded || request.headers.get("x-real-ip") || "unknown"}`;
}

function signingSecret(): string {
  const value = process.env.FAMILY_INVITE_SIGNING_SECRET;
  if (!value) throw new Error("Family invite signing secret is not configured");
  return value;
}

function hmac(label: string, inviteId: string, nonce: string): Buffer {
  return createHmac("sha256", signingSecret())
    .update(`${label}:${inviteId}:${nonce}`)
    .digest();
}

export function hashInviteCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatInviteCode(value: string): string {
  const normalized = normalizeInviteCode(value);
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}` : normalized;
}

export function deriveInviteCredentials(inviteId: string, nonce: string): { token: string; code: string } {
  const token = hmac("token", inviteId, nonce).toString("base64url");
  const codeBytes = hmac("code", inviteId, nonce);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[codeBytes[index] % CODE_ALPHABET.length];
  }
  return { token, code: formatInviteCode(code) };
}

export function createInviteCredentials(): {
  inviteId: string;
  nonce: string;
  token: string;
  code: string;
  tokenHash: string;
  codeHash: string;
} {
  const inviteId = randomUUID();
  const nonce = randomBytes(16).toString("base64url");
  const { token, code } = deriveInviteCredentials(inviteId, nonce);
  return {
    inviteId,
    nonce,
    token,
    code,
    tokenHash: hashInviteCredential(token),
    codeHash: hashInviteCredential(normalizeInviteCode(code)),
  };
}

export function credentialHash(input: { token?: unknown; code?: unknown }): string | null {
  if (typeof input.token === "string" && input.token.length >= 32 && input.token.length <= 128) {
    return hashInviteCredential(input.token);
  }
  if (typeof input.code === "string") {
    const code = normalizeInviteCode(input.code);
    if (/^[A-Z2-9]{8}$/.test(code)) return hashInviteCredential(code);
  }
  return null;
}

export function encodeInviteContext(input: { token?: string; code?: string }): string {
  if (input.token) return `token:${input.token}`;
  if (input.code) return `code:${normalizeInviteCode(input.code)}`;
  throw new Error("Invite credential is missing");
}

export function decodeInviteContext(value: string | undefined): { token?: string; code?: string } | null {
  if (!value) return null;
  if (value.startsWith("token:")) return { token: value.slice(6) };
  if (value.startsWith("code:")) return { code: value.slice(5) };
  return null;
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/family/invite/${encodeURIComponent(token)}`;
}
