/**
 * 퀴즈마스터 내부 리더보드 조회 API 클라이언트 (K-Bestie 서버 → Quizmaster 서버).
 * requests/request_kbestie_app_events.md §11.1, .omc/specs/deep-interview-kbestie-app-events.md §7.
 *
 * 기존 /play/quiz 프록시(app/api/quiz-proxy/[[...path]]/route.ts)와 동일한 서버간
 * 공유 시크릿(QUIZ_INTERNAL_AUTH_SECRET → x-quiz-proxy-auth 헤더, QUIZ_UPSTREAM_ORIGIN)을
 * 재사용한다. 이 호출은 브라우저를 거치지 않고 K-Bestie 서버가 직접 수행하며, 사용자
 * 쿠키는 전달하지 않는다(순수 서버간 조회).
 */

export interface QuizLeaderboardEntry {
  rank: number;
  childId: string;
  score: number;
  correctCount: number;
  completedQuizCount: number;
  lastActivityAt: string;
  estimatedRewardAmount: number;
  isSeedUser?: boolean;
  rewardEligible?: boolean;
}

export interface QuizLeaderboardResponse {
  period: string;
  status: "active" | "finalized" | string;
  asOf: string;
  scoringVersion: string;
  entries: QuizLeaderboardEntry[];
  nextCursor: string | null;
}

import { getAppEventEnvironment } from "@/lib/events/environment";

export type QuizLeaderboardResult =
  | { ok: true; data: QuizLeaderboardResponse }
  | { ok: false; error: string; lastKnownGoodAt?: string };

const REQUEST_TIMEOUT_MS = 8_000;
const VALID_PERIODS = new Set(["2026-08", "2026-09", "2026-10"]);

/** 서버간 조회 실패 시 마지막 정상 조회 시각을 보여주기 위한 인메모리 캐시.
 *  서버리스 인스턴스별로만 유효한 best-effort 캐시다(기존 respondCache와 동일 원칙). */
const lastGoodCache = new Map<string, { data: QuizLeaderboardResponse; at: string }>();

export async function fetchQuizLeaderboard(
  period: string,
  opts: { limit?: number; cursor?: string } = {}
): Promise<QuizLeaderboardResult> {
  if (!VALID_PERIODS.has(period)) {
    return { ok: false, error: "invalid_period" };
  }

  const upstreamOrigin = process.env.QUIZ_UPSTREAM_ORIGIN?.replace(/\/+$/, "");
  const internalSecret = process.env.QUIZ_INTERNAL_AUTH_SECRET;
  if (!upstreamOrigin || !internalSecret) {
    console.error("[quizLeaderboardClient] QUIZ_UPSTREAM_ORIGIN/QUIZ_INTERNAL_AUTH_SECRET 미설정");
    return fallbackToLastGood(period, "not_configured");
  }

  const environment = getAppEventEnvironment();
  const url = new URL("/internal/events/leaderboard", upstreamOrigin);
  url.searchParams.set("period", period);
  url.searchParams.set("limit", String(opts.limit ?? 100));
  if (opts.cursor) url.searchParams.set("cursor", opts.cursor);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-quiz-proxy-auth": internalSecret,
        "x-environment": environment,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[quizLeaderboardClient] upstream non-2xx:", res.status);
      return fallbackToLastGood(period, `upstream_${res.status}`);
    }

    const data = (await res.json()) as QuizLeaderboardResponse;
    lastGoodCache.set(period, { data, at: new Date().toISOString() });
    return { ok: true, data };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    console.error("[quizLeaderboardClient] request failed:", isTimeout ? "timeout" : (err as Error).message);
    return fallbackToLastGood(period, isTimeout ? "timeout" : "request_failed");
  }
}

function fallbackToLastGood(period: string, error: string): QuizLeaderboardResult {
  const cached = lastGoodCache.get(period);
  if (cached) {
    return { ok: false, error, lastKnownGoodAt: cached.at };
  }
  return { ok: false, error };
}
