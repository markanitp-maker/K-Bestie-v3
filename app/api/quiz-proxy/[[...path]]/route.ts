/**
 * `/play/quiz` reverse-proxy — Route Handler 구현 (계획 Phase 4 + Phase 0.7 errata).
 *
 * 사용자에게 보이는 경로는 `/play/quiz/**`이고, middleware가 이를 `/api/quiz-proxy/**`로
 * 내부 rewrite해 이 핸들러로 보낸다. 여기서 업스트림
 * (독립 Quiz Vercel 배포) 요청을 `fetch()`로 직접 조립한다.
 *
 * **왜 `next.config.ts`의 `rewrites()`나 `NextResponse.rewrite()`가 아니라 이 방식인가**:
 * 둘 다 outbound 요청 헤더를 변형할 수 없다. 그러면 K-Bestie 부모 계정의 Supabase
 * 인증 쿠키(refresh token 포함, `path:"/"`)가 정적 자산 요청까지 포함한 **모든** proxied
 * 요청에 실려 외부 배포로 전송된다. 쿠키 Path를 좁혀 원천 차단하는 대안은 RFC 6265상
 * 불가능하다(Path는 prefix-match 전용). 따라서 헤더를 직접 조립할 수 있는 Route
 * Handler가 유일한 실질적 통제 지점이다.
 *
 * **보안 리뷰 반영(task #45)**:
 *  - same-origin 프록시는 Quiz의 JS가 `document.cookie`로 K-Bestie의 non-httpOnly
 *    부모 세션 쿠키를 읽고 same-origin fetch로 인증된 API를 호출할 수 있다는 뜻이다 —
 *    서버측 쿠키 스트립으로는 이 경로를 전혀 막지 못한다. 대표 결정: Quiz를 1st-party로
 *    수용(같은 리뷰 기준 적용)하되 (a) 모든 프록시 요청에 서버간 인증 헤더를 붙여 raw
 *    업스트림 URL이 최종 사용자에게 직접 사용 불가능하게 하고, (b) 프록시 자체가
 *    K-Bestie 인증 세션을 요구한다.
 *  - 롤아웃용 `quiz_proxy` has-게이트는 계획 Phase 7에서 레거시 인앱 구현과 함께
 *    제거했다(되돌아갈 폴백이 없어진 뒤에도 남겨두면 `off` 쿠키를 든 브라우저가
 *    영구 404를 받는 함정이 된다). 인증은 아래 2번의 세션 검사로만 판정한다.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  QUIZ_ERROR_PATH,
  QUIZ_PROXY_INTERNAL_PREFIX,
  QUIZ_PROXY_PATH_PREFIX,
} from "@/lib/play/quizProxyGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 업스트림으로 중계할 요청 본문 상한. 초과 시 413. */
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

/** 업스트림 응답 대기 상한. 초과 시 504. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * 업스트림(Quiz 앱)이 소유한 쿠키 이름. 이 목록에 없는 쿠키는 **나갈 때도 들어올 때도**
 * 차단된다. 계획 Phase 2.3에서 Quiz 저장소가 쓰기로 확정한 이름과 일치해야 한다
 * (같은 Supabase project ref를 쓰기 때문에 이름을 분리하지 않으면 K-Bestie 쿠키와
 * 구분 자체가 불가능하다).
 *
 * `sb-quiz-auth`는 청크 시 `sb-quiz-auth.0` / `.1`로 쪼개지므로 prefix 매칭한다.
 */
const QUIZ_COOKIE_ALLOWLIST = ["sb-quiz-auth", "quiz_attempt_token_v2"] as const;

/**
 * 업스트림으로 그대로 넘겨도 안전한 요청 헤더. 여기 없는 헤더는 전부 버린다.
 * `referer`는 보안 리뷰 권고로 제외했다(K-Bestie 내부 URL 구조 노출 최소화).
 * `cookie`는 의도적으로 없다 — 아래에서 allowlist로 새로 조립한다.
 */
const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "range",
  "if-none-match",
  "if-modified-since",
  "origin",
]);

