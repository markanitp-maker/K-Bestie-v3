import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { lookupWord, BY_FIRST_SYLLABLE } from "../lib/k-conversation/wordChain/dictionaryIndex";
import { allowedNextInitials } from "../lib/k-conversation/wordChain/dueum";

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
const LOG_DIR = "/tmp/agy-qa-015d-play-final";

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

function getChosungSessionState(): { state: string | null; isAlive: boolean; updatedAt: string | null } {
  const rows = runQuery(
    `SELECT state, updated_at FROM chosung_game_sessions WHERE child_id = '${CHILD_A_ID}' ORDER BY updated_at DESC LIMIT 1;`
  );
  if (rows && rows.length > 0) {
    const state = rows[0].state;
    return { state, isAlive: state !== "ENDED", updatedAt: rows[0].updated_at };
  }
  return { state: null, isAlive: false, updatedAt: null };
}

function getWordChainSessionState(): { state: string | null; isAlive: boolean; updatedAt: string | null } {
  const rows = runQuery(
    `SELECT state, updated_at FROM word_chain_game_sessions WHERE child_id = '${CHILD_A_ID}' ORDER BY updated_at DESC LIMIT 1;`
  );
  if (rows && rows.length > 0) {
    const state = rows[0].state;
    return { state, isAlive: state !== "ENDED", updatedAt: rows[0].updated_at };
  }
  return { state: null, isAlive: false, updatedAt: null };
}

