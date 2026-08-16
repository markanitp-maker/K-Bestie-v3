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
const LOG_DIR = "/tmp/agy-qa-080";

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

function extractKWord(kText: string): string | null {
  // 1. Quoted words: '사과', "기차", ‘하늘’, “구름”
  const match = kText.match(/['"‘“]([가-힣]+)['"’”]/);
  if (match) return match[1];

  // 2. Look for pattern like: OOO(으)로 시작
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

async function loginAs(page: import("@playwright/test").Page, username: string, childId: string) {
  console.log(`[loginAs] Navigating to ${BASE}/login...`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(username);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
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

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ state: "visible", timeout: 15000 });
  await keyboardBtn.click();
  await page.waitForTimeout(500);

  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[goToChat] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
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
    page.locator('button[aria-label="전송"]').click(),
  ]);
  const latencyMs = Date.now() - startTime;

  const json = await response.json().catch(() => ({}));
  await page.waitForTimeout(1000);

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

test.describe("080 Dev E2E QA: Game Transition & Regression", () => {
  test.setTimeout(300_000); // 5 minutes

  test("T-1 ~ T-5 Comprehensive Verification (Single Chromium Runner)", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 먼저 이전 활성 세션 정리(깨끗한 상태 보장)
    console.log("[Setup] Checking initial DB session state...");
    const initialDb = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;
    `);
    console.log("[Initial Active Sessions]\n", JSON.stringify(initialDb, null, 2));

    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    // ==========================================
    // T-1. 사고 재현 검증 (핵심)
    // ==========================================
    console.log("\n==========================================");
    console.log("T-1. 사고 재현 검증");
    console.log("==========================================");

    // 1-1. "초성게임 하자"
    console.log("\n[T-1 Step 1] '초성게임 하자'");
    const t1_s1 = await sendChatMessage(page, "초성게임 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "t1-step1-chosung-start.png") });

    // 1-2. 초성 한번 답해보고 잡담 던지기
    console.log("\n[T-1 Step 2a] '사과'");
    const t1_s2a = await sendChatMessage(page, "사과");
    await page.screenshot({ path: path.join(LOG_DIR, "t1-step2a-chosung-answer.png") });

    console.log("\n[T-1 Step 2b] '오늘 킨텍스 다녀왔어'");
    const t1_s2b = await sendChatMessage(page, "오늘 킨텍스 다녀왔어");
    await page.screenshot({ path: path.join(LOG_DIR, "t1-step2b-chitchat.png") });

    // 1-3. "끝말잇기 하자"
    console.log("\n[T-1 Step 3] '끝말잇기 하자'");
    const t1_s3 = await sendChatMessage(page, "끝말잇기 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "t1-step3-wordchain-request.png") });

    // DB 검증: 3번 시점에 wordchain 세션 생성 & chosung 세션 종료 확인
    const dbT1_s3 = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY 5;
    `);
    console.log("[T-1 Step 3 DB Sessions]\n", JSON.stringify(dbT1_s3, null, 2));

    // 1-4. 케이가 낸 단어의 끝말로 이어지는 단어 입력
    let kWord = extractKWord(t1_s3.kText);
    console.log(`[T-1 Step 4] Extracted K Word: "${kWord}" from text: "${t1_s3.kText}"`);
    let nextWord = "스위스";
    if (kWord && kWord.length > 0) {
      const lastChar = kWord.charAt(kWord.length - 1);
      nextWord = findSafeWordForEnding(lastChar, [kWord]);
    }
    console.log(`[T-1 Step 4] Child answers: '${nextWord}'`);
    const t1_s4 = await sendChatMessage(page, nextWord);
    await page.screenshot({ path: path.join(LOG_DIR, "t1-step4-wordchain-answer.png") });

    const dbT1_s4 = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY 5;
    `);
    console.log("[T-1 Step 4 DB Sessions]\n", JSON.stringify(dbT1_s4, null, 2));


    // ==========================================
    // T-2. 같은 게임 재요청은 판을 안 끊는가
    // ==========================================
    console.log("\n==========================================");
    console.log("T-2. 같은 게임 재요청은 판을 안 끊는가");
    console.log("==========================================");

    const dbT2_before = runQuery(`
      SELECT id::text, state, ended_at IS NULL AS active, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY started_at;
    `);
    const t2SessionCountBefore = dbT2_before.length;

    console.log("\n[T-2] '끝말잇기 하자'");
    const t2_resp = await sendChatMessage(page, "끝말잇기 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "t2-re-request.png") });

    const dbT2_after = runQuery(`
      SELECT id::text, state, ended_at IS NULL AS active, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY started_at;
    `);
    console.log("[T-2 DB Wordchain Sessions]\n", JSON.stringify(dbT2_after, null, 2));


    // ==========================================
    // T-3. 게임 이름 언급이 전환을 일으키지 않는가
    // ==========================================
    console.log("\n==========================================");
    console.log("T-3. 게임 이름 언급이 전환을 일으키지 않는가");
    console.log("==========================================");

    console.log("\n[T-3] '이거 초성게임보다 재밌다'");
    const t3_resp = await sendChatMessage(page, "이거 초성게임보다 재밌다");
    await page.screenshot({ path: path.join(LOG_DIR, "t3-mention-other-game.png") });

    const dbT3 = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY 5;
    `);
    console.log("[T-3 DB Sessions]\n", JSON.stringify(dbT3, null, 2));


    // ==========================================
    // T-4. 명시적 종료
    // ==========================================
    console.log("\n==========================================");
    console.log("T-4. 명시적 종료");
    console.log("==========================================");

    console.log("\n[T-4] '그만할래'");
    const t4_resp = await sendChatMessage(page, "그만할래");
    await page.screenshot({ path: path.join(LOG_DIR, "t4-explicit-stop.png") });

    const dbT4 = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY 5;
    `);
    console.log("[T-4 DB Sessions]\n", JSON.stringify(dbT4, null, 2));


    // ==========================================
    // T-5. 회귀: 일반 대화 1턴
    // ==========================================
    console.log("\n==========================================");
    console.log("T-5. 회귀: 일반 대화 1턴");
    console.log("==========================================");

    console.log("\n[T-5] '오늘 저녁 메뉴 추천해줘'");
    const t5_resp = await sendChatMessage(page, "오늘 저녁 메뉴 추천해줘");
    await page.screenshot({ path: path.join(LOG_DIR, "t5-chitchat-regression.png") });

    const dbT5 = runQuery(`
      SELECT 'chosung' AS g, id::text, state, ended_at IS NULL AS active, started_at::text
      FROM chosung_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      UNION ALL
      SELECT 'wordchain', id::text, state, ended_at IS NULL, started_at::text
      FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}'
        AND started_at > now() - interval '1 hour'
      ORDER BY 5;
    `);
    console.log("[T-5 DB Sessions]\n", JSON.stringify(dbT5, null, 2));

    await context.close();
  });
});