/**
 * 브라우저로 되돌릴 응답 헤더 allowlist(denylist에서 전환 — 보안 리뷰 권고).
 * denylist는 새로운 위험 헤더가 등장할 때마다 조용히 통과시키지만 allowlist는 fail-safe다.
 * 특히 `clear-site-data`, `service-worker-allowed`, `access-control-*`,
 * `strict-transport-security`, `content-security-policy(-report-only)`,
 * `permissions-policy`, `document-policy`는 업스트림이 K-Bestie 오리진 **전체**의 보안
 * 태세를 바꿔버릴 수 있어 절대 통과시키면 안 된다. `set-cookie`는 아래에서 별도 처리.
 */
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "location",
  "vary",
  "accept-ranges",
  "content-range",
  "x-content-type-options",
]);

function isQuizCookieName(name: string): boolean {
  return QUIZ_COOKIE_ALLOWLIST.some(
    (allowed) => name === allowed || name.startsWith(`${allowed}.`)
  );
}

/**
 * `x-forwarded-host`로 보낼 호스트. 클라이언트가 보낸 Host 헤더를 그대로 되울리면
 * 업스트림이 공격자 통제 값을 신뢰하게 되므로, 알려진 앱 호스트를 우선한다.
 */
function resolveAppHost(request: NextRequest): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      console.warn("[quiz-proxy] NEXT_PUBLIC_APP_URL 파싱 실패 — Host 헤더로 폴백");
    }
  }
  return request.headers.get("host");
}

