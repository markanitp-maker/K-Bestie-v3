import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const EVIDENCE_DIR = "/tmp/agy-qa-009b";

function runDbQuery(sql: string) {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    const stdout = execSync(`node scripts/run-query.js "${escaped}" --target=dev`, {
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

async function loginChild(page: Page) {
  console.log(`[Auth] Logging in as ${CHILD_USERNAME} at ${BASE}/login...`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: CHILD_ID });
}

async function ensureChatInput(page: Page) {
  console.log(`[Chat] Navigating to ${BASE}/chat...`);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(2000);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const startBtn = page.getByRole("button", { name: /시작하기|케이와 대화 시작하기/ });
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("[Chat] Clicking start conversation button...");
    await startBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInput).toBeVisible({ timeout: 10000 });
  return textInput;
}

async function sendChat(page: Page, text: string) {
  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await textInput.waitFor({ state: "visible", timeout: 10000 });
  await textInput.fill(text);
  await hideTelemetryOverlay(page);

  console.log(`\n-----------------------------------------`);
  console.log(`[User Send]: "${text}"`);
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
      { timeout: 45000 }
    ),
    page.locator('button[aria-label="전송"]').click({ force: true }),
  ]);

  const resJson = await res.json().catch(() => ({}));
  await page.waitForTimeout(2000);

  const bubble = page.locator("p.text-left").first();
  const bubbleText = (await bubble.textContent().catch(() => "")) || "";
  const keiText = (resJson.text || bubbleText).trim();

  console.log(`[Kei Response]: "${keiText}"`);
  console.log(`[API Response category]: ${resJson.category}, intent: ${resJson.intent}`);

  return {
    resJson,
    keiText,
    bubbleText: bubbleText.trim(),
  };
}

test.describe("QA 009b Retest Chosung Game Hint & Wrong Answer", () => {
  test.setTimeout(240_000); // 4 minutes

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }
    context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("초성게임 힌트 요청 및 오답 힌트 검증", async () => {
    let loginSuccess = false;
    try {
      await loginChild(page);
      await ensureChatInput(page);
      loginSuccess = true;
    } catch (e: any) {
      console.error("Login failed:", e.message);
      fs.writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
        login: "실패",
        error: e.message
      }, null, 2));
      throw e;
    }

    // Step 1: 자유대화 -> 초성게임 시작
    console.log("\n[Step 1] '초성게임 하자' 전송");
    const turn1 = await sendChat(page, "초성게임 하자");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "step1-start.png"), fullPage: true });

    // Step 1 DB Check
    const db1 = runDbQuery(`
      select current_word, current_chosung, hint_level, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    console.log("[Step 1 DB]:", JSON.stringify(db1, null, 2));

    const currentChosung = db1?.[0]?.current_chosung || "";
    const currentWord = db1?.[0]?.current_word || "";
    const hintLevel1 = db1?.[0]?.hint_level ?? -1;

    console.log(`[Step 1 Check] DB current_chosung="${currentChosung}", DB current_word="${currentWord}"`);
    console.log(`[Step 1 Check] Kei text contains DB chosung? ${turn1.keiText.includes(currentChosung)}`);

    // Step 2: "힌트 좀 알려줘" 전송
    console.log("\n[Step 2] '힌트 좀 알려줘' 전송");
    const turn2 = await sendChat(page, "힌트 좀 알려줘");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "step2-hint.png"), fullPage: true });

    const db2 = runDbQuery(`
      select current_word, current_chosung, hint_level, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    console.log("[Step 2 DB]:", JSON.stringify(db2, null, 2));
    const hintLevel2 = db2?.[0]?.hint_level ?? -1;

    // Step 3: 오답 하나 말하기
    // Pick an answer that doesn't match currentWord
    let wrongAnswer = "우주선";
    if (currentWord === "우주선") {
      wrongAnswer = "피아노";
    }
    console.log(`\n[Step 3] 오답 전송: "${wrongAnswer}"`);
    const turn3 = await sendChat(page, wrongAnswer);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "step3-wrong.png"), fullPage: true });

    const db3 = runDbQuery(`
      select current_word, current_chosung, hint_level, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    console.log("[Step 3 DB]:", JSON.stringify(db3, null, 2));
    const hintLevel3 = db3?.[0]?.hint_level ?? -1;

    // Top 3 DB sessions as requested by user prompt
    const dbTop3 = runDbQuery(`
      select current_word, current_chosung, hint_level, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      order by started_at desc limit 3;
    `);
    console.log("[Top 3 DB Sessions]:", JSON.stringify(dbTop3, null, 2));

    // Summary evaluation
    const isChosungMatch = turn1.keiText.includes(currentChosung);
    const isStep2FallbackOnly = turn2.keiText.includes("자, 다시 낼게! 초성은") || turn2.keiText === `자, 다시 낼게! 초성은 '${currentChosung}' 이야. 뭘까?`;
    const isStep2Spoiled = currentWord && turn2.keiText.includes(currentWord);
    const isStep2RealHint = !isStep2FallbackOnly && !isStep2Spoiled && turn2.keiText.length > 5;

    const isStep3FallbackOnly = turn3.keiText.includes("자, 다시 낼게! 초성은");
    const isStep3Spoiled = currentWord && turn3.keiText.includes(currentWord);

    const resultData = {
      login: "성공",
      step1: {
        userInput: "초성게임 하자",
        keiText: turn1.keiText,
        dbChosung: currentChosung,
        dbWord: currentWord,
        hintLevel: hintLevel1,
        match: isChosungMatch,
      },
      step2: {
        userInput: "힌트 좀 알려줘",
        keiText: turn2.keiText,
        isRealHint: isStep2RealHint,
        isFallbackOnly: isStep2FallbackOnly,
        isSpoiled: isStep2Spoiled,
        dbHintLevel: hintLevel2,
      },
      step3: {
        userInput: wrongAnswer,
        keiText: turn3.keiText,
        isFallbackOnly: isStep3FallbackOnly,
        isSpoiled: isStep3Spoiled,
        dbHintLevel: hintLevel3,
      },
      dbTop3,
    };

    fs.writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(resultData, null, 2));
    console.log("\n=======================================================");
    console.log("[QA Summary Result Data]:\n", JSON.stringify(resultData, null, 2));
    console.log("=======================================================");
  });
});
