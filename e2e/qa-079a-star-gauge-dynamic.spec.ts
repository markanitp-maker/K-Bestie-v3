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
const EVIDENCE_DIR = "/tmp/agy-qa-079a";

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

function getLatestChatMessages() {
  const sql = `SELECT role, left(content,50) as content FROM chat_messages WHERE session_id=(SELECT id FROM chat_sessions WHERE child_id='${CHILD_ID}' AND session_type='mission' ORDER BY started_at DESC LIMIT 1) ORDER BY created_at LIMIT 14;`;
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

async function loginAndGoToMission(page: Page) {
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

  const filledStars = page.locator('div[aria-label^="미션 진행률"] svg.fill-\\[\\#F6A21A\\]');
  filled = await filledStars.count().catch(() => 0);
  return { filled, total, ariaLabel };
}

const usedAnswers = new Set<string>();

function chooseContextualAnswer(question: string): string {
  const q = question.toLowerCase();

  // 1. Time / When ("언제", "몇 시", "어느 때", "언제가")
  if (q.includes("언제") || q.includes("몇 시") || q.includes("어느 때") || q.includes("언제가")) {
    const timeOptions = ["주말에", "어제 저녁", "일요일에"];
    for (const opt of timeOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 2. Who / With whom ("누구랑", "누구와", "누구하고", "누구")
  if (q.includes("누구랑") || q.includes("누구와") || q.includes("누구하고") || q.includes("누구")) {
    const whoOptions = ["민준이랑", "지호랑", "엄마랑", "동생이랑"];
    for (const opt of whoOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 3. Where / Place ("어디", "어디서", "어디로", "장소")
  if (q.includes("어디") || q.includes("어디서") || q.includes("어디로") || q.includes("장소")) {
    const placeOptions = ["놀이터", "할머니 집", "공원", "도서관"];
    for (const opt of placeOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 4. Game ("무슨 게임", "게임", "비디오", "폰게임")
  if (q.includes("게임") || q.includes("로블록스") || q.includes("마인크")) {
    const gameOptions = ["로블록스", "마인크래프트", "브롤스타즈"];
    for (const opt of gameOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 5. Food / Eating ("뭐 먹", "음식", "밥", "간식", "점심", "저녁", "아침", "급식", "메뉴")
  if (q.includes("먹") || q.includes("음식") || q.includes("밥") || q.includes("간식") || q.includes("점심") || q.includes("저녁") || q.includes("급식") || q.includes("메뉴") || q.includes("맛있")) {
    const foodOptions = ["떡볶이", "김밥", "치킨", "피자"];
    for (const opt of foodOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 6. Subject / School ("학교", "수업", "과목", "시간에", "선생님")
  if (q.includes("과목") || q.includes("수업") || q.includes("학교") || q.includes("교실")) {
    const schoolOptions = ["과학", "체육", "미술", "음악"];
    for (const opt of schoolOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 7. Academy / Study ("학원", "공부", "숙제", "문제", "학습지")
  if (q.includes("학원") || q.includes("공부") || q.includes("숙제") || q.includes("문제집")) {
    const studyOptions = ["수학", "영어", "피아노", "태권도"];
    for (const opt of studyOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 8. Activity / What did you do ("뭐 하면서", "뭐 하고", "뭐 했어", "무슨 놀이", "어떤 놀이", "어떤 거", "어떻게 보냈어", "뭐 보냈어", "활동")
  if (q.includes("뭐 하면서") || q.includes("뭐 하고") || q.includes("뭐 했") || q.includes("무슨 놀이") || q.includes("어떤 놀이") || q.includes("놀았어") || q.includes("보냈어") || q.includes("활동") || q.includes("순간")) {
    const activityOptions = ["축구", "그림 그렸어", "보드게임", "영화 봤어", "자전거 탔어"];
    for (const opt of activityOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 9. Feeling / Emotion ("어땠어", "기분", "속상", "마음", "어떤 기분", "신났", "즐거", "힘들")
  if (q.includes("어땠") || q.includes("기분") || q.includes("속상") || q.includes("마음") || q.includes("느낌") || q.includes("신났")) {
    const feelingOptions = ["좋았어", "속상했어", "신났어", "뿌듯했어"];
    for (const opt of feelingOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 10. Reading / Book ("책", "독서", "만화")
  if (q.includes("책") || q.includes("독서") || q.includes("만화")) {
    const bookOptions = ["만화책", "동화책"];
    for (const opt of bookOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // 11. Vacation ("방학", "쉬는 날")
  if (q.includes("방학") || q.includes("휴일")) {
    const vacOptions = ["집에서 쉬었어", "놀이터 갔어"];
    for (const opt of vacOptions) {
      if (!usedAnswers.has(opt)) {
        usedAnswers.add(opt);
        return opt;
      }
    }
  }

  // Fallbacks
  const fallbackList = [
    "로블록스", "민준이랑", "떡볶이", "좋았어", "과학",
    "수학", "축구", "놀이터", "만화책", "마인크래프트",
    "지호랑", "김밥", "체육", "영어", "그림 그렸어",
    "할머니 집", "신났어"
  ];
  for (const opt of fallbackList) {
    if (!usedAnswers.has(opt)) {
      usedAnswers.add(opt);
      return opt;
    }
  }

  return "재미있었어";
}

test.describe("079 Dev E2E: QA-A Verification", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }
  });

  test("QA-A: 짧지만 유효한 답변으로 별이 차는가 (5턴 진행)", async ({ page }) => {
    test.setTimeout(240_000);

    archiveExistingMissionSessions();

    const textInput = await loginAndGoToMission(page);

    const turns: Array<{
      turn: number;
      kQuestion: string;
      childAnswer: string;
      kResponse: string;
      starBefore: number;
      starAfter: number;
    }> = [];

    for (let t = 1; t <= 5; t++) {
      // 1. Read K's question from the screen
      await page.waitForTimeout(1500);
      const currentKQuestion = await getKCurrentQuestion(page);
      const starBefore = (await getStarCount(page)).filled;

      // 2. Select contextual short answer
      const childAnswer = chooseContextualAnswer(currentKQuestion);

      console.log(`\n--- Turn ${t} ---`);
      console.log(`[Kei Question]: "${currentKQuestion}"`);
      console.log(`[Child Answer]: "${childAnswer}"`);
      console.log(`[Star Before]: ${starBefore}`);

      // 3. Fill and send
      await textInput.fill(childAnswer);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/mission/v3/turn") && res.request().method() === "POST",
          { timeout: 60000 }
        ),
        page.locator('button[aria-label="전송"]').click(),
      ]);

      const turnJson = await response.json().catch(() => ({}));
      console.log(`[API Response Status]:`, turnJson?.status, `goalProgress:`, turnJson?.goalProgress);

      // Wait for response bubble to update and star animation
      await page.waitForTimeout(4000);

      const starInfo = await getStarCount(page);
      const nextKQuestion = await getKCurrentQuestion(page);
      const kResponse = turnJson.kResponse || nextKQuestion;

      console.log(`[Kei Response]: "${kResponse}"`);
      console.log(`[Star After]: ${starInfo.filled}/${starInfo.total}`);

      // 4. Save screenshot
      const screenshotPath = path.join(EVIDENCE_DIR, `turn-${t}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[Screenshot]: Saved to ${screenshotPath}`);

      turns.push({
        turn: t,
        kQuestion: currentKQuestion,
        childAnswer,
        kResponse,
        starBefore,
        starAfter: starInfo.filled,
      });

      // Check if reward modal appeared
      const rewardModal = page.locator('div[role="dialog"], div[data-ui="reward-modal"]');
      if (await rewardModal.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`[Mission Complete] Reward modal displayed at turn ${t}`);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `turn-${t}-reward.png`) });
        break;
      }
    }

    // 5. Query DB
    const dbGoalStats = getLatestMissionGoalStats();
    const dbChatMessages = getLatestChatMessages();

    console.log("\n==========================================");
    console.log("=== QA-A 5-Turn Results ===");
    console.log("==========================================");
    for (const item of turns) {
      console.log(`턴 ${item.turn}: [케이] "${item.kQuestion}" → [아이] "${item.childAnswer}" → [별] ${item.starAfter}개`);
    }

    console.log("\n=== DB Goal Stats ===");
    console.log(JSON.stringify(dbGoalStats, null, 2));

    console.log("\n=== DB Chat Messages ===");
    console.log(JSON.stringify(dbChatMessages, null, 2));

    // Calculate satisfied count
    const satisfiedStat = Array.isArray(dbGoalStats)
      ? dbGoalStats.find((s: any) => s.status === "SATISFIED")
      : null;
    const satisfiedCount = satisfiedStat ? parseInt(satisfiedStat.count, 10) : 0;

    const finalStarCount = (await getStarCount(page)).filled;

    console.log(`\n[Summary] SATISFIED Count in DB: ${satisfiedCount}, Final Screen Stars: ${finalStarCount}`);

    // Judgment: >= 3 PASS, <= 1 FAIL
    expect(satisfiedCount, `SATISFIED가 3건 이상이어야 PASS (현재: ${satisfiedCount})`).toBeGreaterThanOrEqual(3);
  });
});
