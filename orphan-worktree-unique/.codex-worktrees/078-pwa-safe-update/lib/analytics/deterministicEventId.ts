import { createHash } from "node:crypto";

const DOMAIN_SEPARATOR = "kbestie:pwa-update:v1";

/**
 * Domain-separated SHA-256 of authenticated actor ID + client event_id,
 * encoded as an RFC4122 UUIDv8.
 * Server-only helper. Same pair produces same UUID; different pair produces different UUID.
 */
export function generateDeterministicEventId(actorId: string, clientEventId: string): string {
  if (!actorId || typeof actorId !== "string") {
    throw new Error("actorId must be a non-empty string");
  }
  if (!clientEventId || typeof clientEventId !== "string") {
    throw new Error("clientEventId must be a non-empty string");
  }

  const payload = `${DOMAIN_SEPARATOR}\0${actorId}\0${clientEventId}`;
  const hash = createHash("sha256").update(payload, "utf8").digest();

  // Take first 16 bytes for UUID (128 bits)
  const bytes = Buffer.from(hash.subarray(0, 16));

  // Set RFC4122 Version 8 (0b1000xxxx in byte 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x80;

  // Set RFC4122 Variant 1 (0b10xxxxxx in byte 8)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isValidUuid(uuid: string): boolean {
  if (typeof uuid !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}
