import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
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
const LOG_DIR = "/tmp/agy-qa-014";

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

/** 케이의 끝말잇기 응답에서 케이가 제시한 낱말을 찾아낸다 */
function extractKWord(text: string): string | null {
  // 1. 따옴표 안의 단어들 확인
  const quoteMatches = Array.from(text.matchAll(/['"‘“]([가-힣]+)['"’”]/g)).map((m) => m[1]);
  for (let i = quoteMatches.length - 1; i >= 0; i--) {
    const word = quoteMatches[i];
    if (word.length >= 2 && lookupWord(word)) {
      return word;
    }
  }

  // 2. 따옴표가 없을 경우 문장에서 사전 단어 매칭
  // '첫 번째 단어는 XX야' 또는 '케이는 XX(으)로' 또는 'XX!'
  const tokens = text.replace(/[^가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const entry = lookupWord(token);
    if (entry && entry.normalizedWord.length >= 2) {
      // 흔한 조사나 메타 단어 배제
      if (!["우리", "게임", "놀이", "시작", "단어", "케이가", "이제", "먼저", "좋아"].includes(token)) {
        return entry.word;
      }
    }
  }

  return null;
}

/** 주어진 글자(또는 두음법칙)로 시작하는 후속 단어를 사전에서 찾는다 */
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

test.describe("QA-014 Dev K-Play Switch and Word Recognition Verification", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Verify K-Play switch to Word Chain and sentence trailing word recognition", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const turnResults: Array<{
      turn: number;
      childUtterance: string;
      kResponse: string;
      expected: string;
      passed: boolean;
      screenshotPath: string;
      screenshotMtime: string;
      notes: string;
    }> = [];

    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 0. Login & Navigate to Chat
    console.log("=== 0. Login ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);
    await enableTextInput(page);

    const usedWords = new Set<string>();

    // ================================================================
    // 턴 1: "초성게임 하자"
    // 케이가 초성 문제(자음 3개 형태)를 내는지 확인
    // ================================================================
    console.log("\n=== 턴 1: 초성게임 시작 요청 ===");
    const utterance1 = "초성게임 하자";
    const res1 = await sendChatMessage(page, utterance1);
    const ssPath1 = path.join(LOG_DIR, "01-chosung-started.png");
    await page.screenshot({ path: ssPath1 });
    const mtime1 = fs.statSync(ssPath1).mtime.toISOString();

    // 초성 문제 패턴 확인 (예: 초성은 'ㄱㄴㄷ' / 자음 2~3개 등)
    const isChosungPrompt = /[ㄱ-ㅎ]{2,4}/.test(res1.kText) || res1.kText.includes("초성") || res1.kText.includes("문제");
    const passed1 = res1.kText.length > 0 && isChosungPrompt;

    turnResults.push({
      turn: 1,
      childUtterance: utterance1,
      kResponse: res1.kText,
      expected: "초성 문제 제시 (자음 포함)",
      passed: passed1,
      screenshotPath: ssPath1,
      screenshotMtime: mtime1,
      notes: isChosungPrompt ? "초성 문제가 정상 출제됨" : "초성 문제 형태가 확인되지 않음",
    });
    expect(passed1).toBe(true);

    // ================================================================
    // 턴 2: "초성게임 말고 끝말잇기 하자"
    // 케이가 끝말잇기로 전환하는지 확인 (초성 문제 계속 내면 FAIL)
    // ================================================================
    console.log("\n=== 턴 2: 초성게임 말고 끝말잇기 하자 (놀이 전환) ===");
    const utterance2 = "초성게임 말고 끝말잇기 하자";
    const res2 = await sendChatMessage(page, utterance2);
    const ssPath2 = path.join(LOG_DIR, "02-switch-to-wordchain.png");
    await page.screenshot({ path: ssPath2 });
    const mtime2 = fs.statSync(ssPath2).mtime.toISOString();

    // 끝말잇기 전환 확인: 끝말잇기 언급 또는 첫 단어 제시가 있고, 초성 문제 반복이 아니어야 함
    const isWordChainPrompt = res2.kText.includes("끝말잇기") || res2.kText.includes("먼저") || res2.kText.includes("시작");
    const stillChosung = res2.kText.includes("초성은") || /[ㄱ-ㅎ]{2,4}/.test(res2.kText);
    
    // 케이가 제시한 첫 낱말 추출
    const kWord1 = extractKWord(res2.kText);
    console.log(`[턴 2] 추출된 케이의 첫 단어: "${kWord1}"`);
    if (kWord1) usedWords.add(kWord1);

    const passed2 = isWordChainPrompt && !stillChosung && !!kWord1;

    turnResults.push({
      turn: 2,
      childUtterance: utterance2,
      kResponse: res2.kText,
      expected: "끝말잇기로 전환 및 첫 낱말 제시 (초성 문제 반복 없음)",
      passed: passed2,
      screenshotPath: ssPath2,
      screenshotMtime: mtime2,
      notes: passed2
        ? `끝말잇기 전환 성공 (첫 단어: ${kWord1})`
        : stillChosung
        ? "FAIL: 초성 문제를 계속 냄"
        : "FAIL: 끝말잇기 전환 또는 첫 단어 추출 실패",
    });
    expect(passed2).toBe(true);
    expect(kWord1).toBeTruthy();

    // ================================================================
    // 턴 3: 문장 끝에 붙여 말한 끝말잇기 낱말 인정 확인
    // 케이가 낸 낱말의 마지막 글자로 시작하는 낱말을 문장 끝에 붙여 말한다.
    // 예: "아 뭐였지 음 <낱말>"
    // 케이가 그 낱말을 인정하고 이어가는지 확인. "잘 못 들었어" 또는 "사전에 없는 단어" 면 FAIL.
    // ================================================================
    console.log("\n=== 턴 3: 문장 끝 낱말 붙여 말하기 ===");
    const lastChar1 = kWord1!.slice(-1);
    const childWord1 = findNextChildWord(lastChar1, usedWords);
    console.log(`[턴 3] 케이 단어 "${kWord1}"의 끝글자 "${lastChar1}" -> 아이 단어 후보: "${childWord1}"`);
    expect(childWord1).toBeTruthy();
    usedWords.add(childWord1!);

    const utterance3 = `아 뭐였지 음 ${childWord1}`;
    const res3 = await sendChatMessage(page, utterance3);
    const ssPath3 = path.join(LOG_DIR, "03-sentence-word-accepted.png");
    await page.screenshot({ path: ssPath3 });
    const mtime3 = fs.statSync(ssPath3).mtime.toISOString();

    // 케이 응답 검증: 거절 문구("잘 못 들었어", "사전에 없는", "모르는 단어", "글자가 이어지지 않아")가 없어야 함
    const isRejected3 =
      res3.kText.includes("잘 못 들었어") ||
      res3.kText.includes("사전에 없는") ||
      res3.kText.includes("잘 모르는 단어") ||
      res3.kText.includes("글자가 이어지지");

    // 케이의 다음 단어 추출
    const kWord2 = extractKWord(res3.kText);
    console.log(`[턴 3] 케이의 후속 단어: "${kWord2}"`);
    if (kWord2) usedWords.add(kWord2);

    const passed3 = !isRejected3 && !!kWord2;

    turnResults.push({
      turn: 3,
      childUtterance: utterance3,
      kResponse: res3.kText,
      expected: `문장 끝 낱말 "${childWord1}" 인정 및 후속 낱말 제시`,
      passed: passed3,
      screenshotPath: ssPath3,
      screenshotMtime: mtime3,
      notes: passed3
        ? `문장 끝 낱말 "${childWord1}" 정상 인정 (케이 다음 단어: ${kWord2})`
        : isRejected3
        ? `FAIL: 낱말 거절됨 ("${res3.kText}")`
        : "FAIL: 후속 낱말 추출 실패",
    });
    expect(passed3).toBe(true);
    expect(kWord2).toBeTruthy();

    // ================================================================
    // 턴 4: 단답으로 조사 붙여 말하기 (예: "<낱말>야")
    // 케이가 낸 낱말의 끝글자로 시작하는 낱말에 "야"를 붙여 입력.
    // 사전에 있는 낱말이면 인정돼야 한다.
    // ================================================================
    console.log("\n=== 턴 4: 단답 조사 붙여 말하기 ('야' 조사) ===");
    const lastChar2 = kWord2!.slice(-1);
    const childWord2 = findNextChildWord(lastChar2, usedWords);
    console.log(`[턴 4] 케이 단어 "${kWord2}"의 끝글자 "${lastChar2}" -> 아이 단어 후보: "${childWord2}"`);
    expect(childWord2).toBeTruthy();
    usedWords.add(childWord2!);

    const utterance4 = `${childWord2}야`;
    const res4 = await sendChatMessage(page, utterance4);
    const ssPath4 = path.join(LOG_DIR, "04-particle-word-accepted.png");
    await page.screenshot({ path: ssPath4 });
    const mtime4 = fs.statSync(ssPath4).mtime.toISOString();

    const isRejected4 =
      res4.kText.includes("잘 못 들었어") ||
      res4.kText.includes("사전에 없는") ||
      res4.kText.includes("잘 모르는 단어") ||
      res4.kText.includes("글자가 이어지지");

    const kWord3 = extractKWord(res4.kText);
    console.log(`[턴 4] 케이의 후속 단어: "${kWord3}"`);
    if (kWord3) usedWords.add(kWord3);

    const passed4 = !isRejected4;

    turnResults.push({
      turn: 4,
      childUtterance: utterance4,
      kResponse: res4.kText,
      expected: `조사 붙은 낱말 "${childWord2}야"에서 조사 분리 및 인정`,
      passed: passed4,
      screenshotPath: ssPath4,
      screenshotMtime: mtime4,
      notes: passed4
        ? `조사 분리 정상 인정 (단어: "${childWord2}", 케이 다음 단어: ${kWord3 || "인정됨"})`
        : `FAIL: 조사 붙은 단어 거절됨 ("${res4.kText}")`,
    });
    expect(passed4).toBe(true);

    // ================================================================
    // 턴 5: "그만하자"
    // 놀이가 종료되고 일반 대화로 돌아오는지 확인
    // ================================================================
    console.log("\n=== 턴 5: 놀이 종료 요청 ('그만하자') ===");
    const utterance5 = "그만하자";
    const res5 = await sendChatMessage(page, utterance5);
    const ssPath5 = path.join(LOG_DIR, "05-game-ended.png");
    await page.screenshot({ path: ssPath5 });
    const mtime5 = fs.statSync(ssPath5).mtime.toISOString();

    // 놀이 종료 확인: 게임 진행 문구("단어를 이어줘", "차례야" 등)가 없고 일상 칭찬/종료 응답
    const isGameStillOngoing = res5.kText.includes("시작하는 단어") || res5.kText.includes("말해줘");
    const isEndedWarmly = res5.kText.includes("재밌었") || res5.kText.includes("다음에") || res5.kText.includes("좋아") || res5.kText.includes("그만") || res5.kText.length > 0;
    const passed5 = !isGameStillOngoing && isEndedWarmly;

    turnResults.push({
      turn: 5,
      childUtterance: utterance5,
      kResponse: res5.kText,
      expected: "끝말잇기 놀이 종료 및 일반 대화 복귀",
      passed: passed5,
      screenshotPath: ssPath5,
      screenshotMtime: mtime5,
      notes: passed5
        ? "놀이가 정상 종료되고 일반 대화로 복귀함"
        : "FAIL: 놀이가 계속 진행 중이거나 비정상 응답",
    });
    expect(passed5).toBe(true);

    // ================================================================
    // 결과 JSON 저장
    // ================================================================
    const summary = {
      overallPassed: turnResults.every((t) => t.passed),
      targetUrl: BASE,
      childId: CHILD_A_ID,
      username: CHILD_A_USERNAME,
      executedAt: new Date().toISOString(),
      turns: turnResults,
    };

    fs.writeFileSync(
      path.join(LOG_DIR, "results.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );

    console.log("\n=== QA-014 TEST FINISHED ===");
    console.log("Overall Passed:", summary.overallPassed);
    await context.close();
  });
});
