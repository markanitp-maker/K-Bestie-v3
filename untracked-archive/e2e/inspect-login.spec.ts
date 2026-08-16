import { test } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect qatesti-dev session after login', async ({ page }) => {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log('URL after login:', url);

  const meRes = await page.evaluate(async () => {
    const r = await fetch('/api/child/me');
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  });
  console.log('/api/child/me result:', JSON.stringify(meRes));

  const authUser = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me').catch(() => null);
    return r ? await r.json().catch(() => null) : null;
  });
  console.log('/api/auth/me result:', JSON.stringify(authUser));

  const localStorageData = await page.evaluate(() => {
    return { ...localStorage };
  });
  console.log('localStorage:', JSON.stringify(localStorageData));
});
