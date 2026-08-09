/**
 * `/play/mbti` reverse-proxy — Route Handler 구현 (quiz-proxy와 동일한 이유로 채택,
 * app/api/quiz-proxy/[[...path]]/route.ts 참고).
 *
 * 이전에는 next.config.ts의 `rewrites()`(Next.js Multi-Zones)로 이 경로를 직접
 * `MBTI_UPSTREAM_ORIGIN`으로 프록시했다. **2026-08-03 Production 장애 근본원인**:
 * MBTI 업스트림 응답이 `Content-Security-Policy: frame-ancestors 'none'`을
 * 내려보내는데, 단순 rewrite는 업스트림 응답 헤더를 그대로 통과시킬 뿐 통제할 수
 * 없어 K-Bestie 자신의 iframe 래퍼(app/child/play/mbti/page.tsx)가 자기 자신을
 * 감싸려다 매번 이 헤더에 의해 조용히 차단됐다(브라우저 콘솔에만 로그가 남고
 * 사용자에게는 빈 화면으로만 보임 — 실사용자 신고 "MBTI 진입 시 빈 화면").
 *
 * Route Handler로 바꾸면 응답 헤더를 allowlist로 재조립할 수 있어(quiz-proxy와
 * 동일 패턴) content-security-policy를 비롯한 위험 헤더를 아예 전달하지 않는다.
 *
 * 인증 모델은 quiz-proxy와 다르다 — MBTI는 짧은 수명(90초, 1회용)의
 * `play_ticket_mbti` 쿠키(Path=/play/mbti, HttpOnly)로 K-Bestie→MBTI 핸드오프를
 * 하고, 이후 MBTI 자신의 백엔드가 서버간 API(app/api/internal/play/*)로 티켓을
 * 교환·세션을 자체 관리한다(app/api/play/execution-ticket/route.ts). 이 프록시는
 * 그 흐름을 그대로 투명하게 통과시키는 역할만 하며, K-Bestie의 다른 인증 쿠키
 * (`sb-*-auth-token`)는 quiz-proxy와 동일한 이유로 업스트림에 전달하지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MBTI_PATH_PREFIX = "/play/mbti";

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

/** K-Bestie가 소유한 쿠키만 명시적으로 차단 대상으로 삼는다(MBTI 자신의 쿠키 이름은
 *  모르므로 allowlist가 아니라 K-Bestie 전용 이름 denylist로 판단한다 — quiz-proxy는
 *  업스트림이 쓰는 정확한 쿠키 이름을 알아 allowlist를 썼지만, MBTI는 독립 프로젝트라
 *  그 이름을 이 저장소가 알 필요도 없고 알아서도 안 된다).
 *
 * claude-review 지적(2026-08-03) 반영: `play_ticket_mbti`는 여기서 막으면 안 된다 —
 * app/api/play/execution-ticket/route.ts의 응답 본문은 `{ ok: true }`뿐이고 티켓 값을
 * 절대 노출하지 않으며, iframe src에도 쿼리로 전달되지 않는다. 이 HttpOnly+Path=/play/mbti
 * 쿠키가 MBTI 백엔드로 실제 ticketToken 값을 전달하는 유일한 통로다(MBTI가 자신의 Cookie
 * 헤더에서 직접 읽어 exchange-ticket API를 호출) — 여기서 스트립하면 MBTI가 티켓을 절대
 * 못 받아 세션 확립 자체가 깨진다.
 *
 * codex-rv 지적(2026-08-09) 반영: `sb-` 하나만으로는 K-Bestie 소유 쿠키를 전부 잡지
 * 못한다 — 온보딩/가입 유입 추적용 `k_visitor_id`/`first_touch_link_id`/
 * `signup_touch_link_id`도 K-Bestie 1st-party 쿠키라 업스트림에 새면 안 된다. */
const K_BESTIE_OWNED_COOKIE_NAMES = new Set([
  "k_visitor_id",
  "first_touch_link_id",
  "signup_touch_link_id",
]);
function isKBestieOwnedCookie(name: string): boolean {
  return name.startsWith("sb-") || K_BESTIE_OWNED_COOKIE_NAMES.has(name);
}

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "range",
  "if-none-match",
  "if-modified-since",
  "origin",
  // MBTI가 Next.js App Router라면 iframe 안에서 자체 클라이언트 라우팅/Server Action이
  // 이 프록시를 다시 거친다 — 이 헤더들이 빠지면 그 내부 네비게이션이 깨진다.
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "next-action",
]);

/** 응답 헤더 allowlist — quiz-proxy와 동일 원칙(fail-safe). content-security-policy
 *  등은 여기 없으므로 절대 통과하지 않는다(이번 장애의 근본 수정). */
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "location",
  // Server Action 응답이 리다이렉트·재검증을 알릴 때 쓰는 헤더 — 요청 쪽 next-action과 짝.
  "x-action-redirect",
  "x-action-revalidated",
  "vary",
  "accept-ranges",
  "content-range",
  "x-content-type-options",
]);