async function proxyToQuizUpstream(request: NextRequest): Promise<Response> {
  // ── 1. 경로 도출 ───────────────────────────────────────────────────────────
  // middleware rewrite 후의 pathname은 내부 prefix지만, 런타임에 따라 원래
  // `/play/quiz` prefix가 그대로 보일 수도 있으므로 둘 다 받는다. 둘 다 아니면
  // 조용히 루트로 프록시하지 말고(무성 오배송) 거절한다.
  const { pathname, search } = request.nextUrl;
  let suffix: string;
  if (pathname.startsWith(QUIZ_PROXY_INTERNAL_PREFIX)) {
    suffix = pathname.slice(QUIZ_PROXY_INTERNAL_PREFIX.length);
  } else if (pathname.startsWith(QUIZ_PROXY_PATH_PREFIX)) {
    suffix = pathname.slice(QUIZ_PROXY_PATH_PREFIX.length);
  } else {
    console.error(`[quiz-proxy] 예상치 못한 pathname: ${pathname}`);
    return new NextResponse("Bad Request", { status: 400 });
  }

  // 인코딩된 슬래시/백슬래시는 프록시 경계 양쪽의 경로 해석이 갈릴 수 있어 거절한다.
  if (/%2f|%5c/i.test(suffix)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  /** 사용자에게 보이는 원래 경로. 로그인 리다이렉트의 `from`으로 쓴다. */
  const publicPath = `${QUIZ_PROXY_PATH_PREFIX}${suffix}`;

  // 성능: `_next/static/*`는 콘텐츠 해시가 붙은 불변 자산이라 요청자와 무관하게
  // 항상 같은 바이트를 반환한다(사용자별 데이터 없음). 퀴즈 첫 화면 로드 시 이런
  // 정적 청크가 수십 개씩 이 프록시를 거치는데, 매 요청마다 K-Bestie 세션을
  // Supabase Auth API로 왕복 검증하면(요청당 수백 ms) 그 비용이 그대로 누적돼
  // "클릭 후 10초" 체감 지연의 상당 부분을 차지했다(계측 확인). 아래 내부 시크릿
  // 검증(§3)과 쿠키 allowlist는 정적 자산 경로에도 동일하게 그대로 적용되므로
  // "raw 업스트림 URL을 최종 사용자가 직접 못 쓰게 한다"는 보안 속성은 유지된다 —
  // 여기서 생략하는 것은 오직 "이 브라우저가 K-Bestie에 로그인돼 있는가"라는,
  // 이 특정 응답 바이트에는 영향을 주지 않는 검사뿐이다.
  const isImmutableAssetPath = publicPath.startsWith(`${QUIZ_PROXY_PATH_PREFIX}/_next/static/`);

  // ── 2. K-Bestie 인증 세션 필수(불변 정적 자산 제외) ────────────────────────
  // 게이트 쿠키는 롤아웃 스위치일 뿐이므로, 업스트림으로 나가기 전에 실제 세션을
  // 확인한다(대표 결정 task #45-b).
  if (!isImmutableAssetPath) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // 문서 내비게이션은 /login으로, 서브리소스(_next/*·API)는 401로 — 기존 middleware가
      // 쓰는 것과 같은 분기다. 에셋/XHR 요청에 HTML 로그인 페이지를 돌려주면 안 된다.
      const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
      if (wantsHtml) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.search = "";
        loginUrl.searchParams.set("from", `${publicPath}${search}`);
        return NextResponse.redirect(loginUrl);
      }
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // ── 3. 업스트림 설정(둘 다 fail-closed) ────────────────────────────────────
  const upstreamOrigin = process.env.QUIZ_UPSTREAM_ORIGIN?.replace(/\/+$/, "");
  if (!upstreamOrigin) {
    console.error("[quiz-proxy] QUIZ_UPSTREAM_ORIGIN 미설정 — /play/quiz 프록시 불가");
    return new NextResponse("Quiz upstream is not configured", { status: 503 });
  }

  // 서버간 공유 시크릿. Quiz 앱이 이 헤더 없는 요청을 404로 거절하므로 raw 업스트림
  // URL은 최종 사용자에게 직접 사용 불가능해진다(대표 결정 task #45-a).
  // 미설정 시 fail-closed — 인증이 안 붙은 요청을 굳이 내보내지 않는다.
  const internalSecret = process.env.QUIZ_INTERNAL_AUTH_SECRET;
  if (!internalSecret) {
    console.error("[quiz-proxy] QUIZ_INTERNAL_AUTH_SECRET 미설정 — 프록시 요청 중단");
    return new NextResponse("Quiz upstream is not configured", { status: 503 });
  }

  let upstreamBase: URL;
  let upstreamUrl: URL;
  try {
    upstreamBase = new URL(upstreamOrigin);
    upstreamUrl = new URL(`${QUIZ_PROXY_PATH_PREFIX}${suffix}${search}`, upstreamBase);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // `..` 정규화 등으로 업스트림의 basePath 밖(또는 다른 오리진)으로 새어나가지 않는지.
  const isWithinUpstreamBasePath =
    upstreamUrl.origin === upstreamBase.origin &&
    (upstreamUrl.pathname === QUIZ_PROXY_PATH_PREFIX ||
      upstreamUrl.pathname.startsWith(`${QUIZ_PROXY_PATH_PREFIX}/`));
  if (!isWithinUpstreamBasePath) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // ── 4. Outbound 헤더 조립(쿠키 스트립 + 시크릿 부착을 같은 패스에서) ───────
  const outboundHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (REQUEST_HEADER_ALLOWLIST.has(key)) outboundHeaders.set(key, value);
  });

  // 쿠키 재조립 — allowlist 밖(특히 K-Bestie의 `sb-<ref>-auth-token`, 게이트 쿠키
  // `quiz_proxy`)은 업스트림으로 나가지 않는다.
  const forwardedCookies = request.cookies
    .getAll()
    .filter((cookie) => isQuizCookieName(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (forwardedCookies) {
    outboundHeaders.set("cookie", forwardedCookies);
  }

  // 헤더로만 전달한다 — 쿠키/쿼리로 절대 내보내지 않는다(브라우저 JS가 읽으면 안 됨).
  outboundHeaders.set("x-quiz-proxy-auth", internalSecret);

  const appHost = resolveAppHost(request);
  if (appHost) outboundHeaders.set("x-forwarded-host", appHost);
  outboundHeaders.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  // Vercel Deployment Protection이 켜진 dev 업스트림용 bypass. K-Bestie 자신의
  // 시스템 주입 변수(`VERCEL_AUTOMATION_BYPASS_SECRET`)를 전달하지 않고 전용 변수를 쓴다.
  const bypassSecret = process.env.QUIZ_UPSTREAM_BYPASS_SECRET;
  if (bypassSecret && process.env.VERCEL_ENV !== "production") {
    outboundHeaders.set("x-vercel-protection-bypass", bypassSecret);
    outboundHeaders.set("x-vercel-set-bypass-cookie", "false");
  }

  // ── 5. 본문 상한 ───────────────────────────────────────────────────────────
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return new NextResponse("Payload Too Large", { status: 413 });
  }

  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
    // content-length가 없거나 거짓말인 경우를 대비해 실제 버퍼 크기도 확인한다.
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
      return new NextResponse("Payload Too Large", { status: 413 });
    }
  }

  // ── 6. 업스트림 호출 ───────────────────────────────────────────────────────
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
      console.error("[quiz-proxy] 업스트림 응답 시간 초과");
      return new NextResponse("Gateway Timeout", { status: 504 });
    }
    console.error("[quiz-proxy] 업스트림 요청 실패", error);
    return new NextResponse("Bad Gateway", { status: 502 });
  }

  // ── 7. 응답 헤더 필터링 ────────────────────────────────────────────────────
  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key)) responseHeaders.set(key, value);
  });

  // 절대 Location은 파싱해서 검증한다. 단순 `startsWith(upstreamOrigin)` 비교는
  // 프로토콜 상대 URL(`//evil.com`)과 형제 도메인(`<upstream>.evil.com`)을 통과시키는
  // 오픈 리다이렉트였다.
  const rawLocation = upstreamResponse.headers.get("location");
  if (rawLocation) {
    let target: URL | null = null;
    try {
      target = new URL(rawLocation, upstreamUrl);
    } catch {
      target = null;
    }
    // basePath 안쪽이거나, K-Bestie의 오류 수신 경로(정확히 일치할 때만) 허용한다.
    // 오류 수신 경로는 `/play/quiz`의 **형제**라 basePath 규칙에 자동으로 걸리지 않으므로
    // 이렇게 딱 하나만 명시적으로 예외 처리한다(접두사 매칭 금지 — `/play/quiz-error-evil`
    // 같은 경로가 함께 열리면 안 된다).
    const isSafeRedirect =
      target !== null &&
      target.origin === upstreamBase.origin &&
      (target.pathname === QUIZ_PROXY_PATH_PREFIX ||
        target.pathname.startsWith(`${QUIZ_PROXY_PATH_PREFIX}/`) ||
        target.pathname === QUIZ_ERROR_PATH);
    if (!isSafeRedirect || target === null) {
      console.error(`[quiz-proxy] 안전하지 않은 업스트림 Location 차단: ${rawLocation}`);
      responseHeaders.delete("location");
      return new NextResponse("Bad Gateway", { status: 502 });
    }
    // 프록시 오리진 기준 상대경로로 되돌린다 — 브라우저가 Quiz 도메인으로 이탈하지 않게.
    responseHeaders.set("location", `${target.pathname}${target.search}${target.hash}`);
  }

  // 아이별 진행상태가 CDN에 캐시돼 다른 사용자에게 새어나가지 않도록, 불변 정적 자산
  // 외에는 업스트림 Cache-Control을 신뢰하지 않고 강제로 private/no-store로 덮는다.
  if (!isImmutableAssetPath) {
    responseHeaders.set("cache-control", "private, no-store");
  }

  for (const setCookie of upstreamResponse.headers.getSetCookie()) {
    const name = setCookie.split("=", 1)[0].trim();
    if (isQuizCookieName(name)) {
      responseHeaders.append("set-cookie", setCookie);
    } else {
      console.warn(`[quiz-proxy] 업스트림 Set-Cookie 차단(allowlist 밖): ${name}`);
    }
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyToQuizUpstream;
export const HEAD = proxyToQuizUpstream;
export const POST = proxyToQuizUpstream;
export const PUT = proxyToQuizUpstream;
export const PATCH = proxyToQuizUpstream;
export const DELETE = proxyToQuizUpstream;
export const OPTIONS = proxyToQuizUpstream;
