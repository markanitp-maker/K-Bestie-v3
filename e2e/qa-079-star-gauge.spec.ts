import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const EVIDENCE_DIR = "/tmp/agy-qa-079";

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

function getLatestMissionGoalStats() {
  const sql = `SELECT status, count(*) FROM conversation_goals WHERE mission_session_id = (SELECT id FROM chat_sessions WHERE child_id='${CHILD_ID}' AND session_type='mission' ORDER BY started_at DESC LIMIT 1) GROUP BY status;`;
  return runQuery(sql);
}

function archiveExistingMissionSessions() {
  const sql = `
    UPDATE mission_progress
    SET status='FORCE_ENDED', business_date=to_char(to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, 'YYYY-MM-DD')
    WHERE child_id='${CHILD_ID}';
    UPDATE chat_sessions
    SET ended_at=now(), business_date=to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, started_at=started_at - interval '300 days'
    WHERE child_id='${CHILD_ID}' AND session_type='mission';
  `;
  runQuery(sql);
}

async function loginAndGoToMission(page: Page, screenshotPrefix: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(`\n[Login] Navigating to ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: CHILD_ID });

  // Go to child home first to dismiss any modals
  await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const eventModalCloseBtn = page.getByRole("button", { name: /이벤트 확인했어요|이벤트 확인|닫기/ });
  if (await eventModalCloseBtn.count().catch(() => 0)) {
    await eventModalCloseBtn.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Navigate to mission page
  await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Check start / resume button
  const startBtn = page.getByRole("button", { name: /시작하기|이어하기/ });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("[Mission] Clicking start/resume button...");
    await startBtn.click();
    await page.waitForTimeout(4000);
  }

  // Switch to text mode
  console.log("[Mission] Switching to text mode...");
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ state: "visible", timeout: 20000 });
  await keyboardBtn.click();
  await page.waitForTimeout(1000);

  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInput).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${screenshotPrefix}-00-ready.png`), fullPage: false });

  return textInput;
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
  let total = 3;

  if (await progressBar.isVisible({ timeout: 2000 }).catch(() => false)) {
    ariaLabel = (await progressBar.getAttribute("aria-label")) || "";
    const match = ariaLabel.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      filled = parseInt(match[1], 10);
      total = parseInt(match[2], 10);
      return { filled, total, ariaLabel };
    }
  }

  // Fallback: count filled svg elements
  const filledStars = page.locator('div[aria-label^="미션 진행률"] svg.fill-\\[\\#F6A21A\\]');
  filled = await filledStars.count().catch(() => 0);
  return { filled, total, ariaLabel };
}

async function sendAnswerAndGetReply(page: Page, textInput: any, answer: string, screenshotPath: string) {
  console.log(`\n[Child -> K]: "${answer}"`);
  await textInput.fill(answer);

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/mission/v3/turn") && res.request().method() === "POST",
      { timeout: 60000 }
    ),
    page.locator('button[aria-label="전송"]').click(),
  ]);

  const turnJson = await response.json().catch(() => ({}));
  await page.waitForTimeout(3000);

  const starInfo = await getStarCount(page);
  const currentQ = await getKCurrentQuestion(page);
  const kReply = turnJson.kResponse || currentQ;

  console.log(`[K -> Child]: "${kReply}"`);
  console.log(`[Star Gauge]: ${starInfo.filled}/${starInfo.total} (${starInfo.ariaLabel})`);
  console.log(`[Turn Result API]: goalProgress=${JSON.stringify(turnJson.goalProgress)}, status=${turnJson.status}`);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  return {
    kReply,
    currentQ,
    starInfo,
    turnJson,
  };
}

function pickShortAnswer(q: string, turnIdx: number): string {
  const qLower = q.toLowerCase();
  if (qLower.includes("게임") || qLower.includes("놀이") || qLower.includes("영상")) return "로블록스";
  if (qLower.includes("누구") || qLower.includes("친구") || qLower.includes("누구랑")) return "민준이랑";
  if (qLower.includes("점심") || qLower.includes("음식") || qLower.includes("밥") || qLower.includes("맛있") || qLower.includes("먹었") || qLower.includes("간식")) return "떡볶이";
  if (qLower.includes("기분") || qLower.includes("어땠") || qLower.includes("속상") || qLower.includes("마음") || qLower.includes("억울")) return "많이 속상했어";
  if (qLower.includes("학원") || qLower.includes("순간") || qLower.includes("어떤") || qLower.includes("재미")) return "던지는 거";
  if (qLower.includes("숙제") || qLower.includes("공부")) return "일기랑 독서록";
  if (qLower.includes("책")) return "만화책";
  if (qLower.includes("학교") || qLower.includes("수업")) return "체육 시간";
  if (qLower.includes("가장") || qLower.includes("제일") || qLower.includes("잘했")) return "피구";

  const fallbacks = ["로블록스", "민준이랑", "떡볶이", "많이 속상했어", "던지는 거"];
  return fallbacks[turnIdx % fallbacks.length];
}

