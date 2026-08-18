import { test, expect } from "@playwright/test";
import * as fs from "fs";

test.describe("QA-075c Fresh E2E Test", () => {
  test.setTimeout(400_000); // Allow sufficient time for sequential turns with 5s delays

  test("execute memory and hallucination verification turns", async ({ page, context }) => {
    // Ensure clean state / clear storage
    await context.clearCookies();
    await context.clearPermissions();

    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
    const password = process.env.QA_TEST_PASSWORD;
    if (!password) {
      throw new Error("QA_TEST_PASSWORD is not set in environment");
    }

    console.log("Navigating to login page at:", `${baseUrl}/login`);
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });

    // Fill login form
    const usernameInput = page.locator('input[placeholder="아이 아이디를 입력하세요"]');
    const passwordInput = page.locator('input[placeholder="비밀번호를 입력하세요"]');
    const submitBtn = page.locator('button[type="submit"]:has-text("로그인")');

    await expect(usernameInput).toBeVisible({ timeout: 15_000 });
    await usernameInput.fill("qa-child-a-dev");
    await passwordInput.fill(password);
    await submitBtn.click();

    // Wait for navigation after login
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
    console.log("Logged in, current URL:", page.url());

    // Bypass any onboarding / PWA modals if needed
    await page.evaluate(() => {
      localStorage.setItem("k_pwa_intro_seen", "1");
      localStorage.setItem("k_child_id", "e2e00001-aaaa-4000-8000-000000000001");
      localStorage.setItem("k_voice_input_mode:e2e00001-aaaa-4000-8000-000000000001", "manual");
    });

    // Navigate to /chat
    console.log("Navigating to /chat");
    await page.goto(`${baseUrl}/chat`, { waitUntil: "networkidle" });

    // Check if start button exists and click it
    const startButton = page.locator('button:has-text("시작하기")');
    if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("Clicking 시작하기 button");
      await startButton.click();
      await page.waitForTimeout(1000);
    }

    // Switch to text mode if not already in text mode
    const textInputSelector = 'input[placeholder="케이에게 텍스트로 답하기..."]';
    let isTextInputVisible = await page.locator(textInputSelector).isVisible({ timeout: 3000 }).catch(() => false);

    if (!isTextInputVisible) {
      console.log("Switching to text mode");
      const keyboardBtn = page.locator('button[aria-label="텍스트로 답하기"]');
      if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await keyboardBtn.click();
      }
      await expect(page.locator(textInputSelector)).toBeVisible({ timeout: 10000 });
    }

    const turnsToExecute = [
      { id: "A1", text: "내가 로블록스 좋아한다고 했잖아" },
      { id: "A2", text: "내가 민준이랑 논다고 했잖아" },
      { id: "A3", text: "내가 떡볶이 먹었다고 했잖아" },
      { id: "A4", text: "내가 종이로 로봇 만들고 싶다고 했잖아" },
      { id: "B1", text: "내가 지난주에 놀이공원 갔다고 했잖아" },
      { id: "B2", text: "내가 강아지 키운다고 했잖아" },
      { id: "B3", text: "내가 태권도 학원 다닌다고 했잖아" },
      { id: "C1", text: "오늘 무슨 요일이야?" },
      { id: "C2", text: "오늘 며칠이야?" },
    ];

    const results: Array<{ id: string; input: string; response: string; timestamp: string }> = [];

    for (const turn of turnsToExecute) {
      console.log(`\n--- Sending Turn ${turn.id}: "${turn.text}" ---`);

      const inputLoc = page.locator(textInputSelector);
      await expect(inputLoc).toBeEnabled({ timeout: 15000 });

      // Setup response listener for /api/voice/respond
      const respondPromise = page.waitForResponse(
        (res) => res.url().includes("/api/voice/respond") && res.status() === 200,
        { timeout: 30000 }
      );

      // Fill and send
      await inputLoc.fill(turn.text);
      await inputLoc.press("Enter");

      // Wait for K API response
      const respondRes = await respondPromise;
      const json = await respondRes.json();
      const responseText = (json.text || "").trim();

      const record = {
        id: turn.id,
        input: turn.text,
        response: responseText,
        timestamp: new Date().toISOString(),
      };
      results.push(record);
      console.log(`[Turn ${turn.id}] K Response: "${responseText}"`);

      // Wait at least 5 seconds after K response before the next turn
      console.log("Waiting 5.5s before next turn...");
      await page.waitForTimeout(5500);
    }

    // Save results to /tmp/agy-qa-075b/results.json
    fs.writeFileSync("/tmp/agy-qa-075b/results.json", JSON.stringify(results, null, 2), "utf8");
    console.log("Saved results to /tmp/agy-qa-075b/results.json");

    // Take screenshot of final screen
    await page.screenshot({ path: "/tmp/agy-qa-075b/final_chat.png", fullPage: true });
  });
});
