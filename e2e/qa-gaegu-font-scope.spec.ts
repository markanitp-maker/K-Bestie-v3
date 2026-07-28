import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

test('home greeting headline uses Gaegu, rest of home stays Pretendard', async ({ page }) => {
  await page.goto('http://localhost:3910/login');
  await page.getByPlaceholder(/아이디/).fill('testi02');
  await page.getByPlaceholder(/비밀번호/).fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
  await page.goto('http://localhost:3910/child/home');
  await page.waitForLoadState('networkidle');

  const h1Font = await page.locator('h1').first().evaluate(el => getComputedStyle(el).fontFamily);
  console.log('HOME h1 font:', h1Font);
  expect(h1Font).toContain('Gaegu');

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  console.log('HOME body font:', bodyFont);
  expect(bodyFont).not.toContain('Gaegu');

  await page.screenshot({ path: '/tmp/agy-qa-gaegu/home.png' });
});

test('play screen title uses Gaegu, subtitle stays Pretendard', async ({ page }) => {
  await page.goto('http://localhost:3910/login');
  await page.getByPlaceholder(/아이디/).fill('testi02');
  await page.getByPlaceholder(/비밀번호/).fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
  await page.goto('http://localhost:3910/child/play');
  await page.waitForLoadState('networkidle');

  const titleFont = await page.getByText('케이와 놀이', { exact: true }).first().evaluate(el => getComputedStyle(el).fontFamily);
  console.log('PLAY title font:', titleFont);
  expect(titleFont).toContain('Gaegu');

  const subtitleFont = await page.getByText('하고 싶은 놀이를 골라보세요').first().evaluate(el => getComputedStyle(el).fontFamily);
  console.log('PLAY subtitle font:', subtitleFont);
  expect(subtitleFont).not.toContain('Gaegu');

  await page.screenshot({ path: '/tmp/agy-qa-gaegu/play.png' });
});
