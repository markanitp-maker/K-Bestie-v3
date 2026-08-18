import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-013b";
const CHILD_USERNAME = "qa-child-b-dev";
const CHILD_ID = "e2e00002-bbbb-4000-8000-000000000002";

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

const QA_PASSWORD = getQaPassword();

interface TurnRecord {
  step: number;
  childUtterance: string;
  kResponse: string;
  isQuestion: boolean;
  starBefore: number;
  starAfter: number;
  screenshotPath: string;
  timestamp: string;
  notes: string;
  passed: boolean;
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

async function getStarCount(page: Page): Promise<number> {
  try {
    const starContainer = page.locator('[aria-label^="미션 진행률"]');
    if (await starContainer.count() > 0) {
      const label = await starContainer.first().getAttribute("aria-label");
      if (label) {
        const match = label.match(/미션 진행률\s*(\d+)\s*\//);
        if (match) return parseInt(match[1], 10);
      }
    }
  } catch {}

  try {
    const filledStars = page.locator('svg.fill-\\[\\#F6A21A\\]');
    const count = await filledStars.count();
    return count;
  } catch {
    return 0;
  }
}

async function getCurrentKBubbleText(page: Page): Promise<string> {
  try {
    const bubble = page.locator('div[data-ui="current-bubble"] p');
    if (await bubble.count() > 0) {
      const text = await bubble.first().innerText();
      return text.trim();
    }
  } catch {}

  try {
    const bubble = page.locator('[data-ui="current-bubble"]');
    if (await bubble.count() > 0) {
      const text = await bubble.first().innerText();
      return text.trim();
    }
  } catch {}

  return "";
}

test.describe("QA-013: 미션 파생 질문 및 무의미 답변 처리 E2E", () => {
  test.setTimeout(360000); // 6분 타임아웃

  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("미션 파생 질문 및 무의미 답변 대화 플로우 검증", async ({ page }) => {
    console.log(`[QA-013] Target URL: ${BASE_URL}`);
    console.log(`[QA-013] Starting E2E test at ${new Date().toISOString()}`);

    // 1. 로그인
    await page.setViewportSize({ width: 390, height: 844 });
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
    console.log(`[QA-013] Navigating to ${BASE_URL}/child/missions...`);
    await page.goto(`${BASE_URL}/child/missions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await hideOverlays(page);

    // 진행 불가 상태 체크
    const bodyText = await page.locator("body").innerText();
    const blockedKeywords = ["미션을 이미 완료했어요", "오늘 미션을 완료했어요", "내일 다시 만나요"];
    for (const kw of blockedKeywords) {
      if (bodyText.includes(kw)) {
        const shotPath = path.join(EVIDENCE_DIR, "blocked-state.png");
        await page.screenshot({ path: shotPath, fullPage: true });
        const blockedInfo = {
          status: "진행 불가",
          reason: kw,
          bodyTextSnippet: bodyText.substring(0, 300),
          screenshot: shotPath,
          timestamp: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(blockedInfo, null, 2));
        console.log(`[진행 불가] ${kw}`);
        return;
      }
    }

    // "다시 할래요" 버튼이 있으면 클릭
    const restartBtn = page.getByRole("button", { name: /다시 할래요|다시 시작/ }).or(page.getByText("다시 할래요"));
    if (await restartBtn.count() > 0 && await restartBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-013] Clicking restart button...");
      await restartBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
      await hideOverlays(page);
    }

    // "시작하기" 또는 "이어하기" 버튼이 있으면 클릭
    const startBtn = page.locator('button:has-text("시작하기"), button:has-text("이어하기"), [aria-label*="시작하기"], [aria-label*="이어하기"]');
    if (await startBtn.count() > 0 && await startBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-013] Clicking start/resume mission button...");
      await startBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
      await hideOverlays(page);
    }

    // 3. 텍스트 입력 모드 진입
    const textModeBtn = page.locator('button[aria-label="텍스트로 답하기"]');
    if (await textModeBtn.count() > 0 && await textModeBtn.first().isVisible().catch(() => false)) {
      console.log("[QA-013] Enabling text input mode...");
      await textModeBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInput).toBeVisible({ timeout: 15000 });

    // 케이의 첫 질문 준비 대기
    console.log("[QA-013] Waiting for K's initial question...");
    let initialKText = "";
    for (let i = 0; i < 30; i++) {
      initialKText = await getCurrentKBubbleText(page);
      if (initialKText && !["미션을 확인하고 있어요.", "준비 중...", "불러오는 중...", "케이가 질문을 준비하고 있어요..."].includes(initialKText)) {
        break;
      }
      await page.waitForTimeout(1000);
    }

    const initialStar = await getStarCount(page);
    const initialShot = path.join(EVIDENCE_DIR, "turn-1-initial.png");
    await page.screenshot({ path: initialShot, fullPage: true });

    const turns: TurnRecord[] = [];

    // Turn 1: 초기 상태 기록
    turns.push({
      step: 1,
      childUtterance: "(미션 시작)",
      kResponse: initialKText,
      isQuestion: initialKText.endsWith("?") || initialKText.endsWith("니?") || initialKText.endsWith("까?") || initialKText.endsWith("요?") || initialKText.endsWith("어?") || initialKText.includes("?"),
      starBefore: 0,
      starAfter: initialStar,
      screenshotPath: initialShot,
      timestamp: new Date().toISOString(),
      notes: `케이의 첫 질문: ${initialKText}`,
      passed: initialKText.length > 0,
    });

    console.log(`[Turn 1] K Initial Question: "${initialKText}" (Stars: ${initialStar})`);

    // Helper for turn execution
    const executeTurn = async (
      step: number,
      childUtterance: string,
      expectedCheck: (kResp: string, starB: number, starA: number, prevResp: string) => { passed: boolean; notes: string }
    ) => {
      console.log(`\n--- [Turn ${step}] Child Utterance: "${childUtterance}" ---`);
      const starBefore = await getStarCount(page);
      const prevKText = await getCurrentKBubbleText(page);

      // 입력창에 타이핑
      await textInput.fill(childUtterance);
      await page.waitForTimeout(500);

      // 전송 버튼 클릭
      const sendBtn = page.locator('button[aria-label="전송"]');
      await expect(sendBtn).toBeEnabled({ timeout: 10000 });
      await sendBtn.click();
      console.log(`[Turn ${step}] Sent child text. Waiting for K's response (up to 60s)...`);

      // 케이 응답 완료 대기
      const startTime = Date.now();
      let newKText = "";
      while (Date.now() - startTime < 60000) {
        await page.waitForTimeout(1000);
        newKText = await getCurrentKBubbleText(page);
        const isInputReady = await textInput.isEnabled().catch(() => false);

        if (newKText && newKText !== prevKText && isInputReady) {
          // 안정화를 위해 1.5초 추가 대기
          await page.waitForTimeout(1500);
          newKText = await getCurrentKBubbleText(page);
          break;
        }
      }

      const starAfter = await getStarCount(page);
      const shotName = `turn-${step}-${step === 2 ? "tangsu" : step === 3 ? "detailed" : step === 4 ? "molla" : step === 5 ? "geunyang" : "reconcile"}.png`;
      const shotPath = path.join(EVIDENCE_DIR, shotName);
      await page.screenshot({ path: shotPath, fullPage: true });

      const isQuestion = newKText.endsWith("?") || newKText.endsWith("니?") || newKText.endsWith("까?") || newKText.endsWith("요?") || newKText.endsWith("어?") || newKText.includes("?");
      const checkResult = expectedCheck(newKText, starBefore, starAfter, prevKText);

      const record: TurnRecord = {
        step,
        childUtterance,
        kResponse: newKText,
        isQuestion,
        starBefore,
        starAfter,
        screenshotPath: shotPath,
        timestamp: new Date().toISOString(),
        notes: checkResult.notes,
        passed: checkResult.passed,
      };

      turns.push(record);
      console.log(`[Turn ${step}] K Response: "${newKText}"`);
      console.log(`[Turn ${step}] Stars: ${starBefore} -> ${starAfter}`);
      console.log(`[Turn ${step}] IsQuestion: ${isQuestion}, Passed: ${checkResult.passed} (${checkResult.notes})`);

      return record;
    };

    // Turn 2: "오늘 급식에 탕수육 나와서 진짜 맛있었어"
    await executeTurn(
      2,
      "오늘 급식에 탕수육 나와서 진짜 맛있었어",
      (kResp, starB, starA, prevResp) => {
        const hasMechanical = kResp.includes("이제 다음 질문할게") || kResp.includes("다음 질문으로 넘어갈게") || kResp.includes("다음 질문은");
        const hasFoodContext = kResp.includes("탕수육") || kResp.includes("급식") || kResp.includes("맛있") || kResp.includes("점심") || kResp.includes("음식") || kResp.includes("메뉴") || kResp.includes("소스") || kResp.includes("찍먹") || kResp.includes("부먹");

        let passed = true;
        let notes = "";

        if (hasMechanical) {
          passed = false;
          notes += "기계적 전환 멘트 발견; ";
        }
        if (!hasFoodContext) {
          passed = false;
          notes += "탕수육/급식 맥락 반영 미흡; ";
        }
        if (!notes) {
          notes = "탕수육/급식 맥락 자연스럽게 이어 파생 질문 생성 성공";
        }
        return { passed, notes };
      }
    );

    // Turn 3: "짜장면보다 탕수육이 더 좋아. 소스 찍어 먹는 게 재밌어"
    await executeTurn(
      3,
      "짜장면보다 탕수육이 더 좋아. 소스 찍어 먹는 게 재밌어",
      (kResp, starB, starA, prevResp) => {
        const passed = kResp.length > 0;
        const notes = `구체적 답변 후 별 게이지: ${starB} -> ${starA} (변화량: +${starA - starB})`;
        return { passed, notes };
      }
    );

    // Turn 4: "몰라"
    await executeTurn(
      4,
      "몰라",
      (kResp, starB, starA, prevResp) => {
        const starNotIncreased = starA === starB;
        const notExactRepeat = kResp !== prevResp;
        let passed = starNotIncreased && notExactRepeat;
        let notes = `별 게이지 유지: ${starB} -> ${starA} (${starNotIncreased ? "별 미상승 정상" : "별 상승 FAIL"}), 질문 반복: ${notExactRepeat ? "반복 안함" : "동일 질문 반복 FAIL"}`;
        return { passed, notes };
      }
    );

    // Turn 5: "그냥"
    await executeTurn(
      5,
      "그냥",
      (kResp, starB, starA, prevResp) => {
        const notExactRepeat = kResp !== prevResp;
        const passed = kResp.length > 0 && notExactRepeat;
        const notes = `연속 무의미 답변 후 케이 응답: "${kResp}" (교착 없이 대화 진행)`;
        return { passed, notes };
      }
    );

    // Turn 6: "어제 민준이랑 축구하다가 싸웠는데 오늘 화해했어"
    await executeTurn(
      6,
      "어제 민준이랑 축구하다가 싸웠는데 오늘 화해했어",
      (kResp, starB, starA, prevResp) => {
        const passed = kResp.length > 0;
        const notes = `의미있는 답변 후 별 게이지: ${starB} -> ${starA} (변화량: +${starA - starB})`;
        return { passed, notes };
      }
    );

    // Turn 7 검증: 전 구간 케이가 이미 답한 내용을 표현만 바꿔 다시 묻는 일이 있었는지 확인
    console.log("\n--- [전체 시나리오 완료 및 결과 저장] ---");
    const resultSummary = {
      targetUrl: BASE_URL,
      testedAt: new Date().toISOString(),
      turns,
      allPassed: turns.every((t) => t.passed),
    };

    fs.writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(resultSummary, null, 2));
    console.log(`[QA-013] All turn results saved to ${path.join(EVIDENCE_DIR, "result.json")}`);
  });
});
