import { test } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect Chat Text Input Interaction', async ({ page }) => {
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

  // Click text mode button 💬
  const textModeBtn = page.getByRole('button', { name: '💬' });
  await textModeBtn.click();
  await page.waitForTimeout(1000);

  console.log('--- After clicking 💬 ---');
  console.log('Body Text:', await page.innerText('body'));

  const inputs = await page.locator('input, textarea').all();
  for (const input of inputs) {
    console.log('Input placeholder:', await input.getAttribute('placeholder'));
  }

  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/inspect_text_mode.png' });

  // Try typing a message and sending
  const chatInput = page.locator('input[placeholder*="메시지"], textarea[placeholder*="메시지"], input[type="text"]');
  if (await chatInput.count() > 0) {
    await chatInput.fill('안녕 케이야!');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    console.log('--- After sending message ---');
    console.log('Body Text:', await page.innerText('body'));
    await page.screenshot({ path: '/tmp/agy-qa-071-061-064/inspect_sent_message.png' });
  }
});
