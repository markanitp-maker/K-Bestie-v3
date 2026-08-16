import { test, expect } from '@playwright/test';

test.describe('Mission Layout Coordinates', () => {
  const VIEWPORTS = [
    { name: 'Target-333x672', width: 333, height: 672 },
    { name: 'iPhone-390x844', width: 390, height: 844 },
    { name: 'Android-360x800', width: 360, height: 800 }
  ];

  for (const vp of VIEWPORTS) {
    test(`Measure ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      
      // Navigate and login
      await page.goto('http://127.0.0.1:3000/login');
      await page.evaluate(() => {
        localStorage.setItem('kbestie_test_mode', 'true');
      });
      await page.fill('input[type="text"]', 'qa-parent');
      await page.fill('input[type="password"]', 'Test1234!');
      await page.click('button[type="submit"]');
      
      await page.waitForURL('**/child**', { timeout: 10000 }).catch(() => {});
      
      // Go to a fake mission to trigger layout
      await page.goto('http://127.0.0.1:3000/child/mission/test_mission_123');
      await page.waitForTimeout(2000);
      
      const metrics = await page.evaluate(() => {
        const getBox = (el) => el ? (() => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height, left: r.left };
        })() : null;

        // Current bubble
        let bubble = null;
        const bubbleContainer = document.querySelector('.relative.z-20.flex.flex-col.items-center.w-full.shrink-0');
        if (bubbleContainer) {
            bubble = bubbleContainer;
        }

        // Mascot
        const mascotImg = document.querySelector('img[alt*="마스코트"], img[src*="mascot"]');
        let mascot = mascotImg ? mascotImg.closest('.relative.flex.flex-col.items-center') : null;

        // State Card (Right)
        const stateCardText = Array.from(document.querySelectorAll('span')).find(el => el.textContent === '확인 중' || el.textContent === '대기 중' || el.textContent === '시작 전');
        let stateCard = stateCardText ? stateCardText.closest('.bg-\\[\\#D5ECFF\\]\\/60') : null;

        // Platform / Base
        const base = document.querySelector('.absolute.bottom-0.w-\\[clamp\\(135px\\,38vw\\,175px\\)\\]');

        // Auto Button
        const autoBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent && el.textContent.includes('자동'));

        // Mic Button
        const micBtn = document.querySelector('button[aria-label="음성 입력 시작"], button[aria-label="음성 입력 중지"], button:has(svg)');

        return {
           bubble: getBox(bubble),
           mascot: getBox(mascot),
           stateCard: getBox(stateCard),
           base: getBox(base),
           autoBtn: getBox(autoBtn),
           micBtn: getBox(micBtn)
        };
      });
      
      console.log(`\n--- Metrics for ${vp.name} ---`);
      console.log(JSON.stringify(metrics, null, 2));
      
      await page.screenshot({ path: `test-results/layout-${vp.name}.png` });
    });
  }
});
