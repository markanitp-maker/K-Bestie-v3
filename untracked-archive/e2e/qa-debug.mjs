import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://k-bestie-v3-dev.vercel.app');
  await page.fill('input[type="text"]', 'testp02');
  await page.fill('input[type="password"]', process.env.QA_TEST_PASSWORD || '');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/parent/home**');
  await page.goto('https://k-bestie-v3-dev.vercel.app/parent/report/weekly');
  await page.waitForTimeout(3000);
  
  const text = await page.textContent('body');
  console.log("BODY TEXT:", text.replace(/\s+/g, ' ').substring(0, 2000));
  
  await browser.close();
})();
