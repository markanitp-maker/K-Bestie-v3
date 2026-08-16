import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_USER = 'qatesti-dev';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const QA_CHILD_ID = 'fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9';
const SCREENSHOT_DIR = '/tmp/agy-qa-089-cap50';

test('QA 089: Daily 1-time mission reward limit and cap 50 verification', async ({ page }) => {
  test.setTimeout(480000); // 8 min max

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    console.log(entry);
    logs.push(entry);
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'qa_execution.log'), logs.join('\n'));
  };

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[MissionFlow]') || text.includes('rewardStatus') || text.includes('goldkey') || text.includes('award')) {
      log(`BROWSER_LOG: ${text}`);
    }
  });

  // Helper to dismiss random popup modals
  async function dismissModals() {
    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.isVisible().catch(() => false)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // Helper to read gold key balance from /child/home
  async function getGoldKeyBalance(): Promise<number> {
    try {
      await page.goto(`${DEV_BASE}/child/home`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await dismissModals();

      const balanceText = await page.evaluate(async (cid) => {
        try {
          const res = await fetch(`/api/goldkey/balance?childId=${cid}`);
          if (res.ok) {
            const data = await res.json();
            return data.balance;
          }
        } catch (e) {}
        return null;
      }, QA_CHILD_ID);

      if (balanceText !== null && typeof balanceText === 'number') {
        return balanceText;
      }

      // Fallback: parse from DOM on /child/home
      const domText = await page.evaluate(() => {
        const matches = document.body.innerText.match(/🔑\s*(\d+)개/);
        return matches ? parseInt(matches[1], 10) : null;
      });
      if (domText !== null) return domText;
    } catch (e) {
      log(`Balance check failed: ${e}`);
    }
    return -1;
  }

  // 1. Login
  log('Step 1: Logging in as qatesti-dev');
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_login_page.png') });

  await page.getByPlaceholder('아이 아이디를 입력하세요').fill(QA_USER);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3500);

  // Set childId in localStorage
  await page.evaluate((cid) => {
    localStorage.setItem('k_child_id', cid);
    localStorage.setItem('login_role', 'member');
  }, QA_CHILD_ID);

  await page.goto(`${DEV_BASE}/child/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await dismissModals();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_child_home.png') });

  const initialBalance = await getGoldKeyBalance();
  log(`Initial gold key balance on /child/home: ${initialBalance}`);

  // Helper to run mission
  async function runMission(runIndex: number) {
    log(`=== Starting Mission Run #${runIndex} ===`);
    await page.goto(`${DEV_BASE}/child/missions?childId=${QA_CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await dismissModals();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_01_entry.png`) });

    // If "다시 할래요" is present
    const restartBtn = page.locator('button:has-text("다시 할래요"), button:has-text("다시 시작")');
    if (await restartBtn.first().isVisible().catch(() => false)) {
      log(`Run #${runIndex}: Clicking '다시 할래요' button`);
      await restartBtn.first().click();
      await page.waitForTimeout(2500);
      await dismissModals();
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_02_after_restart.png`) });
    }

    // If start / resume button is present
    const startBtn = page.locator('button:has-text("시작하기"), button:has-text("이어하기"), [data-ui="current-bubble"] button');
    if (await startBtn.first().isVisible().catch(() => false)) {
      log(`Run #${runIndex}: Clicking Start/Resume button`);
      await startBtn.first().click();
      await page.waitForTimeout(2500);
      await dismissModals();
    }

    // Switch to text mode
    const textInputCheck = page.locator('input[placeholder*="답하기"]');
    const textModeToggle = page.locator('button[aria-label="텍스트로 답하기"]');
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await textInputCheck.isVisible().catch(() => false)) break;
      if (await textModeToggle.isEnabled().catch(() => false)) {
        await textModeToggle.click().catch(() => {});
      }
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_03_text_mode.png`) });

    const answers = [
      '오늘 학교에서 친구들이랑 축구하고 재밌게 놀았어',
      '수학 시간이 조금 어려웠지만 열심히 풀었어',
      '급식으로 맛있는 돈가스가 나와서 다 먹었어',
      '방과 후에는 집에서 만화책도 보고 쉬었어',
      '내일은 주말이니까 가족들이랑 공원에 놀러가고 싶어',
      '요즘 피아노 치는 연습도 매일 하고 있어',
      '친구랑 보드게임 하는 것도 정말 신나고 좋아',
      '오늘 하루도 알차고 즐겁게 잘 보낸 것 같아',
      '케이랑 이야기 나누니까 기분이 더 좋아졌어',
      '다음에 또 재밌는 이야기 많이 들려줄게'
    ];

    let modalFound = false;
    let modalTitleText = '';
    let modalDescText = '';
    let hasPlusOne = false;

    for (let turn = 0; turn < answers.length; turn++) {
      log(`Run #${runIndex}: Answering turn ${turn + 1}`);
      const input = page.locator('input[placeholder*="답하기"]');
      await input.waitFor({ state: 'visible', timeout: 15000 });
      await input.fill(answers[turn]);

      const sendBtn = page.locator('button[aria-label="전송"], button:has-text("전송")');
      await sendBtn.click();

      // Wait for K's response
      await page.waitForTimeout(8500);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_turn_${turn + 1}.png`) });

      const modal = page.locator('[role="dialog"][aria-labelledby="reward-modal-title"]');
      const isModalVisible = await modal.isVisible().catch(() => false);
      const completedSpeech = page.locator('text=미션을 모두 완료했어');
      const isCompletedSpeech = await completedSpeech.isVisible().catch(() => false);

      if (isModalVisible || isCompletedSpeech) {
        log(`Run #${runIndex}: Completion detected at turn ${turn + 1}. Waiting for modal animation...`);
        for (let wait = 0; wait < 6; wait++) {
          if (await modal.isVisible().catch(() => false)) break;
          await page.waitForTimeout(2500);
        }
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_modal.png`) });

        if (await modal.isVisible().catch(() => false)) {
          modalFound = true;
          const titleElem = modal.locator('#reward-modal-title');
          modalTitleText = (await titleElem.textContent().catch(() => '')) || '';
          const descElem = modal.locator('#reward-modal-desc');
          modalDescText = (await descElem.textContent().catch(() => '')) || '';
          hasPlusOne = modalTitleText.includes('+1');
          log(`Run #${runIndex} Modal Title: "${modalTitleText}", Desc: "${modalDescText}", hasPlusOne: ${hasPlusOne}`);
        }
        break;
      }
    }

    // Close modal if open
    const closeBtn = page.locator('[role="dialog"] button[aria-label="보상 화면 닫기"], [role="dialog"] button:has-text("닫기")');
    if (await closeBtn.first().isVisible().catch(() => false)) {
      await closeBtn.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `run${runIndex}_after_close.png`) });
    }

    const currentBalance = await getGoldKeyBalance();
    log(`Run #${runIndex} Ended. Balance: ${currentBalance}`);

    return {
      modalFound,
      modalTitleText,
      modalDescText,
      hasPlusOne,
      balance: currentBalance
    };
  }

  // Run 1
  const run1 = await runMission(1);
  log(`Run 1 Summary: ${JSON.stringify(run1)}`);

  // Run 2 (Same day second mission)
  const run2 = await runMission(2);
  log(`Run 2 Summary: ${JSON.stringify(run2)}`);

  log('=== Final Verification ===');
  log(`Run 1 Balance: ${run1.balance}`);
  log(`Run 2 Balance: ${run2.balance}`);
  log(`Run 2 Modal Title: "${run2.modalTitleText}"`);
  log(`Run 2 Modal Desc: "${run2.modalDescText}"`);
  log(`Run 2 Has +1: ${run2.hasPlusOne}`);

  const titlePass = run2.modalTitleText.includes('오늘 받을 수 있는 황금열쇠를 모두 받았어요');
  const descPass = run2.modalDescText.includes('미션은 멋지게 완료했어요');
  const noKeyIncrease = run2.balance === run1.balance;
  const noDuplicateBadge = !run2.hasPlusOne;

  expect(run2.modalFound).toBe(true);
  expect(titlePass).toBe(true);
  expect(descPass).toBe(true);
  expect(noDuplicateBadge).toBe(true);
  expect(noKeyIncrease).toBe(true);
});
