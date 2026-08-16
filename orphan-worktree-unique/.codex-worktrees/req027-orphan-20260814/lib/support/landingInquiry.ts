export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
export const MAX_CURRENT_ROUTE_LENGTH = 500;
export const MAX_APP_SURFACE_LENGTH = 50;
export const MAX_APP_VERSION_LENGTH = 50;

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/;

export const GUEST_RATE_LIMIT_WINDOW_MS = 60_000;
export const GUEST_RATE_LIMIT_MAX_REQUESTS = 5;

const guestRateLimits = new Map<string, { count: number; resetAt: number }>();

export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

export function sweepExpiredRateLimits(now = Date.now()): void {
  for (const [key, record] of guestRateLimits.entries()) {
    if (record.resetAt <= now) {
      guestRateLimits.delete(key);
    }
  }
}

export function checkGuestRateLimit(
  ip: string,
  now = Date.now(),
  maxRequests = GUEST_RATE_LIMIT_MAX_REQUESTS,
  windowMs = GUEST_RATE_LIMIT_WINDOW_MS
): boolean {
  sweepExpiredRateLimits(now);
  const record = guestRateLimits.get(ip);
  if (!record || record.resetAt <= now) {
    guestRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= maxRequests) {
    return false;
  }
  record.count += 1;
  return true;
}

export function _resetGuestRateLimitsForTest(): void {
  guestRateLimits.clear();
}

export function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function generateRequestNumber(): string {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${dateStr}-${randomStr}`;
}
