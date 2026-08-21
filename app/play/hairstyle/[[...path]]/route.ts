/**
 * `/play/hairstyle` reverse-proxy — HairStyle(헤어스타일) 업스트림용 Route Handler.
 *
 * 구현 기준은 `app/play/mbti/[[...path]]/route.ts` 다. 그 파일이 기록한
 * **2026-08-03 Production 장애**를 그대로 물려받지 않기 위해 같은 구조를 쓴다:
 * 업스트림이 `Content-Security-Policy: frame-ancestors 'none'` 을 내려보내면
 * 단순 rewrite 는 그 헤더를 통제할 수 없어 K-Bestie 자신의 iframe 래퍼가
 * 조용히 차단되고 사용자에게는 빈 화면만 보인다. Route Handler 로 응답 헤더를
 * allowlist 로 재조립하면 CSP 를 아예 전달하지 않는다.
 *
 * MBTI·comic_book 프록시와 코드가 겹치지만 이번 작업 범위는 hairstyle 신설이므로
 * 기존 MBTI 파일을 건드리지 않는다. 공통화는 별도 작업으로 남긴다.
 *
 * 핸드오프 모델도 MBTI 와 같다 — K-Bestie 가 발급한 짧은 수명의 1회용
 * `play_ticket_hairstyle` 쿠키(Path=/play/hairstyle, HttpOnly)가 HairStyle 백엔드로
 * ticketToken 을 전달하는 유일한 통로이며, 이후 HairStyle 이 서버간 API
 * (`/api/internal/play/*`)로 티켓을 교환하고 세션을 관리한다.
 * K-Bestie 의 인증 쿠키(`sb-*`)는 업스트림에 전달하지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAIRSTYLE_PATH_PREFIX = "/play/hairstyle";

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

/** K-Bestie 소유 쿠키만 denylist 로 막는다. HairStyle 자신의 쿠키 이름은 이 저장소가
 *  알 필요가 없다(독립 프로젝트). `play_ticket_hairstyle` 은 **막으면 안 된다** —
 *  HairStyle 백엔드가 티켓 값을 받는 유일한 통로라 스트립하면 세션 확립이 깨진다. */
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
  // HairStyle 은 Next.js App Router 라 iframe 안 클라이언트 라우팅이 이 프록시를 다시 거친다.
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "next-action",
]);

/** 응답 헤더 allowlist — fail-safe. `content-security-policy` 는 여기 없으므로
 *  절대 통과하지 않는다(2026-08-03 장애의 근본 수정). */
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "location",
  "x-action-redirect",
  "x-action-revalidated",
  "vary",
  "accept-ranges",
  "content-range",
  "x-content-type-options",
]);

async function proxyToHairstyleUpstream(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith(HAIRSTYLE_PATH_PREFIX)) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const suffix = pathname.slice(HAIRSTYLE_PATH_PREFIX.length);

  if (/%2f|%5c/i.test(suffix)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Dev/Production 은 별도 Vercel Project 이며 이 값이 환경별로 완전히 분리된다.
  const upstreamOrigin = process.env.HAIRSTYLE_UPSTREAM_ORIGIN?.replace(/\/+$/, "");
  if (!upstreamOrigin) {
    console.error("[hairstyle-proxy] HAIRSTYLE_UPSTREAM_ORIGIN 미설정 — /play/hairstyle 프록시 불가");
    return new NextResponse("HairStyle upstream is not configured", { status: 503 });
  }

  let upstreamBase: URL;
  let upstreamUrl: URL;
  try {
    upstreamBase = new URL(upstreamOrigin);
    upstreamUrl = new URL(`${HAIRSTYLE_PATH_PREFIX}${suffix}${search}`, upstreamBase);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const isWithinUpstreamBasePath =
    upstreamUrl.origin === upstreamBase.origin &&
    (upstreamUrl.pathname === HAIRSTYLE_PATH_PREFIX ||
      upstreamUrl.pathname.startsWith(`${HAIRSTYLE_PATH_PREFIX}/`));
  if (!isWithinUpstreamBasePath) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const outboundHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (REQUEST_HEADER_ALLOWLIST.has(key)) outboundHeaders.set(key, value);
  });

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
      console.error("[hairstyle-proxy] 업스트림 응답 시간 초과");
      return new NextResponse("Gateway Timeout", { status: 504 });
    }
    console.error("[hairstyle-proxy] 업스트림 요청 실패", error);
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
      (target.pathname === HAIRSTYLE_PATH_PREFIX ||
        target.pathname.startsWith(`${HAIRSTYLE_PATH_PREFIX}/`));
    if (!isSafeRedirect || target === null) {
      console.error(`[hairstyle-proxy] 안전하지 않은 업스트림 Location 차단: ${rawLocation}`);
      responseHeaders.delete("location");
      return new NextResponse("Bad Gateway", { status: 502 });
    }
    responseHeaders.set("location", `${target.pathname}${target.search}${target.hash}`);
  }

  // 이미지에 긴 캐시를 걸지 않는다. comic_book 프록시의 1년 immutable 정책은 K-Toon 이
  // "이미지가 바뀌면 새 version 경로를 만든다"(계약 §9)를 보장하기 때문에 성립한다.
  // **HairStyle 이 같은 보장을 하는지 확인하지 않았다.** 생성형 이미지라 같은 URL 에 다른
  // 그림이 올 수 있다면 1년짜리 immutable 은 잘못된 이미지를 그만큼 고착시킨다.
  // 확인되기 전까지는 보수적으로 no-store 로 둔다. 확인되면 그때 푼다.
  const isImmutableAsset = pathname.startsWith(`${HAIRSTYLE_PATH_PREFIX}/_next/static/`);
  if (!isImmutableAsset) {
    responseHeaders.set("cache-control", "private, no-store");
  }

  for (const setCookie of upstreamResponse.headers.getSetCookie()) {
    const name = setCookie.split("=", 1)[0].trim();
    // 응답 방향은 더 엄격하게 — play_ticket_* 은 K-Bestie 가 발급하는 이름이라
    // 업스트림이 덮어쓸 정당한 이유가 없다.
    if (!isKBestieOwnedCookie(name) && !name.startsWith("play_ticket_")) {
      responseHeaders.append("set-cookie", setCookie);
    } else {
      console.warn(`[hairstyle-proxy] 업스트림 Set-Cookie 차단(K-Bestie 소유 이름과 충돌): ${name}`);
    }
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyToHairstyleUpstream;
export const HEAD = proxyToHairstyleUpstream;
export const POST = proxyToHairstyleUpstream;
export const PUT = proxyToHairstyleUpstream;
export const PATCH = proxyToHairstyleUpstream;
export const DELETE = proxyToHairstyleUpstream;
export const OPTIONS = proxyToHairstyleUpstream;
