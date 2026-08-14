import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";
import { generateDeterministicEventId } from "@/lib/analytics/deterministicEventId";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import {
  validatePwaTelemetryBody,
  PwaTelemetryPayload,
} from "@/lib/pwa/updateTelemetry";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096; // 4KB stream limit
const DB_ROLLING_RATE_LIMIT = 60; // 60 requests per minute per actor
const BURST_RATE_LIMIT = 10; // 10 requests per 10 seconds per actor
const BURST_WINDOW_MS = 10_000;

// In-memory sliding window burst limiter with garbage collection
const burstLimiterMap = new Map<string, number[]>();

function checkAndRecordBurstRate(actorId: string, now: number): boolean {
  // Prune map if too large
  if (burstLimiterMap.size > 5000) {
    const cutoff = now - BURST_WINDOW_MS;
    for (const [id, timestamps] of burstLimiterMap.entries()) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        burstLimiterMap.delete(id);
      } else {
        burstLimiterMap.set(id, active);
      }
    }
  }

  const cutoff = now - BURST_WINDOW_MS;
  const timestamps = (burstLimiterMap.get(actorId) || []).filter(
    (t) => t > cutoff,
  );

  if (timestamps.length >= BURST_RATE_LIMIT) {
    return false;
  }

  timestamps.push(now);
  burstLimiterMap.set(actorId, timestamps);
  return true;
}

export function isValidJsonContentType(contentType: string | null): boolean {
  if (!contentType || typeof contentType !== "string") return false;
  const parts = contentType.split(";");
  const baseType = parts[0].trim().toLowerCase();
  if (baseType !== "application/json") return false;

  if (parts.length === 1) {
    return true;
  }
  if (parts.length > 2) {
    return false;
  }

  const param = parts[1].trim();
  if (!/^charset=/i.test(param)) {
    return false;
  }

  const rawVal = param.slice(8);
  if (rawVal.length === 0) {
    return false; // Reject charset= (empty value)
  }
  if (rawVal.includes("'")) {
    return false; // Reject single quotes completely
  }

  if (rawVal.startsWith('"')) {
    if (!rawVal.endsWith('"') || rawVal.length < 2) {
      return false; // Unbalanced double quote
    }
    const inner = rawVal.slice(1, -1).toLowerCase();
    return inner === "utf-8" || inner === "utf8";
  }

  if (rawVal.includes('"')) {
    return false; // Stray double quote
  }
  const val = rawVal.toLowerCase();
  return val === "utf-8" || val === "utf8";
}

const GENUINE_AUTH_ERROR_NAMES = new Set([
  "authsessionmissingerror",
  "authinvalidcredentialserror",
  "authinvalidtokenresponseerror",
  "sessionmissingerror",
  "invalidtokenerror",
  "tokenexpirederror",
  "jwtexpirederror",
]);

const GENUINE_AUTH_ERROR_CODES = new Set([
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "jwt_expired",
  "invalid_jwt",
  "invalid_token",
  "token_expired",
  "invalid_credentials",
  "user_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "not_authenticated",
  "unauthorized",
  "auth_session_missing",
  "no_authorization",
  "bad_oauth_callback",
  "otp_expired",
  "flow_state_not_found",
  "flow_state_expired",
]);

export function isGenuineNoSessionAuthError(
  error:
    | { status?: number; message?: string; name?: string; code?: string }
    | null
    | undefined,
): boolean {
  if (!error) return true;
  if (typeof error.status !== "number") return false;
  if (error.status !== 400 && error.status !== 401) return false;

  const name = (error.name || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const code = (error.code || "").trim().toLowerCase().replace(/-/g, "_");

  if (name && GENUINE_AUTH_ERROR_NAMES.has(name)) {
    return true;
  }
  if (code && GENUINE_AUTH_ERROR_CODES.has(code)) {
    return true;
  }

  return false;
}

export async function readJsonStreamWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: 400 | 413 }> {
  const body = request.body;
  if (!body) {
    return { ok: false, status: 400 };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          return { ok: false, status: 413 };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (totalBytes === 0) {
    return { ok: false, status: 400 };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400 };
  }
}

export interface PwaUpdateDbClient {
  from: (table: string) => {
    select: (columns: string, options?: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        eq: (col2: string, val2: unknown) => {
          gte: (col3: string, val3: unknown) => Promise<{ count: number | null; error: unknown }>;
        };
      };
    };
  };
}

