import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const EVIDENCE_DIR = "/tmp/agy-qa-009";

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
  console.log(`[API Response JSON]:`, JSON.stringify(resJson));

  return {
    resJson,
    keiText,
    bubbleText: bubbleText.trim(),
  };
}

test.describe("QA 009 Dev Single Runner Verification", () => {
  test.setTimeout(360_000); // 6 minutes

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

  test("Run Live Verification on Dev", async () => {
    // 1. Login
    await loginChild(page);
    await ensureChatInput(page);

    // =========================================================================
    // A. 초성게임이 DB 문제를 낸다
    // =========================================================================
    console.log("\n=======================================================");
    console.log("A. 초성게임 시작 및 DB 일치 검증");
    console.log("=======================================================");

    const startTurn = await sendChat(page, "초성게임 하자");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "a1-start.png"), fullPage: true });

    // DB Query immediately
    const dbRows1 = runDbQuery(`
      select current_word, current_chosung, state, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    console.log("[DB Query Result 1]:\n", JSON.stringify(dbRows1, null, 2));

    const latestDb1 = dbRows1 && dbRows1.length > 0 ? dbRows1[0] : null;
    const currentChosung1 = latestDb1 ? latestDb1.current_chosung : "";
    const currentWord1 = latestDb1 ? latestDb1.current_word : "";

    console.log(`[A1 Check] Screen Kei Text: "${startTurn.keiText}"`);
    console.log(`[A1 Check] DB current_chosung: "${currentChosung1}", DB current_word: "${currentWord1}"`);
    console.log(`[A1 Check] DB chosung in Kei Text? ${startTurn.keiText.includes(currentChosung1)}`);

    // Turn A-2: Wrong answer
    console.log("\n--- Turn A-2: 오답 제출 ('자동차') ---");
    const wrongTurn = await sendChat(page, "자동차");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "a2-wrong.png"), fullPage: true });

    const dbRows2 = runDbQuery(`
      select current_word, current_chosung, state, started_at at time zone 'Asia/Seoul' st 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    console.log("[DB Query Result 2]:\n", JSON.stringify(dbRows2, null, 2));

    const dbChosung2 = dbRows2?.[0]?.current_chosung || "";
    const dbWord2 = dbRows2?.[0]?.current_word || "";
    console.log(`[A2 Check] Screen Kei Text: "${wrongTurn.keiText}"`);
    console.log(`[A2 Check] DB current_chosung: "${dbChosung2}", DB current_word: "${dbWord2}"`);
    console.log(`[A2 Check] DB chosung in Kei Text? ${wrongTurn.keiText.includes(dbChosung2)}`);

    // =========================================================================
    // C. 힌트와 답 요구가 구분된다
    // =========================================================================
    console.log("\n=======================================================");
    console.log("C. 힌트 요청 및 답 요구 분리 검증");
    console.log("=======================================================");

    // C1: 힌트 요청
    console.log("\n--- Turn C-1: 힌트 요청 ('힌트 좀 알려줘') ---");
    const hintTurn = await sendChat(page, "힌트 좀 알려줘");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "c1-hint.png"), fullPage: true });

    const dbRowsHint = runDbQuery(`
      select current_word, current_chosung, state 
      from chosung_game_sessions 
      where child_id='${CHILD_ID}' 
      order by started_at desc limit 1;
    `);
    const wordAtHint = dbRowsHint?.[0]?.current_word || dbWord2;
    const hasSpoiler = wordAtHint ? hintTurn.keiText.includes(wordAtHint) : false;
    console.log(`[C1 Check] Hint Text: "${hintTurn.keiText}"`);
    console.log(`[C1 Check] DB Word: "${wordAtHint}"`);
    console.log(`[C1 Check] Has Answer Spoiler? ${hasSpoiler}`);

    // C2: 답 요구
    console.log("\n--- Turn C-2: 답 요구 ('답이 뭐야') ---");
    const answerTurn = await sendChat(page, "답이 뭐야");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "c2-answer.png"), fullPage: true });

    const answerRevealed = wordAtHint ? answerTurn.keiText.includes(wordAtHint) : false;
    console.log(`[C2 Check] Answer Text: "${answerTurn.keiText}"`);
    console.log(`[C2 Check] Expected Word: "${wordAtHint}"`);
    console.log(`[C2 Check] Was Answer Revealed? ${answerRevealed}`);

    // =========================================================================
    // B. "응" 에 "못 알아들었어" 라고 하지 않는다
    // =========================================================================
    console.log("\n=======================================================");
    console.log("B. '응', '어', '네' 인식 검증");
    console.log("=======================================================");

    const bResults: Array<{ user: string; kei: string; isUnclear: boolean }> = [];
    const affirmations = ["응", "어", "네"];

    for (const aff of affirmations) {
      console.log(`\n--- Turn B ('${aff}') ---`);
      const affTurn = await sendChat(page, aff);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `b-${aff}.png`), fullPage: true });

      const isUnclear = /잘 안 들렸|다시 말해|뭐라고|못 들었|안 들려/.test(affTurn.keiText);
      console.log(`[B Check] User: "${aff}", Kei: "${affTurn.keiText}", IsUnclear: ${isUnclear}`);
      bResults.push({
        user: aff,
        kei: affTurn.keiText,
        isUnclear,
      });
    }

    // Save final report to /tmp/agy-qa-009/report.json
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "report.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          itemA: {
            turn1: { kei: startTurn.keiText, dbChosung: currentChosung1, dbWord: currentWord1 },
            turn2: { kei: wrongTurn.keiText, dbChosung: dbChosung2, dbWord: dbWord2 },
          },
          itemB: bResults,
          itemC_hint: {
            kei: hintTurn.keiText,
            dbWord: wordAtHint,
            hasSpoiler,
          },
          itemC_answer: {
            kei: answerTurn.keiText,
            dbWord: wordAtHint,
            answerRevealed,
          },
        },
        null,
        2
      )
    );
  });
});
