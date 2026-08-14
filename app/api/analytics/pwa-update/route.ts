import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";
import { generateDeterministicEventId } from "@/lib/analytics/deterministicEventId";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import {
  validatePwaTelemetryBody,
  PwaTelemetryPayload,
} from "@/lib/pwa/updateTelemetry";
import {
  isValidJsonContentType,
  isGenuineNoSessionAuthError,
  readJsonStreamWithLimit,
} from "./routeInternals";

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
