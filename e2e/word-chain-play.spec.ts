import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { BY_FIRST_SYLLABLE } from "../lib/k-conversation/wordChain/dictionaryIndex";
import { allowedNextInitials } from "../lib/k-conversation/wordChain/dueum";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const CHILD_B_USERNAME = "qa-child-b-dev";
const CHILD_B_ID = "e2e00002-bbbb-4000-8000-000000000002";

const LOG_DIR = "/tmp/agy-qa-006";

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

function findSafeWordForEnding(lastChar: string, usedWords: string[] = []): string {
  const allowed = allowedNextInitials(lastChar);
  // First attempt: find a word whose ending syllable has multiple continuations in dictionary
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          const nextAllowed = allowedNextInitials(entry.lastSyllable);
          const hasContinuations = nextAllowed.some((s) => (BY_FIRST_SYLLABLE.get(s)?.length || 0) >= 2);
          if (hasContinuations) {
            return entry.word;
          }
        }
      }
    }
  }
  // Fallback attempt: any valid word not used yet
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          return entry.word;
        }
      }
    }
  }
  return `${lastChar}기`;
}

async function loginAs(page: import("@playwright/test").Page, username: string, childId: string) {
  console.log(`[loginAs] Navigating to ${BASE}/login...`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(username);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
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

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ state: "visible", timeout: 15000 });
  await keyboardBtn.click();
  await page.waitForTimeout(500);

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[goToChat] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`[sendChatMessage] Sending: "${message}"`);
  const startTime = Date.now();
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/voice/respond") && res.request().method() === "POST",
      { timeout: 45000 }
    ),
    page.locator('button[aria-label="전송"]').click(),
  ]);
  const latencyMs = Date.now() - startTime;

  const json = await response.json().catch(() => ({}));
  await page.waitForTimeout(1000);

  const bubble = page.locator("p.text-left").first();
  const bubbleText = (await bubble.textContent().catch(() => "")) || json.text || "";
  const kText = (json.text || bubbleText).trim();
  console.log(`[sendChatMessage] Received in ${latencyMs}ms: "${kText}"`);

  return {
    kText,
    bubbleText: bubbleText.trim(),
    status: response.status(),
    latencyMs,
  };
}

test.describe("006 Dev E2E QA: QA-6, QA-8, QA-7", () => {
  test.setTimeout(300_000); // 5 minutes

  test("QA-6. 놀이 제안 (PLAY_PROPOSAL) & 거절 & 쿨다운 & 직접요청", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log("\n==========================================");
    console.log("QA-6. 놀이 제안 (qa-child-b-dev)");
    console.log("==========================================");
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR_6]", err.message));

    await loginAs(page, CHILD_B_USERNAME, CHILD_B_ID);
    await goToChat(page);

    // 1. "심심해" -> K proposes game
    console.log("\n[QA-6 Step 1] Child says: '심심해'");
    const step1 = await sendChatMessage(page, "심심해");
    console.log(`[QA-6 Step 1 Response] ${step1.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-6-step1-simsimhae.png") });

    // 2. "안 할래" -> K accepts refusal
    console.log("\n[QA-6 Step 2] Child says: '안 할래'");
    const step2 = await sendChatMessage(page, "안 할래");
    console.log(`[QA-6 Step 2 Response] ${step2.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-6-step2-refuse.png") });

    // 3. "심심해" again in same session -> Must NOT propose game again (cooldown)
    console.log("\n[QA-6 Step 3] Child says: '심심해' (again in same session)");
    const step3 = await sendChatMessage(page, "심심해");
    console.log(`[QA-6 Step 3 Response] ${step3.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-6-step3-simsimhae-again.png") });

    // 4. "끝말잇기 하자" direct request -> Must start game
    console.log("\n[QA-6 Step 4] Child says: '끝말잇기 하자' (direct request)");
    const step4 = await sendChatMessage(page, "끝말잇기 하자");
    console.log(`[QA-6 Step 4 Response] ${step4.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-6-step4-direct-request.png") });

    const dbWordChain = runQuery(`
      SELECT id, state, current_word, used_words, initiated_by, started_at, ended_at
      FROM word_chain_game_sessions
      WHERE child_id = '${CHILD_B_ID}'
      ORDER BY started_at DESC LIMIT 1;
    `);
    console.log("[QA-6 DB Word Chain Session]\n", JSON.stringify(dbWordChain, null, 2));

    await page.screenshot({ path: path.join(LOG_DIR, "qa-6-play-proposal.png") });
    await context.close();
  });

  test("QA-8. 동시 실행 방지 (§3-23)", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log("\n==========================================");
    console.log("QA-8. 동시 실행 방지 (qa-child-a-dev)");
    console.log("==========================================");
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR_8]", err.message));

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    console.log("\n[QA-8 Step 1] Child says: '초성게임 하자'");
    const chosungTurn = await sendChatMessage(page, "초성게임 하자");
    console.log(`[QA-8 Step 1 Response] ${chosungTurn.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-8-step1-chosung.png") });

    console.log("\n[QA-8 Step 2] Child says: '끝말잇기 하자'");
    const switchTurn = await sendChatMessage(page, "끝말잇기 하자");
    console.log(`[QA-8 Step 2 Response] ${switchTurn.kText}`);
    await page.screenshot({ path: path.join(LOG_DIR, "qa-8-step2-switch.png") });

    const qa8Db = runQuery(`
      SELECT 'chosung' AS g, count(*) FROM chosung_game_sessions
       WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
      UNION ALL
      SELECT 'wordchain', count(*) FROM word_chain_game_sessions
       WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;
    `);
    console.log("[QA-8 DB Concurrent Active Games Check]\n", JSON.stringify(qa8Db, null, 2));
    await page.screenshot({ path: path.join(LOG_DIR, "qa-8-concurrent-prevention.png") });
    await context.close();
  });

  test("QA-7. 제안 차단 (부정감정 차단)", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log("\n==========================================");
    console.log("QA-7. 제안 차단 (새 세션 '오늘 너무 화나')");
    console.log("==========================================");
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR_7]", err.message));

    await loginAs(page, CHILD_B_USERNAME, CHILD_B_ID);
    await goToChat(page);

    console.log("\n[QA-7 Step 1] Child says: '오늘 너무 화나'");
    const qa7Turn = await sendChatMessage(page, "오늘 너무 화나");
    console.log(`[QA-7 Response] ${qa7Turn.kText}`);

    await page.screenshot({ path: path.join(LOG_DIR, "qa-7-negative-emotion.png") });
    await context.close();
  });
});
