import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";
import { getServerDeploymentInfo, BUILD_STAMP } from "@/lib/pwa/buildStamp";
import {
  LatestVersionMetadataV1,
  parseLatestVersionMetadata,
} from "@/lib/pwa/clientVersion";


const MAX_POST_BYTES = 2048; // 2KB stream limit
const RATE_LIMIT_COUNT = 60; // 60 requests per minute per actor
const RATE_WINDOW_MS = 60_000;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rateLimiterMap = new Map<string, number[]>();

function checkAndRecordRate(actorId: string, now: number): boolean {
  if (rateLimiterMap.size > 5000) {
    const cutoff = now - RATE_WINDOW_MS;
    for (const [id, timestamps] of rateLimiterMap.entries()) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        rateLimiterMap.delete(id);
      } else {
        rateLimiterMap.set(id, active);
      }
    }
  }

  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (rateLimiterMap.get(actorId) || []).filter(
    (t) => t > cutoff,
  );

  if (timestamps.length >= RATE_LIMIT_COUNT) {
    return false;
  }

  timestamps.push(now);
  rateLimiterMap.set(actorId, timestamps);
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

export interface ClientVersionGetDeps {
  getDeploymentInfo?: () => {
    buildId: string;
    buildStamp: string;
    deploymentId: string;
    swVersion: string;
    serviceWorkerScriptUrl: string;
  };
}

export async function handleClientVersionGet(deps: ClientVersionGetDeps = {}) {
  const getInfo = deps.getDeploymentInfo ?? getServerDeploymentInfo;
  const info = getInfo();

  const metadata: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: info.buildId,
    buildStamp: info.buildStamp,
    deploymentId: info.deploymentId,
    swVersion: info.swVersion,
    serviceWorkerScriptUrl: info.serviceWorkerScriptUrl,
  };

  const validated = parseLatestVersionMetadata(metadata);
  if (!validated) {
    return NextResponse.json(
      { error: "Build metadata missing" },
      { status: 503 },
    );
  }

  return NextResponse.json(
    validated,
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export interface ClientVersionDbClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    insert: (record: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
}

export interface ClientVersionPostDeps {
  createAuthClient?: () => Promise<{
    auth: {
      getUser: () => Promise<{
        data: { user: { id: string } | null };
        error?: { status?: number; message?: string; name?: string; code?: string } | null;
      }>;
    };
  }>;
  createDbClient?: () => ClientVersionDbClient;
  resolveActor?: (userId: string) => Promise<{
    actorId: string;
    actorType: "parent" | "child" | "system" | "admin";
    familyId: string | null;
    childId: string | null;
  }>;
  now?: () => number;
}

export async function handleClientVersionPost(
  request: Request,
  deps: ClientVersionPostDeps = {},
) {
  // 1. Media type verification
  const contentType = request.headers.get("content-type");
  if (!isValidJsonContentType(contentType)) {
    return NextResponse.json(
      { error: "Unsupported Media Type" },
      { status: 415 },
    );
  }

  // 2. Stream reading with 2KB size limit
  const streamResult = await readJsonStreamWithLimit(request, MAX_POST_BYTES);
  if (!streamResult.ok) {
    if (streamResult.status === 413) {
      return NextResponse.json(
        { error: "Payload Too Large" },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Strict body shape & allowlist
  if (
    !streamResult.data ||
    typeof streamResult.data !== "object" ||
    Array.isArray(streamResult.data)
  ) {
    return NextResponse.json({ error: "Invalid body shape" }, { status: 400 });
  }

  const record = streamResult.data as Record<string, unknown>;

  // Reject if childId is provided by client
  if ("childId" in record) {
    return NextResponse.json(
      { error: "childId must not be supplied by client" },
      { status: 400 },
    );
  }

  // Check top-level allowed keys
  const allowedKeys = new Set(["sessionId", "clientSha", "swVersion"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return NextResponse.json(
        { error: `Unknown field: ${key}` },
        { status: 400 },
      );
    }
  }

  const { sessionId, clientSha, swVersion } = record;

  if (
    sessionId !== undefined &&
    sessionId !== null &&
    (typeof sessionId !== "string" || !UUID_REGEX.test(sessionId))
  ) {
    return NextResponse.json(
      { error: "sessionId must be a valid UUID string" },
      { status: 400 },
    );
  }

  if (
    clientSha !== undefined &&
    clientSha !== null &&
    (typeof clientSha !== "string" || clientSha.length > 64)
  ) {
    return NextResponse.json(
      { error: "clientSha must be a string up to 64 chars" },
      { status: 400 },
    );
  }

  if (
    swVersion !== undefined &&
    swVersion !== null &&
    (typeof swVersion !== "string" || swVersion.length > 64)
  ) {
    return NextResponse.json(
      { error: "swVersion must be a string up to 64 chars" },
      { status: 400 },
    );
  }

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
    console.error("[client-version] Auth client error:", err);
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

  const service: ClientVersionDbClient = deps.createDbClient
    ? deps.createDbClient()
    : (createServiceClient() as unknown as ClientVersionDbClient);

  // 5. Session Ownership Verification (if sessionId provided)
  if (sessionId) {
    let sessionRow: unknown = null;
    let sessionError: unknown = null;
    try {
      const query = service
        .from("chat_sessions")
        .select("id, child_id")
        .eq("id", sessionId);

      if (typeof query?.maybeSingle !== "function") {
        console.error("[client-version] Invalid DB client: maybeSingle missing");
        return NextResponse.json(
          { error: "Session verification failed" },
          { status: 500 },
        );
      }
      const res = await query.maybeSingle();
      sessionRow = res.data;
      sessionError = res.error;
    } catch (err) {
      console.error("[client-version] Session verification exception:", err);
      return NextResponse.json(
        { error: "Session verification failed" },
        { status: 500 },
      );
    }

    if (sessionError) {
      console.error("[client-version] session check error:", sessionError);
      return NextResponse.json(
        { error: "Session verification failed" },
        { status: 500 },
      );
    }

    if (!sessionRow) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 403 },
      );
    }

    const typedSessionRow = sessionRow as { id: string; child_id: string | null };
    if (typedSessionRow.child_id !== actor.childId) {
      return NextResponse.json(
        { error: "Session ownership mismatch" },
        { status: 403 },
      );
    }
  }

  // 6. Rate Limiting
  const currentTime = deps.now ? deps.now() : Date.now();
  const allowed = checkAndRecordRate(actor.actorId, currentTime);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  // 7. Insert
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || BUILD_STAMP;
  let insertError: unknown = null;
  try {
    const res = await service
      .from("client_version_events")
      .insert({
        session_id: sessionId ?? null,
        child_id: actor.childId, // server derived childId
        client_sha: clientSha ?? null,
        sw_version: swVersion ?? null,
        deployment_id: deploymentId,
      });
    insertError = res.error;
  } catch (err) {
    console.error("[client-version] insert exception:", err);
    return NextResponse.json(
      { error: "Database insert failed" },
      { status: 500 },
    );
  }

  if (insertError) {
    console.error("[client-version] insert error:", insertError);
    return NextResponse.json(
      { error: "Database insert failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
