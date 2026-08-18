import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const LOG_DIR = "/tmp/agy-qa-008b";

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

async function hideTelemetryOverlay(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
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
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(1500);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  await hideTelemetryOverlay(page);
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[goToChat] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`\n[sendChatMessage] Child: "${message}"`);
  const startTime = Date.now();
  await hideTelemetryOverlay(page);
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/voice/respond") && res.request().method() === "POST",
      { timeout: 45000 }
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

test.describe("008 Re-QA: QA-4 Hint Flow Verification", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Verify QA-4 3-Turn Wrong Answer Flow + Explicit Hint Request", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    // ==========================================
    // Part 1: 오답 3회 흐름 (한 문제로 끝까지)
    // ==========================================
    console.log("\n==========================================");
    console.log("[PART 1] 3-Turn Wrong Answer Flow Verification");
    console.log("==========================================");

    const preStartTimestampRes = runQuery("SELECT now() as t;");
    const preStartTimestamp = preStartTimestampRes[0].t;

    // 1. "수수께끼 하자" 시작
    const startRes = await sendChatMessage(page, "수수께끼 하자");
    await page.screenshot({ path: `${LOG_DIR}/01_game_start.png` });

    // 2. DB에서 방금 시작된 세션 및 질문 정보 확인
    const querySql = `
      SELECT s.id AS session_id, s.hint_level, s.current_question_id, s.state,
             q.id AS q_id, q.question, q.canonical_answer, q.hint_1, q.hint_2
      FROM nonsense_game_sessions s
      JOIN nonsense_questions q ON q.id=s.current_question_id
      WHERE s.child_id='${CHILD_A_ID}' AND s.started_at >= '${preStartTimestamp}'
      ORDER BY s.started_at DESC LIMIT 1;
    `;
    const sessionRes = runQuery(querySql);
    console.log("[DB Session & Question Info]:", JSON.stringify(sessionRes, null, 2));

    if (!sessionRes || sessionRes.length === 0) {
      throw new Error("Failed to find active nonsense game session in DB!");
    }

    const initialSession = sessionRes[0];
    const sessionId = initialSession.session_id;
    const qId = initialSession.q_id || initialSession.current_question_id;
    const questionText = initialSession.question;
    const canonicalAnswer = initialSession.canonical_answer;
    const hint1 = initialSession.hint_1;
    const hint2 = initialSession.hint_2;

    console.log(`\nActive Game Question:`);
    console.log(`- ID: ${qId}`);
    console.log(`- Question: ${questionText}`);
    console.log(`- Canonical Answer: ${canonicalAnswer}`);
    console.log(`- Hint 1: ${hint1}`);
    console.log(`- Hint 2: ${hint2}`);

    const results: any = {
      questionInfo: {
        id: qId,
        question: questionText,
        canonical_answer: canonicalAnswer,
        hint_1: hint1,
        hint_2: hint2,
      },
      turns: [],
    };

    // 3. 오답 1
    const wrongWord1 = "바나나123";
    const resWrong1 = await sendChatMessage(page, wrongWord1);
    await page.screenshot({ path: `${LOG_DIR}/02_wrong_turn1.png` });

    const dbAfterTurn1 = runQuery(`SELECT hint_level, current_question_id, state, ended_at FROM nonsense_game_sessions WHERE id='${sessionId}';`);
    console.log("[DB After Turn 1]:", JSON.stringify(dbAfterTurn1, null, 2));
    const t1 = dbAfterTurn1 && dbAfterTurn1[0];

    const turn1HintLevelOk = t1?.hint_level === 1;
    const turn1AnswerNotExposed = !resWrong1.kText.includes(canonicalAnswer);
    const turn1SameQuestion = t1?.current_question_id === qId;

    results.turns.push({
      turn: 1,
      userUtterance: wrongWord1,
      kText: resWrong1.kText,
      hint_level: t1?.hint_level,
      current_question_id: t1?.current_question_id,
      state: t1?.state,
      ended_at: t1?.ended_at,
      pass: turn1HintLevelOk && turn1AnswerNotExposed && turn1SameQuestion,
    });

    // 4. 오답 2
    const wrongWord2 = "사과456";
    const resWrong2 = await sendChatMessage(page, wrongWord2);
    await page.screenshot({ path: `${LOG_DIR}/03_wrong_turn2.png` });

    const dbAfterTurn2 = runQuery(`SELECT hint_level, current_question_id, state, ended_at FROM nonsense_game_sessions WHERE id='${sessionId}';`);
    console.log("[DB After Turn 2]:", JSON.stringify(dbAfterTurn2, null, 2));
    const t2 = dbAfterTurn2 && dbAfterTurn2[0];

    const turn2HintLevelOk = t2?.hint_level === 2;
    const turn2AnswerNotExposed = !resWrong2.kText.includes(canonicalAnswer);
    const turn2SameQuestion = t2?.current_question_id === qId;

    results.turns.push({
      turn: 2,
      userUtterance: wrongWord2,
      kText: resWrong2.kText,
      hint_level: t2?.hint_level,
      current_question_id: t2?.current_question_id,
      state: t2?.state,
      ended_at: t2?.ended_at,
      pass: turn2HintLevelOk && turn2AnswerNotExposed && turn2SameQuestion,
    });

    // 5. 오답 3
    const wrongWord3 = "우주선789";
    const resWrong3 = await sendChatMessage(page, wrongWord3);
    await page.screenshot({ path: `${LOG_DIR}/04_wrong_turn3.png` });

    const dbAfterTurn3 = runQuery(`SELECT hint_level, current_question_id, state, ended_at FROM nonsense_game_sessions WHERE id='${sessionId}';`);
    console.log("[DB After Turn 3]:", JSON.stringify(dbAfterTurn3, null, 2));
    const t3 = dbAfterTurn3 && dbAfterTurn3[0];

    const turn3AnswerExposed = resWrong3.kText.includes(canonicalAnswer);
    const turn3Ended = t3?.ended_at !== null || t3?.state === "ROUND_RESULT" || t3?.state === "ENDED";
    const turn3SameQuestion = t3?.current_question_id === qId;

    results.turns.push({
      turn: 3,
      userUtterance: wrongWord3,
      kText: resWrong3.kText,
      hint_level: t3?.hint_level,
      current_question_id: t3?.current_question_id,
      state: t3?.state,
      ended_at: t3?.ended_at,
      pass: turn3AnswerExposed && turn3Ended && turn3SameQuestion,
    });

    // ==========================================
    // Part 2: 명시적 "힌트 줘" 요청 경로 회귀 확인
    // ==========================================
    console.log("\n==========================================");
    console.log("[PART 2] Explicit '힌트 줘' Request Verification");
    console.log("==========================================");

    const preStartTimestampRes2 = runQuery("SELECT now() as t;");
    const preStartTimestamp2 = preStartTimestampRes2[0].t;

    // 새 게임 시작
    const startRes2 = await sendChatMessage(page, "수수께끼 하자");
    await page.screenshot({ path: `${LOG_DIR}/05_explicit_hint_game_start.png` });

    const querySql2 = `
      SELECT s.id AS session_id, s.hint_level, s.current_question_id, s.state,
             q.id AS q_id, q.question, q.canonical_answer, q.hint_1, q.hint_2
      FROM nonsense_game_sessions s
      JOIN nonsense_questions q ON q.id=s.current_question_id
      WHERE s.child_id='${CHILD_A_ID}' AND s.started_at >= '${preStartTimestamp2}'
      ORDER BY s.started_at DESC LIMIT 1;
    `;
    const sessionRes2 = runQuery(querySql2);
    console.log("[DB Part 2 Session Info]:", JSON.stringify(sessionRes2, null, 2));

    if (!sessionRes2 || sessionRes2.length === 0) {
      throw new Error("Failed to find new active nonsense game session in DB for Part 2!");
    }

    const s2 = sessionRes2[0];
    const s2Id = s2.session_id;
    const s2qId = s2.q_id || s2.current_question_id;
    const s2Hint1 = s2.hint_1;
    const s2Canonical = s2.canonical_answer;

    // "힌트 줘" 발화
    const hintReqRes = await sendChatMessage(page, "힌트 줘");
    await page.screenshot({ path: `${LOG_DIR}/06_explicit_hint_req.png` });

    const dbAfterHintReq = runQuery(`SELECT hint_level, current_question_id, state, ended_at FROM nonsense_game_sessions WHERE id='${s2Id}';`);
    console.log("[DB After Explicit Hint Req]:", JSON.stringify(dbAfterHintReq, null, 2));

    const s2Check = dbAfterHintReq && dbAfterHintReq[0];
    const explicitHintLevelOk = s2Check?.hint_level === 1;
    const explicitAnswerNotExposed = !hintReqRes.kText.includes(s2Canonical);

    results.explicitHint = {
      qId: s2qId,
      question: s2.question,
      canonical_answer: s2Canonical,
      hint_1: s2Hint1,
      kText: hintReqRes.kText,
      hint_level: s2Check?.hint_level,
      current_question_id: s2Check?.current_question_id,
      state: s2Check?.state,
      pass: explicitHintLevelOk && explicitAnswerNotExposed,
    };

    // 결과 파일 저장
    fs.writeFileSync(`${LOG_DIR}/qa4_results.json`, JSON.stringify(results, null, 2));
    console.log(`\nSaved test results to ${LOG_DIR}/qa4_results.json`);
  });
});
