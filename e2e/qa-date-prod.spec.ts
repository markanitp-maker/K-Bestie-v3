import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://app.k-bestie.com";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-date-prod";
const PARENT_USERNAME = "qa-parent";
const CHILD_A_ID = "11111111-1111-1111-1111-111111111111"; // TestA

async function hideTelemetryOverlay(page: Page) {
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

test.describe("Production QA: Date Shift & Parent-K Conversation Evaluation", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Verify date shift and regression scenarios on prod", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes
    await page.setViewportSize({ width: 390, height: 844 });

    const results: Record<string, any> = {};

    console.log(`[QA] Navigating to ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    console.log(`[QA] Logging in as ${PARENT_USERNAME}...`);
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA] Login wait URL timeout, current url:", page.url());
    });
    console.log(`[QA] Logged in. Current URL: ${page.url()}`);
    results.login = (page.url().includes("/parent/") || page.url() === `${BASE}/` || page.url() === `${BASE}`) ? "성공" : "실패";

    // Set active child to TestA in local storage and navigate
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);

    await page.evaluate((cid) => {
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
      localStorage.setItem("k_child_id", cid);
      localStorage.setItem("selected_child_id", cid);
      localStorage.setItem("active_child_id", cid);
      try {
        const storeRaw = localStorage.getItem("kbestie_store");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = cid;
          localStorage.setItem("kbestie_store", JSON.stringify(parsed));
        }
      } catch (e) {}
    }, CHILD_A_ID);

    // Dismiss any modals on parent home
    const modalClose = page.getByRole("button", { name: /확인|닫기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // Navigate to /parent/guide (케이와 대화)
    console.log(`[QA] Navigating to ${BASE}/parent/guide`);
    await page.goto(`${BASE}/parent/guide`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/00-guide-loaded.png` });

    const inputLocator = page.locator('input[placeholder*="케이가 아는 선에서"], input[placeholder*="듣는 중"]');
    await expect(inputLocator).toBeVisible({ timeout: 15000 });

    async function sendChat(text: string, stepId: string): Promise<{ text: string; fullText: string }> {
      console.log(`\n[QA] Waiting 8s for rate limit before step ${stepId}...`);
      await page.waitForTimeout(8000);

      console.log(`[QA] === STEP ${stepId}: Sending "${text}" ===`);
      await hideTelemetryOverlay(page);

      const prevKCount = await page.evaluate(() => {
        return document.querySelectorAll('.items-start .p-3.rounded-2xl').length;
      });

      await inputLocator.fill(text);
      await page.waitForTimeout(300);

      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeVisible({ timeout: 5000 });
      await sendButton.click({ force: true });

      console.log(`[QA] Waiting for response to "${text}"...`);
      try {
        await page.waitForFunction(
          (oldCount) => {
            const currentCount = document.querySelectorAll('.items-start .p-3.rounded-2xl').length;
            const hasSpinner = document.querySelector('.animate-bounce') !== null;
            return currentCount > oldCount && !hasSpinner;
          },
          prevKCount,
          { timeout: 45000 }
        );
      } catch (e) {
        console.log(`[QA] Response wait finished with error or timeout:`, (e as Error).message);
      }

      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${EVIDENCE_DIR}/${stepId}.png`, fullPage: true });

      const kMessages = await page.evaluate(() => {
        const kNodes = Array.from(document.querySelectorAll('.items-start .p-3.rounded-2xl'));
        return kNodes.map(n => (n as HTMLElement).innerText.trim());
      });

      const latestKMessage = kMessages.length > 0 ? kMessages[kMessages.length - 1] : "";
      console.log(`[QA] [Step ${stepId}] K Response: "${latestKMessage}"`);

      return {
        text: latestKMessage,
        fullText: latestKMessage,
      };
    }

    // 1. "서현이 어제 뭐 했어?"
    results["step_1"] = await sendChat("서현이 어제 뭐 했어?", "step_1_yesterday_name");

    // 2. "오늘은 뭐 했어?"
    results["step_2"] = await sendChat("오늘은 뭐 했어?", "step_2_today");

    // 3. "이번 주에 뭐 했어?"
    results["step_3"] = await sendChat("이번 주에 뭐 했어?", "step_3_this_week");

    // Extra: If child name is TestA, also test asking about TestA specifically or "어제 뭐 했어?"
    results["step_extra_yesterday"] = await sendChat("어제 뭐 했어?", "step_extra_yesterday");

    // 4. "우리 애가 요즘 통 말이 없어요"
    results["step_4"] = await sendChat("우리 애가 요즘 통 말이 없어요", "step_4_counseling");

    // 5. "인터넷에서 찾아봐"
    results["step_5"] = await sendChat("인터넷에서 찾아봐", "step_5_no_external_search");

    fs.writeFileSync(`${EVIDENCE_DIR}/results.json`, JSON.stringify(results, null, 2), "utf-8");
    console.log(`[QA] Saved results to ${EVIDENCE_DIR}/results.json`);
  });
});
