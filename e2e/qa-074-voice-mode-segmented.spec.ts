import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-074";
const PARENT_USERNAME = "qatesti-dev";

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^QA_TEST_PASSWORD=(.*)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

const QA_TEST_PASSWORD = getQaPassword();

async function hideTelemetryOverlay(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
    const nextjsPortal = document.querySelector("nextjs-portal");
    if (nextjsPortal) {
      (nextjsPortal as HTMLElement).style.display = "none";
    }
  }).catch(() => {});
}

test.describe("QA-074: Parent Guide Voice Mode Segmented Control Verification", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Verify 2-button segmented control for input mode on dev /parent/guide", async ({ browser }) => {
    test.setTimeout(120_000);

    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    const results: Record<string, any> = {
      micPermissionGranted: true,
      step2_both_visible: false,
      step3_initial_selected: "",
      step3_is_typing: false,
      step4_handsfree_pressed: false,
      step4_typing_not_pressed: false,
      step5_reclick_handsfree_pressed: false,
      step6_group_and_aria_label: false,
    };

    console.log(`[QA-074] 1. Logging in as parent (${PARENT_USERNAME})...`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA-074] Login wait URL timeout, current url:", page.url());
    });
    console.log(`[QA-074] Current URL after login: ${page.url()}`);

    // Ensure child context is selected by visiting /parent/home
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1000);

    // Dismiss any modals on home if present
    const modalClose = page.getByRole("button", { name: /확인|닫기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    console.log(`[QA-074] 1. Navigating to /parent/guide...`);
    await page.goto(`${BASE}/parent/guide`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    // Wait for the input area to be ready
    const textInput = page.locator('input[placeholder*="케이가 아는 선에서"], input[placeholder*="듣는 중"]');
    await expect(textInput).toBeVisible({ timeout: 15000 });

    // Step 6: Verify container role="group" and aria-label="입력 모드 선택"
    console.log(`[QA-074] 6. Checking container role="group" and aria-label="입력 모드 선택"...`);
    const groupContainer = page.locator('div[role="group"][aria-label="입력 모드 선택"]');
    const isGroupContainerVisible = await groupContainer.isVisible();
    console.log(`[QA-074] Container visible: ${isGroupContainerVisible}`);
    expect(isGroupContainerVisible).toBe(true);
    results.step6_group_and_aria_label = isGroupContainerVisible;

    // Step 2: Are both buttons visible at the same time: ⌨️ 타이핑 and 🎤 핸즈프리?
    console.log(`[QA-074] 2. Checking both buttons visibility...`);
    const typingBtn = groupContainer.locator('button', { hasText: "타이핑" });
    const handsfreeBtn = groupContainer.locator('button', { hasText: "핸즈프리" });

    const isTypingVisible = await typingBtn.isVisible();
    const isHandsfreeVisible = await handsfreeBtn.isVisible();
    const bothVisible = isTypingVisible && isHandsfreeVisible;
    console.log(`[QA-074] Typing button visible: ${isTypingVisible}, Handsfree button visible: ${isHandsfreeVisible}`);
    expect(bothVisible).toBe(true);
    results.step2_both_visible = bothVisible;

    const screenshotPath1 = path.join(EVIDENCE_DIR, "01-initial-both-buttons-visible.png");
    await page.screenshot({ path: screenshotPath1 });
    console.log(`[QA-074] Saved screenshot: ${screenshotPath1}`);

    // Step 3: Initial state - which button has aria-pressed="true"?
    console.log(`[QA-074] 3. Checking initial selected button (aria-pressed="true")...`);
    const typingAriaPressedInit = await typingBtn.getAttribute("aria-pressed");
    const handsfreeAriaPressedInit = await handsfreeBtn.getAttribute("aria-pressed");
    console.log(`[QA-074] Initial aria-pressed -> Typing: "${typingAriaPressedInit}", Handsfree: "${handsfreeAriaPressedInit}"`);

    let initialSelectedName = "None";
    if (typingAriaPressedInit === "true") {
      initialSelectedName = "타이핑 (⌨️ 타이핑)";
      results.step3_is_typing = true;
    } else if (handsfreeAriaPressedInit === "true") {
      initialSelectedName = "핸즈프리 (🎤 핸즈프리)";
      results.step3_is_typing = false;
    }
    results.step3_initial_selected = initialSelectedName;
    expect(typingAriaPressedInit).toBe("true");
    expect(handsfreeAriaPressedInit).toBe("false");

    // Step 4: Click 🎤 핸즈프리
    console.log(`[QA-074] 4. Clicking 🎤 핸즈프리 button...`);
    await handsfreeBtn.click({ force: true });
    await page.waitForTimeout(1000);

    const typingAriaPressedAfterClick = await typingBtn.getAttribute("aria-pressed");
    const handsfreeAriaPressedAfterClick = await handsfreeBtn.getAttribute("aria-pressed");
    console.log(`[QA-074] After clicking Handsfree -> Typing: "${typingAriaPressedAfterClick}", Handsfree: "${handsfreeAriaPressedAfterClick}"`);

    const screenshotPath2 = path.join(EVIDENCE_DIR, "02-handsfree-selected.png");
    await page.screenshot({ path: screenshotPath2 });
    console.log(`[QA-074] Saved screenshot: ${screenshotPath2}`);

    const step4HandsfreeTrue = handsfreeAriaPressedAfterClick === "true";
    const step4TypingFalse = typingAriaPressedAfterClick === "false";
    results.step4_handsfree_pressed = step4HandsfreeTrue;
    results.step4_typing_not_pressed = step4TypingFalse;
    expect(step4HandsfreeTrue).toBe(true);
    expect(step4TypingFalse).toBe(true);

    // Step 5: Click already selected 🎤 핸즈프리 button again
    console.log(`[QA-074] 5. Clicking 🎤 핸즈프리 button again when already selected...`);
    await handsfreeBtn.click({ force: true });
    await page.waitForTimeout(1000);

    const typingAriaPressedAfterReclick = await typingBtn.getAttribute("aria-pressed");
    const handsfreeAriaPressedAfterReclick = await handsfreeBtn.getAttribute("aria-pressed");
    console.log(`[QA-074] After re-clicking Handsfree -> Typing: "${typingAriaPressedAfterReclick}", Handsfree: "${handsfreeAriaPressedAfterReclick}"`);

    const screenshotPath3 = path.join(EVIDENCE_DIR, "03-handsfree-reclicked-still-true.png");
    await page.screenshot({ path: screenshotPath3 });
    console.log(`[QA-074] Saved screenshot: ${screenshotPath3}`);

    const step5HandsfreeStillTrue = handsfreeAriaPressedAfterReclick === "true";
    const step5TypingStillFalse = typingAriaPressedAfterReclick === "false";
    results.step5_reclick_handsfree_pressed = step5HandsfreeStillTrue && step5TypingStillFalse;
    expect(step5HandsfreeStillTrue).toBe(true);
    expect(step5TypingStillFalse).toBe(true);

    // Write results summary to /tmp/agy-qa-074/results.json
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "results.json"),
      JSON.stringify(results, null, 2),
      "utf8"
    );

    console.log("[QA-074] Verification summary:", JSON.stringify(results, null, 2));
    await context.close();
  });
});
