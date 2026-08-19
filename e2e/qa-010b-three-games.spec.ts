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
const LOG_DIR = "/tmp/agy-qa-010b";

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

function getWordChainCurrentWordFromDB(): string | null {
  const rows = runQuery(
    `SELECT current_word FROM word_chain_game_sessions WHERE child_id = '${CHILD_A_ID}' ORDER BY updated_at DESC LIMIT 1;`
  );
  if (rows && rows.length > 0) {
    return rows[0].current_word || null;
  }
  return null;
}

function getChosungFromDB(): { current_chosung: string; current_word: string } | null {
  const rows = runQuery(
    `SELECT current_chosung, current_word FROM chosung_game_sessions WHERE child_id = '${CHILD_A_ID}' ORDER BY updated_at DESC LIMIT 1;`
  );
  if (rows && rows.length > 0) {
    return rows[0];
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

test.describe("QA-010B Three Games Verification", () => {
  test.setTimeout(360_000);

  test("Play Word Chain, Chosung, Nonsense games and verify 4 criteria", async ({ browser }) => {
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

    const turnsRecord: Array<{
      game: string;
      turnId: string;
      childUtterance: string;
      kResponse: string;
      screenshotPath: string;
    }> = [];

    const usedWords = new Set<string>();

    // ==========================================
    // [A 끝말잇기]
    // ==========================================
    console.log("\n=== [A 끝말잇기] ===");

    // A1: 끝말잇기 하자
    console.log("--- A1: 끝말잇기 하자 ---");
    const resA1 = await sendChatMessage(page, "끝말잇기 하자");
    const ssA1 = path.join(LOG_DIR, "A1-wordchain-start.png");
    await page.screenshot({ path: ssA1 });
    turnsRecord.push({
      game: "끝말잇기",
      turnId: "A1",
      childUtterance: "끝말잇기 하자",
      kResponse: resA1.kText,
      screenshotPath: ssA1,
    });

    // DB에서 케이 첫 단어 확인
    const kWord1 = getWordChainCurrentWordFromDB();
    console.log(`[A1 DB Current Word]: "${kWord1}"`);
    if (kWord1) usedWords.add(kWord1);

    // A2: 케이 단어의 마지막 글자로 시작하는 짧고 흔한 단어 답하기
    const lastCharA1 = kWord1 ? kWord1[kWord1.length - 1] : "과";
    const childWord1 = findNextChildWord(lastCharA1, usedWords) || "과자";
    usedWords.add(childWord1);
    console.log(`--- A2: ${childWord1} ---`);
    const resA2 = await sendChatMessage(page, childWord1);
    const ssA2 = path.join(LOG_DIR, "A2-wordchain-turn1.png");
    await page.screenshot({ path: ssA2 });
    turnsRecord.push({
      game: "끝말잇기",
      turnId: "A2",
      childUtterance: childWord1,
      kResponse: resA2.kText,
      screenshotPath: ssA2,
    });

    // A3: 다시 이어지는 단어 답하기
    const kWord2 = getWordChainCurrentWordFromDB();
    console.log(`[A2 DB Current Word]: "${kWord2}"`);
    if (kWord2) usedWords.add(kWord2);

    const lastCharA2 = kWord2 ? kWord2[kWord2.length - 1] : "기";
    const childWord2 = findNextChildWord(lastCharA2, usedWords) || "기차";
    usedWords.add(childWord2);
    console.log(`--- A3: ${childWord2} ---`);
    const resA3 = await sendChatMessage(page, childWord2);
    const ssA3 = path.join(LOG_DIR, "A3-wordchain-turn2.png");
    await page.screenshot({ path: ssA3 });
    turnsRecord.push({
      game: "끝말잇기",
      turnId: "A3",
      childUtterance: childWord2,
      kResponse: resA3.kText,
      screenshotPath: ssA3,
    });

    // A4: 그만할래
    console.log("--- A4: 그만할래 ---");
    const resA4 = await sendChatMessage(page, "그만할래");
    const ssA4 = path.join(LOG_DIR, "A4-wordchain-quit.png");
    await page.screenshot({ path: ssA4 });
    turnsRecord.push({
      game: "끝말잇기",
      turnId: "A4",
      childUtterance: "그만할래",
      kResponse: resA4.kText,
      screenshotPath: ssA4,
    });

    // ==========================================
    // [B 초성게임]
    // ==========================================
    console.log("\n=== [B 초성게임] ===");

    // B1: 초성게임 하자
    console.log("--- B1: 초성게임 하자 ---");
    const resB1 = await sendChatMessage(page, "초성게임 하자");
    const ssB1 = path.join(LOG_DIR, "B1-chosung-start.png");
    await page.screenshot({ path: ssB1 });
    turnsRecord.push({
      game: "초성게임",
      turnId: "B1",
      childUtterance: "초성게임 하자",
      kResponse: resB1.kText,
      screenshotPath: ssB1,
    });

    // B2: DB 에서 정답을 읽어 "그러니까 <정답> 이라고" 형태로 답한다
    const chosungDb = getChosungFromDB();
    console.log(`[B1 DB Chosung]:`, JSON.stringify(chosungDb));
    const chosungAnswer = chosungDb?.current_word || "피카츄";
    const chosungAnswerUtterance = `그러니까 ${chosungAnswer} 이라고`;

    console.log(`--- B2: ${chosungAnswerUtterance} ---`);
    const resB2 = await sendChatMessage(page, chosungAnswerUtterance);
    const ssB2 = path.join(LOG_DIR, "B2-chosung-answer.png");
    await page.screenshot({ path: ssB2 });
    turnsRecord.push({
      game: "초성게임",
      turnId: "B2",
      childUtterance: chosungAnswerUtterance,
      kResponse: resB2.kText,
      screenshotPath: ssB2,
    });

    // B3: 다음 문제 줘
    console.log("--- B3: 다음 문제 줘 ---");
    const resB3 = await sendChatMessage(page, "다음 문제 줘");
    const ssB3 = path.join(LOG_DIR, "B3-chosung-next.png");
    await page.screenshot({ path: ssB3 });
    turnsRecord.push({
      game: "초성게임",
      turnId: "B3",
      childUtterance: "다음 문제 줘",
      kResponse: resB3.kText,
      screenshotPath: ssB3,
    });

    // B4: 그만할래
    console.log("--- B4: 그만할래 ---");
    const resB4 = await sendChatMessage(page, "그만할래");
    const ssB4 = path.join(LOG_DIR, "B4-chosung-quit.png");
    await page.screenshot({ path: ssB4 });
    turnsRecord.push({
      game: "초성게임",
      turnId: "B4",
      childUtterance: "그만할래",
      kResponse: resB4.kText,
      screenshotPath: ssB4,
    });

    // ==========================================
    // [C 넌센스]
    // ==========================================
    console.log("\n=== [C 넌센스] ===");

    // C1: 넌센스 퀴즈 하자
    console.log("--- C1: 넌센스 퀴즈 하자 ---");
    const resC1 = await sendChatMessage(page, "넌센스 퀴즈 하자");
    const ssC1 = path.join(LOG_DIR, "C1-nonsense-start.png");
    await page.screenshot({ path: ssC1 });
    turnsRecord.push({
      game: "넌센스",
      turnId: "C1",
      childUtterance: "넌센스 퀴즈 하자",
      kResponse: resC1.kText,
      screenshotPath: ssC1,
    });

    // C2: 힌트 줘
    console.log("--- C2: 힌트 줘 ---");
    const resC2 = await sendChatMessage(page, "힌트 줘");
    const ssC2 = path.join(LOG_DIR, "C2-nonsense-hint.png");
    await page.screenshot({ path: ssC2 });
    turnsRecord.push({
      game: "넌센스",
      turnId: "C2",
      childUtterance: "힌트 줘",
      kResponse: resC2.kText,
      screenshotPath: ssC2,
    });

    // C3: 정답 알려줘
    console.log("--- C3: 정답 알려줘 ---");
    const resC3 = await sendChatMessage(page, "정답 알려줘");
    const ssC3 = path.join(LOG_DIR, "C3-nonsense-answer.png");
    await page.screenshot({ path: ssC3 });
    turnsRecord.push({
      game: "넌센스",
      turnId: "C3",
      childUtterance: "정답 알려줘",
      kResponse: resC3.kText,
      screenshotPath: ssC3,
    });

    // C4: 내 봐 (이게 "다음 문제"로 처리되어야 한다)
    console.log("--- C4: 내 봐 ---");
    const resC4 = await sendChatMessage(page, "내 봐");
    const ssC4 = path.join(LOG_DIR, "C4-nonsense-next.png");
    await page.screenshot({ path: ssC4 });
    turnsRecord.push({
      game: "넌센스",
      turnId: "C4",
      childUtterance: "내 봐",
      kResponse: resC4.kText,
      screenshotPath: ssC4,
    });

    // C5: 그만할래
    console.log("--- C5: 그만할래 ---");
    const resC5 = await sendChatMessage(page, "그만할래");
    const ssC5 = path.join(LOG_DIR, "C5-nonsense-quit.png");
    await page.screenshot({ path: ssC5 });
    turnsRecord.push({
      game: "넌센스",
      turnId: "C5",
      childUtterance: "그만할래",
      kResponse: resC5.kText,
      screenshotPath: ssC5,
    });

    // Save all turn results to JSON
    fs.writeFileSync(
      path.join(LOG_DIR, "results.json"),
      JSON.stringify(turnsRecord, null, 2),
      "utf8"
    );

    console.log("\n=== All Turns Recorded ===");
    console.log(JSON.stringify(turnsRecord, null, 2));
  });
});
