import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { WORD_CHAIN_DICTIONARY } from "../lib/k-conversation/wordChain/dictionaryIndex";
import { allowedNextInitials } from "../lib/k-conversation/wordChain/dueum";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const SCREENSHOT_DIR = "/tmp/agy-qa-play";

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  for (const c of [".env.local", ".env.test.local", ".env"]) {
    const f = path.join(process.cwd(), c);
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, "utf8").match(/^QA_TEST_PASSWORD=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("QA_TEST_PASSWORD 를 찾을 수 없다");
}

function runDevQuery(sql: string) {
  try {
    const stdout = execSync(
      `node scripts/run-query.js "${sql.replace(/"/g, '\\"')}" --target=dev`,
      { cwd: process.cwd(), encoding: "utf8" }
    );
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

type Page = import("@playwright/test").Page;

async function hideTelemetryOverlay(page: Page) {
  await page
    .evaluate(() => {
      const style = document.createElement("style");
      style.innerHTML =
        '[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }';
      document.head.appendChild(style);
    })
    .catch(() => {});
}

async function loginAndEnterChat(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await hideTelemetryOverlay(page);
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(getQaPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$|\/onboarding/, { timeout: 20000 }).catch(() => {});
  await page.evaluate(
    ({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    },
    { cId: CHILD_ID }
  );
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await hideTelemetryOverlay(page);

  const later = page.getByRole("button", { name: "나중에 할게요" });
  if ((await later.count().catch(() => 0)) > 0) {
    await later.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function enableTextInput(page: Page) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  if (await input.isVisible().catch(() => false)) return;
  const kb = page.getByRole("button", { name: "텍스트로 답하기" });
  if ((await kb.count().catch(() => 0)) > 0) {
    await kb.click({ force: true });
    await page.waitForTimeout(700);
  }
  await expect(input).toBeVisible({ timeout: 15000 });
}

test("Dev E2E QA — 케이놀이 조회/종료 실패 처리 종합 시나리오", async ({ page }) => {
  test.setTimeout(480_000);

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const stepResults: Array<{ step: number; desc: string; pass: boolean; note?: string }> = [];

  const send = async (message: string) => {
    await enableTextInput(page);
    const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await input.fill(message);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 90000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);
    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    const text = String(json.text ?? "");
    console.log(`[SEND: "${message}"] RESPONSE: ${JSON.stringify(text)} (activePlaySkillId=${JSON.stringify(json.activePlaySkillId)})`);
    await page.waitForTimeout(1500);
    return { text, json };
  };

  const checkBannedPatterns = (text: string, context: string) => {
    const englishErrors = /(Failed to|Could not confirm|session|error|undefined|null|Internal Server)/i;
    expect(englishErrors.test(text), `[${context}] 영문 오류 문구 노출: ${text}`).toBeFalsy();
    expect(text.trim().length, `[${context}] 케이가 아무 말도 하지 않음 (침묵)`).toBeGreaterThan(0);
    expect(text.includes("그건 아직 잘 기억이 안 나는데"), `[${context}] 기억 회피 문구 노출: ${text}`).toBeFalsy();
  };

  // ============================================================
  // 시나리오 1. 로그인 → 자유대화 진입. 텍스트 입력창 placeholder, 전송 버튼 확인
  // ============================================================
  console.log("=== STEP 1: 로그인 및 자유대화 진입 ===");
  await loginAndEnterChat(page);
  await enableTextInput(page);
  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  const sendBtn = page.locator('button[aria-label="전송"]');
  await expect(textInput).toBeVisible();
  await expect(sendBtn).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-freechat-entered.png` });
  stepResults.push({ step: 1, desc: "로그인 및 자유대화 진입", pass: true });

  // ============================================================
  // 시나리오 2. '끝말잇기 하자' → 케이가 놀이를 시작하는지. 첫 낱말이 나오는지
  // ============================================================
  console.log("=== STEP 2: 끝말잇기 시작 ===");
  const step2Res = await send("끝말잇기 하자");
  checkBannedPatterns(step2Res.text, "끝말잇기 시작");
  expect(step2Res.json.activePlaySkillId, "activePlaySkillId 가 WORD_CHAIN 이 아님").toBe("WORD_CHAIN");

  // 첫 음절 추출
  const openMatch =
    step2Res.text.match(/["']([^"']+)["'](?:로|으로|\(으\)로)\s*시작/) ||
    step2Res.text.match(/"(.)"(?:로|으로)/) ||
    step2Res.text.match(/'(.)'(?:로|으로)/);
  let nextSyllable = openMatch ? openMatch[1] : null;

  if (!nextSyllable) {
    // DB 세션에서 현재 단어의 끝 글자 확인
    const dbRow = runDevQuery(
      `SELECT current_word FROM word_chain_game_sessions WHERE child_id = '${CHILD_ID}' AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1;`
    );
    if (dbRow && dbRow.length > 0 && dbRow[0].current_word) {
      nextSyllable = dbRow[0].current_word.slice(-1);
    }
  }

  expect(nextSyllable, `첫 낱말 시작 음절 추출 실패: ${step2Res.text}`).toBeTruthy();
  console.log(`[끝말잇기 시작] 첫 음절: "${nextSyllable}"`);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-wordchain-start.png` });
  stepResults.push({ step: 2, desc: "끝말잇기 시작 및 첫 낱말 제시", pass: true, note: `첫 낱말 음절: ${nextSyllable}` });

  // ============================================================
  // 시나리오 3. 케이 낱말을 이어 3턴 진행 → 말풍선이 정확히 3줄인지 매 턴 확인
  // ============================================================
  console.log("=== STEP 3: 끝말잇기 3턴 진행 및 3줄 구조 검증 ===");
  const usedWords = new Set<string>();
  const pickWord = (syllable: string): string | null => {
    const initials = allowedNextInitials(syllable);
    const found = WORD_CHAIN_DICTIONARY.find(
      (e) => initials.includes(e.word[0]) && !usedWords.has(e.normalizedWord) && !usedWords.has(e.word)
    );
    if (found) {
      usedWords.add(found.normalizedWord);
      usedWords.add(found.word);
      return found.word;
    }
    return null;
  };

  let step3Pass = true;
  for (let turn = 1; turn <= 3; turn++) {
    expect(nextSyllable, `턴 ${turn}: 다음 음절 없음`).toBeTruthy();
    const candidate = pickWord(nextSyllable!);
    expect(candidate, `턴 ${turn}: '${nextSyllable}'로 시작하는 사전 단어 없음`).toBeTruthy();
    console.log(`[끝말잇기 턴 ${turn}] 보낼 단어: ${candidate} (이전 음절: ${nextSyllable})`);

    const turnRes = await send(candidate!);
    checkBannedPatterns(turnRes.text, `끝말잇기 턴 ${turn}`);
    expect(turnRes.json.activePlaySkillId, `턴 ${turn}: activePlaySkillId 가 풀림`).toBe("WORD_CHAIN");

    // 말풍선 3줄 검증: <아이낱말>... / 나는 <케이낱말>! / 이제 "<음절>"(으)로 시작하는 단어는?
    const lines = turnRes.text.split("\n").filter((l) => l.trim().length > 0);
    console.log(`[끝말잇기 턴 ${turn} 라인수: ${lines.length}]`, lines);
    expect(lines.length, `턴 ${turn} 응답이 3줄이 아님: ${JSON.stringify(turnRes.text)}`).toBe(3);
    expect(lines[0].endsWith("..."), `턴 ${turn} 1줄 형식 위반: ${lines[0]}`).toBeTruthy();
    expect(lines[1].startsWith("나는 ") && lines[1].endsWith("!"), `턴 ${turn} 2줄 형식 위반: ${lines[1]}`).toBeTruthy();
    expect(/^이제\s*["'].+["'](?:\(으\)로|으로|로)\s*시작하는\s*(?:단어|낱말)는\?$/.test(lines[2]), `턴 ${turn} 3줄 형식 위반: ${lines[2]}`).toBeTruthy();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-wordchain-turn${turn}.png` });

    const nm =
      turnRes.text.match(/["']([^"']+)["'](?:로|으로|\(으\)로)\s*시작/) ||
      turnRes.text.match(/"(.)"(?:로|으로)/) ||
      turnRes.text.match(/'(.)'(?:로|으로)/);
    if (nm) {
      nextSyllable = nm[1];
    } else {
      const dbRow = runDevQuery(
        `SELECT current_word FROM word_chain_game_sessions WHERE child_id = '${CHILD_ID}' AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1;`
      );
      if (dbRow && dbRow.length > 0 && dbRow[0].current_word) {
        nextSyllable = dbRow[0].current_word.slice(-1);
      }
    }
  }
  stepResults.push({ step: 3, desc: "끝말잇기 3턴 진행 및 정확히 3줄 말풍선 검증", pass: step3Pass });

  // ============================================================
  // 시나리오 4. '넌센스 퀴즈 하자' → 놀이가 바뀌는지. 끝말잇기 낱말로 채점되지 않는지
  // ============================================================
  console.log("=== STEP 4: 넌센스 퀴즈로 전환 ===");
  const step4Res = await send("넌센스 퀴즈 하자");
  checkBannedPatterns(step4Res.text, "넌센스 퀴즈 전환");
  expect(step4Res.json.activePlaySkillId, "activePlaySkillId 가 NONSENSE_QUIZ 가 아님").toBe("NONSENSE_QUIZ");
  expect(step4Res.text.includes("이어지지 않아") || step4Res.text.includes("모르는 단어"), "끝말잇기로 채점됨").toBeFalsy();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-switch-nonsense.png` });
  stepResults.push({ step: 4, desc: "넌센스 퀴즈 전환 (놀이 변경 및 채점 비간섭)", pass: true });

  // ============================================================
  // 시나리오 5. 넌센스에서 '힌트 줘' → 힌트가 나오고 정답이 노출되지 않는지
  // ============================================================
  console.log("=== STEP 5: 넌센스 힌트 요청 ===");
  const step5Res = await send("힌트 줘");
  checkBannedPatterns(step5Res.text, "넌센스 힌트");
  expect(step5Res.json.activePlaySkillId, "activePlaySkillId 가 NONSENSE_QUIZ 가 아님").toBe("NONSENSE_QUIZ");
  expect(step5Res.text.includes("정답은"), "힌트에 정답이 직접 노출됨").toBeFalsy();
  expect(step5Res.text.length, "힌트가 비어있음").toBeGreaterThan(5);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-nonsense-hint.png` });
  stepResults.push({ step: 5, desc: "넌센스 힌트 제공 및 정답 비노출 검증", pass: true });

  // ============================================================
  // 시나리오 6. '그만' → 놀이가 끝나고 자유대화로 돌아오는지. 입력 모드가 풀리는지
  // ============================================================
  console.log("=== STEP 6: '그만' 발화로 놀이 종료 ===");
  const step6Res = await send("그만");
  checkBannedPatterns(step6Res.text, "놀이 그만");
  expect(step6Res.json.activePlaySkillId === null || step6Res.json.activePlaySkillId === undefined, "activePlaySkillId 가 남아있음").toBeTruthy();
  await page.waitForTimeout(2000);

  // 놀이 종료 후 UI 검증: 놀이 중 없던 텍스트 닫기 버튼이 복귀하거나 자유대화 모드로 복귀
  const textCloseBtn = page.getByRole("button", { name: "텍스트 입력창 닫기" });
  const chatCloseBtn = page.getByRole("button", { name: "채팅창 닫기" });
  const hasCloseBtn = (await textCloseBtn.count()) > 0 || (await chatCloseBtn.count()) > 0;
  console.log("놀이 종료 후 닫기 버튼 카운트:", { textClose: await textCloseBtn.count(), chatClose: await chatCloseBtn.count() });
  expect(hasCloseBtn, "놀이 종료 후 닫기/복귀 버튼이 없음").toBeTruthy();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/06-play-quit.png` });
  stepResults.push({ step: 6, desc: "놀이 '그만' 종료 및 자유대화 복귀", pass: true });

  // ============================================================
  // 시나리오 7. 놀이 선택 모달(케이놀이 버튼)을 열어 → 목록이 뜨는지 확인
  // ============================================================
  console.log("=== STEP 7: 케이 놀이 모달 열기 및 목록 확인 ===");
  // 자유대화 텍스트 입력창 닫기를 눌러 메인 화면의 케이놀이 버튼을 확보하거나 케이놀이 버튼 직접 클릭
  const closeInputBtn = page.getByRole("button", { name: "텍스트 입력창 닫기" });
  if ((await closeInputBtn.count()) > 0) {
    await closeInputBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  const kplayBtn = page.getByRole("button", { name: "놀이 고르기" });
  await expect(kplayBtn).toBeVisible({ timeout: 10000 });
  await kplayBtn.click({ force: true });

  // 모달 확인
  const modalTitle = page.locator("#play-skill-modal-title");
  await expect(modalTitle).toBeVisible({ timeout: 10000 });
  await expect(modalTitle).toHaveText("케이 놀이 선택");

  // 놀이 목록 확인
  const chosungItem = page.getByRole("button", { name: /초성게임/ });
  const wordchainItem = page.getByRole("button", { name: /끝말잇기/ });
  const nonsenseItem = page.getByRole("button", { name: /넌센스 퀴즈/ });
  await expect(chosungItem).toBeVisible();
  await expect(wordchainItem).toBeVisible();
  await expect(nonsenseItem).toBeVisible();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/07-play-modal-catalog.png` });
  stepResults.push({ step: 7, desc: "케이 놀이 모달 열기 및 목록 노출 확인", pass: true });

  // ============================================================
  // 시나리오 8. 모달에서 '초성게임' 선택 → 시작되는지. 모달의 '종료' 버튼으로 끝내는지
  // ============================================================
  console.log("=== STEP 8: 모달에서 초성게임 시작 및 모달 종료 버튼으로 종료 ===");
  const [startRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/play/skill/select") && r.request().method() === "POST",
      { timeout: 30000 }
    ),
    chosungItem.click({ force: true }),
  ]);
  const startJson = await startRes.json().catch(() => ({}));
  console.log("[초성게임 시작 응답]", startJson);
  expect(startJson.ok, "초성게임 시작 실패").toBeTruthy();

  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/08-chosung-started.png` });

  // 모달을 다시 열어 '지금 하는 놀이 그만하기'(종료 버튼) 확인 및 클릭
  const kplayBtnDuringGame = page.getByRole("button", { name: "놀이 고르기" });
  await expect(kplayBtnDuringGame).toBeVisible({ timeout: 10000 });
  await kplayBtnDuringGame.click({ force: true });

  await expect(modalTitle).toBeVisible({ timeout: 10000 });
  const endPlayBtn = page.getByRole("button", { name: "지금 하는 놀이 그만하기" });
  await expect(endPlayBtn).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/08-modal-end-button-visible.png` });

  const [endRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/play/skill/end") && r.request().method() === "POST",
      { timeout: 30000 }
    ),
    endPlayBtn.click({ force: true }),
  ]);
  const endJson = await endRes.json().catch(() => ({}));
  console.log("[모달 종료 응답]", endJson);
  expect(endJson.ok, "놀이 종료 실패").toBeTruthy();

  await page.waitForTimeout(2000);
  await expect(modalTitle).not.toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/08-chosung-ended.png` });
  stepResults.push({ step: 8, desc: "모달에서 초성게임 시작 및 모달 종료 버튼으로 완료", pass: true });

  console.log("=== 종합 결과 ===");
  console.table(stepResults);
});
