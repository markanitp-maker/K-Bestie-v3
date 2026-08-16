import { test, expect } from '@playwright/test';

const viewports = [
  { width: 334, height: 672, name: 'Target-334x672' },
  { width: 360, height: 800, name: 'Android-360x800' },
  { width: 412, height: 915, name: 'Android-412x915' },
  { width: 390, height: 844, name: 'iPhone-390x844' }
];

test.describe('Free Chat Layout Measurement', () => {
  for (const vp of viewports) {
    test(`Measure ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      
      await page.goto('http://127.0.0.1:3002/login');
      await page.evaluate(() => {
        localStorage.setItem('kbestie_test_mode', 'true');
      });
      await page.fill('input[type="text"]', 'qa-parent');
      await page.fill('input[type="password"]', 'Test1234!');
      await page.click('button[type="submit"]');
      
      await page.waitForURL('**/child**', { timeout: 10000 }).catch(() => {});
      
      await page.goto('http://127.0.0.1:3002/chat', { waitUntil: 'domcontentloaded' });
      
      await page.waitForTimeout(2000); // let animations settle
      
      const metrics = await page.evaluate(() => {
        // Find elements more robustly based on the known structure
        const findBySelector = (s) => document.querySelector(s);
        
        let bubbleArea = null;
        let bubbleTail = null;
        const currentBubble = findBySelector('div.bg-white.rounded-\\[20px\\].border-\\[var\\(--color-k-orange\\)\\]');
        if (currentBubble) {
            bubbleArea = currentBubble.getBoundingClientRect();
            // Tail is the second absolute div inside it
            const tails = currentBubble.querySelectorAll('div.absolute');
            if(tails && tails.length > 0) {
               // The first tail is the orange border, the second is white fill. Their bottom is the same.
               bubbleTail = tails[0].getBoundingClientRect();
            }
        }
        
        const mascotArea = findBySelector('.free-chat-mascot-group')?.getBoundingClientRect();
        const mascotImg = findBySelector('.free-chat-mascot-group img')?.getBoundingClientRect();
        
        // Auto/Manual row
        let modeArea = null;
        const autoBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent && el.textContent.includes('자동'));
        if (autoBtn && autoBtn.parentElement) {
            modeArea = autoBtn.parentElement.getBoundingClientRect();
        }
        
        // Mic row
        let micArea = null;
        const micBtn = findBySelector('button[aria-label="대화 시작하기"], button[aria-label="텍스트로 답하기"]');
        if (micBtn && micBtn.parentElement && micBtn.parentElement.parentElement) {
            micArea = micBtn.parentElement.parentElement.getBoundingClientRect();
        }
        
        return {
           bubbleArea,
           bubbleTail,
           mascotArea,
           mascotImg,
           modeArea,
           micArea,
           viewportHeight: window.innerHeight
        };
      });
      
      console.log(`\n--- Metrics for ${vp.name} ---`);
      if(metrics.bubbleArea) {
         console.log(`Bubble Body Y: ${metrics.bubbleArea.top} ~ ${metrics.bubbleArea.bottom}`);
         if(metrics.bubbleTail) {
            console.log(`Bubble Tail Bottom: ${metrics.bubbleTail.bottom}`);
         }
      }
      if(metrics.mascotArea) {
         console.log(`Mascot Row Top: ${metrics.mascotArea.top}`);
      }
      if(metrics.modeArea) {
         console.log(`Auto/Manual Row Top: ${metrics.modeArea.top}`);
      }
      if(metrics.micArea) {
         console.log(`Mic Row Top: ${metrics.micArea.top}`);
         console.log(`Mic Row Bottom: ${metrics.micArea.bottom}`);
         console.log(`Bottom Gap: ${metrics.viewportHeight - metrics.micArea.bottom}`);
      }
      
      // Save screenshot
      await page.screenshot({ path: `e2e-results/chat-${process.env.TEST_PHASE || 'after'}-${vp.name}.png` });
    });
  }
});
