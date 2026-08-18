import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const LOG_DIR = "/tmp/agy-qa-008/hint_debug";

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

async function hideTelemetryOverlay(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
  }).catch(() => {});
}

async function loginAs(page: import("@playwright/test").Page, username: string, childId: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(username);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await hideTelemetryOverlay(page);
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: childId });
}

async function goToChat(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(1500);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  await hideTelemetryOverlay(page);
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`\n[sendChatMessage] Child: "${message}"`);
  const startTime = Date.now();
  await hideTelemetryOverlay(page);
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/voice/respond") && res.request().method() === "POST",
      { timeout: 45000 }
    ),
    page.locator('button[aria-label="전송"]').click({ force: true }),
  ]);
  const latencyMs = Date.now() - startTime;

  const json = await response.json().catch(() => ({}));
  await page.waitForTimeout(1200);

  const bubble = page.locator("p.text-left").first();
  const bubbleText = (await bubble.textContent().catch(() => "")) || json.text || "";
  const kText = (json.text || bubbleText).trim();
  console.log(`[sendChatMessage] K (${latencyMs}ms): "${kText}"`);

  return {
    kText,
    bubbleText: bubbleText.trim(),
    status: response.status(),
    latencyMs,
    json,
  };
}

test.describe("Nonsense Quiz Explicit Hint Flow Verification", () => {
  test.setTimeout(300_000);

  test("Verify explicit hint flow and hint_level progression", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    const startPreTimeRes = runQuery("SELECT now() as t;");
    const startPreTime = startPreTimeRes[0].t;

    // 1. 시작
    const res1 = await sendChatMessage(page, "수수께끼 하자");
    const sRes = runQuery(`
      SELECT id, state, current_question_id, hint_level, started_at
      FROM nonsense_game_sessions
      WHERE child_id='${CHILD_A_ID}' AND started_at >= '${startPreTime}'
      ORDER BY started_at DESC LIMIT 1;
    `);
    console.log("[Start Session]", JSON.stringify(sRes, null, 2));

    const gameSessionId = sRes[0].id;
    const qId = sRes[0].current_question_id;
    const qInfo = runQuery(`SELECT * FROM nonsense_questions WHERE id='${qId}';`)[0];
    console.log("[Question Info]", JSON.stringify(qInfo, null, 2));

    // 2. 힌트 요청: "힌트 줘"
    const hint1Res = await sendChatMessage(page, "힌트 줘");
    const sHint1 = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`)[0];
    console.log("[After Hint 1]", JSON.stringify(sHint1, null, 2));

    // 3. 오답 발화
    const wrong1Res = await sendChatMessage(page, "틀린답1");
    const sWrong1 = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`)[0];
    console.log("[After Wrong 1]", JSON.stringify(sWrong1, null, 2));

    // 4. 두 번째 힌트 요청: "힌트 더 줘"
    const hint2Res = await sendChatMessage(page, "힌트 더 줘");
    const sHint2 = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`)[0];
    console.log("[After Hint 2]", JSON.stringify(sHint2, null, 2));

    // 5. 포기/정답 요청: "정답 알려줘"
    const revealRes = await sendChatMessage(page, "정답 알려줘");
    const sReveal = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`)[0];
    console.log("[After Reveal]", JSON.stringify(sReveal, null, 2));

    // 종료
    await sendChatMessage(page, "그만할래");

    fs.writeFileSync(`${LOG_DIR}/hint_flow_result.json`, JSON.stringify({
      qInfo,
      res1: res1.kText,
      hint1: { kText: hint1Res.kText, session: sHint1 },
      wrong1: { kText: wrong1Res.kText, session: sWrong1 },
      hint2: { kText: hint2Res.kText, session: sHint2 },
      reveal: { kText: revealRes.kText, session: sReveal },
    }, null, 2));
  });
});
