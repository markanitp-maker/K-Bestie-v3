import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const OUT_DIR = '/tmp/agy-qa-freechat-scenarios';

test('Dev QA FreeChat Scenarios 1-6', async ({ page }) => {
  test.setTimeout(360000); // 6 minutes for 6 LLM interactions

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });

  console.log('[STEP 1] Navigating to /login...');
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });

  // Login as child using qatesti-dev
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  // Dismiss PWA / notice modal if present
  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  console.log('[STEP 2] Navigating to /chat...');
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Click start conversation if '대화 시작하기' button appears
  const startBtn = page.getByRole('button', { name: '대화 시작하기' });
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2000);
  }

  // Switch to text mode (💬)
  console.log('[STEP 3] Switching to text mode (💬)...');
  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await keyboardBtn.click();
    await page.waitForTimeout(500);
  } else {
    const textIconBtn = page.getByRole('button', { name: '💬' });
    if (await textIconBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await textIconBtn.click();
      await page.waitForTimeout(500);
    }
  }

  const inputLocator = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]').first();
  await inputLocator.waitFor({ state: 'visible', timeout: 15000 });

  // Function to send message and wait for K's updated response bubble text
  async function sendMessageAndGetResponse(inputPrompt: string, waitMs = 12000): Promise<string> {
    console.log(`\n========================================`);
    console.log(`[USER INPUT]: "${inputPrompt}"`);

    // Get current K text before sending so we can detect when it updates
    const getKText = async () => {
      return await page.evaluate(() => {
        const mainParagraph = document.querySelector('div.relative.z-20.w-\\[clamp\\(84\\%\\,86\\%\\,88\\%\\)\\] p, div.relative.z-20 p');
        if (mainParagraph && mainParagraph.textContent?.trim()) {
          return mainParagraph.textContent.trim();
        }
        const pElements = Array.from(document.querySelectorAll('p'));
        const textElements = pElements
          .map(p => p.textContent?.trim() || '')
          .filter(t => t.length > 0 && !t.includes('케이에게 텍스트로') && !t.includes('대화를 시작해 보세요') && !t.includes('연결 중') && !t.includes('잠시만 기다려주세요'));
        return textElements.length > 0 ? textElements[textElements.length - 1] : '';
      });
    };

    const previousText = await getKText();

    await inputLocator.fill(inputPrompt);

    const sendBtn = page.getByRole('button', { name: '전송' });
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    // Wait until response text updates or waitMs expires
    const startTime = Date.now();
    let latestText = previousText;

    while (Date.now() - startTime < waitMs) {
      await page.waitForTimeout(1000);
      latestText = await getKText();
      if (latestText && latestText !== previousText && !latestText.includes('준비하고 있어요') && !latestText.includes('잠시만')) {
        console.log(`[UPDATED K RESPONSE]: "${latestText}" (took ${(Date.now() - startTime)/1000}s)`);
        return latestText;
      }
    }

    console.log(`[FINAL K RESPONSE]: "${latestText}"`);
    return latestText;
  }

  const results: Record<string, { prompt: string; response: string }> = {};

  // Scenario 1: "나 오늘 학교에서 시험 100점 맞았어!"
  console.log('\n>>> Running Scenario 1...');
  const res1 = await sendMessageAndGetResponse("나 오늘 학교에서 시험 100점 맞았어!");
  results['1'] = { prompt: "나 오늘 학교에서 시험 100점 맞았어!", response: res1 };

  // Scenario 2: "오늘 친구랑 싸웠어"
  console.log('\n>>> Running Scenario 2...');
  const res2 = await sendMessageAndGetResponse("오늘 친구랑 싸웠어");
  results['2'] = { prompt: "오늘 친구랑 싸웠어", response: res2 };

  // Scenario 3: "나 방귀 뀌었어 ㅋㅋ"
  console.log('\n>>> Running Scenario 3...');
  const res3 = await sendMessageAndGetResponse("나 방귀 뀌었어 ㅋㅋ");
  results['3'] = { prompt: "나 방귀 뀌었어 ㅋㅋ", response: res3 };

  // Scenario 4: "하늘은 왜 파래?"
  console.log('\n>>> Running Scenario 4...');
  const res4 = await sendMessageAndGetResponse("하늘은 왜 파래?");
  results['4'] = { prompt: "하늘은 왜 파래?", response: res4 };

  // Scenario 5: "지금 자동모드야 수동모드야?"
  console.log('\n>>> Running Scenario 5...');
  const res5 = await sendMessageAndGetResponse("지금 자동모드야 수동모드야?");
  results['5'] = { prompt: "지금 자동모드야 수동모드야?", response: res5 };

  // Scenario 6: "몰라" -> "그냥" -> "몰라"
  console.log('\n>>> Running Scenario 6-1 ("몰라")...');
  const res6_1 = await sendMessageAndGetResponse("몰라");
  console.log('\n>>> Running Scenario 6-2 ("그냥")...');
  const res6_2 = await sendMessageAndGetResponse("그냥");
  console.log('\n>>> Running Scenario 6-3 ("몰라")...');
  const res6_3 = await sendMessageAndGetResponse("몰라");

  results['6_1'] = { prompt: "몰라", response: res6_1 };
  results['6_2'] = { prompt: "그냥", response: res6_2 };
  results['6_3'] = { prompt: "몰라", response: res6_3 };

  fs.writeFileSync(path.join(OUT_DIR, 'captured_responses.json'), JSON.stringify(results, null, 2), 'utf8');

  console.log('\n=======================================');
  console.log('ALL CAPTURED RESPONSES:');
  console.log(JSON.stringify(results, null, 2));
  console.log('=======================================\n');
});
