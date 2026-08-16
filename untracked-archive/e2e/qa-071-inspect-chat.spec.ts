import { test } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect Chat Page UI Elements', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  console.log('--- Chat Page Inner Text ---');
  console.log(await page.innerText('body'));

  console.log('--- All Buttons ---');
  const buttons = await page.locator('button').allInnerTexts();
  console.log(buttons);

  console.log('--- All Inputs / Textareas ---');
  const inputs = await page.locator('input, textarea').all();
  for (const input of inputs) {
    console.log('Input tag:', await input.evaluate(el => el.tagName), 'placeholder:', await input.getAttribute('placeholder'));
  }

  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/inspect_chat_initial.png' });
});
