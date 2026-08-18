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
const LOG_DIR = "/tmp/agy-qa-mission-nogame";

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
  await page.waitForTimeout(1200);

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

async function goToMission(page: import("@playwright/test").Page) {
  console.log(`[goToMission] Navigating to ${BASE}/child/missions...`);
  await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(2000);

  // Modal dismiss if any
  const modalCloseBtn = page.getByRole("button", { name: /이벤트 확인했어요|이벤트 확인|닫기|나중에/ });
  if (await modalCloseBtn.count().catch(() => 0)) {
    await modalCloseBtn.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Start / Resume button (ConversationStartButton)
  const startBtn = page.getByRole("button", { name: /시작하기|이어하기|오늘의 미션|대화 시작|미션 시작/ });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("[goToMission] Clicking start/resume mission button...");
    await startBtn.click({ force: true });
    await page.waitForTimeout(3000);
  }

  // Wait for bubble or active state
  await page.waitForSelector('div[data-ui="current-bubble"]', { timeout: 15000 }).catch(() => {});

  // Text mode switch
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log("[goToMission] Clicking keyboard button...");
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 15000 });
  console.log("[goToMission] Mission text input ready!");
}

async function sendMissionMessage(page: import("@playwright/test").Page, message: string) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`\n[sendMissionMessage] Child (Mission): "${message}"`);
  const startTime = Date.now();
  await hideTelemetryOverlay(page);

  const [turnResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        (r.url().includes("/api/mission/v3/turn") ||
          r.url().includes("/api/mission/turn") ||
          r.url().includes("/api/voice/respond")) &&
        r.request().method() === "POST",
      { timeout: 60000 }
    ),
    page.locator('button[aria-label="전송"]').click({ force: true }),
  ]);
  const latencyMs = Date.now() - startTime;

  const json = await turnResponse.json().catch(() => ({}));
  await page.waitForTimeout(1500);

  // Check bubble text from mission layout
  const bubble = page.locator('div[data-ui="current-bubble"] p');
  const bubbleText = (await bubble.textContent().catch(() => "")) || "";
  const kText = (json.kMessage || json.kResponse || json.text || bubbleText).trim();
  console.log(`[sendMissionMessage] K (${latencyMs}ms): "${kText}" (bubble: "${bubbleText.trim()}")`);

  return {
    kText: kText || bubbleText.trim(),
    bubbleText: bubbleText.trim(),
    status: turnResponse.status(),
    latencyMs,
    json,
  };
}

