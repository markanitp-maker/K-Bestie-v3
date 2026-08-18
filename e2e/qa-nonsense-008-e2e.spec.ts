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
const LOG_DIR = "/tmp/agy-qa-008";

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

test.describe("008 Dev E2E QA: Nonsense Quiz Full Verification", () => {
  test.setTimeout(600_000); // 10 minutes

  test("Execute QA-1 to QA-10", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 기준시각 확인
    const timeRes = runQuery("SELECT now() as current_utc_time;");
    const baselineUtc = timeRes[0].current_utc_time;
    console.log(`[Setup] Baseline UTC: ${baselineUtc}`);

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    // Chat session id 조회
    const sessionRes = runQuery(`SELECT id, started_at FROM chat_sessions WHERE child_id='${CHILD_A_ID}' ORDER BY started_at DESC LIMIT 1;`);
    const chatSessionId = sessionRes && sessionRes[0] ? sessionRes[0].id : "unknown";
    console.log(`[Setup] Chat Session ID: ${chatSessionId}`);

    const results: Record<string, any> = {};

    // ----------------------------------------------------
    // QA-7. Hard Guard — 가짜 게임 (임의 생성 0건)
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-7. Hard Guard — 가짜 게임 방지");
    console.log("==========================================");
    {
      const guardUtterances = [
        "심심해",
        "오늘 급식 맛있었어",
        "넌센스가 뭐야?",
        "친구가 수수께끼 하자고 했어",
        "수수께끼 내지 마",
        "엄마가 수수께끼 내줬어",
      ];

      let qa7Pass = true;
      const guardLogs: any[] = [];

      for (const utt of guardUtterances) {
        const preTimeRes = runQuery("SELECT now() as t;");
        const preTime = preTimeRes[0].t;

        const res = await sendChatMessage(page, utt);

        const checkSession = runQuery(`
          SELECT count(*) FROM nonsense_game_sessions
          WHERE child_id='${CHILD_A_ID}' AND started_at >= '${preTime}';
        `);
        const sessionCount = checkSession ? Number(checkSession[0].count) : -1;

        const checkQuestions = runQuery(`
          SELECT id, question FROM nonsense_questions
          WHERE position(question in '${res.kText.replace(/'/g, "''")}') > 0 LIMIT 1;
        `);
        const isProblemAsked = checkQuestions && checkQuestions.length > 0;

        console.log(`[QA-7 Guard] "${utt}" -> SessionCount: ${sessionCount}, ProblemAsked: ${isProblemAsked}, K: "${res.kText}"`);

        guardLogs.push({
          utt,
          kText: res.kText,
          sessionCount,
          isProblemAsked,
        });

        if (sessionCount > 0 || isProblemAsked) {
          qa7Pass = false;
        }
      }

      results["QA-7"] = {
        pass: qa7Pass,
        logs: guardLogs,
      };
      await page.screenshot({ path: `${LOG_DIR}/qa7_hard_guard.png` });
    }

    // ----------------------------------------------------
    // QA-1, QA-2, QA-3, QA-4: 시작 라우팅 + 학년 필터 + PRESENTED 기록 + 힌트 흐름
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-1 ~ QA-4. 시작 라우팅, 학년 필터, PRESENTED, 힌트 흐름");
    console.log("==========================================");
    {
      const startPreTimeRes = runQuery("SELECT now() as t;");
      const startPreTime = startPreTimeRes[0].t;

      const res1 = await sendChatMessage(page, "수수께끼 하자");
      await page.screenshot({ path: `${LOG_DIR}/qa1_start.png` });

      // DB 세션 확인
      const sessionCheck = runQuery(`
        SELECT id, state, current_question_id, hint_level, initiated_by, started_at
        FROM nonsense_game_sessions
        WHERE child_id='${CHILD_A_ID}' AND started_at >= '${startPreTime}'
        ORDER BY started_at DESC LIMIT 1;
      `);

      console.log("[QA-1 Session DB]", JSON.stringify(sessionCheck, null, 2));

      let qa1Pass = false;
      let qa2Pass = false;
      let qa3Pass = false;
      let qInfo: any = null;
      let gameSessionId = "";

      if (sessionCheck && sessionCheck.length > 0) {
        const s = sessionCheck[0];
        gameSessionId = s.id;
        const qId = s.current_question_id;

        // 질문 정보 가져오기
        const qRes = runQuery(`
          SELECT id, question, canonical_answer, accepted_answers, hint_1, hint_2, min_grade, max_grade, status, child_safe
          FROM nonsense_questions WHERE id='${qId}';
        `);
        if (qRes && qRes.length > 0) {
          qInfo = qRes[0];
          console.log("[QA-1 Question Info]", JSON.stringify(qInfo, null, 2));

          const questionInKText = res1.kText.includes(qInfo.question);
          const answerExposed = res1.kText.includes(qInfo.canonical_answer);
          const hintLevelZero = s.hint_level === 0;

          qa1Pass = Boolean(questionInKText && !answerExposed && hintLevelZero);
          console.log(`[QA-1 Check] questionInKText: ${questionInKText}, answerExposed: ${answerExposed}, hintLevelZero: ${hintLevelZero} -> QA-1: ${qa1Pass}`);

          // QA-2 검증: 학년 필터 (min_grade <= 3 <= max_grade, status='ACTIVE', child_safe=true)
          const gradeOk = qInfo.min_grade <= 3 && qInfo.max_grade >= 3;
          const statusOk = qInfo.status === "ACTIVE";
          const safeOk = qInfo.child_safe === true;
          qa2Pass = gradeOk && statusOk && safeOk;
          console.log(`[QA-2 Check] gradeOk: ${gradeOk} (${qInfo.min_grade}~${qInfo.max_grade}), statusOk: ${statusOk}, safeOk: ${safeOk} -> QA-2: ${qa2Pass}`);

          // QA-3 검증: PRESENTED 즉시 기록
          const histCheck = runQuery(`
            SELECT question_id, outcome, presented_at, answered_at, hint_count
            FROM nonsense_question_history
            WHERE child_id='${CHILD_A_ID}' AND game_session_id='${gameSessionId}'
            ORDER BY presented_at DESC LIMIT 1;
          `);
          console.log("[QA-3 History DB]", JSON.stringify(histCheck, null, 2));
          if (histCheck && histCheck.length > 0) {
            const h = histCheck[0];
            qa3Pass = h.question_id === qId && h.outcome === "PRESENTED" && h.answered_at === null;
          }
          console.log(`[QA-3 Check] qa3Pass: ${qa3Pass}`);
        }
      }

      results["QA-1"] = { pass: qa1Pass, session: sessionCheck, question: qInfo, kText: res1.kText };
      results["QA-2"] = { pass: qa2Pass, question: qInfo };
      results["QA-3"] = { pass: qa3Pass };

      // QA-4: 힌트 흐름 (오답 1 -> 힌트 1 요청 -> 오답 2 -> 힌트 2 요청 -> 정답 공개)
      console.log("\n==========================================");
      console.log("QA-4. 힌트 흐름 검증");
      console.log("==========================================");

      let qa4Pass = false;
      const hintLogs: any[] = [];

      if (qInfo && gameSessionId) {
        // Step 1: 오답 발화
        const wrong1Res = await sendChatMessage(page, "틀린답1이야");
        await page.screenshot({ path: `${LOG_DIR}/qa4_wrong1.png` });

        // Step 2: 힌트 1 요청
        const hint1Res = await sendChatMessage(page, "힌트 줘");
        await page.screenshot({ path: `${LOG_DIR}/qa4_hint1.png` });
        const s1Check = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`);
        console.log("[QA-4 Hint 1 DB]", JSON.stringify(s1Check, null, 2));

        const s1 = s1Check && s1Check[0];
        const s1HintLevel = s1 ? s1.hint_level : -1;
        const s1QidKeep = s1 ? s1.current_question_id === qInfo.id : false;
        const answerExposed1 = hint1Res.kText.includes(qInfo.canonical_answer);

        hintLogs.push({
          step: "hint1",
          kText: hint1Res.kText,
          hintLevel: s1HintLevel,
          qidKeep: s1QidKeep,
          answerExposed: answerExposed1,
        });

        // Step 3: 두 번째 오답 발화
        const wrong2Res = await sendChatMessage(page, "틀린답2인가");
        await page.screenshot({ path: `${LOG_DIR}/qa4_wrong2.png` });

        // Step 4: 힌트 2 요청
        const hint2Res = await sendChatMessage(page, "힌트 더 줘");
        await page.screenshot({ path: `${LOG_DIR}/qa4_hint2.png` });
        const s2Check = runQuery(`SELECT id, current_question_id, hint_level, state FROM nonsense_game_sessions WHERE id='${gameSessionId}';`);
        console.log("[QA-4 Hint 2 DB]", JSON.stringify(s2Check, null, 2));

        const s2 = s2Check && s2Check[0];
        const s2HintLevel = s2 ? s2.hint_level : -1;
        const s2QidKeep = s2 ? s2.current_question_id === qInfo.id : false;
        const answerExposed2 = hint2Res.kText.includes(qInfo.canonical_answer);

        hintLogs.push({
          step: "hint2",
          kText: hint2Res.kText,
          hintLevel: s2HintLevel,
          qidKeep: s2QidKeep,
          answerExposed: answerExposed2,
        });

        // Step 5: 정답 공개 요청
        const wrong3Res = await sendChatMessage(page, "도저히 모르겠어 정답 알려줘");
        await page.screenshot({ path: `${LOG_DIR}/qa4_wrong3_reveal.png` });
        const s3Check = runQuery(`SELECT id, state, current_question_id, hint_level FROM nonsense_game_sessions WHERE id='${gameSessionId}';`);
        console.log("[QA-4 Step 3 DB]", JSON.stringify(s3Check, null, 2));

        const answerRevealed = wrong3Res.kText.includes(qInfo.canonical_answer);
        hintLogs.push({
          step: "reveal",
          kText: wrong3Res.kText,
          answerRevealed,
        });

        const step1Ok = s1HintLevel === 1 && s1QidKeep && !answerExposed1;
        const step2Ok = s2HintLevel === 2 && s2QidKeep && !answerExposed2;
        const step3Ok = answerRevealed;

        qa4Pass = step1Ok && step2Ok && step3Ok;
        console.log(`[QA-4 Check] step1Ok: ${step1Ok}, step2Ok: ${step2Ok}, step3Ok: ${step3Ok} -> QA-4: ${qa4Pass}`);
      }

      results["QA-4"] = { pass: qa4Pass, hintLogs };

      // 세션 종료
      await sendChatMessage(page, "그만할래");
    }

    // ----------------------------------------------------
    // QA-5. 정답 판정 (실제 canonical_answer 입력)
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-5. 정답 판정");
    console.log("==========================================");
    {
      const startPreTimeRes = runQuery("SELECT now() as t;");
      const startPreTime = startPreTimeRes[0].t;

      const resStart = await sendChatMessage(page, "수수께끼 하자");
      const sessionCheck = runQuery(`
        SELECT id, state, current_question_id, hint_level, initiated_by, started_at
        FROM nonsense_game_sessions
        WHERE child_id='${CHILD_A_ID}' AND started_at >= '${startPreTime}'
        ORDER BY started_at DESC LIMIT 1;
      `);

      let qa5Pass = false;
      let ansResText = "";
      let histCheck: any = null;

      if (sessionCheck && sessionCheck.length > 0) {
        const s = sessionCheck[0];
        const qId = s.current_question_id;
        const qRes = runQuery(`SELECT id, question, canonical_answer FROM nonsense_questions WHERE id='${qId}';`);
        if (qRes && qRes.length > 0) {
          const canonicalAnswer = qRes[0].canonical_answer;
          console.log(`[QA-5] Answering with canonical answer: "${canonicalAnswer}"`);

          const ansRes = await sendChatMessage(page, canonicalAnswer);
          ansResText = ansRes.kText;
          await page.screenshot({ path: `${LOG_DIR}/qa5_correct_answer.png` });

          // outcome, answered_at 확인
          histCheck = runQuery(`
            SELECT question_id, outcome, presented_at, answered_at, hint_count
            FROM nonsense_question_history
            WHERE child_id='${CHILD_A_ID}' AND question_id='${qId}'
            ORDER BY presented_at DESC LIMIT 1;
          `);
          console.log("[QA-5 History DB]", JSON.stringify(histCheck, null, 2));

          const isTeacherTone = ansRes.kText.includes("정답입니다") || ansRes.kText.includes("훌륭합니다");
          const outcomeCorrect = histCheck && histCheck.length > 0 && (histCheck[0].outcome === "ANSWERED_CORRECT" || histCheck[0].outcome === "ANSWERED");
          const answeredAtFilled = histCheck && histCheck.length > 0 && histCheck[0].answered_at !== null;

          qa5Pass = outcomeCorrect && answeredAtFilled && !isTeacherTone;
          console.log(`[QA-5 Check] outcomeCorrect: ${outcomeCorrect}, answeredAtFilled: ${answeredAtFilled}, isTeacherTone: ${isTeacherTone} -> QA-5: ${qa5Pass}`);
        }
      }

      results["QA-5"] = { pass: qa5Pass, kText: ansResText, history: histCheck };

      // 세션 정리
      await sendChatMessage(page, "그만할래");
    }

    // ----------------------------------------------------
    // QA-8. Topic Shift / Safety
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-8. Topic Shift / Safety");
    console.log("==========================================");
    {
      const startPreTimeRes = runQuery("SELECT now() as t;");
      const startPreTime = startPreTimeRes[0].t;

      await sendChatMessage(page, "수수께끼 하자");
      const sessionCheck = runQuery(`
        SELECT id, state, current_question_id
        FROM nonsense_game_sessions
        WHERE child_id='${CHILD_A_ID}' AND started_at >= '${startPreTime}'
        ORDER BY started_at DESC LIMIT 1;
      `);

      let qa8Pass = false;
      let shiftResText = "";
      let sessionAfter: any = null;

      if (sessionCheck && sessionCheck.length > 0) {
        const gameSessionId = sessionCheck[0].id;

        // 중간에 속상한 일 발화
        const shiftRes = await sendChatMessage(page, "오늘 학교에서 속상한 일 있었어");
        shiftResText = shiftRes.kText;
        await page.screenshot({ path: `${LOG_DIR}/qa8_topic_shift.png` });

        sessionAfter = runQuery(`SELECT id, state, ended_at FROM nonsense_game_sessions WHERE id='${gameSessionId}';`);
        console.log("[QA-8 Session DB After Shift]", JSON.stringify(sessionAfter, null, 2));

        const isWrongHandled = shiftRes.kText.includes("틀렸") || shiftRes.kText.includes("땡") || shiftRes.kText.includes("오답");
        const isGameRuleForced = shiftRes.kText.includes("수수께끼 풀어") || shiftRes.kText.includes("맞혀봐");
        const isEmpathy = shiftRes.kText.includes("속상") || shiftRes.kText.includes("무슨 일") || shiftRes.kText.includes("왜");

        // 일반 대화 2턴 진행
        const free1 = await sendChatMessage(page, "친구가 내 지우개를 말도 없이 가져갔어");
        const free2 = await sendChatMessage(page, "응 그래도 사과는 받았어");

        const sessionState = sessionAfter && sessionAfter[0] ? sessionAfter[0].state : "UNKNOWN";
        const stateValid = sessionState === "SUSPENDED" || sessionState === "ENDED";

        qa8Pass = !isWrongHandled && !isGameRuleForced && isEmpathy && stateValid;
        console.log(`[QA-8 Check] isWrongHandled: ${isWrongHandled}, isGameRuleForced: ${isGameRuleForced}, isEmpathy: ${isEmpathy}, state: ${sessionState} -> QA-8: ${qa8Pass}`);
      }

      results["QA-8"] = { pass: qa8Pass, kText: shiftResText, sessionState: sessionAfter };
    }

    // ----------------------------------------------------
    // QA-9. 종료 ("그만할래")
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-9. 종료 검증");
    console.log("==========================================");
    {
      const startPreTimeRes = runQuery("SELECT now() as t;");
      const startPreTime = startPreTimeRes[0].t;

      await sendChatMessage(page, "수수께끼 하자");
      const sessionCheck = runQuery(`
        SELECT id, state
        FROM nonsense_game_sessions
        WHERE child_id='${CHILD_A_ID}' AND started_at >= '${startPreTime}'
        ORDER BY started_at DESC LIMIT 1;
      `);

      let qa9Pass = false;
      let sessionAfter: any = null;

      if (sessionCheck && sessionCheck.length > 0) {
        const gameSessionId = sessionCheck[0].id;

        const stopRes = await sendChatMessage(page, "그만할래");
        await page.screenshot({ path: `${LOG_DIR}/qa9_stop.png` });

        sessionAfter = runQuery(`SELECT id, state, ended_at FROM nonsense_game_sessions WHERE id='${gameSessionId}';`);
        console.log("[QA-9 Session DB After Stop]", JSON.stringify(sessionAfter, null, 2));

        // 종료 후 일반 대화 1턴
        const postRes = await sendChatMessage(page, "오늘 날씨 좋다");
        const isQuestionAskedAfterStop = postRes.kText.includes("수수께끼") || postRes.kText.includes("문제");

        const s = sessionAfter && sessionAfter[0];
        const stateEnded = s && s.state === "ENDED" && s.ended_at !== null;

        qa9Pass = stateEnded && !isQuestionAskedAfterStop;
        console.log(`[QA-9 Check] stateEnded: ${stateEnded}, isQuestionAskedAfterStop: ${isQuestionAskedAfterStop} -> QA-9: ${qa9Pass}`);
      }

      results["QA-9"] = { pass: qa9Pass, session: sessionAfter };
    }

    // ----------------------------------------------------
    // QA-6. 180일 재출제 방지 (3회 추가 반복 후 중복 체크)
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-6. 180일 재출제 방지");
    console.log("==========================================");
    {
      for (let i = 0; i < 3; i++) {
        console.log(`[QA-6 Iteration ${i + 1}]`);
        await sendChatMessage(page, "수수께끼 하자");
        await sendChatMessage(page, "그만할래");
      }

      const dupCheck = runQuery(`
        SELECT question_id, count(*) FROM nonsense_question_history
        WHERE child_id='${CHILD_A_ID}' GROUP BY 1 HAVING count(*) > 1;
      `);
      console.log("[QA-6 Duplicate Question DB]", JSON.stringify(dupCheck, null, 2));

      const qa6Pass = dupCheck && dupCheck.length === 0;
      results["QA-6"] = { pass: qa6Pass, duplicates: dupCheck };
      console.log(`[QA-6 Check] duplicate count: ${dupCheck ? dupCheck.length : -1} -> QA-6: ${qa6Pass}`);
    }

    // ----------------------------------------------------
    // QA-10. 저장 검증 및 공통 검사
    // ----------------------------------------------------
    console.log("\n==========================================");
    console.log("QA-10. 저장 검증 및 공통 검사");
    console.log("==========================================");
    {
      // 1) 동시 활성 게임 체크
      const activeGames = runQuery(`
        SELECT 'chosung' g, count(*) FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
        UNION ALL SELECT 'wordchain', count(*) FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
        UNION ALL SELECT 'nonsense', count(*) FROM nonsense_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;
      `);
      console.log("[QA-10 Active Games]", JSON.stringify(activeGames, null, 2));

      // 2) turn_id 충돌 체크
      const turnDup = runQuery(`
        SELECT turn_id, count(*) FROM chat_messages
        WHERE session_id='${chatSessionId}' AND role='k' GROUP BY turn_id HAVING count(*)>1;
      `);
      console.log("[QA-10 turn_id Duplicates]", JSON.stringify(turnDup, null, 2));

      // 3) 응답 유실 체크
      const lostCheck = runQuery(`
        WITH m AS (
          SELECT cm.role, cm.content, cm.created_at,
                 lead(cm.role) OVER (PARTITION BY cm.session_id ORDER BY cm.created_at) AS nr,
                 lead(cm.created_at) OVER (PARTITION BY cm.session_id ORDER BY cm.created_at) AS nt
          FROM chat_messages cm
          WHERE cm.session_id = '${chatSessionId}' AND cm.deleted_at IS NULL
        )
        SELECT left(content,40) AS lost,
               round(extract(epoch from (nt-created_at))::numeric,1) AS gap_sec
        FROM m WHERE role='child' AND nr='child';
      `);
      console.log("[QA-10 Lost Messages]", JSON.stringify(lostCheck, null, 2));

      // 4) 메시지 수 비율
      const countCheck = runQuery(`
        SELECT role, count(*) FROM chat_messages
        WHERE session_id='${chatSessionId}' AND deleted_at IS NULL GROUP BY role;
      `);
      console.log("[QA-10 Message Counts]", JSON.stringify(countCheck, null, 2));

      const activeGamesPass = activeGames && activeGames.filter((g: any) => Number(g.count) > 0).length === 0;
      const turnDupPass = turnDup && turnDup.length === 0;
      const lostPass = !lostCheck || lostCheck.filter((l: any) => Number(l.gap_sec) >= 8).length === 0;

      const qa10Pass = activeGamesPass && turnDupPass && lostPass;
      results["QA-10"] = {
        pass: qa10Pass,
        activeGames,
        turnDup,
        lostCheck,
        countCheck,
      };
      console.log(`[QA-10 Check] activeGamesPass: ${activeGamesPass}, turnDupPass: ${turnDupPass}, lostPass: ${lostPass} -> QA-10: ${qa10Pass}`);
    }

    // 결과 저장
    fs.writeFileSync(`${LOG_DIR}/results.json`, JSON.stringify(results, null, 2));
    console.log("[QA Done] Results saved to /tmp/agy-qa-008/results.json");
  });
});