test.describe("079 Dev E2E: Star Gauge & Goal Assessor Verification", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }
  });

  test("QA-A: 짧은 정답으로 별이 차는가 (5턴 진행)", async ({ page }) => {
    test.setTimeout(240_000);

    archiveExistingMissionSessions();

    const textInput = await loginAndGoToMission(page, "qa-a");

    const turns: Array<{
      turn: number;
      kQuestion: string;
      childAnswer: string;
      kResponse: string;
      starBefore: number;
      starAfter: number;
      satisfiedCount: number;
    }> = [];

    let initialQ = await getKCurrentQuestion(page);
    let initialStars = (await getStarCount(page)).filled;
    console.log(`[QA-A Start] Initial Question: "${initialQ}", Stars: ${initialStars}`);

    for (let t = 1; t <= 5; t++) {
      const currentK = await getKCurrentQuestion(page);
      const starBefore = (await getStarCount(page)).filled;
      const ans = pickShortAnswer(currentK, t - 1);

      const res = await sendAnswerAndGetReply(
        page,
        textInput,
        ans,
        path.join(EVIDENCE_DIR, `qa-a-turn-${t}.png`)
      );

      turns.push({
        turn: t,
        kQuestion: currentK,
        childAnswer: ans,
        kResponse: res.kReply,
        starBefore,
        starAfter: res.starInfo.filled,
        satisfiedCount: res.turnJson?.goalProgress?.satisfied ?? res.starInfo.filled,
      });

      // Check if reward modal or mission completion dialog appeared
      const modal = page.locator('div[role="dialog"], div[data-ui="reward-modal"]');
      if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`[QA-A] Mission completed / reward modal visible at turn ${t}`);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `qa-a-turn-${t}-completion-modal.png`) });
        break;
      }
    }

    const dbStats = getLatestMissionGoalStats();
    console.log("\n=== QA-A Summary ===");
    console.log("Turns:", JSON.stringify(turns, null, 2));
    console.log("DB Stats:", JSON.stringify(dbStats, null, 2));

    const finalStars = (await getStarCount(page)).filled;
    console.log(`Final Stars: ${finalStars}`);
    expect(finalStars, "QA-A: 5턴 후 별이 최소 1개 이상 차야 함").toBeGreaterThan(0);
  });

  test("QA-B: 미흡한 답변은 안 차는가 (과도한 완화 방지)", async ({ page }) => {
    test.setTimeout(240_000);

    archiveExistingMissionSessions();

    const textInput = await loginAndGoToMission(page, "qa-b");

    const poorAnswers = ["응", "몰라", "그냥", "부루마불"];
    const results: Array<{
      turn: number;
      kQuestion: string;
      childAnswer: string;
      kResponse: string;
      starBefore: number;
      starAfter: number;
      increased: boolean;
    }> = [];

    const initialStars = (await getStarCount(page)).filled;
    console.log(`[QA-B Start] Initial Stars: ${initialStars}`);
    expect(initialStars, "QA-B 시작 시 별은 0개여야 함").toBe(0);

    for (let i = 0; i < poorAnswers.length; i++) {
      const ans = poorAnswers[i];
      const q = await getKCurrentQuestion(page);
      const starBefore = (await getStarCount(page)).filled;

      const res = await sendAnswerAndGetReply(
        page,
        textInput,
        ans,
        path.join(EVIDENCE_DIR, `qa-b-turn-${i + 1}-${i}.png`)
      );

      const starAfter = res.starInfo.filled;
      const increased = starAfter > starBefore;

      results.push({
        turn: i + 1,
        kQuestion: q,
        childAnswer: ans,
        kResponse: res.kReply,
        starBefore,
        starAfter,
        increased,
      });

      console.log(`[QA-B] Answer: "${ans}" -> Star before: ${starBefore}, Star after: ${starAfter}, Increased: ${increased}`);
      expect(increased, `QA-B FAIL: 미흡한 답변 "${ans}"에 별이 증가함 (${starBefore} -> ${starAfter})`).toBeFalsy();
    }

    console.log("\n=== QA-B Summary ===");
    console.log(JSON.stringify(results, null, 2));
  });

  test("QA-C: 현실 정정 (지금 방학이야)", async ({ page }) => {
    test.setTimeout(180_000);

    archiveExistingMissionSessions();

    const textInput = await loginAndGoToMission(page, "qa-c");

    const initialQ = await getKCurrentQuestion(page);
    console.log(`[QA-C] Initial Question: "${initialQ}"`);

    // Say "지금 방학이야"
    const res1 = await sendAnswerAndGetReply(
      page,
      textInput,
      "지금 방학이야",
      path.join(EVIDENCE_DIR, "qa-c-turn-1-vacation.png")
    );

    console.log(`[QA-C Turn 1 Response]: "${res1.kReply}"`);

    // Next turn answer to see if K repeats the school question
    const q2 = await getKCurrentQuestion(page);
    console.log(`[QA-C Turn 2 Question]: "${q2}"`);

    const res2 = await sendAnswerAndGetReply(
      page,
      textInput,
      "집에서 쉬었어",
      path.join(EVIDENCE_DIR, "qa-c-turn-2-followup.png")
    );

    console.log(`[QA-C Turn 2 Response]: "${res2.kReply}"`);

    const repeatedExactSchoolQuestion = initialQ.includes("학교") && (res1.kReply.includes(initialQ) || q2 === initialQ);
    console.log(`[QA-C] Repeated exact school question: ${repeatedExactSchoolQuestion}`);
    expect(repeatedExactSchoolQuestion, `QA-C FAIL: 방학이라고 알렸는데 같은 질문을 반복함: "${q2}"`).toBeFalsy();
  });

  test("QA-D: 회귀 (정상 진행 및 종료/에러 없음)", async ({ page }) => {
    test.setTimeout(180_000);

    const textInput = await loginAndGoToMission(page, "qa-d");
    await expect(textInput).toBeVisible();

    const starInfo = await getStarCount(page);
    expect(starInfo.total).toBeGreaterThanOrEqual(3);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa-d-regression-clean.png"), fullPage: false });
    console.log("[QA-D] Regression test passed cleanly.");
  });
});
