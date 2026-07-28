import { test } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const viewports = [
  { width: 390, height: 844, name: '390x844' },
  { width: 320, height: 568, name: '320x568' },
  { width: 768, height: 1024, name: '768x1024' },
];

const SCREENSHOT_DIR = '/tmp/agy-qa-033';

test.describe('Visual QA - Mission Viewports', () => {
  for (const vp of viewports) {
    test(`mission screen screenshot at ${vp.name}`, async ({ page, context }) => {
      await context.grantPermissions(['microphone']);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      
      await page.goto('http://localhost:3910/login');
      await page.getByPlaceholder(/아이디/).fill('testi02');
      await page.getByPlaceholder(/비밀번호/).fill(process.env.QA_TEST_PASSWORD || '');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      
      await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
      await page.goto('http://localhost:3910/child/missions');
      
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000); // Wait for animations/rendering to settle

      // Dismiss Next.js devtools overlay if present
      await page.evaluate(() => {
        const nextjsPortal = document.querySelector('nextjs-portal');
        if (nextjsPortal) {
          const shadowRoot = nextjsPortal.shadowRoot;
          if (shadowRoot) {
            const toast = shadowRoot.querySelector('#nextjs-dev-tools-toast') || shadowRoot.querySelector('[data-nextjs-toast]');
            if (toast) {
              (toast as HTMLElement).style.display = 'none';
            }
          }
          (nextjsPortal as HTMLElement).style.display = 'none';
        }
      });
      await page.waitForTimeout(1000);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/mission_${vp.name}.png` });
    });
  }
});
