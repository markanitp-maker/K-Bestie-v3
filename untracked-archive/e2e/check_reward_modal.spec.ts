import { test } from '@playwright/test';

test('inspect completed mission state', async ({ page }) => {
  test.setTimeout(60000);

  const responses: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/mission/')) {
      try {
        const body = await res.text();
        responses.push(`${res.url()} -> ${res.status()} -> ${body.slice(0, 1000)}`);
      } catch {}
    }
  });

  await page.goto('https://k-bestie-v3-dev.vercel.app/login');
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.TESTI02_PASSWORD || '');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/child/home', { timeout: 15000 });

  await page.goto('https://k-bestie-v3-dev.vercel.app/child/missions');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: '/tmp/agy-qa-035-lite/6-revisit-completed.png' });

  console.log('--- mission API responses ---');
  for (const r of responses) console.log(r);
  console.log('--- page URL ---', page.url());
});
