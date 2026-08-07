import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient, type Session } from "@supabase/supabase-js";

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const CHILD_ID = "4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c";
const EVIDENCE_DIR = "/tmp/codex-qa-069";

type ApiResult = { status: number; body: any };

test("069 server turn is atomic, idempotent, and completes with reward", async ({ page, context }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
  expect(supabaseUrl && anonKey && serviceKey).toBeTruthy();
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: "qatesti-dev@kbestie.local",
  });
  expect(linkError, linkError?.message).toBeNull();
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties!.hashed_token,
  });
  expect(verifyError, verifyError?.message).toBeNull();
  const session = verified.session as Session;
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunks = cookieValue.length <= 3180
    ? [{ name: cookieName, value: cookieValue }]
    : Array.from({ length: Math.ceil(cookieValue.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: cookieValue.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(chunks.map((cookie) => ({
    ...cookie,
    url: DEV_URL,
    secure: true,
    sameSite: "Lax" as const,
  })));
  await page.goto(DEV_URL);
  await page.waitForLoadState("domcontentloaded");

  const call = async (path: string, payload: Record<string, unknown>): Promise<ApiResult> => {
    const response = await context.request.post(new URL(path, DEV_URL).toString(), { data: payload });
    return { status: response.status(), body: await response.json().catch(() => null) };
  };

  const started = await call("/api/mission/start", { childId: CHILD_ID, roundType: "round1_day" });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.sessionId).toBeTruthy();
  expect(started.body.questions.length).toBeGreaterThanOrEqual(5);

  const sessionId = started.body.sessionId as string;
  const turns: Array<{ clientTurnId: string; kTurnId: string }> = [];
  const requiredCount = started.body.requiredCount || 5;

  for (let index = 0; index < requiredCount; index += 1) {
    const question = started.body.questions[index];
    const clientTurnId = crypto.randomUUID();
    const kTurnId = `${clientTurnId}:k`;
    const startPayload = {
      action: "start",
      sessionId,
      clientTurnId,
      questionId: question.id,
      // 질문 엔진이 명시적으로 유효 답변으로 취급하는 짧은 자연어. 외부 분류 모델의
      // 비결정성을 제거해 persistence 원자성만 검증한다.
      answerText: "없어",
      voiceMode: "stt_tts",
      displaySequence: index * 2 + 1,
    };

    const first = await call("/api/mission/turn", startPayload);
    expect(first.status, `turn ${index + 1}: ${JSON.stringify(first.body)}`).toBe(200);
    expect(first.body.completed).toBe(false);
    expect(first.body.completionCandidate).toBe(index === requiredCount - 1);

    const replays = await Promise.all([
      call("/api/mission/turn", startPayload),
      call("/api/mission/turn", startPayload),
    ]);
    for (const replay of replays) {
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.replayed).toBe(true);
    }

    const finalizePayload = {
      action: "finalize",
      sessionId,
      clientTurnId,
      kTurnId,
      kContent: index === requiredCount - 1
        ? "오늘 미션을 모두 완료했어! 이야기해 줘서 고마워. 다음에 또 보자!"
        : `069 검증 응답 ${index + 1}`,
      kDisplaySequence: index * 2 + 2,
      isClarification: false,
    };
    const finalized = await call("/api/mission/turn", finalizePayload);
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    expect(finalized.body.completed).toBe(index === requiredCount - 1);
    if (index === requiredCount - 1) {
      expect(["awarded", "already_earned", "daily_limit_reached", "balance_limit_reached"])
        .toContain(finalized.body.rewardStatus);
    }

    const finalizedReplay = await call("/api/mission/turn", finalizePayload);
    expect(finalizedReplay.status, JSON.stringify(finalizedReplay.body)).toBe(200);
    expect(finalizedReplay.body.replayed).toBe(true);
    turns.push({ clientTurnId, kTurnId });
  }

  writeFileSync(`${EVIDENCE_DIR}/server-result.json`, JSON.stringify({ sessionId, requiredCount, turns }, null, 2));
});
