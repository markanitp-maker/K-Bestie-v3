import { test } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect Chat Speech Bubble DOM Structure', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2000);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click 💬 button to enter text mode
  await page.getByRole('button', { name: '💬' }).click();
  await page.waitForTimeout(500);

  // Send message
  const input = page.locator('input[placeholder*="메시지"], textarea[placeholder*="메시지"]');
  await input.fill('안녕');
  await page.keyboard.press('Enter');
  
  // Wait 8 seconds for response
  await page.waitForTimeout(8000);

  // Inspect paragraphs or bubbles
  const domInfo = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('div, p, span'))
      .filter(el => el.children.length === 0 && el.textContent?.trim())
      .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.trim() }));
    return bubbles;
  });

  console.log('--- DOM Text Elements ---');
  console.log(JSON.stringify(domInfo, null, 2));
});
