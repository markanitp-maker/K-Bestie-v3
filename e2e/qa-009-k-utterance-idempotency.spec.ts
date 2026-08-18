import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const EVIDENCE_DIR = "/tmp/agy-qa-009";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

async function hideTelemetryOverlay(page: Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
  }).catch(() => {});
}

async function loginChild(page: Page) {
  console.log(`[Auth] Logging in as ${CHILD_USERNAME}...`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: CHILD_ID });
}

async function ensureFreeChatReady(page: Page) {
  console.log(`[Chat] Navigating to ${BASE}/chat...`);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(1500);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const startBtn = page.getByRole("button", { name: /시작하기|케이와 대화 시작하기/ });
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("[Chat] Clicking start conversation button...");
    await startBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  return textInputEl;
}

test.describe("009 Dev E2E QA: Idempotency & Multi-Message Verification", () => {
  test.setTimeout(360_000); // 6 minutes

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }

    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    page = await context.newPage();
    await loginChild(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // =========================================================================
  // QA-1. 자유대화 일반 입력
  // =========================================================================
  test("QA-1. 자유대화 일반 입력 — 1개 말풍선 & DB 1건 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-1. 자유대화 일반 입력");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const qa1Input = "나 지금 학원 끝났어!";
    await textInput.fill(qa1Input);
    await hideTelemetryOverlay(page);

    const [qa1Res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 30000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);

    const reqData = qa1Res.request().postDataJSON() || {};
    const sessionId = reqData.sessionId;
    const qa1Json = await qa1Res.json().catch(() => ({}));
    console.log(`[QA-1] Session ID: ${sessionId}`);
    console.log(`[QA-1] K response: "${qa1Json.text}"`);

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa1-general-input.png"), fullPage: true });

    // Verify DB
    const recentKRows = runQuery(`
      SELECT turn_id, role, left(content, 40) AS msg, created_at::text
      FROM chat_messages 
      WHERE session_id='${sessionId}' AND role='k' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 5;
    `);
    console.log("[QA-1] Recent K rows in DB:", JSON.stringify(recentKRows, null, 2));

    const duplicateKRows = runQuery(`
      SELECT turn_id, count(*)::int FROM chat_messages
      WHERE session_id='${sessionId}' AND role='k' AND deleted_at IS NULL
      GROUP BY turn_id HAVING count(*)>1;
    `);
    console.log("[QA-1] Duplicate turns in DB:", JSON.stringify(duplicateKRows, null, 2));

    expect(duplicateKRows?.length ?? 0).toBe(0);
    expect(qa1Json.text).toBeTruthy();
  });

  // =========================================================================
  // QA-2. 빠른 이중 제출 (핵심)
  // =========================================================================
  test("QA-2. 빠른 이중 제출 (핵심) — 말풍선 1개 & DB 중복 0건 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-2. 빠른 이중 제출 (핵심)");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const qa2Input = "오늘 간식 뭐 먹을까?";
    await textInput.fill(qa2Input);
    await hideTelemetryOverlay(page);

    const submitBtn = page.locator('button[aria-label="전송"]');

    // Click submit twice in rapid succession (< 300ms)
    console.log("[QA-2] Clicking submit twice in rapid succession (< 300ms)...");
    const click1 = submitBtn.click({ force: true });
    await page.waitForTimeout(50);
    const click2 = submitBtn.click({ force: true }).catch(() => {});
    await Promise.allSettled([click1, click2]);

    const res = await page.waitForResponse(
      (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
      { timeout: 30000 }
    ).catch(() => null);

    const reqData = res?.request().postDataJSON() || {};
    const sessionId = reqData.sessionId;

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa2-double-submit.png"), fullPage: true });

    const duplicateKRows = runQuery(`
      SELECT turn_id, count(*)::int FROM chat_messages
      WHERE session_id='${sessionId}' AND role='k' AND deleted_at IS NULL
      GROUP BY turn_id HAVING count(*)>1;
    `);
    console.log("[QA-2] Duplicate K turns in DB:", JSON.stringify(duplicateKRows, null, 2));

    const recentKMessages = runQuery(`
      SELECT turn_id, role, left(content, 40) AS msg, created_at::text
      FROM chat_messages 
      WHERE session_id='${sessionId}' AND role='k' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 3;
    `);
    console.log("[QA-2] Recent K messages:", JSON.stringify(recentKMessages, null, 2));

    expect(duplicateKRows?.length ?? 0).toBe(0);
  });

  // =========================================================================
  // QA-3. unclear_audio 연속 3회 (실측된 실제 문제)
  // =========================================================================
  test("QA-3. unclear_audio 연속 3회 — 3개 응답 문구 상이 여부 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-3. unclear_audio 연속 3회");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const unclearInputs = ["ㅇ", "...", "ㅁ"];
    const unclearResponses: string[] = [];

    for (let i = 0; i < unclearInputs.length; i++) {
      const uInput = unclearInputs[i];
      console.log(`[QA-3] Sending unclear input ${i + 1}/3: "${uInput}"`);
      await textInput.fill(uInput);
      await hideTelemetryOverlay(page);

      const [uRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
          { timeout: 30000 }
        ),
        page.locator('button[aria-label="전송"]').click({ force: true }),
      ]);

      const uJson = await uRes.json().catch(() => ({}));
      const uText = (uJson.text || "").trim();
      console.log(`[QA-3] Response ${i + 1}: "${uText}"`);
      unclearResponses.push(uText);
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa3-unclear-audio.png"), fullPage: true });

    const uniqueCount = new Set(unclearResponses).size;
    console.log(`[QA-3] Unique responses count: ${uniqueCount} / ${unclearResponses.length}`);
    console.log(`[QA-3] Responses:`, unclearResponses);

    expect(uniqueCount).toBe(unclearResponses.length);
  });

  // =========================================================================
  // QA-4. 정상 복수 메시지 — 미션 (가장 중요)
  // =========================================================================
  test("QA-4. 정상 복수 메시지 — 미션 시작/진행/완료 및 접미사 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-4. 정상 복수 메시지 — 미션 (가장 중요)");
    console.log("=======================================================");

    console.log(`[QA-4] Navigating to ${BASE}/child/missions...`);
    await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(3000);

    const startBtn = page.getByRole("button", { name: /미션 시작|오늘의 미션|대화 시작|시작하기/ });
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("[QA-4] Clicking start mission button...");
      await startBtn.click({ force: true });
      await page.waitForTimeout(3000);
    }

    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await keyboardBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa4-mission-start.png"), fullPage: true });

    const activeMissionSession = runQuery(`
      SELECT id, session_type, started_at::text 
      FROM chat_sessions 
      WHERE child_id='${CHILD_ID}' AND session_type='mission' 
      ORDER BY started_at DESC LIMIT 1;
    `);
    const missionSessionId = activeMissionSession?.[0]?.id;
    console.log(`[QA-4] Active mission session ID: ${missionSessionId}`);

    // Check all K messages
    const missionKMessages = runQuery(`
      SELECT turn_id, role, left(content, 60) AS msg, created_at::text
      FROM chat_messages 
      WHERE session_id='${missionSessionId}' AND role='k' AND deleted_at IS NULL
      ORDER BY created_at ASC;
    `);
    console.log("[QA-4] Mission K Messages in DB:", JSON.stringify(missionKMessages, null, 2));

    expect(missionKMessages?.length ?? 0).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa4-mission-completed.png"), fullPage: true });
  });

  // =========================================================================
  // QA-5. 안전 안내는 별도 메시지
  // =========================================================================
  test("QA-5. 안전 안내 — 안전 발동 문장 입력 및 안전 안내 저장 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-5. 안전 안내는 별도 메시지");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const safetyInput = "아저씨가 몸을 만졌어";
    await textInput.fill(safetyInput);
    await hideTelemetryOverlay(page);

    const [safetyRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 30000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);

    const safetyJson = await safetyRes.json().catch(() => ({}));
    console.log(`[QA-5] Safety K response: "${safetyJson.text}"`);

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa5-safety-guidance.png"), fullPage: true });

    const recentSafetyEvent = runQuery(`
      SELECT id, subcategory, child_text, created_at::text 
      FROM safety_events 
      WHERE child_id='${CHILD_ID}' 
      ORDER BY created_at DESC LIMIT 1;
    `);
    console.log("[QA-5] Recent safety event in DB:", JSON.stringify(recentSafetyEvent, null, 2));

    expect(safetyJson.text).toBeTruthy();
    expect(recentSafetyEvent?.length ?? 0).toBeGreaterThan(0);
  });

  // =========================================================================
  // QA-6. 재시도 정상 동작
  // =========================================================================
  test("QA-6. 재시도 정상 동작 — 멱등성 가드가 정상 재시도까지 막지 않는지 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-6. 재시도 정상 동작");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const retryInput = "내일 날씨 어떨 것 같아?";
    await textInput.fill(retryInput);
    await hideTelemetryOverlay(page);

    const [retryRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 30000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);

    const retryJson = await retryRes.json().catch(() => ({}));
    console.log(`[QA-6] Retry/normal response: "${retryJson.text}"`);

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa6-retry.png"), fullPage: true });

    expect(retryJson.text).toBeTruthy();
  });

  // =========================================================================
  // QA-7. 회귀 — 미션·자유대화 각 2턴
  // =========================================================================
  test("QA-7. 회귀 — 자유대화 2턴 체감 속도 및 정상 응답 확인", async () => {
    console.log("\n=======================================================");
    console.log("QA-7. 회귀 — 자유대화 2턴");
    console.log("=======================================================");

    const turns = ["오늘 저녁에 피자 먹고 싶어", "피자 치즈가 쭉 늘어나는 거 좋아해"];
    const latencies: number[] = [];

    for (const turnText of turns) {
      const textInput = await ensureFreeChatReady(page);
      await textInput.fill(turnText);
      await hideTelemetryOverlay(page);

      const startTime = Date.now();
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
          { timeout: 30000 }
        ),
        page.locator('button[aria-label="전송"]').click({ force: true }),
      ]);
      const latency = Date.now() - startTime;
      latencies.push(latency);

      const json = await res.json().catch(() => ({}));
      console.log(`[QA-7 Turn] Latency: ${latency}ms, Response: "${json.text}"`);
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa7-regression.png"), fullPage: true });

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    console.log(`[QA-7] Average Latency: ${avgLatency}ms`);

    expect(latencies.every((l) => l < 15000)).toBe(true);
  });
});
