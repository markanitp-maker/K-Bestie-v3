import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";

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
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const LOG_DIR = "/tmp/agy-qa-015g";

function runQuery(sql: string) {
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

async function hideTelemetryOverlay(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
    const style = document.createElement("style");
    style.id = "hide-stt-overlay-style";
    style.innerHTML = `[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }`;
    document.head.appendChild(style);
  }).catch(() => {});
}

async function loginAs(page: import("@playwright/test").Page, username: string, childId: string) {
  console.log(`[loginAs] Navigating to ${BASE}/login...`);
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
  console.log(`[loginAs] Logged in as ${username}, child_id=${childId}`);
}

async function goToChat(page: import("@playwright/test").Page) {
  console.log(`[goToChat] Navigating to ${BASE}/chat...`);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await hideTelemetryOverlay(page);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function enableTextInput(page: import("@playwright/test").Page) {
  await hideTelemetryOverlay(page);
  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  if (await textInputEl.isVisible().catch(() => false)) {
    return;
  }
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[enableTextInput] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  await enableTextInput(page);
  await hideTelemetryOverlay(page);

  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`[sendChatMessage] Child: "${message}"`);
  const startTime = Date.now();

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/voice/respond") && res.request().method() === "POST",
      { timeout: 60000 }
    ),
    page.locator('button[aria-label="전송"]').click({ force: true }),
  ]);
  const latencyMs = Date.now() - startTime;

  const json = await response.json().catch(() => ({}));
  await page.waitForTimeout(1500);

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

test.describe("QA-015G Next Question Verification", () => {
  test.setTimeout(180_000);

  test("초성게임 '다음 문제 줘' 3턴 검증", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    console.log("=== Login ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);
    await enableTextInput(page);

    const querySql = "select current_chosung, current_word, state, updated_at from chosung_game_sessions where child_id='e2e00001-aaaa-4000-8000-000000000001' order by updated_at desc limit 1";

    // 턴 1: 초성게임 하자
    console.log("\n--- Turn 1: 초성게임 하자 ---");
    const res1 = await sendChatMessage(page, "초성게임 하자");
    const ss1Path = path.join(LOG_DIR, "turn1-chosung-start.png");
    await page.screenshot({ path: ss1Path });
    const db1 = runQuery(querySql);
    console.log("[DB 1 Result]:", JSON.stringify(db1, null, 2));

    // 턴 2: 다음 문제 줘
    console.log("\n--- Turn 2: 다음 문제 줘 ---");
    const res2 = await sendChatMessage(page, "다음 문제 줘");
    const ss2Path = path.join(LOG_DIR, "turn2-next-question.png");
    await page.screenshot({ path: ss2Path });
    const db2 = runQuery(querySql);
    console.log("[DB 2 Result]:", JSON.stringify(db2, null, 2));

    // 턴 3: 그만할래
    console.log("\n--- Turn 3: 그만할래 ---");
    const res3 = await sendChatMessage(page, "그만할래");
    const ss3Path = path.join(LOG_DIR, "turn3-quit.png");
    await page.screenshot({ path: ss3Path });
    const db3 = runQuery(querySql);
    console.log("[DB 3 Result]:", JSON.stringify(db3, null, 2));

    const fullResult = {
      turn1: {
        child: "초성게임 하자",
        kText: res1.kText,
        db: db1,
        screenshot: ss1Path,
      },
      turn2: {
        child: "다음 문제 줘",
        kText: res2.kText,
        db: db2,
        screenshot: ss2Path,
      },
      turn3: {
        child: "그만할래",
        kText: res3.kText,
        db: db3,
        screenshot: ss3Path,
      },
    };

    fs.writeFileSync(path.join(LOG_DIR, "result.json"), JSON.stringify(fullResult, null, 2), "utf8");
    console.log("\n=== FINAL TEST RESULT ===");
    console.log(JSON.stringify(fullResult, null, 2));

    await context.close();
  });
});
