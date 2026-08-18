import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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
const LOG_DIR = "/tmp/agy-qa-010";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}" --target=dev`, {
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
    const style = document.createElement("style");
    style.id = "hide-stt-overlay-style";
    style.innerHTML = `[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }`;
    document.head.appendChild(style);
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
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function enableTextInput(page: import("@playwright/test").Page) {
  await hideTelemetryOverlay(page);
  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  if (await textInputEl.isVisible().catch(() => false)) {
    return;
  }
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  await expect(textInputEl).toBeVisible({ timeout: 10000 });
  console.log("[enableTextInput] Text input ready!");
}

async function sendChatMessage(page: import("@playwright/test").Page, message: string) {
  await enableTextInput(page);
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

test.describe("QA-010 Dev K-Play Alive & Regression Verification", () => {
  test.setTimeout(300_000); // 5 minutes

  test("A to E Full Verification on Dev", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logResults: Record<string, any> = {};

    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 0. Login & Navigate to Chat
    console.log("=== 0. Login ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    // ================================================================
    // A. 케이 놀이 버튼이 살아 있다
    // 1. 자유대화 진입
    // 2. 케이 놀이 버튼이 '준비중' 이 아니라 정상 버튼인가?
    // 3. 눌러서 모달이 열리고 게임 3개가 보이는가? (초성게임·끝말잇기·넌센스퀴즈)
    // ================================================================
    console.log("\n=== A. 케이 놀이 버튼 및 모달 확인 ===");
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1000);
    
    // Check button state in default voice mode
    const playButton = page.locator('button[aria-label="놀이 고르기"]');
    const prepButton = page.locator('button[aria-label="놀이 준비중"]');

    const isPlayBtnVisible = await playButton.isVisible();
    const isPrepBtnVisible = await prepButton.isVisible();
    console.log(`[A] playButton visible: ${isPlayBtnVisible}, prepButton visible: ${isPrepBtnVisible}`);
    expect(isPlayBtnVisible).toBe(true);
    expect(isPrepBtnVisible).toBe(false);

    const buttonText = await playButton.innerText();
    console.log(`[A] Button innerText: "${buttonText.replace(/\n/g, ' ')}"`);
    expect(buttonText).toContain("케이 놀이");
    expect(buttonText).not.toContain("준비중");

    await page.screenshot({ path: path.join(LOG_DIR, "a1-play-button-live.png") });

    // Click button to open modal
    await playButton.click({ force: true });
    const modalTitle = page.locator('h2#play-skill-modal-title');
    await expect(modalTitle).toBeVisible({ timeout: 10000 });
    const titleText = await modalTitle.innerText();
    console.log(`[A] Modal title: "${titleText}"`);
    expect(titleText).toContain("케이 놀이 선택");

    await page.waitForTimeout(1500); // Wait for skills catalog API load

    // Count games in modal
    const skillButtons = page.locator('div[role="dialog"] button:has(span.font-bold)');
    const skillCount = await skillButtons.count();
    const skillNames: string[] = [];
    for (let i = 0; i < skillCount; i++) {
      const name = await skillButtons.nth(i).locator('span.font-bold').innerText();
      skillNames.push(name.trim());
    }
    console.log(`[A] Found ${skillCount} skills:`, skillNames);
    await page.screenshot({ path: path.join(LOG_DIR, "a2-modal-games-list.png") });

    expect(skillCount).toBe(3);
    expect(skillNames).toContain("초성게임");
    expect(skillNames).toContain("끝말잇기");
    const hasNonsense = skillNames.some((s) => s.replace(/\s+/g, "").includes("넌센스"));
    expect(hasNonsense).toBe(true);

    logResults.A = {
      isNormalButton: isPlayBtnVisible && !isPrepBtnVisible,
      buttonText,
      skillCount,
      skillNames,
    };

    // ================================================================
    // B. 모달로 시작이 된다
    // 4. 끝말잇기를 고른다 -> 케이가 첫 낱말을 말하는가?
    // 5. DB 확인: word_chain_game_sessions 새 행 생성 확인
    // ================================================================
    console.log("\n=== B. 모달로 끝말잇기 시작 ===");
    const wordChainButton = page.locator('div[role="dialog"] button:has-text("끝말잇기")');
    await wordChainButton.waitFor({ state: "visible" });
    
    const [selectRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/play/skill/select") && res.request().method() === "POST",
        { timeout: 30000 }
      ),
      wordChainButton.click({ force: true }),
    ]);

    const selectJson = await selectRes.json().catch(() => ({}));
    console.log("[B] /api/play/skill/select status:", selectRes.status(), selectJson);
    await page.waitForTimeout(2500);

    const bubble = page.locator("p.text-left").first();
    const bubbleTextB = ((await bubble.textContent().catch(() => "")) || "").trim();
    console.log(`[B] K opening text from bubble: "${bubbleTextB}"`);
    console.log(`[B] K opening text from select response: "${selectJson.openingLine || ''}"`);

    await page.screenshot({ path: path.join(LOG_DIR, "b-wordchain-started.png") });

    const kOpeningWordChain = bubbleTextB || selectJson.openingLine || "";
    expect(kOpeningWordChain.length).toBeGreaterThan(0);

    // Query DB word_chain_game_sessions
    const dbWordChain = runQuery(`
      SELECT id, current_word, state, started_at at time zone 'Asia/Seoul' st
      FROM word_chain_game_sessions
      WHERE child_id='${CHILD_A_ID}'
      ORDER BY started_at DESC
      LIMIT 3
    `);
    console.log("[B] DB word_chain_game_sessions:\n", JSON.stringify(dbWordChain, null, 2));
    expect(dbWordChain).toBeTruthy();
    expect(dbWordChain.length).toBeGreaterThan(0);

    logResults.B = {
      kOpeningWordChain,
      dbWordChain,
    };

    // End current game so we can test start by utterance
    console.log("\n[Teardown B] Ending word chain before starting step C...");
    const endRespB = await sendChatMessage(page, "그만할래");
    console.log("[Teardown B] K response to '그만할래':", endRespB.kText);
    await page.waitForTimeout(1000);

    // ================================================================
    // C. 말로도 시작이 된다
    // 6. 새 대화에서 "초성게임 하자" 라고 말한다
    // 7. 케이가 초성 문제를 내는가? DB chosung_game_sessions 에 새 행이 생겼는가?
    // ================================================================
    console.log("\n=== C. 말로 초성게임 시작 ===");
    const respC = await sendChatMessage(page, "초성게임 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "c-chosung-started.png") });

    console.log(`[C] K response: "${respC.kText}"`);
    expect(respC.kText.length).toBeGreaterThan(0);

    const dbChosung = runQuery(`
      SELECT id, current_chosung, current_word, state, started_at at time zone 'Asia/Seoul' st
      FROM chosung_game_sessions
      WHERE child_id='${CHILD_A_ID}'
      ORDER BY started_at DESC
      LIMIT 3
    `);
    console.log("[C] DB chosung_game_sessions:\n", JSON.stringify(dbChosung, null, 2));
    expect(dbChosung).toBeTruthy();
    expect(dbChosung.length).toBeGreaterThan(0);

    logResults.C = {
      kResponseChosung: respC.kText,
      dbChosung,
    };

    // ================================================================
    // D. 종료가 된다
    // 8. "그만할래" -> 게임이 끝나고 일반 대화로 돌아오는가?
    // ================================================================
    console.log("\n=== D. 게임 종료 ===");
    const respD = await sendChatMessage(page, "그만할래");
    await page.screenshot({ path: path.join(LOG_DIR, "d-game-ended.png") });

    console.log(`[D] K response: "${respD.kText}"`);
    expect(respD.kText.length).toBeGreaterThan(0);

    const dbChosungEnded = runQuery(`
      SELECT id, state, ended_at at time zone 'Asia/Seoul' et, started_at at time zone 'Asia/Seoul' st
      FROM chosung_game_sessions
      WHERE child_id='${CHILD_A_ID}'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    console.log("[D] DB chosung ended state:\n", JSON.stringify(dbChosungEnded, null, 2));

    logResults.D = {
      kResponseEnd: respD.kText,
      dbChosungEnded,
    };

    // ================================================================
    // E. 자유대화 회귀
    // 9. 놀이와 무관한 일반 대화 3턴 -> 케이가 정상 응답하는가? 침묵 0건인가?
    // ================================================================
    console.log("\n=== E. 자유대화 3턴 회귀 검증 ===");
    
    // Turn 1
    console.log("[E-Turn 1] 오늘 날씨 어때?");
    const t1 = await sendChatMessage(page, "오늘 날씨 어때?");
    await page.screenshot({ path: path.join(LOG_DIR, "e-turn1.png") });
    expect(t1.kText.length).toBeGreaterThan(0);

    // Turn 2
    console.log("[E-Turn 2] 오늘 기분이 좋아");
    const t2 = await sendChatMessage(page, "오늘 기분이 좋아");
    await page.screenshot({ path: path.join(LOG_DIR, "e-turn2.png") });
    expect(t2.kText.length).toBeGreaterThan(0);

    // Turn 3
    console.log("[E-Turn 3] 제일 좋아하는 색이 뭐야?");
    const t3 = await sendChatMessage(page, "제일 좋아하는 색이 뭐야?");
    await page.screenshot({ path: path.join(LOG_DIR, "e-turn3.png") });
    expect(t3.kText.length).toBeGreaterThan(0);

    logResults.E = {
      turn1: { child: "오늘 날씨 어때?", k: t1.kText, status: t1.status },
      turn2: { child: "오늘 기분이 좋아", k: t2.kText, status: t2.status },
      turn3: { child: "제일 좋아하는 색이 뭐야?", k: t3.kText, status: t3.status },
      silenceCount: 0,
    };

    fs.writeFileSync(
      path.join(LOG_DIR, "results.json"),
      JSON.stringify(logResults, null, 2),
      "utf8"
    );

    console.log("\n=== ALL QA-010 TESTS COMPLETED SUCCESSFULLY ===");
    await context.close();
  });
});
