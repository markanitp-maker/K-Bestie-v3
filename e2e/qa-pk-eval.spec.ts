import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-pk";
const PARENT_USERNAME = "qatesti-dev";
const CHILD_ID = "fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9"; // TestChild

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

test.describe("Parent-K Dialogue Evaluation QA", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Run full dialogue scenario A to E", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes max
    await page.setViewportSize({ width: 390, height: 844 });

    const results: Record<string, any> = {};

    console.log(`[QA] Navigating to login page: ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    console.log(`[QA] Entering parent credentials (${PARENT_USERNAME})...`);
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA] Login wait URL timeout, current url:", page.url());
    });
    console.log(`[QA] Logged in. Current URL: ${page.url()}`);
    results.login = (page.url().includes("/parent/") || page.url() === `${BASE}/` || page.url() === `${BASE}`) ? "성공" : "실패";

    // Visit /parent/home first to ensure children store is loaded
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    // Set local storage child id
    await page.evaluate((cid) => {
      localStorage.setItem("k_child_id", cid);
      localStorage.setItem("selected_child_id", cid);
      localStorage.setItem("active_child_id", cid);
    }, CHILD_ID);

    // Navigate to /parent/guide
    console.log(`[QA] Navigating to ${BASE}/parent/guide`);
    await page.goto(`${BASE}/parent/guide`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/00-parent-guide-loaded.png` });

    const inputLocator = page.locator('input[placeholder*="케이가 아는 선에서"], input[placeholder*="듣는 중"]');
    await expect(inputLocator).toBeVisible({ timeout: 15000 });

    async function sendChat(text: string, stepId: string): Promise<{ text: string; proposal?: string; hasDraftModal?: boolean; fullText?: string }> {
      // 10초 2회 rate limit 방어를 위해 매 전송 전 7초 대기
      console.log(`\n[QA] Waiting 7s to respect rate limit...`);
      await page.waitForTimeout(7000);

      console.log(`[QA] === STEP ${stepId}: Sending "${text}" ===`);
      await hideTelemetryOverlay(page);
      
      const prevKCount = await page.evaluate(() => {
        return document.querySelectorAll('.items-start .p-3.rounded-2xl').length;
      });

      await inputLocator.fill(text);
      await page.waitForTimeout(300);

      // Check send button
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeVisible({ timeout: 5000 });
      await sendButton.click({ force: true });

      // Wait for response: wait for loading spinner to appear or new K message to appear
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

      // Extract all K messages
      const kMessages = await page.evaluate(() => {
        const kNodes = Array.from(document.querySelectorAll('.items-start .p-3.rounded-2xl'));
        return kNodes.map(n => (n as HTMLElement).innerText.trim());
      });

      const latestKMessage = kMessages.length > 0 ? kMessages[kMessages.length - 1] : "";
      console.log(`[QA] [Step ${stepId}] K Response (${kMessages.length} total): "${latestKMessage}"`);

      // Check if draft proposal button or modal is visible
      const proposalButton = page.locator('button:has-text("아이에게 물어보기")');
      const proposalCount = await proposalButton.count();
      const proposalVisible = proposalCount > 0 && await proposalButton.last().isVisible();

      // Check if draft modal opened
      const draftModal = page.locator('[role="dialog"]');
      const hasDraftModal = (await draftModal.count()) > 0 && await draftModal.isVisible();

      return {
        text: latestKMessage,
        proposal: proposalVisible ? "아이에게 물어보기 버튼 표시됨" : undefined,
        hasDraftModal,
        fullText: latestKMessage,
      };
    }

    // A. 맥락이 이어지는가
    // 1. "우리 애가 요즘 통 말이 없어요"
    results["A_1"] = await sendChat("우리 애가 요즘 통 말이 없어요", "step_A1");

    // 2. "왜 그럴까요?"
    results["A_2"] = await sendChat("왜 그럴까요?", "step_A2");

    // 3. "그럼 제가 어떻게 하면 좋을까요?"
    results["A_3"] = await sendChat("그럼 제가 어떻게 하면 좋을까요?", "step_A3");

    // B. 같은 말 반복이 사라졌는가
    // 4. "최근에는 뭐했니?"
    results["B_4"] = await sendChat("최근에는 뭐했니?", "step_B4");

    // 5. "그게 전부니?"
    results["B_5"] = await sendChat("그게 전부니?", "step_B5");

    // 6. "뭐니?"
    results["B_6"] = await sendChat("뭐니?", "step_B6");

    // C. 답변이 성의 있는가
    // 7. "케이는 무슨 도움을 줄 수 있어요?"
    results["C_7"] = await sendChat("케이는 무슨 도움을 줄 수 있어요?", "step_C7");

    // D. 아이 정보는 여전히 지어내지 않는가
    // 8. "서현이 어제 학교에서 뭐 했어요?"
    results["D_8"] = await sendChat("서현이 어제 학교에서 뭐 했어요?", "step_D8");

    // E. 기존 기능 회귀
    // 9. "서현이한테 학교 얘기 물어봐줘"
    results["E_9"] = await sendChat("서현이한테 학교 얘기 물어봐줘", "step_E9");

    fs.writeFileSync(`${EVIDENCE_DIR}/results.json`, JSON.stringify(results, null, 2), "utf-8");
    console.log("[QA] Saved full test results to /tmp/agy-qa-pk/results.json");
  });
});