async function proxyToMbtiUpstream(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith(MBTI_PATH_PREFIX)) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const suffix = pathname.slice(MBTI_PATH_PREFIX.length);

  if (/%2f|%5c/i.test(suffix)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const upstreamOrigin = process.env.MBTI_UPSTREAM_ORIGIN?.replace(/\/+$/, "");
  if (!upstreamOrigin) {
    console.error("[mbti-proxy] MBTI_UPSTREAM_ORIGIN 미설정 — /play/mbti 프록시 불가");
    return new NextResponse("MBTI upstream is not configured", { status: 503 });
  }

  let upstreamBase: URL;
  let upstreamUrl: URL;
  try {
    upstreamBase = new URL(upstreamOrigin);
    upstreamUrl = new URL(`${MBTI_PATH_PREFIX}${suffix}${search}`, upstreamBase);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const isWithinUpstreamBasePath =
    upstreamUrl.origin === upstreamBase.origin &&
    (upstreamUrl.pathname === MBTI_PATH_PREFIX || upstreamUrl.pathname.startsWith(`${MBTI_PATH_PREFIX}/`));
  if (!isWithinUpstreamBasePath) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const outboundHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (REQUEST_HEADER_ALLOWLIST.has(key)) outboundHeaders.set(key, value);
  });

  // 쿠키 재조립 — K-Bestie 소유 쿠키(sb-*, Supabase 인증)는 내보내지 않지만
  // play_ticket_mbti는 반드시 내보낸다(MBTI 백엔드가 자신의 Cookie 헤더에서
  // 직접 읽어 exchange-ticket을 검증하는 유일한 통로 — 위 isKBestieOwnedCookie 주석 참고).
  const forwardedCookies = request.cookies
    .getAll()
    .filter((cookie) => !isKBestieOwnedCookie(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (forwardedCookies) {
    outboundHeaders.set("cookie", forwardedCookies);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return new NextResponse("Payload Too Large", { status: 413 });
  }

  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
      return new NextResponse("Payload Too Large", { status: 413 });
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: outboundHeaders,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      console.error("[mbti-proxy] 업스트림 응답 시간 초과");
      return new NextResponse("Gateway Timeout", { status: 504 });
    }
    console.error("[mbti-proxy] 업스트림 요청 실패", error);
    return new NextResponse("Bad Gateway", { status: 502 });
  }

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key)) responseHeaders.set(key, value);
  });

  const rawLocation = upstreamResponse.headers.get("location");
  if (rawLocation) {
    let target: URL | null = null;
    try {
      target = new URL(rawLocation, upstreamUrl);
    } catch {
      target = null;
    }
    const isSafeRedirect =
      target !== null &&
      target.origin === upstreamBase.origin &&
      (target.pathname === MBTI_PATH_PREFIX || target.pathname.startsWith(`${MBTI_PATH_PREFIX}/`));
    if (!isSafeRedirect || target === null) {
      console.error(`[mbti-proxy] 안전하지 않은 업스트림 Location 차단: ${rawLocation}`);
      responseHeaders.delete("location");
      return new NextResponse("Bad Gateway", { status: 502 });
    }
    responseHeaders.set("location", `${target.pathname}${target.search}${target.hash}`);
  }

  const isStaticImageAsset = pathname.startsWith(`${MBTI_PATH_PREFIX}/images/`);
  const isImmutableAsset = pathname.startsWith(`${MBTI_PATH_PREFIX}/_next/static/`);
  if (isStaticImageAsset) {
    responseHeaders.set("cache-control", "public, max-age=31536000, immutable");
  } else if (!isImmutableAsset) {
    responseHeaders.set("cache-control", "private, no-store");
  }

  for (const setCookie of upstreamResponse.headers.getSetCookie()) {
    const name = setCookie.split("=", 1)[0].trim();
    // 응답 방향은 요청 방향보다 엄격하게: play_ticket_mbti는 K-Bestie가 발급하는
    // 값이므로 업스트림이 이 이름으로 Set-Cookie를 보내 덮어쓸 정당한 이유가 없다.
    if (!isKBestieOwnedCookie(name) && !name.startsWith("play_ticket_")) {
      responseHeaders.append("set-cookie", setCookie);
    } else {
      console.warn(`[mbti-proxy] 업스트림 Set-Cookie 차단(K-Bestie 소유 이름과 충돌): ${name}`);
    }
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyToMbtiUpstream;
export const HEAD = proxyToMbtiUpstream;
export const POST = proxyToMbtiUpstream;
export const PUT = proxyToMbtiUpstream;
export const PATCH = proxyToMbtiUpstream;
export const DELETE = proxyToMbtiUpstream;
export const OPTIONS = proxyToMbtiUpstream;
