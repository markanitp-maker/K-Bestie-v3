import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const LOG_DIR = "/tmp/agy-qa-kplay";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";

function queryDev(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}" --target=dev`, {
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

test.describe("K-Play Telemetry Dev E2E QA", () => {
  test.setTimeout(180_000);

  test("Dev: Modal Path & Utterance Path behavior_events telemetry", async ({ page }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Initial query check
    const initialRows = queryDev("select event_name, event_key, feature, play_type, occurred_at from behavior_events where event_name like 'k_play%' order by occurred_at desc limit 5");
    console.log("Initial DB Rows:", JSON.stringify(initialRows));
    fs.writeFileSync(path.join(LOG_DIR, "db_initial.json"), JSON.stringify(initialRows, null, 2));

    // 2. Login
    console.log(`[QA] Navigating to ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await hideTelemetryOverlay(page);

    const userInput = page.getByPlaceholder("아이 아이디를 입력하세요");
    await userInput.waitFor({ state: "visible", timeout: 10000 });
    await userInput.fill(CHILD_A_USERNAME);

    const pwInput = page.getByPlaceholder("비밀번호를 입력하세요");
    await pwInput.fill(QA_TEST_PASSWORD);

    const loginBtn = page.getByRole("button", { name: "로그인", exact: true });
    await loginBtn.click({ force: true });
    await page.waitForTimeout(2000);
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    }, { cId: CHILD_A_ID });

    await page.screenshot({ path: path.join(LOG_DIR, "01_after_login.png") });
    console.log("[QA] Login completed. Current URL:", page.url());

    // 3. Go to /chat
    console.log(`[QA] Navigating to ${BASE}/chat`);
    await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await hideTelemetryOverlay(page);

    const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn.count().catch(() => 0)) {
      console.log("[QA] Closing PWA prompt...");
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: path.join(LOG_DIR, "02_chat_page.png") });

    // 4. Modal Path Test
    console.log("[QA] Opening K-Play modal...");
    const playModalBtn = page.locator('button[aria-label="놀이 고르기"]');
    await expect(playModalBtn).toBeVisible({ timeout: 10000 });
    await playModalBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(LOG_DIR, "03_modal_open.png") });

    // Select "끝말잇기"
    console.log("[QA] Selecting 끝말잇기 in modal...");
    const wordChainSkillBtn = page.locator('button').filter({ hasText: "끝말잇기" }).first();
    await expect(wordChainSkillBtn).toBeVisible({ timeout: 10000 });
    await wordChainSkillBtn.click();

    // Wait for modal select response and DB insert
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(LOG_DIR, "04_after_modal_select.png") });

    // 5. Check DB after Modal Path
    const afterModalRows = queryDev("select event_name, event_key, feature, play_type, occurred_at from behavior_events where event_name like 'k_play%' order by occurred_at desc limit 5");
    console.log("DB Rows after Modal Select:", JSON.stringify(afterModalRows, null, 2));
    fs.writeFileSync(path.join(LOG_DIR, "db_after_modal.json"), JSON.stringify(afterModalRows, null, 2));

    // 6. Utterance Path Test
    console.log("[QA] Testing Utterance Path...");
    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    if (await keyboardBtn.isVisible().catch(() => false)) {
      await keyboardBtn.click();
      await page.waitForTimeout(500);
    }

    const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInputEl).toBeVisible({ timeout: 10000 });

    // First end the current game by saying "그만할래"
    console.log("[QA] Sending utterance: '그만할래'");
    await textInputEl.fill("그만할래");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/voice/respond"), { timeout: 45000 }).catch(() => null),
      page.locator('button[aria-label="전송"]').click(),
    ]);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(LOG_DIR, "05_after_end_utterance.png") });

    // Now start a new game by utterance: "초성게임 하자"
    console.log("[QA] Sending utterance: '초성게임 하자'");
    await textInputEl.fill("초성게임 하자");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/voice/respond"), { timeout: 45000 }),
      page.locator('button[aria-label="전송"]').click(),
    ]);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(LOG_DIR, "06_after_chosung_utterance.png") });

    // 7. Check final DB state
    const finalRows = queryDev("select event_name, event_key, feature, play_type, occurred_at from behavior_events where event_name like 'k_play%' order by occurred_at desc limit 10");
    console.log("Final DB Rows:", JSON.stringify(finalRows, null, 2));
    fs.writeFileSync(path.join(LOG_DIR, "db_final.json"), JSON.stringify(finalRows, null, 2));
  });
});
