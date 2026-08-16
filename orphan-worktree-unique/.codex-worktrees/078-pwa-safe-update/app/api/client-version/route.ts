import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";
import { resolveAppSessionActor, AppSessionError } from "@/lib/analytics/appSession";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2048; // 2KB hard bound
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set(["sessionId", "clientSha", "swVersion"]);

// In-memory rate limiter for legacy client-version POST: 30 requests / 60 seconds per actor
const clientVersionRateMap = new Map<string, number[]>();

function checkClientVersionRateLimit(actorId: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;

  const timestamps = (clientVersionRateMap.get(actorId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    clientVersionRateMap.set(actorId, timestamps);
    return false;
  }
  timestamps.push(now);
  clientVersionRateMap.set(actorId, timestamps);
  return true;
}

function currentBuildId(): string {
  return BUILD_STAMP;
}

export async function GET() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || currentBuildId();
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";

  return NextResponse.json(
    {
      buildId: currentBuildId(),
      buildStamp: BUILD_STAMP,
      deploymentId,
      gitSha,
      swVersion: BUILD_STAMP,
      serverTime: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    // Stream body max 2KB bound
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
            return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
          }
          rawText += decoder.decode(value, { stream: true });
        }
      }
      rawText += decoder.decode();
    } else {
      rawText = await request.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
        return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
      }
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    // Strict allowlist: no childId or extraneous keys allowed
    const keys = Object.keys(body);
    for (const key of keys) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
      }
    }

    const { sessionId, clientSha, swVersion } = body;

    if (sessionId !== undefined && sessionId !== null && (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId))) {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    if (clientSha !== undefined && clientSha !== null && (typeof clientSha !== "string" || clientSha.length > 64)) {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    if (swVersion !== undefined && swVersion !== null && (typeof swVersion !== "string" || swVersion.length > 64)) {
      return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
    }

    let user;
    try {
      const supabase = await createClient();
      const authResult = await supabase.auth.getUser();
      user = authResult.data?.user;
    } catch {
      return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });
    }

    let actor;
    try {
      actor = await resolveAppSessionActor(user.id);
    } catch (err: unknown) {
      if (err instanceof AppSessionError) {
        return NextResponse.json({ ok: false, error: "ownership" }, { status: 403 });
      }
      return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });
    }

    // Ownership check: if sessionId is provided, verify against chat_sessions child_id
    const service = await createServiceClient();
    if (typeof sessionId === "string") {
      const { data: chatSession } = await service
        .from("chat_sessions")
        .select("child_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (!chatSession || chatSession.child_id !== actor.childId) {
        return NextResponse.json({ ok: false, error: "ownership" }, { status: 403 });
      }
    }

    // Rate limit check
    if (!checkClientVersionRateLimit(actor.actorId)) {
      return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
    }

    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || currentBuildId();

    const { error } = await service.from("client_version_events").insert({
      session_id: typeof sessionId === "string" ? sessionId : null,
      child_id: actor.childId ?? null,
      client_sha: typeof clientSha === "string" ? clientSha : null,
      sw_version: typeof swVersion === "string" ? swVersion : null,
      deployment_id: deploymentId,
    });

    if (error) {
      console.error("[client-version] insert error:", error);
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[client-version] unhandled error:", error);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }
}
