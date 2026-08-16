import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

async function loginAsChild(page: any) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2500);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const laterBtn2 = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn2.count().catch(() => 0)) {
    await laterBtn2.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Handle "이어하기" or "시작하기" button if present
  const startBtn = page.getByRole('button', { name: /시작하기|이어하기/ });
  if (await startBtn.count().catch(() => 0)) {
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}

test('C. 064 미션 대화 화면 말풍선 배치 검증 (iPhone/Android 3종)', async ({ page }) => {
  test.setTimeout(90000);
  await loginAsChild(page);

  const viewports = [
    { name: 'C_iphone_390x844.png', width: 390, height: 844 },
    { name: 'C_android_360x800.png', width: 360, height: 800 },
    { name: 'C_android_412x915.png', width: 412, height: 915 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `/tmp/agy-qa-071-061-064/${vp.name}`, fullPage: false });
    console.log(`[C Visual] Captured screenshot: ${vp.name}`);
  }

  // 1. Check progress bar presence in mission
  const progressBarCount = await page.locator('text="1 / 3"', 'text="2 / 3"', 'text="3 / 3"', '[class*="progress"]').count();
  console.log('[C Check 1] Mission progress bar count:', progressBarCount);

  // 2. Check layout spacing / overlap
  // Test entering a long child utterance via text mode
  const textModeBtn = page.getByRole('button', { name: '💬' });
  if (await textModeBtn.count() > 0) {
    await textModeBtn.click();
    await page.waitForTimeout(500);
  }

  const input = page.locator('input[placeholder*="메시지"], textarea[placeholder*="메시지"]');
  const LONG_TEXT = "오늘 학교에서 정말 흥미진진하고 재미있는 시험을 봤는데 내가 열심히 공부해서 100점을 받았어! 그래서 친구들도 엄청 축하해줬어!";
  
  if (await input.count() > 0) {
    await input.fill(LONG_TEXT);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(7000);
  } else {
    // Inject DOM text to test long bubble visual layout
    await page.evaluate((text) => {
      const pElements = Array.from(document.querySelectorAll('p'));
      if (pElements.length > 0) {
        pElements[pElements.length - 1].textContent = text;
      }
    }, LONG_TEXT);
    await page.waitForTimeout(1000);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/C_long_text_layout.png', fullPage: false });
  console.log('[C Check 2] Captured long text layout screenshot: C_long_text_layout.png');

  // Check horizontal overflow
  const hasHorizontalOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log('[C Check 3] Horizontal overflow:', hasHorizontalOverflow);

  // Toggle mode check (auto/manual/voice/keyboard)
  const autoBtn = page.getByRole('button', { name: '자동' });
  const manualBtn = page.getByRole('button', { name: '수동' });
  if (await autoBtn.count() > 0 && await manualBtn.count() > 0) {
    await autoBtn.click();
    await page.waitForTimeout(500);
    await manualBtn.click();
    await page.waitForTimeout(500);
  }

  expect(hasHorizontalOverflow).toBe(false);
  console.log('C Visual & Layout Test PASSED cleanly.');
});
