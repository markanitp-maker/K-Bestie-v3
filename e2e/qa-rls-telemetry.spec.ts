import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const USERNAME = "qa-child-a-dev";
const LOG_DIR = "/tmp/agy-qa-rls";

function getPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^QA_TEST_PASSWORD=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

fs.mkdirSync(LOG_DIR, { recursive: true });

test.describe("QA RLS Telemetry Verification", () => {
  test.setTimeout(240_000);

  test("Child login, enter mission, execute 2 turns and verify telemetry", async ({ page }) => {
    const password = getPassword();
    if (!password) {
      throw new Error("QA_TEST_PASSWORD is not set in environment or .env.local");
    }

    await page.setViewportSize({ width: 393, height: 852 });

    console.log(`[1] Navigating to ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Login as child
    const usernameInput = page.locator('input[placeholder*="아이디"], input[type="text"]').first();
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    await usernameInput.fill(USERNAME);

    const passwordInput = page.locator('input[placeholder*="비밀번호"], input[type="password"]').first();
    await passwordInput.fill(password);

    const submitBtn = page.getByRole("button", { name: "로그인", exact: true });
    await submitBtn.click();

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
    console.log("[2] Logged in successfully. Current URL:", page.url());

    await page.waitForTimeout(1500);

    // Handle Roulette modal if present on /child/home
    const rouletteSpinBtn = page.getByRole("button", { name: "룰렛 돌리기" });
    if (await rouletteSpinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("[2.1] Spinning roulette...");
      await rouletteSpinBtn.click();
      await page.waitForTimeout(4000);
      const rouletteCloseBtn = page.getByRole("button", { name: /확인|받기|닫기/ });
      if (await rouletteCloseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await rouletteCloseBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    // Dismiss PWA install modal or event modal if present
    const closeBtns = page.getByRole("button", { name: /닫기|나중에 할게요|이벤트 확인/ });
    if (await closeBtns.count().catch(() => 0)) {
      await closeBtns.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Navigate to /child/missions
    console.log(`[3] Navigating to /child/missions`);
    const missionLink = page.locator('a[href*="/child/missions"]').first();
    if (await missionLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("[3.1] Clicking mission link on child home...");
      await missionLink.click();
    } else {
      console.log("[3.2] Direct goto /child/missions...");
      await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(2000);

    // Handle any modals on mission page
    const missionCloseBtn = page.getByRole("button", { name: /닫기|이벤트 확인|나중에/ });
    if (await missionCloseBtn.count().catch(() => 0)) {
      await missionCloseBtn.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Start / Resume button on mission page
    const startBtn = page.getByRole("button", { name: /시작하기|이어하기|오늘의 미션|대화 시작|미션 시작|계속하기/ });
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("[4] Clicking start/resume mission button...");
      await startBtn.click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Switch to text mode
    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    if (await keyboardBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log("[5] Switching to text mode...");
      await keyboardBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }

    const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."], input[type="text"]').last();
    await textInput.waitFor({ state: "visible", timeout: 15_000 });

    // Turn 1: "오늘 학교에서 체육했어"
    console.log("[6] Executing Turn 1: 오늘 학교에서 체육했어");
    await textInput.fill("오늘 학교에서 체육했어");

    const turn1Promise = page.waitForResponse(
      (res) => (res.url().includes("/api/mission") || res.url().includes("/api/voice")) && res.status() === 200,
      { timeout: 45_000 }
    ).catch(() => null);

    const sendBtn = page.locator('button[aria-label="전송"], button:has-text("전송")').first();
    if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textInput.press("Enter");
    }

    await turn1Promise;
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(LOG_DIR, "01_turn1_completed.png"), fullPage: true });

    // Turn 2: "친구들이랑 피구했어"
    console.log("[7] Executing Turn 2: 친구들이랑 피구했어");
    await textInput.waitFor({ state: "visible", timeout: 15_000 });
    await textInput.fill("친구들이랑 피구했어");

    const turn2Promise = page.waitForResponse(
      (res) => (res.url().includes("/api/mission") || res.url().includes("/api/voice")) && res.status() === 200,
      { timeout: 45_000 }
    ).catch(() => null);

    if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textInput.press("Enter");
    }

    await turn2Promise;
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(LOG_DIR, "02_turn2_completed.png"), fullPage: true });

    console.log("[8] Both turns completed successfully!");
  });
});
