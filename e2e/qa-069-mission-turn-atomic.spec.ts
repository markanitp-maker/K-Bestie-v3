import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient, type Session } from "@supabase/supabase-js";

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const CHILD_ID = "4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c";
const EVIDENCE_DIR = "/tmp/codex-qa-069";
const QA_ROUND = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours() >= 18
  ? "round2_night"
  : "round1_day";

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
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstDayStart = new Date(Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
  ) - 9 * 60 * 60 * 1000).toISOString();
  const { data: todaySessions, error: todaySessionsError } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", CHILD_ID)
    .gte("started_at", kstDayStart);
  expect(todaySessionsError, todaySessionsError?.message).toBeNull();
  const todaySessionIds = (todaySessions ?? []).map((row) => row.id);
  if (todaySessionIds.length > 0) {
    const { data: staleProgress, error: staleProgressError } = await service
      .from("mission_progress")
      .select("session_id")
      .in("session_id", todaySessionIds)
      .eq("round_type", QA_ROUND)
      .eq("status", "IN_PROGRESS");
    expect(staleProgressError, staleProgressError?.message).toBeNull();
    const staleSessionIds = (staleProgress ?? []).map((row) => row.session_id);
    if (staleSessionIds.length > 0) {
      const { error: progressCleanupError } = await service
        .from("mission_progress")
        .update({ status: "FORCE_ENDED" })
        .in("session_id", staleSessionIds);
      expect(progressCleanupError, progressCleanupError?.message).toBeNull();
      const { error: sessionCleanupError } = await service
        .from("chat_sessions")
        .update({
          started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          ended_at: new Date().toISOString(),
        })
        .in("id", staleSessionIds);
      expect(sessionCleanupError, sessionCleanupError?.message).toBeNull();
    }
  }
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

  const started = await call("/api/mission/start", {
    childId: CHILD_ID,
    roundType: QA_ROUND,
    confirmRestart: true,
  });
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

    if (index === 0) {
      const failedStart = await call("/api/mission/turn", {
        ...startPayload,
        questionId: crypto.randomUUID(),
      });
      expect(failedStart.status).toBe(503);
      const { count: failedTurnCount } = await service
        .from("mission_turns")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("client_turn_id", clientTurnId);
      const { data: progressAfterFailure } = await service
        .from("mission_progress")
        .select("valid_answer_count,status")
        .eq("session_id", sessionId)
        .single();
      expect(failedTurnCount).toBe(0);
      expect(progressAfterFailure).toMatchObject({ valid_answer_count: 0, status: "IN_PROGRESS" });
    }

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
    if (index === requiredCount - 1) {
      const failedFinalize = await call("/api/mission/turn", {
        ...finalizePayload,
        kTurnId: `${clientTurnId}:invalid`,
      });
      expect(failedFinalize.status).toBe(503);
      const [{ data: preFinalizeProgress }, { count: preFinalizeRewardCount }, { count: preFinalizeKCount }] = await Promise.all([
        service.from("mission_progress").select("valid_answer_count,status").eq("session_id", sessionId).single(),
        service.from("gold_key_ledger").select("id", { count: "exact", head: true }).eq("mission_id", sessionId),
        service.from("chat_messages").select("id", { count: "exact", head: true })
          .eq("session_id", sessionId).eq("turn_id", kTurnId),
      ]);
      expect(preFinalizeProgress).toMatchObject({ valid_answer_count: requiredCount, status: "IN_PROGRESS" });
      expect(preFinalizeRewardCount).toBe(0);
      expect(preFinalizeKCount).toBe(0);
    }
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

  const uiStarted = await call("/api/mission/start", {
    childId: CHILD_ID,
    roundType: QA_ROUND,
    confirmRestart: true,
  });
  expect(uiStarted.status, JSON.stringify(uiStarted.body)).toBe(200);
  await page.evaluate((childId) => localStorage.setItem("k_child_id", childId), CHILD_ID);
  await page.goto(`${DEV_URL}/child/missions?childId=${CHILD_ID}&roundType=${QA_ROUND}`, { waitUntil: "domcontentloaded" });
  const resume = page.getByRole("button", { name: /진행 중인 미션 이어하기/ });
  await expect(resume).toBeVisible({ timeout: 20_000 });
  await resume.click({ force: true });
  const textMode = page.getByRole("button", { name: "텍스트로 답하기" }).first();
  await expect(textMode).toBeEnabled({ timeout: 20_000 });
  await textMode.click({ force: true });
  const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
  await expect(input).toBeVisible({ timeout: 10_000 });

  const failedBodies: any[] = [];
  await page.route("**/api/mission/turn", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "start" && failedBodies.length < 3) {
      failedBodies.push(body);
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });
  await input.fill("없어");
  await page.getByRole("button", { name: "전송" }).click();
  await expect.poll(() => failedBodies.length, { timeout: 15_000 }).toBe(3);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible({ timeout: 15_000 });
  expect(failedBodies).toHaveLength(3);
  expect(new Set(failedBodies.map((body) => body.clientTurnId)).size).toBe(1);

  const pending = await page.evaluate(async () => new Promise<any>((resolve) => {
    const open = indexedDB.open("k-bestie-mission-recovery", 1);
    open.onsuccess = () => {
      const tx = open.result.transaction("pending-turns", "readonly");
      const get = tx.objectStore("pending-turns").get("current");
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => resolve(null);
    };
    open.onerror = () => resolve(null);
  }));
  expect(pending?.clientTurnId).toBe(failedBodies[0].clientTurnId);

  await page.unroute("**/api/mission/turn");
  const recoveredIds: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/mission/turn") || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.clientTurnId) recoveredIds.push(body.clientTurnId);
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => recoveredIds.includes(pending.clientTurnId), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => page.evaluate(async () => new Promise<boolean>((resolve) => {
    const open = indexedDB.open("k-bestie-mission-recovery", 1);
    open.onsuccess = () => {
      const tx = open.result.transaction("pending-turns", "readonly");
      const get = tx.objectStore("pending-turns").get("current");
      get.onsuccess = () => resolve(!get.result);
      get.onerror = () => resolve(false);
    };
    open.onerror = () => resolve(false);
  })), { timeout: 25_000 }).toBe(true);
});