export interface PwaUpdateRouteDeps {
  createAuthClient?: () => Promise<{
    auth: {
      getUser: () => Promise<{
        data: { user: { id: string } | null };
        error?: { status?: number; message?: string; name?: string; code?: string } | null;
      }>;
    };
  }>;
  createDbClient?: () => PwaUpdateDbClient;
  resolveActor?: (userId: string) => Promise<{
    actorId: string;
    actorType: "parent" | "child" | "system" | "admin";
    familyId: string | null;
    childId: string | null;
  }>;
  logEvent?: typeof logBehaviorEvent;
  now?: () => number;
}

export async function POST(request: Request, deps: PwaUpdateRouteDeps = {}) {
  // 1. Content-Type Check
  const contentType = request.headers.get("content-type");
  if (!isValidJsonContentType(contentType)) {
    return NextResponse.json(
      { error: "Unsupported Media Type" },
      { status: 415 },
    );
  }

  // 2. Stream Reading & Size Limit (max 4KB)
  const streamResult = await readJsonStreamWithLimit(request, MAX_BODY_BYTES);
  if (!streamResult.ok) {
    if (streamResult.status === 413) {
      return NextResponse.json(
        { error: "Payload Too Large" },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Strict Body & Metadata Validation
  const validation = validatePwaTelemetryBody(streamResult.data);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const body: PwaTelemetryPayload = validation.value;

  // 4. Auth & Actor Resolution
  let user: { id: string } | null = null;
  let authError: { status?: number; message?: string; name?: string; code?: string } | null = null;
  try {
    const supabase = deps.createAuthClient
      ? await deps.createAuthClient()
      : await createClient();
    const authRes = await supabase.auth.getUser();
    user = authRes.data?.user ?? null;
    authError = (authRes.error as { status?: number; message?: string; name?: string; code?: string } | null) ?? null;
  } catch (err) {
    console.error("[pwa-update] Auth client error:", err);
    return NextResponse.json({ error: "Auth service error" }, { status: 500 });
  }

  if (authError) {
    if (!isGenuineNoSessionAuthError(authError)) {
      return NextResponse.json({ error: "Auth service error" }, { status: 500 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let actor;
  try {
    actor = deps.resolveActor
      ? await deps.resolveActor(user.id)
      : await resolveAppSessionActor(user.id);
  } catch (err) {
    if (err instanceof AppSessionError) {
      if (err.code === "database_error") {
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "Forbidden: Not eligible" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "Actor resolution failure" },
      { status: 500 },
    );
  }

  // 5. Deterministic Event PK
  const behaviorEventId = generateDeterministicEventId(
    actor.actorId,
    body.event_id,
  );

  const service: PwaUpdateDbClient = deps.createDbClient
    ? deps.createDbClient()
    : (createServiceClient() as unknown as PwaUpdateDbClient);

  // 6. Exact Existing Row Lookup (duplicate-first)
  let existingRow: unknown = null;
  let existingError: unknown = null;
  try {
    const existingQuery = service
      .from("behavior_events")
      .select("id, actor_id, event_name, properties")
      .eq("id", behaviorEventId);

    if (typeof existingQuery?.maybeSingle !== "function") {
      console.error("[pwa-update] Invalid DB client: maybeSingle missing");
      return NextResponse.json(
        { error: "Database lookup failed" },
        { status: 500 },
      );
    }
    const res = await existingQuery.maybeSingle();
    existingRow = res.data;
    existingError = res.error;
  } catch (err) {
    console.error("[pwa-update] Existing lookup exception:", err);
    return NextResponse.json(
      { error: "Database lookup failed" },
      { status: 500 },
    );
  }

  if (existingError) {
    console.error("[pwa-update] Existing lookup error:", existingError);
    return NextResponse.json(
      { error: "Database lookup failed" },
      { status: 500 },
    );
  }

  if (existingRow) {
    const row = existingRow as {
      id: string;
      actor_id: string;
      event_name: string;
      properties: Record<string, unknown>;
    };
    const props = (row.properties as Record<string, unknown>) || {};
    const matches =
      row.actor_id === actor.actorId &&
      row.event_name === body.event_type &&
      props.client_event_id === body.event_id;

    if (matches) {
      // Duplicate returns 200 and does NOT consume rate limit
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    } else {
      // ID Collision across different actor/event/client_event_id
      return NextResponse.json({ error: "id_collision" }, { status: 409 });
    }
  }

  // 7. Rate Limiting for New Events
  const currentTime = deps.now ? deps.now() : Date.now();
  // 7.A DB rolling count (60/min)
  const oneMinuteAgo = new Date(currentTime - 60_000).toISOString();
  let countResult: { count: number | null; error: unknown };
  try {
    const countQuery = service
      .from("behavior_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", actor.actorId);

    if (typeof countQuery?.eq !== "function") {
      console.error("[pwa-update] Invalid DB client: eq missing for feature filter");
      return NextResponse.json(
        { error: "Database rate check failed" },
        { status: 500 },
      );
    }
    const subQuery = countQuery.eq("feature", "pwa_update");
    if (typeof subQuery?.gte !== "function") {
      console.error("[pwa-update] Invalid DB client: gte missing for timestamp filter");
      return NextResponse.json(
        { error: "Database rate check failed" },
        { status: 500 },
      );
    }
    countResult = await subQuery.gte("occurred_at", oneMinuteAgo);
  } catch (err) {
    console.error("[pwa-update] Rate count query exception:", err);
    return NextResponse.json(
      { error: "Database rate check failed" },
      { status: 500 },
    );
  }

  if (countResult.error || countResult.count === null) {
    console.error("[pwa-update] Rate count error:", countResult.error);
    return NextResponse.json(
      { error: "Database rate check failed" },
      { status: 500 },
    );
  }

  if (countResult.count >= DB_ROLLING_RATE_LIMIT) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // 7.B Instance burst rate limit (10/10s)
  const burstAllowed = checkAndRecordBurstRate(actor.actorId, currentTime);
  if (!burstAllowed) {
    return NextResponse.json(
      { error: "Burst rate limit exceeded" },
      { status: 429 },
    );
  }

  // 8. Insert
  const metadataClean = { ...(body.metadata ?? {}) };
  delete (metadataClean as Record<string, unknown>).error_code;

  const logger = deps.logEvent ?? logBehaviorEvent;
  let insertResult: string;
  try {
    insertResult = await logger({
      id: behaviorEventId,
      eventName: body.event_type,
      actorType: actor.actorType,
      actorId: actor.actorId,
      familyId: actor.familyId,
      childId: actor.childId,
      feature: "pwa_update",
      route: body.route,
      appVersion: body.current_version ?? null,
      properties: {
        client_event_id: body.event_id,
        correlation_id: body.correlation_id,
        latest_version: body.latest_version ?? null,
        ...metadataClean,
        error_code: body.error_code ?? null,
      },
    });
  } catch (err) {
    console.error("[pwa-update] Logger exception:", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  if (insertResult === "inserted") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (insertResult === "duplicate") {
    // 23505 race: re-read row to ensure identity match
    let recheckRow: unknown = null;
    let recheckError: unknown = null;
    try {
      const recheckQuery = service
        .from("behavior_events")
        .select("id, actor_id, event_name, properties")
        .eq("id", behaviorEventId);

      if (typeof recheckQuery?.maybeSingle !== "function") {
        console.error("[pwa-update] Invalid DB client for re-check: maybeSingle missing");
        return NextResponse.json(
          { error: "Database verification failed" },
          { status: 500 },
        );
      }
      const res = await recheckQuery.maybeSingle();
      recheckRow = res.data;
      recheckError = res.error;
    } catch (err) {
      console.error("[pwa-update] Re-check lookup exception:", err);
      return NextResponse.json(
        { error: "Database verification failed" },
        { status: 500 },
      );
    }

    if (recheckError) {
      console.error("[pwa-update] Re-check lookup error:", recheckError);
      return NextResponse.json(
        { error: "Database verification failed" },
        { status: 500 },
      );
    }

    if (recheckRow) {
      const row = recheckRow as {
        id: string;
        actor_id: string;
        event_name: string;
        properties: Record<string, unknown>;
      };
      const props = (row.properties as Record<string, unknown>) || {};
      const matches =
        row.actor_id === actor.actorId &&
        row.event_name === body.event_type &&
        props.client_event_id === body.event_id;

      if (matches) {
        return NextResponse.json(
          { ok: true, duplicate: true },
          { status: 200 },
        );
      }
    }

    return NextResponse.json({ error: "id_collision" }, { status: 409 });
  }

  return NextResponse.json({ error: "Insert failed" }, { status: 500 });
}
