import { NextResponse } from "next/server";

import {
  AppSessionError,
  type AppSessionAction,
  resolveAppSessionActor,
  startAppSession,
  updateAppSession,
} from "@/lib/analytics/appSession";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACTIONS = new Set<AppSessionAction>([
  "start",
  "heartbeat",
  "foreground",
  "background",
  "end",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;
const ALLOWED_BODY_KEYS = new Set(["session_id", "action", "route"]);
// codex-rv claude-review 지적(§49): 초대 토큰(64자 hex 등)처럼 opaque하고 긴 경로
// 세그먼트가 그대로 저장되면 Secret 저장 금지 규칙 위반이다. UUID나 20자 이상의
// hex/URL-safe base64 문자열로만 이뤄진 세그먼트는 위치 기반 플레이스홀더로 치환한다.
const OPAQUE_SEGMENT_PATTERN = /^[0-9a-zA-Z_-]{20,}$/;
const HEX_ONLY_PATTERN = /^[0-9a-f]+$/i;

function sanitizeRoute(route: string): string {
  return route
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (UUID_PATTERN.test(segment)) return ":id";
      if (OPAQUE_SEGMENT_PATTERN.test(segment) && (HEX_ONLY_PATTERN.test(segment) || segment.length >= 32)) {
        return ":token";
      }
      return segment;
    })
    .join("/");
}

interface SessionRequestBody {
  session_id: string;
  action: AppSessionAction;
  route: string;
}

function parseBody(value: unknown): SessionRequestBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 3 || keys.some((key) => !ALLOWED_BODY_KEYS.has(key))) return null;

  const sessionId = body.session_id;
  const action = body.action;
  const route = body.route;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) return null;
  if (typeof action !== "string" || !ACTIONS.has(action as AppSessionAction)) return null;
  if (
    typeof route !== "string"
    || route.length > 512
    || !ROUTE_PATTERN.test(route)
    || route.includes("?")
    || route.includes("#")
  ) {
    return null;
  }

  return { session_id: sessionId, action: action as AppSessionAction, route };
}

function errorResponse(error: unknown) {
  if (!(error instanceof AppSessionError)) {
    console.error("[analytics/session] unexpected error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "세션 계측 처리에 실패했습니다." }, { status: 500 });
  }

  if (error.code === "not_eligible") {
    return NextResponse.json({ error: "세션 계측 대상 계정이 아닙니다." }, { status: 403 });
  }
  if (error.code === "not_found") {
    return NextResponse.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });
  }
  if (error.code === "conflict") {
    return NextResponse.json({ error: "이미 시작된 세션입니다." }, { status: 409 });
  }
  return NextResponse.json({ error: "세션 계측 처리에 실패했습니다." }, { status: 500 });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 1024) {
    return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  let bodyValue: unknown;
  try {
    bodyValue = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const body = parseBody(bodyValue);
  if (!body) {
    return NextResponse.json({ error: "잘못된 세션 계측 요청입니다." }, { status: 400 });
  }
  const sanitizedRoute = sanitizeRoute(body.route);

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actor = await resolveAppSessionActor(user.id);
    if (body.action === "start") {
      await startAppSession(actor, body.session_id, sanitizedRoute);
    } else {
      await updateAppSession(actor, body.session_id, body.action, sanitizedRoute);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
