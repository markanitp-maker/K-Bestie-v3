import * as crypto from "node:crypto";

export const PWA_TELEMETRY_DOMAIN = "kbestie:pwa-update:v1";

const UUID_V8_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a deterministic RFC 4122 UUIDv8 from domain-separated SHA-256(domain\0actorId\0eventId).
 * - Byte 6: version 8 (high nibble 8: 1000xxxx -> 0x80..0x8f)
 * - Byte 8: RFC 4122 variant (high 2 bits: 10xxxxxx -> 0x80..0xbf, matching hex char 8, 9, a, or b)
 */
export function generateDeterministicEventId(
  actorId: string,
  eventId: string,
  domain: string = PWA_TELEMETRY_DOMAIN,
): string {
  if (typeof actorId !== "string" || actorId.trim().length === 0) {
    throw new Error("actorId must be a non-empty string");
  }
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    throw new Error("eventId must be a non-empty string");
  }
  if (typeof domain !== "string" || domain.trim().length === 0) {
    throw new Error("domain must be a non-empty string");
  }

  const payload = `${domain}\0${actorId}\0${eventId}`;
  const hash = crypto.createHash("sha256").update(payload, "utf8").digest();

  // Take first 16 bytes
  const bytes = Buffer.from(hash.subarray(0, 16));

  // Set UUID version 8
  bytes[6] = (bytes[6] & 0x0f) | 0x80;

  // Set RFC 4122 variant (10xxxxxx)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isValidDeterministicEventId(id: string): boolean {
  return typeof id === "string" && UUID_V8_REGEX.test(id);
}
