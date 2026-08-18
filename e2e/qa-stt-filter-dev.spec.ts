import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-stt";

const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";

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

test.describe("STT 1 & 2 Dev QA", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("QA-1: Keyboard text inputs should not be blocked and K should respond", async ({ page }) => {
    test.setTimeout(180000);

    // 1. Login as QA_Child_A
    console.log(`[Login] Logging in as ${CHILD_A_USERNAME}...`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_A_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    }, { cId: CHILD_A_ID });

    // 2. Go to /chat
    console.log(`[Chat] Navigating to ${BASE}/chat...`);
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // Switch to text mode
    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await keyboardBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInputEl).toBeVisible({ timeout: 10000 });

    const inputs = [
      "ㅇㅇ",
      "ㄴㄴ",
      "ㅋㅋ",
      "응",
      "오늘 학교에서 그림 그렸어"
    ];

    const results: { input: string; saved: boolean; responseReceived: boolean; responseText: string; time: string }[] = [];

    for (const text of inputs) {
      console.log(`\n>>> Sending text: "${text}"`);
      await textInputEl.fill(text);
      await hideTelemetryOverlay(page);
      
      const sendBtn = page.getByRole("button", { name: "전송" });
      if (await sendBtn.isVisible()) {
        await sendBtn.click({ force: true });
      } else {
        await textInputEl.press("Enter");
      }

      console.log(`[Wait] Waiting for response to "${text}"...`);
      let saved = false;
      let responseReceived = false;
      let responseText = "";
      let msgTime = "";

      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);
        await hideTelemetryOverlay(page);

        // Check DB for recent messages
        const recentMsgs = runQuery(`
          SELECT cm.role, cm.content, to_char(cm.created_at AT TIME ZONE 'Asia/Seoul','HH24:MI:SS') as t 
          FROM chat_messages cm
          JOIN chat_sessions cs ON cs.id = cm.session_id
          WHERE cs.child_id = '${CHILD_A_ID}' AND cm.deleted_at IS NULL 
          ORDER BY cm.created_at DESC LIMIT 5;
        `);

        if (recentMsgs && recentMsgs.length > 0) {
          const childMsg = recentMsgs.find((m: any) => (m.role === "child" || m.role === "user") && m.content === text);
          const kMsg = recentMsgs.find((m: any) => (m.role === "k" || m.role === "assistant"));
          if (childMsg) {
            saved = true;
            msgTime = childMsg.t;
          }
          if (childMsg && kMsg) {
            responseReceived = true;
            responseText = kMsg.content;
            console.log(`[Response] K replied (${kMsg.t}): "${responseText.substring(0, 50)}..."`);
            break;
          }
        }
      }

      results.push({
        input: text,
        saved,
        responseReceived,
        responseText,
        time: msgTime
      });

      // take screenshot of conversation
      await page.screenshot({ path: `${EVIDENCE_DIR}/qa1_${encodeURIComponent(text)}.png` });
      await page.waitForTimeout(1500);
    }

    fs.writeFileSync(`${EVIDENCE_DIR}/qa1_results.json`, JSON.stringify(results, null, 2));
    console.log("[QA-1 Results]", JSON.stringify(results, null, 2));

    for (const r of results) {
      expect(r.saved).toBe(true);
      expect(r.responseReceived).toBe(true);
    }
  });
});
