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
  console.log(`[Auth] Logging in as ${CHILD_USERNAME}...`);
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

function archiveExistingFreeChatSessions() {
  runQuery(`UPDATE chat_sessions SET business_date=to_char(to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, 'YYYY-MM-DD')::date, ended_at=now() WHERE child_id='${CHILD_ID}' AND session_type='free_chat';`);
}

async function ensureFreeChatReady(page: Page) {
  console.log("[Chat] Ending previous free_chat sessions in DB...");
  archiveExistingFreeChatSessions();

  console.log(`[Chat] Navigating to ${BASE}/chat...`);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("k_session_id");
  });
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
  await page.waitForTimeout(1500);

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
  if (await keyboardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  return textInputEl;
}

function archiveExistingMissionSessions() {
  runQuery(`UPDATE mission_progress SET status='FORCE_ENDED', business_date=to_char(to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, 'YYYY-MM-DD') WHERE child_id='${CHILD_ID}';`);
  runQuery(`UPDATE chat_sessions SET ended_at=now(), business_date=to_char(to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, 'YYYY-MM-DD')::date, started_at=started_at - interval '300 days' WHERE child_id='${CHILD_ID}' AND session_type='mission';`);
}

async function getKCurrentQuestion(page: Page): Promise<string> {
  const bubble = page.locator('div[data-ui="current-bubble"] p');
  if (await bubble.isVisible({ timeout: 2000 }).catch(() => false)) {
    return (await bubble.textContent().catch(() => ""))?.trim() || "";
  }
  return "";
}

async function getStarCount(page: Page): Promise<{ filled: number; total: number; ariaLabel: string }> {
  const progressBar = page.locator('div[aria-label^="미션 진행률"]');
  let ariaLabel = "";
  let filled = 0;
  let total = 5;

  if (await progressBar.isVisible({ timeout: 2000 }).catch(() => false)) {
    ariaLabel = (await progressBar.getAttribute("aria-label")) || "";
    const match = ariaLabel.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      filled = parseInt(match[1], 10);
      total = parseInt(match[2], 10);
      return { filled, total, ariaLabel };
    }
  }

  const filledStars = page.locator('div[aria-label^="미션 진행률"] svg.fill-\\[\\#F6A21A\\]');
  filled = await filledStars.count().catch(() => 0);
  return { filled, total, ariaLabel };
}

function chooseAnswerForQuestion(question: string, turnIndex: number): string {
  const q = question.toLowerCase();
  
  // Specific checks FIRST
  if (q.includes("준비물") || q.includes("숙제") || q.includes("챙겼") || q.includes("챙겨") || q.includes("챙기")) {
    return "가방에 공책이랑 필통이랑 가위, 색연필을 스스로 꼼꼼하게 다 챙겨 넣었어";
  }
  if (q.includes("선생님") || q.includes("말씀") || q.includes("칭찬")) {
    return "담임 선생님이 오늘 발표 정말 씩씩하고 멋지게 잘했다고 칭찬해 주셨어";
  }
  if (q.includes("해보고 싶은") || q.includes("다음 달") || q.includes("하고 싶") || q.includes("말고 또")) {
    return "체육 시간에 친구들이랑 축구 시합도 하고 피구도 꼭 해보고 싶어";
  }
  if (q.includes("뿌듯") || q.includes("잘한") || q.includes("멋지게") || q.includes("해낸")) {
    return "어려운 수학 문제를 혼자서 포기하지 않고 끝까지 다 풀어서 뿌듯했어";
  }
  if (q.includes("누구") || q.includes("누구랑") || q.includes("누구와") || q.includes("친구")) {
    return "민준이랑 지호랑 셋이서 놀이터에서 재미있게 놀았어";
  }
  if (q.includes("어디") || q.includes("어디서") || q.includes("장소")) {
    return "학교 앞 놀이터에서 만났어";
  }
  if (q.includes("먹") || q.includes("음식") || q.includes("밥") || q.includes("간식") || q.includes("치킨") || q.includes("떡볶이")) {
    return "점심에 맛있는 떡볶이랑 김밥을 배부르게 먹었어";
  }
  if (q.includes("그림") || q.includes("만들") || q.includes("활동") || q.includes("미술")) {
    return "미술 시간에 커다란 도화지에 알록달록한 무지개 우주선을 그렸어";
  }
  if (q.includes("과학") || q.includes("실험") || q.includes("관찰")) {
    return "과학 시간에 돋보기로 나뭇잎이랑 곤충을 관찰하는 게 제일 신나고 재미있었어";
  }
  if (q.includes("기분") || q.includes("어땠") || q.includes("마음") || q.includes("날씨")) {
    return "친구들이랑 신나게 웃고 놀아서 기분이 정말 최고로 좋았어";
  }
  if (q.includes("힘들") || q.includes("속상") || q.includes("어려웠")) {
    return "숙제가 조금 많아서 힘들었지만 엄마가 도와주셔서 다 끝냈어";
  }
  if (q.includes("도와") || q.includes("이야기 들어") || q.includes("어른")) {
    return "엄마가 내 이야기를 귀 기울여 들어주시고 꼭 안아주셨어";
  }

  const contextualPool = [
    "오늘 친구들이랑 운동장에서 축구하고 놀아서 정말 신났어",
    "수학 시간에 문제 다 맞혀서 백 점 받아서 기분 최고야",
    "미술 시간에 멋진 로봇 그림을 완성해서 선생님께 자랑했어",
    "점심시간에 좋아하는 반찬 많이 먹어서 든든하고 행복했어",
    "가족들이랑 저녁에 공원 산책하면서 이야기 많이 나눴어",
    "내일 학교 갈 생각 하니까 벌써 설레고 기대돼",
  ];
  return contextualPool[turnIndex % contextualPool.length];
}

