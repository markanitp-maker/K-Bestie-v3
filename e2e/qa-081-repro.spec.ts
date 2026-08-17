import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { BY_FIRST_SYLLABLE } from "../lib/k-conversation/wordChain/dictionaryIndex";
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
const LOG_DIR = "/tmp/agy-qa-081";

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

function getSessions() {
  const sql = `
    SELECT 'chosung' AS g, id::text, state, current_word, started_at::text, (ended_at IS NULL) AS active
    FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
      AND started_at > now() - interval '1 hour'
    UNION ALL
    SELECT 'wordchain', id::text, state, current_word, started_at::text, (ended_at IS NULL)
    FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
      AND started_at > now() - interval '1 hour'
    ORDER BY 5;
  `;
  return runQuery(sql) || [];
}

function extractKWord(kText: string): string | null {
  const match = kText.match(/['"‘“]([가-힣]+)['"’”]/);
  if (match) return match[1];

  const match2 = kText.match(/([가-힣]{2,4})(?:[!]|\(으\)로|으로|로 시작)/);
  if (match2) return match2[1];

  return null;
}

function findSafeWordForEnding(lastChar: string, usedWords: string[] = []): string {
  const allowed = allowedNextInitials(lastChar);
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          const nextAllowed = allowedNextInitials(entry.lastSyllable);
          const hasContinuations = nextAllowed.some((s) => (BY_FIRST_SYLLABLE.get(s)?.length || 0) >= 2);
          if (hasContinuations) {
            return entry.word;
          }
        }
      }
    }
  }
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          return entry.word;
        }
      }
    }
  }
  return `${lastChar}기`;
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
  await page.waitForTimeout(1500);
  await hideTelemetryOverlay(page);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await hideTelemetryOverlay(page);
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ state: "visible", timeout: 15000 });
  await keyboardBtn.click({ force: true });
  await page.waitForTimeout(500);

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[goToChat] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(message);

  console.log(`[sendChatMessage] Child: "${message}"`);
  const startTime = Date.now();
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

