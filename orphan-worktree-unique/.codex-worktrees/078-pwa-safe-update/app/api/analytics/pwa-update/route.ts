import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { isPwaUpdateEventType } from "@/lib/pwa/updateTelemetry";
import { generateDeterministicEventId } from "@/lib/analytics/deterministicEventId";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096; // 4KB hard bound
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_KEYS = new Set([
  "event_id",
  "event_type",
  "correlation_id",
  "route",
  "current_version",
  "latest_version",
  "error_code",
  "metadata",
]);

const ALLOWED_METADATA_KEYS = new Set([
  "sw_state",
  "retry_count",
  "trigger",
  "reason",
  "phase",
  "check_interval_ms",
  "stale_signature",
  "recovery_action",
  "attempt",
]);

// In-memory per-instance burst rate limiter: 10 requests / 10 seconds per actor
const burstRateLimitMap = new Map<string, number[]>();

function checkBurstRateLimit(actorId: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 1000;
  const maxBurst = 10;

  const timestamps = (burstRateLimitMap.get(actorId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxBurst) {
    burstRateLimitMap.set(actorId, timestamps);
    return false;
  }
  timestamps.push(now);
  burstRateLimitMap.set(actorId, timestamps);
  return true;
}

/**
 * Periodically cleanup burstRateLimitMap entries older than 30s
 */
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [actorId, timestamps] of Array.from(burstRateLimitMap.entries())) {
      const active = timestamps.filter((t) => now - t < 10000);
      if (active.length === 0) {
        burstRateLimitMap.delete(actorId);
      } else {
        burstRateLimitMap.set(actorId, active);
      }
    }
  }, 60000).unref?.();
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ ok: false, error: "invalid_content_type" }, { status: 400 });
    }

    // Read request stream with hard 4KB limit regardless of Content-Length header
    let rawText = "";
    let totalBytes = 0;
    if (request.body) {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BODY_BYTES) {
            await reader.cancel();
            return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 400 });
          }
          rawText += decoder.decode(value, { stream: true });
        }
      }
      rawText += decoder.decode();
    } else {
      rawText = await request.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
        return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 400 });
      }
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const keys = Object.keys(body);
    for (const key of keys) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ ok: false, error: "unallowed_key" }, { status: 400 });
      }
    }

    const {
      event_id,
      event_type,
      correlation_id,
      route,
      current_version,
      latest_version,
      error_code,
      metadata,
    } = body;

    if (typeof event_id !== "string" || !UUID_PATTERN.test(event_id)) {
      return NextResponse.json({ ok: false, error: "invalid_event_id" }, { status: 400 });
    }

    if (!isPwaUpdateEventType(event_type)) {
      return NextResponse.json({ ok: false, error: "invalid_event_type" }, { status: 400 });
    }

    if (typeof correlation_id !== "string" || !UUID_PATTERN.test(correlation_id)) {
      return NextResponse.json({ ok: false, error: "invalid_correlation_id" }, { status: 400 });
    }

    if (
      typeof route !== "string" ||
      route.length > 256 ||
      !route.startsWith("/") ||
      /[\x00-\x1F\x7F?#]/.test(route) ||
      /bearer|token|secret|password/i.test(route)
    ) {
      return NextResponse.json({ ok: false, error: "invalid_route" }, { status: 400 });
    }

    if (current_version !== undefined && current_version !== null && (typeof current_version !== "string" || current_version.length > 64)) {
      return NextResponse.json({ ok: false, error: "invalid_current_version" }, { status: 400 });
    }

    if (latest_version !== undefined && latest_version !== null && (typeof latest_version !== "string" || latest_version.length > 64)) {
      return NextResponse.json({ ok: false, error: "invalid_latest_version" }, { status: 400 });
    }

    if (error_code !== undefined && error_code !== null && (typeof error_code !== "string" || error_code.length > 64)) {
      return NextResponse.json({ ok: false, error: "invalid_error_code" }, { status: 400 });
    }

    if (metadata !== undefined && metadata !== null) {
      if (typeof metadata !== "object" || Array.isArray(metadata)) {
        return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
      }
      for (const [metaKey, metaVal] of Object.entries(metadata)) {
        if (!ALLOWED_METADATA_KEYS.has(metaKey)) {
          return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
        }
        if (typeof metaVal === "number") {
          if (!Number.isFinite(metaVal)) {
            return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
          }
          if ((metaKey === "retry_count" || metaKey === "attempt") && (metaVal < 0 || metaVal > 10 || !Number.isInteger(metaVal))) {
            return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
          }
          if (metaKey === "check_interval_ms" && (metaVal < 0 || metaVal > 86400000 || !Number.isInteger(metaVal))) {
            return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
          }
        } else if (typeof metaVal === "string") {
          if (metaVal.length > 64) {
            return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
          }
        } else if (typeof metaVal !== "boolean") {
          return NextResponse.json({ ok: false, error: "invalid_metadata" }, { status: 400 });
        }
      }
    }

    let user;
    try {
      const supabase = await createClient();
      const authResult = await supabase.auth.getUser();
      user = authResult.data?.user;
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let actor;
    try {
      actor = await resolveAppSessionActor(user.id);
    } catch (err: unknown) {
      if (err instanceof AppSessionError) {
        return NextResponse.json({ ok: false, error: err.code }, { status: 403 });
      }
      return NextResponse.json({ ok: false, error: "actor_resolution_failed" }, { status: 500 });
    }

    // Compute server-only deterministic behavior_events.id (UUIDv8)
    const deterministicId = generateDeterministicEventId(actor.actorId, event_id);

    const service = await createServiceClient();

    // Idempotency Step: Existing row lookup BEFORE rate limit check
    const { data: existingRow } = await service
      .from("behavior_events")
      .select("id, actor_id, event_name, properties")
      .eq("id", deterministicId)
      .maybeSingle();

    if (existingRow) {
      const existingClientEventId = (existingRow.properties as Record<string, unknown> | null)?.client_event_id;
      if (
        existingRow.actor_id === actor.actorId &&
        existingRow.event_name === event_type &&
        existingClientEventId === event_id
      ) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      return NextResponse.json({ ok: false, error: "id_collision" }, { status: 409 });
    }

    // Rate limit check for NEW requests ONLY (60 / min DB rolling count)
    const sixtySecsAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: dbCount } = await service
      .from("behavior_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", actor.actorId)
      .gte("occurred_at", sixtySecsAgo)
      .like("event_name", "pwa_%");

    if ((dbCount ?? 0) >= 60) {
      return NextResponse.json({ ok: false, error: "rate_limit_exceeded" }, { status: 429 });
    }

    // Per-instance burst rate limit check (10 / 10s)
    if (!checkBurstRateLimit(actor.actorId)) {
      return NextResponse.json({ ok: false, error: "rate_limit_exceeded" }, { status: 429 });
    }

    // Insert new event
    const logResult = await logBehaviorEvent({
      id: deterministicId,
      eventName: event_type,
      actorType: actor.actorType,
      actorId: actor.actorId,
      familyId: actor.familyId,
      childId: actor.childId,
      sessionId: null,
      feature: "app_session",
      route,
      appVersion: typeof current_version === "string" ? current_version : null,
      properties: {
        client_event_id: event_id,
        correlation_id,
        current_version: current_version ?? null,
        latest_version: latest_version ?? null,
        error_code: error_code ?? null,
        ...(metadata as Record<string, unknown> || {}),
      },
    });

    if (logResult.status === "inserted") {
      return NextResponse.json({ ok: true });
    }

    if (logResult.status === "duplicate" || logResult.isPg23505) {
      // Re-read row on concurrent 23505 insert race
      const { data: reReadRow } = await service
        .from("behavior_events")
        .select("id, actor_id, event_name, properties")
        .eq("id", deterministicId)
        .maybeSingle();

      if (reReadRow) {
        const reReadClientEventId = (reReadRow.properties as Record<string, unknown> | null)?.client_event_id;
        if (
          reReadRow.actor_id === actor.actorId &&
          reReadRow.event_name === event_type &&
          reReadClientEventId === event_id
        ) {
          return NextResponse.json({ ok: true, duplicate: true });
        }
      }
      return NextResponse.json({ ok: false, error: "id_collision" }, { status: 409 });
    }

    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  } catch (error) {
    console.error("[pwa-update-analytics] server error:", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
