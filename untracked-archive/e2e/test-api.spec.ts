import { test, expect } from '@playwright/test';
import fs from 'fs';

const DEV_URL = 'https://k-bestie-v3-dev.vercel.app';
const PROD_URL = 'https://app.k-bestie.com';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

async function testApi(page, siteUrl, parentUsername, childUsername) {
  console.log(`\n=== Testing ${siteUrl} ===`);
  
  // 1. Login Parent
  await page.goto(`${siteUrl}/login`);
  await page.waitForTimeout(2000);
  await page.getByPlaceholder('아이디').fill(parentUsername);
  await page.getByPlaceholder('비밀번호').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  
  // Wait for network idle or error
  await page.waitForTimeout(3000);
  
  // Check if there is an error message
  const errorLocator = page.locator('.text-red-500, .text-red-600, .error');
  if (await errorLocator.count() > 0) {
    console.log(`[${siteUrl}] Login error:`, await errorLocator.first().innerText());
  }

  const url = page.url();
  console.log(`[${siteUrl}] Current URL after parent login: ${url}`);
  if (!url.includes('/parent')) {
    console.log(`[${siteUrl}] Parent login failed, skipping API tests`);
    return;
  }
  console.log(`[${siteUrl}] Parent Logged in`);

  // Parent API Test
  const pRes = await page.evaluate(async () => {
    const res = await fetch('/api/parent/k-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: 'fake-id', message: '테스트', history: [] })
    });
    return { status: res.status, text: await res.text() };
  });
  console.log(`[${siteUrl}] Parent-K Chat API: ${pRes.status} - ${pRes.text.substring(0, 100)}`);

  // Logout Parent
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  const context = page.context();
  await context.clearCookies();

  // 2. Login Child
  await page.goto(`${siteUrl}/login`);
  await page.waitForTimeout(2000);
  await page.getByPlaceholder('아이디').fill(childUsername);
  await page.getByPlaceholder('비밀번호').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  
  await page.waitForTimeout(3000);
  const curl = page.url();
  if (!curl.includes('/child')) {
    console.log(`[${siteUrl}] Child login failed, skipping child API tests`);
    return;
  }
  console.log(`[${siteUrl}] Child Logged in`);

  // Child API Test
  const cRes = await page.evaluate(async () => {
    const res = await fetch('/api/mission/respond-lean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childId: 'fake-id',
        transcriptText: "테스트",
        k_utterance_text: "테스트",
        mission_id: "m1",
        mission_step_index: 0
      })
    });
    return { status: res.status, text: await res.text() };
  });
  console.log(`[${siteUrl}] Mission Respond-Lean: ${cRes.status} - ${cRes.text.substring(0, 100)}`);

  const memRes = await page.evaluate(async () => {
    const res = await fetch('/api/parent/memory/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childId: 'fake-id',
        query: "테스트"
      })
    });
    return { status: res.status, text: await res.text() };
  });
  console.log(`[${siteUrl}] Freechat Memory Query: ${memRes.status} - ${memRes.text.substring(0, 100)}`);
}

test('Test Dev and Prod APIs', async ({ page }) => {
  await testApi(page, DEV_URL, 'testp02', 'testi02');
  await testApi(page, PROD_URL, 'qatest-parent-prod', 'qatest-child-prod');
});