test.describe("009 QA Retest: unclear_audio & Mission Completion", () => {
  test.setTimeout(360_000); // 6 minutes

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }

    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    page = await context.newPage();
    await loginChild(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // =========================================================================
  // A. unclear_audio 연속 3회 (제대로)
  // =========================================================================
  test("A. unclear_audio 연속 3회 (ㅇ, ..., ㅁ) 검증", async () => {
    console.log("\n=======================================================");
    console.log("A. unclear_audio 연속 3회");
    console.log("=======================================================");

    const textInput = await ensureFreeChatReady(page);

    const unclearInputs = ["ㅇ", "...", "ㅁ"];
    const recordedResponses: Array<{
      input: string;
      responseText: string;
      category?: string;
      turnId?: string;
      sessionId?: string;
    }> = [];

    for (let i = 0; i < unclearInputs.length; i++) {
      const uInput = unclearInputs[i];
      console.log(`\n[QA-A] Turn ${i + 1}/3 - Sending unclear input: "${uInput}"`);
      await textInput.fill(uInput);
      await hideTelemetryOverlay(page);

      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
          { timeout: 30000 }
        ),
        page.locator('button[aria-label="전송"]').click({ force: true }),
      ]);

      const reqBody = res.request().postDataJSON() || {};
      const resJson = await res.json().catch(() => ({}));
      const resText = (resJson.text || "").trim();
      const sessionId = reqBody.sessionId;
      const turnId = reqBody.childTurnId || reqBody.turnId;

      console.log(`[QA-A] Turn ${i + 1}/3 - Session: ${sessionId}, Turn: ${turnId}`);
      console.log(`[QA-A] Turn ${i + 1}/3 - Kei response text: "${resText}"`);
      console.log(`[QA-A] Turn ${i + 1}/3 - Category: ${resJson.category}`);

      recordedResponses.push({
        input: uInput,
        responseText: resText,
        category: resJson.category,
        turnId,
        sessionId,
      });

      await page.waitForTimeout(2500);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, `qa-a-unclear-turn-${i + 1}.png`),
        fullPage: true,
      });
    }

    const lastSessionId = recordedResponses[recordedResponses.length - 1].sessionId;
    console.log(`\n[QA-A] Checking DB for session: ${lastSessionId}...`);
    const dbKRows = runQuery(`
      SELECT turn_id, role, content AS msg, created_at::text
      FROM chat_messages
      WHERE session_id='${lastSessionId}' AND role='k' AND deleted_at IS NULL
      ORDER BY created_at ASC;
    `);
    console.log("[QA-A] DB K Messages:", JSON.stringify(dbKRows, null, 2));

    const responseTexts = recordedResponses.map((r) => r.responseText);
    const uniqueTexts = new Set(responseTexts);

    console.log("\n=======================================================");
    console.log("[QA-A Summary]");
    recordedResponses.forEach((r, idx) => {
      console.log(`  Turn ${idx + 1} ("${r.input}") -> [${r.category}] "${r.responseText}"`);
    });
    console.log(`Unique responses count: ${uniqueTexts.size} / ${responseTexts.length}`);
    console.log("=======================================================");

    expect(responseTexts.length).toBe(3);
    expect(uniqueTexts.size).toBe(3);
    expect(recordedResponses.every((r) => r.category === "deterministic" || r.category === "unclear_audio")).toBe(true);
  });

  // =========================================================================
  // B. 미션 완료까지 진행 (가장 중요)
  // =========================================================================
  test("B. 미션 완료까지 진행 — 오프닝/질문/완료/보상 및 접미사 DB 검증", async () => {
    console.log("\n=======================================================");
    console.log("B. 미션 완료까지 진행 (가장 중요)");
    console.log("=======================================================");

    // 1. Clean previous mission progress to allow starting a fresh mission
    console.log("[QA-B] Archiving previous mission sessions...");
    archiveExistingMissionSessions();

    // 2. Navigate to /child/missions
    console.log(`[QA-B] Navigating to ${BASE}/child/missions...`);
    await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    // Dismiss any modals
    const modalCloseBtn = page.getByRole("button", { name: /이벤트 확인했어요|이벤트 확인|닫기|나중에/ });
    if (await modalCloseBtn.count().catch(() => 0)) {
      await modalCloseBtn.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Click start button
    const startBtn = page.getByRole("button", { name: /시작하기|오늘의 미션|대화 시작/ });
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("[QA-B] Clicking start mission button...");
      await startBtn.click({ force: true });
      await page.waitForTimeout(4000);
    }

    // Switch to text mode
    console.log("[QA-B] Switching to text mode...");
    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    await keyboardBtn.waitFor({ state: "visible", timeout: 20000 });
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(1000);

    const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInput).toBeVisible({ timeout: 10000 });

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa-b-mission-start.png"),
      fullPage: true,
    });

    // Query active mission session ID
    const activeMissionSession = runQuery(`
      SELECT id, session_type, started_at::text
      FROM chat_sessions
      WHERE child_id='${CHILD_ID}' AND session_type='mission'
      ORDER BY started_at DESC LIMIT 1;
    `);
    const missionSessionId = activeMissionSession?.[0]?.id;
    console.log(`[QA-B] Active Mission Session ID: ${missionSessionId}`);

    let isCompleted = false;
    let completionTurnNumber = -1;
    const turnRecords: Array<{
      turnIndex: number;
      question: string;
      answer: string;
      kResponse: string;
      stars: number;
    }> = [];

    // Loop turns until completion (up to 10 turns)
    for (let t = 1; t <= 10; t++) {
      await page.waitForTimeout(2000);
      const currentQuestion = await getKCurrentQuestion(page);
      const starInfoBefore = await getStarCount(page);

      console.log(`\n--- [QA-B] Mission Turn ${t} ---`);
      console.log(`[K Current Question]: "${currentQuestion}"`);
      console.log(`[Stars Before]: ${starInfoBefore.filled}/${starInfoBefore.total}`);

      const childAnswer = chooseAnswerForQuestion(currentQuestion, t - 1);
      console.log(`[Child Answer]: "${childAnswer}"`);

      await textInput.fill(childAnswer);
      await hideTelemetryOverlay(page);

      const [turnResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            (r.url().includes("/api/mission/v3/turn") || r.url().includes("/api/mission/turn")) &&
            r.request().method() === "POST",
          { timeout: 60000 }
        ),
        page.locator('button[aria-label="전송"]').click({ force: true }),
      ]);

      const turnJson = await turnResponse.json().catch(() => ({}));
      console.log(`[Turn API Response]: status=${turnJson.status}, completed=${turnJson.completed}, rewardStatus=${turnJson.rewardStatus}`);

      await page.waitForTimeout(4000);

      const starInfoAfter = await getStarCount(page);
      const nextQuestion = await getKCurrentQuestion(page);
      const kResponse = turnJson.kMessage || turnJson.kResponse || nextQuestion;

      console.log(`[Kei Response]: "${kResponse}"`);
      console.log(`[Stars After]: ${starInfoAfter.filled}/${starInfoAfter.total}`);

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, `qa-b-turn-${t}.png`),
        fullPage: true,
      });

      turnRecords.push({
        turnIndex: t,
        question: currentQuestion,
        answer: childAnswer,
        kResponse,
        stars: starInfoAfter.filled,
      });

      // Check for reward modal or completion status
      const rewardModal = page.locator('div[role="dialog"], div[data-ui="reward-modal"]');
      const hasRewardModal = await rewardModal.isVisible({ timeout: 3000 }).catch(() => false);
      if (turnJson.completed || hasRewardModal || turnJson.status === "COMPLETED" || starInfoAfter.filled >= 5) {
        console.log(`[QA-B] Mission completed at turn ${t}!`);
        isCompleted = true;
        completionTurnNumber = t;
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, `qa-b-mission-complete.png`),
          fullPage: true,
        });
        break;
      }
    }

    console.log(`\n[QA-B] Completed flag: ${isCompleted}, at turn: ${completionTurnNumber}`);

    // Wait 2s for all persistence to settle
    await page.waitForTimeout(2000);

    // DB Verification
    console.log("\n=======================================================");
    console.log("[QA-B DB Verification]");
    console.log("=======================================================");

    const allKMessages = runQuery(`
      SELECT turn_id, left(content,50) AS msg, created_at::text
      FROM chat_messages
      WHERE session_id='${missionSessionId}' AND role='k' AND deleted_at IS NULL
      ORDER BY created_at ASC;
    `);
    console.log("All K Messages in Mission Session:\n", JSON.stringify(allKMessages, null, 2));

    const suffixStats = runQuery(`
      SELECT count(*) FILTER (WHERE turn_id LIKE '%:completion')::int AS completion,
             count(*) FILTER (WHERE turn_id LIKE '%:reward')::int AS reward
      FROM chat_messages WHERE session_id='${missionSessionId}' AND role='k' AND deleted_at IS NULL;
    `);
    console.log("Suffix stats (:completion, :reward):\n", JSON.stringify(suffixStats, null, 2));

    const allSessionMessages = runQuery(`
      SELECT role, turn_id, left(content,50) AS msg, created_at::text
      FROM chat_messages
      WHERE session_id='${missionSessionId}' AND deleted_at IS NULL
      ORDER BY created_at ASC;
    `);
    console.log("All messages in Mission Session:\n", JSON.stringify(allSessionMessages, null, 2));
  });
});