function getLatestMessageTimestamp(): string | null {
  const rows = runQuery(
    `SELECT created_at FROM chat_messages ORDER BY created_at DESC LIMIT 1;`
  );
  if (rows && rows.length > 0) {
    return rows[0].created_at;
  }
  return null;
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

function extractKWord(text: string): string | null {
  const quoteMatches = Array.from(text.matchAll(/['"‘“]([가-힣]+)['"’”]/g)).map((m) => m[1]);
  for (let i = quoteMatches.length - 1; i >= 0; i--) {
    const word = quoteMatches[i];
    if (word.length >= 2 && lookupWord(word)) {
      return word;
    }
  }

  const tokens = text.replace(/[^가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const entry = lookupWord(token);
    if (entry && entry.normalizedWord.length >= 2) {
      if (!["우리", "게임", "놀이", "시작", "단어", "케이가", "이제", "먼저", "좋아", "맞춰봐", "하자", "생각"].includes(token)) {
        return entry.word;
      }
    }
  }

  return null;
}

function findNextChildWord(startChar: string, usedWords: Set<string> = new Set()): string | null {
  const initials = allowedNextInitials(startChar);
  for (const init of initials) {
    const candidates = BY_FIRST_SYLLABLE.get(init) ?? [];
    for (const cand of candidates) {
      if (!usedWords.has(cand.normalizedWord) && !usedWords.has(cand.word)) {
        return cand.word;
      }
    }
  }
  return null;
}

test.describe("QA-015D Final Play Verification", () => {
  test.setTimeout(300_000);

  test("Scenario A & Scenario B Execution", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    console.log("=== 0. Login ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);
    await enableTextInput(page);

    const scenarioAResults: Array<{
      turnId: string;
      childUtterance: string;
      kResponse: string;
      sessionState: string | null;
      isAlive: boolean;
      passed: boolean;
      screenshotPath: string;
      notes: string;
    }> = [];

    const scenarioBResults: Array<{
      turnId: string;
      childUtterance: string;
      kResponse: string;
      sessionState: string | null;
      isAlive: boolean;
      passed: boolean;
      screenshotPath: string;
      notes: string;
    }> = [];

    // ================================================================
    // SCENARIO A: 초성게임 이탈 복귀
    // ================================================================
    console.log("\n=================== [SCENARIO A] ===================");

    // A1: 초성게임 하자
    console.log("\n--- Turn A1: 초성게임 하자 ---");
    const resA1 = await sendChatMessage(page, "초성게임 하자");
    const ssA1 = path.join(LOG_DIR, "A1-chosung-start.png");
    await page.screenshot({ path: ssA1 });
    const sessA1 = getChosungSessionState();
    scenarioAResults.push({
      turnId: "A1",
      childUtterance: "초성게임 하자",
      kResponse: resA1.kText,
      sessionState: sessA1.state,
      isAlive: sessA1.isAlive,
      passed: sessA1.isAlive,
      screenshotPath: ssA1,
      notes: sessA1.isAlive ? "초성게임 세션 정상 생성" : "초성게임 세션 미생성",
    });

    // A2: 모르겠어
    console.log("\n--- Turn A2: 모르겠어 ---");
    const resA2 = await sendChatMessage(page, "모르겠어");
    const ssA2 = path.join(LOG_DIR, "A2-dont-know.png");
    await page.screenshot({ path: ssA2 });
    const sessA2 = getChosungSessionState();
    scenarioAResults.push({
      turnId: "A2",
      childUtterance: "모르겠어",
      kResponse: resA2.kText,
      sessionState: sessA2.state,
      isAlive: sessA2.isAlive,
      passed: sessA2.isAlive,
      screenshotPath: ssA2,
      notes: sessA2.isAlive ? "힌트 제공 및 세션 유지" : "세션 종료됨",
    });

    // A3: 아 진짜 짜증나네
    console.log("\n--- Turn A3: 아 진짜 짜증나네 ---");
    const resA3 = await sendChatMessage(page, "아 진짜 짜증나네");
    const ssA3 = path.join(LOG_DIR, "A3-annoyed.png");
    await page.screenshot({ path: ssA3 });
    const sessA3 = getChosungSessionState();
    const a3ReturnsToGame = resA3.kText.includes("초성") || resA3.kText.includes("게임") || resA3.kText.includes("문제") || resA3.kText.includes("힌트") || resA3.kText.includes("이어서") || resA3.kText.includes("마저") || resA3.kText.includes("맞혀");
    const a3AskedToQuitFirst = resA3.kText.includes("그만할까") || resA3.kText.includes("그만둘까") || resA3.kText.includes("여기서 그만");
    scenarioAResults.push({
      turnId: "A3",
      childUtterance: "아 진짜 짜증나네",
      kResponse: resA3.kText,
      sessionState: sessA3.state,
      isAlive: sessA3.isAlive,
      passed: sessA3.isAlive && a3ReturnsToGame && !a3AskedToQuitFirst,
      screenshotPath: ssA3,
      notes: `세션:${sessA3.isAlive ? 'Y' : 'N'}, 복귀언급:${a3ReturnsToGame}, 먼저종료유도:${a3AskedToQuitFirst}`,
    });

    // A4: 오늘 급식 맛있었어
    console.log("\n--- Turn A4: 오늘 급식 맛있었어 ---");
    const resA4 = await sendChatMessage(page, "오늘 급식 맛있었어");
    const ssA4 = path.join(LOG_DIR, "A4-lunch.png");
    await page.screenshot({ path: ssA4 });
    const sessA4 = getChosungSessionState();
    const a4ReturnsToGame = resA4.kText.includes("초성") || resA4.kText.includes("게임") || resA4.kText.includes("문제") || resA4.kText.includes("이어서") || resA4.kText.includes("마저") || resA4.kText.includes("맞혀");
    scenarioAResults.push({
      turnId: "A4",
      childUtterance: "오늘 급식 맛있었어",
      kResponse: resA4.kText,
      sessionState: sessA4.state,
      isAlive: sessA4.isAlive,
      passed: sessA4.isAlive && a4ReturnsToGame,
      screenshotPath: ssA4,
      notes: `세션:${sessA4.isAlive ? 'Y' : 'N'}, 복귀언급:${a4ReturnsToGame}`,
    });

    // A5: 우리 강아지 이름은 콩이야
    console.log("\n--- Turn A5: 우리 강아지 이름은 콩이야 ---");
    const resA5 = await sendChatMessage(page, "우리 강아지 이름은 콩이야");
    const ssA5 = path.join(LOG_DIR, "A5-dog-name.png");
    await page.screenshot({ path: ssA5 });
    const sessA5 = getChosungSessionState();
    const a5ReturnsToGame = resA5.kText.includes("초성") || resA5.kText.includes("게임") || resA5.kText.includes("문제") || resA5.kText.includes("이어서") || resA5.kText.includes("마저") || resA5.kText.includes("맞혀") || resA5.kText.includes("콩");
    scenarioAResults.push({
      turnId: "A5",
      childUtterance: "우리 강아지 이름은 콩이야",
      kResponse: resA5.kText,
      sessionState: sessA5.state,
      isAlive: sessA5.isAlive,
      passed: sessA5.isAlive && a5ReturnsToGame,
      screenshotPath: ssA5,
      notes: `세션:${sessA5.isAlive ? 'Y' : 'N'}, 복귀언급:${a5ReturnsToGame}`,
    });

    // A6: 그만할래
    console.log("\n--- Turn A6: 그만할래 ---");
    const resA6 = await sendChatMessage(page, "그만할래");
    const ssA6 = path.join(LOG_DIR, "A6-quit.png");
    await page.screenshot({ path: ssA6 });
    const sessA6 = getChosungSessionState();
    scenarioAResults.push({
      turnId: "A6",
      childUtterance: "그만할래",
      kResponse: resA6.kText,
      sessionState: sessA6.state,
      isAlive: sessA6.isAlive,
      passed: !sessA6.isAlive,
      screenshotPath: ssA6,
      notes: !sessA6.isAlive ? "초성게임 세션 정상 종료됨" : "세션이 아직 살아있음",
    });

    console.log("Waiting 2s before Scenario B...");
    await page.waitForTimeout(2000);

    // ================================================================
    // SCENARIO B: 끝말잇기 단어 인식
    // ================================================================
    console.log("\n=================== [SCENARIO B] ===================");
    const usedWords = new Set<string>();

    // B1: 끝말잇기 하자
    console.log("\n--- Turn B1: 끝말잇기 하자 ---");
    const resB1 = await sendChatMessage(page, "끝말잇기 하자");
    const ssB1 = path.join(LOG_DIR, "B1-wordchain-start.png");
    await page.screenshot({ path: ssB1 });
    const sessB1 = getWordChainSessionState();
    const b1HasKNameError = resB1.kText.includes("케이이가") || resB1.kText.includes("케이가 먼저");
    const kWordB1 = extractKWord(resB1.kText);
    if (kWordB1) usedWords.add(kWordB1);
    scenarioBResults.push({
      turnId: "B1",
      childUtterance: "끝말잇기 하자",
      kResponse: resB1.kText,
      sessionState: sessB1.state,
      isAlive: sessB1.isAlive,
      passed: sessB1.isAlive && !b1HasKNameError,
      screenshotPath: ssB1,
      notes: `세션:${sessB1.isAlive ? 'Y' : 'N'}, 단어:${kWordB1}, 3인칭오류:${b1HasKNameError}`,
    });

    // B2: 케이가 제시한 단어의 끝 글자로 이어지는 단어
    console.log("\n--- Turn B2: 이어지는 단어 답하기 ---");
    let childWordB2 = "과자";
    if (kWordB1) {
      const lastChar = kWordB1.slice(-1);
      const nextWord = findNextChildWord(lastChar, usedWords);
      if (nextWord) {
        childWordB2 = nextWord;
      }
    }
    usedWords.add(childWordB2);
    console.log(`[B2] Child says: "${childWordB2}"`);
    const resB2 = await sendChatMessage(page, childWordB2);
    const ssB2 = path.join(LOG_DIR, "B2-child-word.png");
    await page.screenshot({ path: ssB2 });
    const sessB2 = getWordChainSessionState();
    const kWordB2 = extractKWord(resB2.kText);
    if (kWordB2) usedWords.add(kWordB2);
    scenarioBResults.push({
      turnId: "B2",
      childUtterance: childWordB2,
      kResponse: resB2.kText,
      sessionState: sessB2.state,
      isAlive: sessB2.isAlive,
      passed: sessB2.isAlive,
      screenshotPath: ssB2,
      notes: `세션:${sessB2.isAlive ? 'Y' : 'N'}, 케이응답단어:${kWordB2}`,
    });

    // B3: 유리
    console.log("\n--- Turn B3: 유리 ---");
    const resB3 = await sendChatMessage(page, "유리");
    const ssB3 = path.join(LOG_DIR, "B3-glass.png");
    await page.screenshot({ path: ssB3 });
    const sessB3 = getWordChainSessionState();
    const b3UnknownWordRejection = resB3.kText.includes("모르는 단어") || resB3.kText.includes("잘 모르는");
    const b3ChainMismatch = resB3.kText.includes("시작해야") || resB3.kText.includes("이어") || resB3.kText.includes("글자");
    scenarioBResults.push({
      turnId: "B3",
      childUtterance: "유리",
      kResponse: resB3.kText,
      sessionState: sessB3.state,
      isAlive: sessB3.isAlive,
      passed: !b3UnknownWordRejection,
      screenshotPath: ssB3,
      notes: b3UnknownWordRejection
        ? "FAIL: '유리'를 모르는 단어로 거절"
        : b3ChainMismatch
        ? "PASS: 안 이어짐 안내(정상)"
        : "PASS: 정상 처리",
    });

    // B4: 그만할래
    console.log("\n--- Turn B4: 그만할래 ---");
    const resB4 = await sendChatMessage(page, "그만할래");
    const ssB4 = path.join(LOG_DIR, "B4-quit.png");
    await page.screenshot({ path: ssB4 });
    const sessB4 = getWordChainSessionState();
    scenarioBResults.push({
      turnId: "B4",
      childUtterance: "그만할래",
      kResponse: resB4.kText,
      sessionState: sessB4.state,
      isAlive: sessB4.isAlive,
      passed: !sessB4.isAlive,
      screenshotPath: ssB4,
      notes: !sessB4.isAlive ? "끝말잇기 세션 정상 종료됨" : "세션이 아직 살아있음",
    });

    // Write full execution report JSON
    const report = {
      timestamp: new Date().toISOString(),
      latestDbTimestamp: getLatestMessageTimestamp(),
      scenarioA: scenarioAResults,
      scenarioB: scenarioBResults,
    };
    fs.writeFileSync(
      path.join(LOG_DIR, "qa-final-result.json"),
      JSON.stringify(report, null, 2),
      "utf8"
    );
    console.log("\n=== FULL REPORT ===");
    console.log(JSON.stringify(report, null, 2));
  });
});
