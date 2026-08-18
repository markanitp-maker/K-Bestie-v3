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
const CHILD_B_USERNAME = "qa-child-b-dev";
const CHILD_B_ID = "e2e00002-bbbb-4000-8000-000000000002";
const LOG_DIR = "/tmp/agy-qa-007";

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

function getActiveSessions() {
  return runQuery(`
    SELECT 'chosung' AS g, state, current_word, (ended_at IS NULL) AS active, started_at::text
    FROM chosung_game_sessions WHERE child_id='${CHILD_B_ID}'
      AND started_at > now() - interval '1 hour'
    UNION ALL
    SELECT 'wordchain', state, current_word, (ended_at IS NULL), started_at::text
    FROM word_chain_game_sessions WHERE child_id='${CHILD_B_ID}'
      AND started_at > now() - interval '1 hour' ORDER BY 5;
  `);
}

function getPendingProposal() {
  return runQuery(`
    SELECT id::text, pending_play_proposal FROM chat_sessions
    WHERE child_id='${CHILD_B_ID}' ORDER BY started_at DESC LIMIT 1;
  `);
}

function cleanUpAllSessions() {
  runQuery(`UPDATE chosung_game_sessions SET state='ENDED', ended_at = now() WHERE child_id = '${CHILD_B_ID}' AND ended_at IS NULL;`);
  runQuery(`UPDATE word_chain_game_sessions SET state='ENDED', ended_at = now() WHERE child_id = '${CHILD_B_ID}' AND ended_at IS NULL;`);
  runQuery(`UPDATE chat_sessions SET pending_play_proposal = null WHERE child_id = '${CHILD_B_ID}';`);
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

test.describe("007 Dev E2E QA: Play Proposal & Session Guard", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Run QA-1 through QA-8 Scenarios", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));

    // Results collector
    const results: Record<string, { pass: boolean; detail: string; screenshot: string }> = {};

    console.log("[Setup] Resetting DB state...");
    cleanUpAllSessions();

    await loginAs(page, CHILD_B_USERNAME, CHILD_B_ID);
    await goToChat(page);

    // ==========================================
    // QA-1. 단일 제안 + 포괄 수락
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-1. 단일 제안 + 포괄 수락");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      // CHOSUNG on K-cooldown, WORD_CHAIN available -> single proposal
      runQuery(`UPDATE conversation_topics SET last_initiated_by = 'k', cooldown_until = now() + interval '1 day' WHERE child_id = '${CHILD_B_ID}' AND semantic_group = 'PLAYFUL_GAME_CHOSUNG';`);
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}' AND semantic_group = 'PLAYFUL_GAME_WORD_CHAIN';`);
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}' AND semantic_group = 'PLAY_PROPOSAL';`);

      const s1 = await sendChatMessage(page, "심심해");
      const proposalDb = getPendingProposal();
      console.log("[QA-1 Proposal DB]", JSON.stringify(proposalDb));

      const s2 = await sendChatMessage(page, "좋아");
      const ssPath = path.join(LOG_DIR, "qa1-single-proposal-accept.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-1 Active Sessions DB]", JSON.stringify(activeDb));

      const hasActiveGame = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true);
      const isWordChain = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true && r.g === "wordchain");

      const pass = hasActiveGame && isWordChain;
      results["QA-1"] = {
        pass,
        detail: `제안: "${s1.kText}" -> 수락: "${s2.kText}" (DB active=${hasActiveGame}, g=wordchain)`,
        screenshot: ssPath,
      };

      // Clean up game session
      await sendChatMessage(page, "그만할래");
      cleanUpAllSessions();
    }

    // ==========================================
    // QA-2. 복수 제안 + 포괄 수락 (핵심)
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-2. 복수 제안 + 포괄 수락 (핵심)");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      // Clear cooldown for both games so both are offered
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}';`);

      const s1 = await sendChatMessage(page, "뭐 하고 놀까?");
      const proposalDb1 = getPendingProposal();
      console.log("[QA-2 Proposal DB]", JSON.stringify(proposalDb1));

      // Blanket acceptance
      const s2 = await sendChatMessage(page, "좋아");
      const ssPath = path.join(LOG_DIR, "qa2-multiple-proposal-blanket.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-2 Active Sessions DB (Must be empty!)]", JSON.stringify(activeDb));
      const proposalDb2 = getPendingProposal();
      console.log("[QA-2 Proposal DB after blanket]", JSON.stringify(proposalDb2));

      const hasActiveGame = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true);
      const asksWhich = s2.kText.includes("뭐") || s2.kText.includes("어떤") || s2.kText.includes("골라") || s2.kText.includes("선택");

      const pass = !hasActiveGame && asksWhich;
      results["QA-2"] = {
        pass,
        detail: `제안: "${s1.kText}" -> 되물음: "${s2.kText}" (세션 미생성 DB active=${hasActiveGame})`,
        screenshot: ssPath,
      };
    }

    // ==========================================
    // QA-3. 되물은 뒤 선택
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-3. 되물은 뒤 선택");
    console.log("==========================================");
    {
      // Continue from QA-2: child chooses "초성게임"
      const s3 = await sendChatMessage(page, "초성게임");
      const ssPath = path.join(LOG_DIR, "qa3-choose-chosung.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-3 Active Sessions DB]", JSON.stringify(activeDb));

      const hasActiveChosung = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true && r.g === "chosung");

      const pass = hasActiveChosung;
      results["QA-3"] = {
        pass,
        detail: `응답: "${s3.kText}" (DB chosung active=${hasActiveChosung})`,
        screenshot: ssPath,
      };

      // Clean up game session
      await sendChatMessage(page, "그만할래");
      cleanUpAllSessions();
    }

    // ==========================================
    // QA-4. 직접 요청 우선
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-4. 직접 요청 우선");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}';`);

      const s1 = await sendChatMessage(page, "끝말잇기 하자");
      const ssPath = path.join(LOG_DIR, "qa4-direct-wordchain.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-4 Active Sessions DB]", JSON.stringify(activeDb));

      const hasActiveWordChain = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true && r.g === "wordchain");

      const pass = hasActiveWordChain;
      results["QA-4"] = {
        pass,
        detail: `응답: "${s1.kText}" (DB wordchain active=${hasActiveWordChain})`,
        screenshot: ssPath,
      };

      // Clean up game session
      await sendChatMessage(page, "그만할래");
      cleanUpAllSessions();
    }

    // ==========================================
    // QA-5. 제안 후 딴 얘기 → "응" (핵심, 리뷰가 잡은 사고)
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-5. 제안 후 딴 얘기 → '응' (핵심)");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}';`);

      // 1. K proposes
      const s1 = await sendChatMessage(page, "심심해");
      console.log("[QA-5 Step 1 Proposal]:", s1.kText);

      // 2. Off-topic chitchat
      const s2 = await sendChatMessage(page, "숙제 다 했어");
      console.log("[QA-5 Step 2 Off-topic]:", s2.kText);

      // 3. "응"
      const s3 = await sendChatMessage(page, "응");
      console.log("[QA-5 Step 3 '응']:", s3.kText);
      const ssPath = path.join(LOG_DIR, "qa5-offtopic-then-yes.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-5 Active Sessions DB (Must be empty!)]", JSON.stringify(activeDb));

      const hasActiveGame = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true);

      const pass = !hasActiveGame;
      results["QA-5"] = {
        pass,
        detail: `1)제안:"${s1.kText}" -> 2)숙제:"${s2.kText}" -> 3)응:"${s3.kText}" (세션 미생성 active=${hasActiveGame})`,
        screenshot: ssPath,
      };
    }

    // ==========================================
    // QA-6. 거절 후 상태 정리
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-6. 거절 후 상태 정리");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}';`);

      // 1. Propose
      const s1 = await sendChatMessage(page, "심심해");
      console.log("[QA-6 Step 1 Propose]:", s1.kText);

      // 2. Decline
      const s2 = await sendChatMessage(page, "안 할래");
      console.log("[QA-6 Step 2 Decline]:", s2.kText);

      // 3. "심심해" again -> should NOT propose
      const s3 = await sendChatMessage(page, "심심해");
      console.log("[QA-6 Step 3 '심심해' again]:", s3.kText);

      const proposalDb = getPendingProposal();
      console.log("[QA-6 Proposal DB after second '심심해']", JSON.stringify(proposalDb));
      const hasProposal = proposalDb?.[0]?.pending_play_proposal !== null && proposalDb?.[0]?.pending_play_proposal !== undefined;

      // 4. Direct request "끝말잇기 하자" MUST work
      const s4 = await sendChatMessage(page, "끝말잇기 하자");
      console.log("[QA-6 Step 4 Direct request]:", s4.kText);
      const ssPath = path.join(LOG_DIR, "qa6-decline-cleanup-direct.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-6 Active Sessions DB]", JSON.stringify(activeDb));

      const hasActiveWordChain = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true && r.g === "wordchain");

      const pass = !hasProposal && hasActiveWordChain;
      results["QA-6"] = {
        pass,
        detail: `거절 후 재제안 방지(제안=${hasProposal}, 응답="${s3.kText}") + 직접요청 시작(active=${hasActiveWordChain}, 응답="${s4.kText}")`,
        screenshot: ssPath,
      };

      // Clean up game session
      await sendChatMessage(page, "그만할래");
      cleanUpAllSessions();
    }

    // ==========================================
    // QA-7. 부정감정은 수락이 아니다
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-7. 부정감정은 수락이 아니다");
    console.log("==========================================");
    {
      cleanUpAllSessions();
      runQuery(`UPDATE conversation_topics SET cooldown_until = now() - interval '1 day' WHERE child_id = '${CHILD_B_ID}';`);

      // 1. Propose
      const s1 = await sendChatMessage(page, "뭐 하고 놀까?");
      console.log("[QA-7 Step 1 Propose]:", s1.kText);

      // 2. Negative emotion
      const s2 = await sendChatMessage(page, "오늘 너무 속상해");
      console.log("[QA-7 Step 2 Negative Emotion]:", s2.kText);
      const ssPath = path.join(LOG_DIR, "qa7-negative-emotion.png");
      await page.screenshot({ path: ssPath });

      const activeDb = getActiveSessions();
      console.log("[QA-7 Active Sessions DB (Must be empty!)]", JSON.stringify(activeDb));

      const hasActiveGame = Array.isArray(activeDb) && activeDb.some((r: any) => r.active === true);
      const pass = !hasActiveGame;
      results["QA-7"] = {
        pass,
        detail: `제안:"${s1.kText}" -> 속상해:"${s2.kText}" (게임 미생성 active=${hasActiveGame})`,
        screenshot: ssPath,
      };
    }

    // ==========================================
    // QA-8. 회귀 — 일반 대화 2턴
    // ==========================================
    console.log("\n==========================================");
    console.log("QA-8. 회귀 — 일반 대화 2턴");
    console.log("==========================================");
    {
      const s1 = await sendChatMessage(page, "오늘 날씨 어때?");
      const s2 = await sendChatMessage(page, "내일 뭐 입을까?");
      const ssPath = path.join(LOG_DIR, "qa8-general-chat.png");
      await page.screenshot({ path: ssPath });

      const pass = Boolean(s1.kText && s2.kText && s1.status === 200 && s2.status === 200);
      results["QA-8"] = {
        pass,
        detail: `1턴: "${s1.kText}" (${s1.latencyMs}ms), 2턴: "${s2.kText}" (${s2.latencyMs}ms)`,
        screenshot: ssPath,
      };
    }

    // ==========================================
    // Summary
    // ==========================================
    console.log("\n==========================================");
    console.log("QA SUMMARY REPORT");
    console.log("==========================================");
    for (const [key, val] of Object.entries(results)) {
      console.log(`${key}: ${val.pass ? "PASS" : "FAIL"} — ${val.detail}`);
    }

    // Assert all passed
    for (const [key, val] of Object.entries(results)) {
      expect(val.pass, `${key} failed: ${val.detail}`).toBe(true);
    }
  });
});