test.describe("Mission Game Blocking Dev QA", () => {
  test.setTimeout(600_000); // 10 minutes

  test("QA-1 to QA-5 Comprehensive Verification", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 0. Base time
    const timeRes = runQuery("SELECT now() as current_utc_time;");
    const baselineUtc = timeRes[0].current_utc_time;
    console.log(`[Setup] Baseline UTC: ${baselineUtc}`);

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);

    const results: Record<string, any> = {};

    // =========================================================================
    // QA-1. 자유대화 게임 세션을 열어둔 채 미션 진입 (핵심 재현)
    // =========================================================================
    console.log("\n=======================================================");
    console.log("QA-1. 자유대화 게임 세션을 열어둔 채 미션 진입");
    console.log("=======================================================");

    await goToChat(page);
    const startRes1 = await sendChatMessage(page, "끝말잇기 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "qa1_freechat_wordchain_start.png") });

    // Verify active word_chain_game_sessions exists
    const activeWordChainBefore = runQuery(`
      SELECT id, state, current_word, ended_at 
      FROM word_chain_game_sessions 
      WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;
    `);
    console.log("[QA-1 DB Active Before Mission]", JSON.stringify(activeWordChainBefore, null, 2));

    const hasActiveWordChain = activeWordChainBefore && activeWordChainBefore.length > 0;
    const wordChainSessionId = hasActiveWordChain ? activeWordChainBefore[0].id : null;

    if (!hasActiveWordChain) {
      console.error("[QA-1] ERROR: 활성 끝말잇기 세션이 생성되지 않았습니다.");
    }

    // Now WITHOUT ending the game, navigate directly to Mission
    await goToMission(page);
    await page.screenshot({ path: path.join(LOG_DIR, "qa1_mission_entered.png") });

    // Answer normally in mission
    const missionAnswerRes = await sendMissionMessage(page, "오늘 학교에서 그림 그렸어");
    await page.screenshot({ path: path.join(LOG_DIR, "qa1_mission_first_answer.png") });

    // Check if K output word chain rules/words/dictionary complaints
    const badKeywords = ["끝말잇기", "사전에 없는", "단어", "글자", "차례야", "이어", "첫 글자"];
    const containsWordChainNoise = badKeywords.some((kw) => missionAnswerRes.kText.includes(kw));

    // Check if word chain session is now ended
    const wordChainAfter = runQuery(`
      SELECT id, state, ended_at 
      FROM word_chain_game_sessions 
      WHERE child_id='${CHILD_A_ID}' 
      ORDER BY started_at DESC LIMIT 1;
    `);
    console.log("[QA-1 DB Word Chain After Mission Entry]", JSON.stringify(wordChainAfter, null, 2));

    const isWordChainEnded = wordChainAfter && wordChainAfter.length > 0 && wordChainAfter[0].ended_at !== null;
    const qa1Pass = hasActiveWordChain && !containsWordChainNoise && isWordChainEnded;

    results["QA-1"] = {
      pass: qa1Pass,
      hasActiveWordChainBefore: hasActiveWordChain,
      wordChainSessionId,
      kText: missionAnswerRes.kText,
      containsWordChainNoise,
      isWordChainEnded,
      wordChainAfter,
    };
    console.log(`[QA-1 Check Result] PASS=${qa1Pass} (ActiveBefore=${hasActiveWordChain}, NoNoise=${!containsWordChainNoise}, EndedAfter=${isWordChainEnded})`);

    // =========================================================================
    // QA-2. 미션 중 게임 요청 ("끝말잇기 하자", "초성게임 하자", "수수께끼 하자")
    // =========================================================================
    console.log("\n=======================================================");
    console.log("QA-2. 미션 중 게임 요청");
    console.log("=======================================================");

    const missionStartTimeRes = runQuery("SELECT now() as t;");
    const missionReqBaseline = missionStartTimeRes[0].t;

    const gameRequests = ["끝말잇기 하자", "초성게임 하자", "수수께끼 하자"];
    const qa2Logs: any[] = [];
    let qa2Pass = true;

    for (let i = 0; i < gameRequests.length; i++) {
      const utt = gameRequests[i];
      const res = await sendMissionMessage(page, utt);
      await page.screenshot({ path: path.join(LOG_DIR, `qa2_game_req_${i + 1}.png`) });

      // Check DB for any newly started sessions
      const sessionsCheck = runQuery(`
        SELECT 'chosung' g, count(*) FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}' AND started_at >= '${missionReqBaseline}'
        UNION ALL SELECT 'wordchain', count(*) FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' AND started_at >= '${missionReqBaseline}'
        UNION ALL SELECT 'nonsense', count(*) FROM nonsense_game_sessions WHERE child_id='${CHILD_A_ID}' AND started_at >= '${missionReqBaseline}';
      `);
      console.log(`[QA-2 DB Check for "${utt}"]`, JSON.stringify(sessionsCheck, null, 2));

      const totalNewSessions = sessionsCheck?.reduce((acc: number, cur: any) => acc + Number(cur.count), 0) ?? 0;
      const isSilent = !res.kText || res.kText.trim() === "";

      // Check if K started giving quiz problems or chosung
      const isProblemOrChosungStarted =
        res.kText.includes("초성") && (res.kText.includes("맞혀") || res.kText.includes("문제")) ||
        res.kText.includes("수수께끼 문제") ||
        res.kText.includes("단어로 시작할게");

      const stepPass = totalNewSessions === 0 && !isSilent && !isProblemOrChosungStarted;
      if (!stepPass) {
        qa2Pass = false;
      }

      qa2Logs.push({
        utt,
        kText: res.kText,
        totalNewSessions,
        isSilent,
        isProblemOrChosungStarted,
        stepPass,
      });
    }

    results["QA-2"] = {
      pass: qa2Pass,
      logs: qa2Logs,
    };
    console.log(`[QA-2 Check Result] PASS=${qa2Pass}`);

    // =========================================================================
    // QA-3. 미션 중 놀이 제안 ("심심해", "뭐 하고 놀까")
    // =========================================================================
    console.log("\n=======================================================");
    console.log("QA-3. 미션 중 놀이 제안");
    console.log("=======================================================");

    const playProposals = ["심심해", "뭐 하고 놀까"];
    const qa3Logs: any[] = [];
    let qa3Pass = true;

    for (let i = 0; i < playProposals.length; i++) {
      const utt = playProposals[i];
      const res = await sendMissionMessage(page, utt);
      await page.screenshot({ path: path.join(LOG_DIR, `qa3_play_proposal_${i + 1}.png`) });

      // Check if K proposed chosung / word chain / nonsense quiz
      const proposedForbiddenGames =
        res.kText.includes("초성게임") ||
        res.kText.includes("끝말잇기") ||
        res.kText.includes("수수께끼") ||
        res.kText.includes("넌센스");

      const stepPass = !proposedForbiddenGames && !!res.kText;
      if (!stepPass) {
        qa3Pass = false;
      }

      qa3Logs.push({
        utt,
        kText: res.kText,
        proposedForbiddenGames,
        stepPass,
      });
    }

    results["QA-3"] = {
      pass: qa3Pass,
      logs: qa3Logs,
    };
    console.log(`[QA-3 Check Result] PASS=${qa3Pass}`);

    // =========================================================================
    // QA-4. 자유대화 회귀 (끝말잇기 정상 시작, 수수께끼 정상 시작, 심심해 제안)
    // =========================================================================
    console.log("\n=======================================================");
    console.log("QA-4. 자유대화 회귀 검증");
    console.log("=======================================================");

    await goToChat(page);
    let qa4Pass = true;
    const qa4Logs: any[] = [];

    // 1) "끝말잇기 하자"
    const freechatPreTime1Res = runQuery("SELECT now() as t;");
    const freechatPreTime1 = freechatPreTime1Res[0].t;

    const wcRes = await sendChatMessage(page, "끝말잇기 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "qa4_wordchain_regression.png") });

    const wcSessionCheck = runQuery(`
      SELECT id, state, current_word, ended_at 
      FROM word_chain_game_sessions 
      WHERE child_id='${CHILD_A_ID}' AND started_at >= '${freechatPreTime1}'
      ORDER BY started_at DESC LIMIT 1;
    `);
    console.log("[QA-4 Word Chain DB Check]", JSON.stringify(wcSessionCheck, null, 2));

    const wcStartedOk = wcSessionCheck && wcSessionCheck.length > 0 && wcSessionCheck[0].ended_at === null;
    qa4Logs.push({ step: "wordchain_start", kText: wcRes.kText, wcStartedOk, session: wcSessionCheck });
    if (!wcStartedOk) qa4Pass = false;

    // End word chain session cleanly
    await sendChatMessage(page, "그만할래");
    await page.screenshot({ path: path.join(LOG_DIR, "qa4_wordchain_end.png") });

    // 2) "수수께끼 하자"
    const freechatPreTime2Res = runQuery("SELECT now() as t;");
    const freechatPreTime2 = freechatPreTime2Res[0].t;

    const quizRes = await sendChatMessage(page, "수수께끼 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "qa4_nonsense_regression.png") });

    const quizSessionCheck = runQuery(`
      SELECT id, state, current_question_id, ended_at 
      FROM nonsense_game_sessions 
      WHERE child_id='${CHILD_A_ID}' AND started_at >= '${freechatPreTime2}'
      ORDER BY started_at DESC LIMIT 1;
    `);
    console.log("[QA-4 Nonsense Quiz DB Check]", JSON.stringify(quizSessionCheck, null, 2));

    const quizStartedOk = quizSessionCheck && quizSessionCheck.length > 0 && quizSessionCheck[0].ended_at === null;
    qa4Logs.push({ step: "nonsense_start", kText: quizRes.kText, quizStartedOk, session: quizSessionCheck });
    if (!quizStartedOk) qa4Pass = false;

    // End nonsense session cleanly
    await sendChatMessage(page, "그만할래");
    await page.screenshot({ path: path.join(LOG_DIR, "qa4_nonsense_end.png") });

    // 3) "심심해" -> check if play proposal appears in free chat
    const boredRes = await sendChatMessage(page, "심심해");
    await page.screenshot({ path: path.join(LOG_DIR, "qa4_bored_proposal.png") });

    const proposalAppeared =
      boredRes.kText.includes("게임") ||
      boredRes.kText.includes("놀") ||
      boredRes.kText.includes("수수께끼") ||
      boredRes.kText.includes("끝말잇기") ||
      boredRes.kText.includes("초성");

    qa4Logs.push({ step: "bored_proposal", kText: boredRes.kText, proposalAppeared });
    console.log(`[QA-4 Bored Response] "${boredRes.kText}"`);

    results["QA-4"] = {
      pass: qa4Pass,
      logs: qa4Logs,
    };
    console.log(`[QA-4 Check Result] PASS=${qa4Pass}`);

    // =========================================================================
    // QA-5. 저장 검증 및 공통 검사
    // =========================================================================
    console.log("\n=======================================================");
    console.log("QA-5. 저장 검증 및 공통 검사");
    console.log("=======================================================");

    // 1) Active games count across all 3 game tables
    const activeGamesCheck = runQuery(`
      SELECT 'chosung' g, count(*) FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
      UNION ALL SELECT 'wordchain', count(*) FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
      UNION ALL SELECT 'nonsense', count(*) FROM nonsense_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;
    `);
    console.log("[QA-5 Active Games]", JSON.stringify(activeGamesCheck, null, 2));

    // 2) Message counts by role in current chat session
    const recentChatSession = runQuery(`
      SELECT id FROM chat_sessions WHERE child_id='${CHILD_A_ID}' ORDER BY started_at DESC LIMIT 1;
    `);
    const recentSessionId = recentChatSession?.[0]?.id;

    const countCheck = runQuery(`
      SELECT role, count(*) FROM chat_messages 
      WHERE session_id='${recentSessionId}' AND deleted_at IS NULL 
      GROUP BY role;
    `);
    console.log("[QA-5 Message Counts for Session]", JSON.stringify(countCheck, null, 2));

    const totalActiveGames = activeGamesCheck?.reduce((acc: number, cur: any) => acc + Number(cur.count), 0) ?? 0;
    const qa5Pass = totalActiveGames <= 1;

    results["QA-5"] = {
      pass: qa5Pass,
      activeGamesCheck,
      countCheck,
    };
    console.log(`[QA-5 Check Result] PASS=${qa5Pass} (ActiveGames=${totalActiveGames})`);

    // Write full result summary
    fs.writeFileSync(path.join(LOG_DIR, "results.json"), JSON.stringify(results, null, 2));
    console.log("\n[QA Completed] Full results saved to /tmp/agy-qa-mission-nogame/results.json");
  });
});
