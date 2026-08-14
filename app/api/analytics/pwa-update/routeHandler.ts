import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";
import { generateDeterministicEventId } from "@/lib/analytics/deterministicEventId";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { validatePwaTelemetryBody, PwaTelemetryPayload } from "@/lib/pwa/updateTelemetry";
import {
  isValidJsonContentType,
  isGenuineNoSessionAuthError,
  readJsonStreamWithLimit,
} from "./routeInternals";

const MAX_BODY_BYTES = 4096;
const DB_ROLLING_RATE_LIMIT = 60;
const BURST_RATE_LIMIT = 10;
const BURST_WINDOW_MS = 10_000;

const burstLimiterMap = new Map<string, number[]>();

function checkAndRecordBurstRate(actorId: string, now: number): boolean {
  if (burstLimiterMap.size > 5000) {
    const cutoff = now - BURST_WINDOW_MS;
    for (const [id, timestamps] of burstLimiterMap.entries()) {
      const active = timestamps.filter((timestamp) => timestamp > cutoff);
      if (active.length === 0) burstLimiterMap.delete(id);
      else burstLimiterMap.set(id, active);
    }
  }

  const cutoff = now - BURST_WINDOW_MS;
  const timestamps = (burstLimiterMap.get(actorId) || []).filter(
    (timestamp) => timestamp > cutoff,
  );
  if (timestamps.length >= BURST_RATE_LIMIT) return false;
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
          gte: (
            col3: string,
            val3: unknown,
          ) => Promise<{ count: number | null; error: unknown }>;
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
        error?: {
          status?: number;
          message?: string;
          name?: string;
          code?: string;
        } | null;
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

export async function handlePwaUpdatePost(
  request: Request,
  deps: PwaUpdateRouteDeps = {},
) {
  const contentType = request.headers.get("content-type");
  if (!isValidJsonContentType(contentType)) {
    return NextResponse.json({ error: "Unsupported Media Type" }, { status: 415 });
  }

  const streamResult = await readJsonStreamWithLimit(request, MAX_BODY_BYTES);
  if (!streamResult.ok) {
    if (streamResult.status === 413) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validatePwaTelemetryBody(streamResult.data);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const body: PwaTelemetryPayload = validation.value;

  let user: { id: string } | null = null;
  let authError: {
    status?: number;
    message?: string;
    name?: string;
    code?: string;
  } | null = null;
  try {
    const supabase = deps.createAuthClient
      ? await deps.createAuthClient()
      : await createClient();
    const authRes = await supabase.auth.getUser();
    user = authRes.data?.user ?? null;
    authError =
      (authRes.error as {
        status?: number;
        message?: string;
        name?: string;
        code?: string;
      } | null) ?? null;
  } catch (error) {
    console.error("[pwa-update] Auth client error:", error);
    return NextResponse.json({ error: "Auth service error" }, { status: 500 });
  }

  if (authError) {
    if (!isGenuineNoSessionAuthError(authError)) {
      return NextResponse.json({ error: "Auth service error" }, { status: 500 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let actor;
  try {
    actor = deps.resolveActor
      ? await deps.resolveActor(user.id)
      : await resolveAppSessionActor(user.id);
  } catch (error) {
    if (error instanceof AppSessionError) {
      if (error.code === "database_error") {
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
      return NextResponse.json({ error: "Forbidden: Not eligible" }, { status: 403 });
    }
    return NextResponse.json({ error: "Actor resolution failure" }, { status: 500 });
  }

  const behaviorEventId = generateDeterministicEventId(actor.actorId, body.event_id);
  const service: PwaUpdateDbClient = deps.createDbClient
    ? deps.createDbClient()
    : (createServiceClient() as unknown as PwaUpdateDbClient);

  let existingRow: unknown = null;
  let existingError: unknown = null;
  try {
    const existingQuery = service
      .from("behavior_events")
      .select("id, actor_id, event_name, properties")
      .eq("id", behaviorEventId);
    if (typeof existingQuery?.maybeSingle !== "function") {
      console.error("[pwa-update] Invalid DB client: maybeSingle missing");
      return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
    }
    const result = await existingQuery.maybeSingle();
    existingRow = result.data;
    existingError = result.error;
  } catch (error) {
    console.error("[pwa-update] Existing lookup exception:", error);
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }
  if (existingError) {
    console.error("[pwa-update] Existing lookup error:", existingError);
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }

  const rowMatchesRequest = (rowValue: unknown): boolean => {
    const row = rowValue as {
      actor_id: string;
      event_name: string;
      properties: Record<string, unknown>;
    };
    const props = row.properties || {};
    return (
      row.actor_id === actor.actorId &&
      row.event_name === body.event_type &&
      props.client_event_id === body.event_id
    );
  };
  if (existingRow) {
    if (rowMatchesRequest(existingRow)) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    return NextResponse.json({ error: "id_collision" }, { status: 409 });
  }

  const currentTime = deps.now ? deps.now() : Date.now();
  const oneMinuteAgo = new Date(currentTime - 60_000).toISOString();
  let countResult: { count: number | null; error: unknown };
  try {
    const countQuery = service
      .from("behavior_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", actor.actorId);
    if (typeof countQuery?.eq !== "function") {
      console.error("[pwa-update] Invalid DB client: eq missing for feature filter");
      return NextResponse.json({ error: "Database rate check failed" }, { status: 500 });
    }
    const subQuery = countQuery.eq("feature", "pwa_update");
    if (typeof subQuery?.gte !== "function") {
      console.error("[pwa-update] Invalid DB client: gte missing for timestamp filter");
      return NextResponse.json({ error: "Database rate check failed" }, { status: 500 });
    }
    countResult = await subQuery.gte("occurred_at", oneMinuteAgo);
  } catch (error) {
    console.error("[pwa-update] Rate count query exception:", error);
    return NextResponse.json({ error: "Database rate check failed" }, { status: 500 });
  }
  if (countResult.error || countResult.count === null) {
    console.error("[pwa-update] Rate count error:", countResult.error);
    return NextResponse.json({ error: "Database rate check failed" }, { status: 500 });
  }
  if (countResult.count >= DB_ROLLING_RATE_LIMIT) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  if (!checkAndRecordBurstRate(actor.actorId, currentTime)) {
    return NextResponse.json({ error: "Burst rate limit exceeded" }, { status: 429 });
  }

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
  } catch (error) {
    console.error("[pwa-update] Logger exception:", error);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
  if (insertResult === "inserted") return NextResponse.json({ ok: true }, { status: 200 });

  if (insertResult === "duplicate") {
    let recheckRow: unknown = null;
    let recheckError: unknown = null;
    try {
      const recheckQuery = service
        .from("behavior_events")
        .select("id, actor_id, event_name, properties")
        .eq("id", behaviorEventId);
      if (typeof recheckQuery?.maybeSingle !== "function") {
        console.error("[pwa-update] Invalid DB client for re-check: maybeSingle missing");
        return NextResponse.json({ error: "Database verification failed" }, { status: 500 });
      }
      const result = await recheckQuery.maybeSingle();
      recheckRow = result.data;
      recheckError = result.error;
    } catch (error) {
      console.error("[pwa-update] Re-check lookup exception:", error);
      return NextResponse.json({ error: "Database verification failed" }, { status: 500 });
    }
    if (recheckError) {
      console.error("[pwa-update] Re-check lookup error:", recheckError);
      return NextResponse.json({ error: "Database verification failed" }, { status: 500 });
    }
    if (recheckRow && rowMatchesRequest(recheckRow)) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    return NextResponse.json({ error: "id_collision" }, { status: 409 });
  }

  return NextResponse.json({ error: "Insert failed" }, { status: 500 });
}
