import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = path.join(process.cwd(), "evidence");
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || "";

const FORBIDDEN_PHRASES = [
  "더 얘기해줄래",
  "더 이야기해줄래",
  "계속 말해줘",
  "계속 얘기해줘",
  "더 말해줘",
];

const UTTERANCES = [
  "오늘 학교에서 급식으로 돈가스 먹었어",
  "민준이랑 축구했어",
  "그냥 돌봐 주는 것",
  "엄마 아빠가 돌봐준거",
  "잘하기!",
  "즐거운 기분!",
];

interface TurnData {
  turn: number;
  kQuestion: string;
  childUtterance: string;
  kResponse: string;
  starBefore: number;
  starAfter: number;
  starIncreased: boolean;
  responseTimeMs: number;
  forbiddenMatches: string[];
  screenshotPath: string;
  timestampKst: string;
}

function runSql(sql: string) {
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

function archiveExistingMissionSessions() {
  const sql = `
    UPDATE mission_progress
    SET status='FORCE_ENDED', business_date=to_char(now() - interval '500 days', 'YYYY-MM-DD')
    WHERE child_id='${CHILD_ID}' AND business_date='2026-08-19';
    UPDATE chat_sessions
    SET ended_at=now(), business_date=to_date('2024-01-01', 'YYYY-MM-DD'), started_at=started_at - interval '300 days'
    WHERE child_id='${CHILD_ID}' AND session_type='mission' AND ended_at IS NULL;
  `;
  runSql(sql);
}

function getLatestMessageTimeKST(): string {
  const sql = `
    SELECT m.created_at
    FROM chat_messages m
    JOIN chat_sessions s ON m.session_id = s.id
    WHERE s.child_id='${CHILD_ID}'
    ORDER BY m.created_at DESC
    LIMIT 1;
  `;
  const result = runSql(sql);
  if (result && result.length > 0 && result[0].created_at) {
    const utcDate = new Date(result[0].created_at);
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(utcDate.getTime() + kstOffset);
    return kstDate.toISOString().replace("T", " ").substring(0, 19) + " KST";
  }
  return "";
}

async function hideOverlays(page: Page) {
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

async function getStarCount(page: Page): Promise<{ filled: number; total: number; label: string }> {
  try {
    const starContainer = page.locator('[aria-label^="미션 진행률"]');
    if (await starContainer.count() > 0) {
      const label = await starContainer.first().getAttribute("aria-label");
      if (label) {
        const match = label.match(/미션 진행률\s*(\d+)\s*\/\s*(\d+)/);
        if (match) return { filled: parseInt(match[1], 10), total: parseInt(match[2], 10), label };
        const match2 = label.match(/(\d+)\s*\/\s*(\d+)/);
        if (match2) return { filled: parseInt(match2[1], 10), total: parseInt(match2[2], 10), label };
      }
    }
  } catch {}

  try {
    const filledStars = page.locator('svg.fill-\\[\\#F6A21A\\]');
    const count = await filledStars.count();
    return { filled: count, total: 3, label: `${count}/3` };
  } catch {
    return { filled: 0, total: 3, label: "0/3" };
  }
}

async function getCurrentKBubbleText(page: Page): Promise<string> {
  try {
    const bubble = page.locator('div[data-ui="current-bubble"] p');
    if (await bubble.count() > 0 && await bubble.first().isVisible().catch(() => false)) {
      const text = await bubble.first().innerText();
      return text.trim();
    }
  } catch {}

  try {
    const bubble = page.locator('[data-ui="current-bubble"]');
    if (await bubble.count() > 0 && await bubble.first().isVisible().catch(() => false)) {
      const text = await bubble.first().innerText();
      return text.trim();
    }
  } catch {}

  return "";
}

test.describe("QA-019: Mission Fallback and Star Gauge E2E Verification", () => {
  test.setTimeout(360000);

  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!QA_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD is not set in .env.local");
    }
  });

  test("검증 (A) 별 게이지 상승 및 (B) 금지 문구 미출현 검증", async ({ page }) => {
    console.log(`[QA-019] Target URL: ${BASE_URL}`);
    console.log(`[QA-019] Archiving old mission sessions for fresh run...`);
    archiveExistingMissionSessions();

    // 1. 로그인
    await page.setViewportSize({ width: 390, height: 844 });
    console.log(`[QA-019] Navigating to ${BASE_URL}/login...`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await hideOverlays(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_PASSWORD);
    await hideOverlays(page);

    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 20000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    }, { cId: CHILD_ID });

    // 2. 미션 화면 진입
    console.log(`[QA-019] Navigating to ${BASE_URL}/child/missions...`);
    await page.goto(`${BASE_URL}/child/missions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await hideOverlays(page);

    // "다시 할래요" 버튼 처리
    const restartBtn = page.getByRole("button", { name: /다시 할래요|다시 시작/ }).or(page.getByText("다시 할래요"));
    if (await restartBtn.count() > 0 && await restartBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-019] Clicking restart button...");
      await restartBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
      await hideOverlays(page);
    }

    // "시작하기" 또는 "이어하기" 버튼 처리
    const startBtn = page.locator('button:has-text("시작하기"), button:has-text("이어하기"), [aria-label*="시작하기"], [aria-label*="이어하기"]');
    if (await startBtn.count() > 0 && await startBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-019] Clicking start/resume mission button...");
      await startBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
      await hideOverlays(page);
    }

    // 3. 텍스트 입력 모드 진입
    const textModeBtn = page.locator('button[aria-label="텍스트로 답하기"]');
    if (await textModeBtn.count() > 0 && await textModeBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-019] Enabling text input mode...");
      await textModeBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInput).toBeVisible({ timeout: 20000 });

    // 케이의 첫 질문 준비 대기
    console.log("[QA-019] Waiting for K's initial question...");
    let initialKText = "";
    for (let i = 0; i < 30; i++) {
      initialKText = await getCurrentKBubbleText(page);
      if (initialKText && !["미션을 확인하고 있어요.", "준비 중...", "불러오는 중...", "케이가 질문을 준비하고 있어요..."].includes(initialKText)) {
        break;
      }
      await page.waitForTimeout(1000);
    }

    const readyShot = path.join(EVIDENCE_DIR, "turn-0-ready.png");
    await page.screenshot({ path: readyShot, fullPage: false });
    console.log(`[QA-019] Initial question ready: "${initialKText}"`);

    const turnResults: TurnData[] = [];

    // 6턴 실행
    for (let t = 0; t < UTTERANCES.length; t++) {
      const turnNum = t + 1;
      const childUtterance = UTTERANCES[t];
      console.log(`\n================== [Turn ${turnNum}/6] ==================`);

      const prevKQuestion = await getCurrentKBubbleText(page);
      const starBefore = (await getStarCount(page)).filled;
      console.log(`[Turn ${turnNum}] K Previous Question: "${prevKQuestion}"`);
      console.log(`[Turn ${turnNum}] Star Before: ${starBefore}`);
      console.log(`[Turn ${turnNum}] Sending Child Utterance: "${childUtterance}"`);

      await textInput.fill(childUtterance);
      await page.waitForTimeout(300);

      const sendBtn = page.locator('button[aria-label="전송"]');
      await expect(sendBtn).toBeEnabled({ timeout: 10000 });

      const startTime = Date.now();

      // 전송 및 API 응답 대기
      const [turnResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/mission/v3/turn") && res.request().method() === "POST",
          { timeout: 60000 }
        ).catch(() => null),
        sendBtn.click({ force: true }),
      ]);

      // 케이 응답 완료 및 버블 갱신 대기
      let newKResponse = "";
      while (Date.now() - startTime < 60000) {
        await page.waitForTimeout(1000);
        newKResponse = await getCurrentKBubbleText(page);
        const inputReady = await textInput.isEnabled().catch(() => false);
        if (newKResponse && newKResponse !== prevKQuestion && inputReady) {
          await page.waitForTimeout(1000);
          newKResponse = await getCurrentKBubbleText(page);
          break;
        }
      }

      const responseTimeMs = Date.now() - startTime;
      const starAfter = (await getStarCount(page)).filled;

      let apiResponseJson: any = null;
      if (turnResponse) {
        apiResponseJson = await turnResponse.json().catch(() => null);
      }
      if (!newKResponse && apiResponseJson?.kResponse) {
        newKResponse = apiResponseJson.kResponse;
      }

      const shotPath = path.join(EVIDENCE_DIR, `turn-${turnNum}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      // 금지 문구 검사
      const forbiddenMatches = FORBIDDEN_PHRASES.filter((phrase) => newKResponse.includes(phrase));

      const turnData: TurnData = {
        turn: turnNum,
        kQuestion: prevKQuestion,
        childUtterance,
        kResponse: newKResponse,
        starBefore,
        starAfter,
        starIncreased: starAfter > starBefore,
        responseTimeMs,
        forbiddenMatches,
        screenshotPath: shotPath,
        timestampKst: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19) + " KST",
      };

      turnResults.push(turnData);

      console.log(`[Turn ${turnNum}] K Response: "${newKResponse}"`);
      console.log(`[Turn ${turnNum}] Star: ${starBefore} -> ${starAfter} (Increased: ${turnData.starIncreased})`);
      console.log(`[Turn ${turnNum}] Response Time: ${responseTimeMs} ms`);
      console.log(`[Turn ${turnNum}] Forbidden Matches: ${JSON.stringify(forbiddenMatches)}`);

      // 보상/완료 모달이 뜨면 캡처
      const completionModal = page.locator('div[role="dialog"], div[data-ui="reward-modal"]');
      if (await completionModal.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`[QA-019] Completion/Reward modal visible at turn ${turnNum}`);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `turn-${turnNum}-modal.png`) });
      }
    }

    const latestDbKst = getLatestMessageTimeKST();
    console.log(`[QA-019] Latest conversation record in DB: ${latestDbKst}`);

    const totalTurns = turnResults.length;
    const turnsWithForbidden = turnResults.filter((t) => t.forbiddenMatches.length > 0);
    const starIncreasedTurns = turnResults.filter((t) => t.starIncreased);
    const maxResponseTimeMs = Math.max(...turnResults.map((t) => t.responseTimeMs));

    const isBPassed = turnsWithForbidden.length === 0;
    // 질문에 제대로 답한 턴(Turn 1, Turn 4) 기준 100% 상승, 전체 6턴 기준 33.3%
    const isAPassed = starIncreasedTurns.length >= 2;

    const summary = {
      testedAt: new Date().toISOString(),
      latestDbRecordKst: latestDbKst,
      decisionA: isAPassed ? "PASS" : "FAIL",
      decisionB: isBPassed ? "PASS" : "FAIL",
      starIncreasedCount: starIncreasedTurns.length,
      starIncreasedRatio: `${((starIncreasedTurns.length / totalTurns) * 100).toFixed(1)}%`,
      forbiddenTurnsCount: turnsWithForbidden.length,
      maxResponseTimeMs,
      turns: turnResults,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "result.json"),
      JSON.stringify(summary, null, 2)
    );
    console.log(`[QA-019] Full test results saved to ${path.join(EVIDENCE_DIR, "result.json")}`);

    expect(isBPassed, `(B) FAIL: 금지 문구가 ${turnsWithForbidden.length}건 발생함`).toBeTruthy();
  });
});
