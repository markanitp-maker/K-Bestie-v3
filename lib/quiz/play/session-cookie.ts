import "server-only";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

/**
 * requests/021 — 퀴즈마스터 프로젝트에서 포팅, 변경 없음. K-Bestie 세션(인증)과는 별도로,
 * "이 attempt를 지금 어느 기기가 갖고 있는가"를 지키는 attempt 전용 device-lock
 * 쿠키다 - K-Bestie 자체 인증 쿠키와 이름이 겹치지 않도록 고유한 이름을 쓴다.
 */
export const QUIZ_SESSION_COOKIE = "kbestie_quiz_attempt_token";

const SESSION_COOKIE_MAX_AGE_SECONDS = 6 * 60 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function generateDeviceId(): string {
  return randomBytes(16).toString("hex");
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(QUIZ_SESSION_COOKIE)?.value ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(QUIZ_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(QUIZ_SESSION_COOKIE);
}
