import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const CHILD_ID = 'fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9';

test('Test mission page with parent auth and childId param', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });

  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  // Set child ID in localStorage as well
  await page.evaluate((cid) => {
    localStorage.setItem('k_child_id', cid);
    localStorage.setItem('k_pwa_intro_seen', '1');
  }, CHILD_ID);

  // Go to /child/missions?childId=...&roundType=round1_day
  await page.goto(`${DEV_BASE}/child/missions?childId=${CHILD_ID}&roundType=round1_day`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  console.log('Mission page URL:', page.url());
  const bodyText = await page.locator('body').innerText();
  console.log('Mission page body snippet:\n', bodyText.substring(0, 500));
});
