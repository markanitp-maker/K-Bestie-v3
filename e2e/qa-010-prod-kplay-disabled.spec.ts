import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE = "https://app.k-bestie.com";

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
const CHILD_USERNAME = "testa";
const CHILD_ID = "11111111-1111-1111-1111-111111111111";
const LOG_DIR = "/tmp/agy-qa-010prod";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}" --target=prod`, {
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
  await page.waitForTimeout(2000);

  const bubble = page.locator("p.text-left").first();
  const bubbleText = (await bubble.textContent().catch(() => "")) || json.text || "";
  const kText = (json.text || bubbleText).trim();
  console.log(`[sendChatMessage] K (${latencyMs}ms): "${kText}"`);

  return {
    userPrompt: message,
    kText,
    bubbleText: bubbleText.trim(),
    status: response.status(),
    latencyMs,
    json,
  };
}

test.describe("QA-010 Production K-Play Disabled Verification", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Full Prod Verification A through E", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const results: Record<string, any> = {
      login: false,
      A: {},
      B: {},
      C: {},
      D: {},
      E: {},
    };

    // DB Query BEFORE
    const sessionQuery = `select 'chosung' g, count(*) n from chosung_game_sessions where started_at > now() - interval '1 hour' union all select 'wordchain', count(*) from word_chain_game_sessions where started_at > now() - interval '1 hour' union all select 'nonsense', count(*) from nonsense_game_sessions where started_at > now() - interval '1 hour'`;
    const dbBefore = runQuery(sessionQuery);
    results.C.before = dbBefore;
    console.log("=== DB Before ===", dbBefore);

    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // 0. Login & Navigate
    console.log("\n=== 0. Login to Prod ===");
    await loginAs(page, CHILD_USERNAME, CHILD_ID);
    await goToChat(page);
    results.login = true;

    // ================================================================
    // A. 케이 놀이 버튼이 준비중이다
    // 1. 자유대화 진입
    // 2. 케이 놀이 자리가 '준비중' 으로 보이는가?
    // 3. 눌러도 모달이 안 열리는가? 열리면 실패.
    // 4. 화면 배치가 깨지지 않았는가?
    // ================================================================
    console.log("\n=== A. 케이 놀이 버튼 UI 검증 ===");
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1000);

    const prepButton = page.locator('button[aria-label="놀이 준비중"]');
    const playButton = page.locator('button[aria-label="놀이 고르기"]');

    const isPrepBtnVisible = await prepButton.isVisible().catch(() => false);
    const isPlayBtnVisible = await playButton.isVisible().catch(() => false);
    
    let activeBtn = isPrepBtnVisible ? prepButton : (isPlayBtnVisible ? playButton : page.locator('button:has-text("놀이"), button:has-text("준비중")').first());
    const btnText = (await activeBtn.innerText().catch(() => "")) || (await activeBtn.getAttribute("aria-label")) || "";
    const box = await activeBtn.boundingBox();

    console.log(`[A] isPrepBtnVisible: ${isPrepBtnVisible}, isPlayBtnVisible: ${isPlayBtnVisible}, btnText: "${btnText.replace(/\n/g, ' ')}"`);
    await page.screenshot({ path: path.join(LOG_DIR, "a1-kplay-button-ui.png") });

    // Try clicking button to check modal
    await activeBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);

    const modalTitle = page.locator('h2#play-skill-modal-title, div[role="dialog"]');
    const isModalOpened = await modalTitle.isVisible().catch(() => false);
    console.log(`[A] isModalOpened after click: ${isModalOpened}`);
    await page.screenshot({ path: path.join(LOG_DIR, "a2-modal-check.png") });

    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    const isLayoutIntact = layout.scrollWidth <= layout.clientWidth + 1;

    results.A = {
      isPrepBtnVisible,
      isPlayBtnVisible,
      btnText: btnText.trim().replace(/\n/g, ' '),
      isModalOpened,
      isLayoutIntact,
      box,
    };

    // ================================================================
    // B. 말로 요청해도 시작되지 않는다 — 각각 시험하라
    // 5. "초성게임 하자"
    // 6. "끝말잇기 하자"
    // 7. "넌센스 퀴즈 하자"
    // 8. "우리 놀자"
    // ================================================================
    console.log("\n=== B. 놀이 요청 음성/텍스트 시험 ===");
    const promptsB = [
      "초성게임 하자",
      "끝말잇기 하자",
      "넌센스 퀴즈 하자",
      "우리 놀자",
    ];

    results.B.responses = [];
    for (let i = 0; i < promptsB.length; i++) {
      const p = promptsB[i];
      const res = await sendChatMessage(page, p);
      await page.screenshot({ path: path.join(LOG_DIR, `b${i+1}-k-response-${i}.png`) });
      results.B.responses.push(res);
      await page.waitForTimeout(1000);
    }

    // ================================================================
    // D. 케이가 선제로 놀이를 권하지 않는다
    // 10. "심심해", "뭐 하지?" 라고 말한다
    // ================================================================
    console.log("\n=== D. 놀이 선제 제안 방지 시험 ===");
    const promptsD = [
      "심심해",
      "뭐 하지?",
    ];

    results.D.responses = [];
    for (let i = 0; i < promptsD.length; i++) {
      const p = promptsD[i];
      const res = await sendChatMessage(page, p);
      await page.screenshot({ path: path.join(LOG_DIR, `d${i+1}-k-response-${i}.png`) });
      results.D.responses.push(res);
      await page.waitForTimeout(1000);
    }

    // ================================================================
    // E. 자유대화는 멀쩡하다
    // 11. 놀이와 무관한 일반 대화 3턴 -> 침묵 0건, 정상 응답인가?
    // ================================================================
    console.log("\n=== E. 일반 자유대화 3턴 시험 ===");
    const promptsE = [
      "오늘 날씨 어때?",
      "오늘 유치원에서 그림 그렸어",
      "케이 좋아하는 색깔이 뭐야?",
    ];

    results.E.responses = [];
    for (let i = 0; i < promptsE.length; i++) {
      const p = promptsE[i];
      const res = await sendChatMessage(page, p);
      await page.screenshot({ path: path.join(LOG_DIR, `e${i+1}-freechat-${i}.png`) });
      results.E.responses.push(res);
      await page.waitForTimeout(1000);
    }

    // ================================================================
    // C. 세션이 하나도 안 생긴다 (가장 중요)
    // ================================================================
    console.log("\n=== C. DB 세션 건수 사후 확인 ===");
    const dbAfter = runQuery(sessionQuery);
    results.C.after = dbAfter;
    console.log("=== DB After ===", dbAfter);

    fs.writeFileSync(path.join(LOG_DIR, "results.json"), JSON.stringify(results, null, 2), "utf8");
    console.log("\n=== Final Results Summary ===");
    console.log(JSON.stringify(results, null, 2));
  });
});