test.describe("081 Dev E2E QA: Game Complaint Repro & Transition Verification", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Execute full Q1 ~ Q7 verification scenario in single session", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    console.log("[Setup] Checking initial DB session state...");
    const initialDb = getSessions();
    console.log("[Initial Active Sessions]\n", JSON.stringify(initialDb, null, 2));

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    const summaryReport: Record<string, any> = {};

    // ==========================================
    // Q1. 불평은 게임을 시작시키지 않는다 (핵심)
    // ==========================================
    console.log("\n==========================================");
    console.log("Q1. 불평은 게임을 시작시키지 않는다 (핵심)");
    console.log("==========================================");
    const q1Input = "너 놀이가 초성 게임 밖에 할 줄 아는 게 없어 다른 놀이 몰라";
    const q1Res = await sendChatMessage(page, q1Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q1-complaint-no-start.png") });

    const q1Db = getSessions();
    console.log("[Q1 DB Sessions]\n", JSON.stringify(q1Db, null, 2));
    const q1ActiveChosung = q1Db.filter((s: any) => s.g === "chosung" && s.active);
    const q1Pass = q1ActiveChosung.length === 0;
    summaryReport["Q1"] = {
      pass: q1Pass,
      input: q1Input,
      kText: q1Res.kText,
      db: q1Db,
      latencyMs: q1Res.latencyMs,
    };

    // ==========================================
    // Q2. 케이가 자기 놀이를 안다 (핵심)
    // ==========================================
    console.log("\n==========================================");
    console.log("Q2. 케이가 자기 놀이를 안다 (핵심)");
    console.log("==========================================");
    const q2Input = "너 무슨 놀이 할 수 있어?";
    const q2Res = await sendChatMessage(page, q2Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q2-knows-own-games.png") });

    const q2Db = getSessions();
    console.log("[Q2 DB Sessions]\n", JSON.stringify(q2Db, null, 2));
    const hasChosung = q2Res.kText.includes("초성");
    const hasWordChain = q2Res.kText.includes("끝말잇기");
    const q2Pass = hasChosung && hasWordChain;
    summaryReport["Q2"] = {
      pass: q2Pass,
      input: q2Input,
      kText: q2Res.kText,
      hasChosung,
      hasWordChain,
      db: q2Db,
      latencyMs: q2Res.latencyMs,
    };

    // ==========================================
    // Q3. 정상 시작은 막히지 않는다
    // ==========================================
    console.log("\n==========================================");
    console.log("Q3. 정상 시작은 막히지 않는다");
    console.log("==========================================");
    const q3Input = "끝말잇기 하자";
    const q3Res = await sendChatMessage(page, q3Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q3-wordchain-start.png") });

    const q3Db = getSessions();
    console.log("[Q3 DB Sessions]\n", JSON.stringify(q3Db, null, 2));
    const q3ActiveWc = q3Db.find((s: any) => s.g === "wordchain" && s.active);
    const q3FirstWord = extractKWord(q3Res.kText) || q3ActiveWc?.current_word || "";
    const q3Pass = !!q3ActiveWc && (q3ActiveWc.current_word === q3FirstWord || q3Res.kText.includes(q3ActiveWc.current_word));
    summaryReport["Q3"] = {
      pass: q3Pass,
      input: q3Input,
      kText: q3Res.kText,
      extractedWord: q3FirstWord,
      dbCurrentWord: q3ActiveWc?.current_word,
      db: q3Db,
      latencyMs: q3Res.latencyMs,
    };

    // ==========================================
    // Q4. 진행 중 게임이 불평으로 끊기지 않는다 (핵심)
    // ==========================================
    console.log("\n==========================================");
    console.log("Q4. 진행 중 게임이 불평으로 끊기지 않는다 (핵심)");
    console.log("==========================================");
    let kCurrentWord = q3ActiveWc?.current_word || extractKWord(q3Res.kText) || "바나나";
    const lastChar = kCurrentWord.charAt(kCurrentWord.length - 1);
    const childAnswerWord = findSafeWordForEnding(lastChar, [kCurrentWord]);
    console.log(`[Q4 Prep] K word was '${kCurrentWord}', Child replies with '${childAnswerWord}'`);
    const q4PrepRes = await sendChatMessage(page, childAnswerWord);
    await page.screenshot({ path: path.join(LOG_DIR, "q4-step1-wordchain-turn.png") });

    const q4PrepDb = getSessions();
    console.log("[Q4 Prep DB Sessions]\n", JSON.stringify(q4PrepDb, null, 2));

    const q4Input = "근데 초성 게임만 제한 하고 끝말잇기는 잘 안하지";
    const q4Res = await sendChatMessage(page, q4Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q4-complaint-during-game.png") });

    const q4Db = getSessions();
    console.log("[Q4 DB Sessions]\n", JSON.stringify(q4Db, null, 2));
    const q4ActiveWc = q4Db.find((s: any) => s.g === "wordchain" && s.active);
    const q4ActiveChosung = q4Db.find((s: any) => s.g === "chosung" && s.active);
    const q4Pass = !!q4ActiveWc && !q4ActiveChosung;
    summaryReport["Q4"] = {
      pass: q4Pass,
      prepInput: childAnswerWord,
      prepKText: q4PrepRes.kText,
      input: q4Input,
      kText: q4Res.kText,
      wcActive: !!q4ActiveWc,
      chosungActive: !!q4ActiveChosung,
      db: q4Db,
      latencyMs: q4Res.latencyMs,
    };

    // ==========================================
    // Q5. 부정형이 가드를 뚫지 않는다
    // ==========================================
    console.log("\n==========================================");
    console.log("Q5. 부정형이 가드를 뚫지 않는다");
    console.log("==========================================");
    const q5Input = "너 초성게임 잘 못하잖아";
    const q5Res = await sendChatMessage(page, q5Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q5-negative-guard.png") });

    const q5Db = getSessions();
    console.log("[Q5 DB Sessions]\n", JSON.stringify(q5Db, null, 2));
    const q5ActiveChosung = q5Db.find((s: any) => s.g === "chosung" && s.active);
    const q5Pass = !q5ActiveChosung;
    summaryReport["Q5"] = {
      pass: q5Pass,
      input: q5Input,
      kText: q5Res.kText,
      chosungActive: !!q5ActiveChosung,
      db: q5Db,
      latencyMs: q5Res.latencyMs,
    };

    // ==========================================
    // Q6. 요청하면 전환은 된다 (Q1·Q4가 과하지 않은지 확인)
    // ==========================================
    console.log("\n==========================================");
    console.log("Q6. 요청하면 전환은 된다 (Q1·Q4가 과하지 않은지 확인)");
    console.log("==========================================");
    const q6Input = "초성게임 하자";
    const q6Res = await sendChatMessage(page, q6Input);
    await page.screenshot({ path: path.join(LOG_DIR, "q6-transition-to-chosung.png") });

    const q6Db = getSessions();
    console.log("[Q6 DB Sessions]\n", JSON.stringify(q6Db, null, 2));
    const q6ActiveWc = q6Db.find((s: any) => s.g === "wordchain" && s.active);
    const q6ActiveChosung = q6Db.find((s: any) => s.g === "chosung" && s.active);
    const q6Pass = !q6ActiveWc && !!q6ActiveChosung;
    summaryReport["Q6"] = {
      pass: q6Pass,
      input: q6Input,
      kText: q6Res.kText,
      wcActive: !!q6ActiveWc,
      chosungActive: !!q6ActiveChosung,
      db: q6Db,
      latencyMs: q6Res.latencyMs,
    };

    // ==========================================
    // Q7. 회귀 — 일반 대화
    // ==========================================
    console.log("\n==========================================");
    console.log("Q7. 회귀 — 일반 대화 (2턴)");
    console.log("==========================================");
    const q7Input1 = "오늘 저녁에 맛있는 거 먹고 싶다";
    const q7Res1 = await sendChatMessage(page, q7Input1);
    await page.screenshot({ path: path.join(LOG_DIR, "q7-turn1-chat.png") });

    const q7Input2 = "내일 유치원에서 친구들이랑 그림 그릴 거야";
    const q7Res2 = await sendChatMessage(page, q7Input2);
    await page.screenshot({ path: path.join(LOG_DIR, "q7-turn2-chat.png") });

    const q7Db = getSessions();
    console.log("[Q7 DB Sessions]\n", JSON.stringify(q7Db, null, 2));
    const q7Pass =
      q7Res1.kText.length > 0 &&
      q7Res1.status === 200 &&
      q7Res2.kText.length > 0 &&
      q7Res2.status === 200;

    summaryReport["Q7"] = {
      pass: q7Pass,
      turn1: { input: q7Input1, kText: q7Res1.kText, latencyMs: q7Res1.latencyMs },
      turn2: { input: q7Input2, kText: q7Res2.kText, latencyMs: q7Res2.latencyMs },
      db: q7Db,
    };

    fs.writeFileSync(
      path.join(LOG_DIR, "summary-report.json"),
      JSON.stringify(summaryReport, null, 2),
      "utf8"
    );
    console.log("\n[SUMMARY REPORT SAVED TO /tmp/agy-qa-081/summary-report.json]");
  });
});
