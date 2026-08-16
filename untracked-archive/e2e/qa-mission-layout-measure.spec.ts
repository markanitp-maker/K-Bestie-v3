import { test, expect } from '@playwright/test';

const viewports = [
  { width: 345, height: 729, name: 'Target-345x729' },
  { width: 360, height: 800, name: 'Android-360x800' },
  { width: 412, height: 915, name: 'Android-412x915' },
  { width: 390, height: 844, name: 'iPhone-390x844' }
];

test.describe('Mission Layout Measurement', () => {
  for (const vp of viewports) {
    test(`Measure ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      
      await page.goto('http://127.0.0.1:3000/login');
      await page.evaluate(() => {
        localStorage.setItem('kbestie_test_mode', 'true');
      });
      await page.fill('input[type="text"]', 'qa-parent');
      await page.fill('input[type="password"]', 'Test1234!');
      await page.click('button[type="submit"]');
      
      await page.waitForURL('**/child**', { timeout: 10000 }).catch(() => {});
      
      await page.goto('http://127.0.0.1:3000/child/mission/test_mission_id', { waitUntil: 'networkidle' });
      
      await page.waitForTimeout(2000);
      
      const metrics = await page.evaluate(() => {
        // Grid Row 1: progress bar
        const progressBar = document.querySelector('.bg-white.rounded-full.shadow-sm.flex.items-center.px-4');
        
        // Find Grid Row 2 and 3 more robustly by looking for specific descendants
        // Grid Row 2: chat area contains the mascot spacer or fade out
        let chatArea = null;
        const fadeOut = document.querySelector('.bg-gradient-to-b.from-\\[\\#D5ECFF\\].to-transparent');
        if (fadeOut && fadeOut.parentElement) {
            chatArea = fadeOut.parentElement;
        }

        // Grid Row 3: mascot area contains the mute card
        let mascotArea = null;
        const muteCard = document.querySelector('button[aria-label="소리 꺼짐"], button[aria-label="소리 켜짐"], button:has(.bg-white.flex.items-center.justify-center.text-gray-700)');
        if (muteCard && muteCard.parentElement) {
            mascotArea = muteCard.parentElement;
        }
        
        return {
           progressBar: progressBar ? progressBar.getBoundingClientRect() : null,
           chatArea: chatArea ? chatArea.getBoundingClientRect() : null,
           mascotArea: mascotArea ? mascotArea.getBoundingClientRect() : null,
        };
      });
      
      console.log(`\n--- Metrics for ${vp.name} ---`);
      if(metrics.progressBar && metrics.chatArea && metrics.mascotArea) {
         console.log(`Progress Bar Bottom: ${metrics.progressBar.bottom}`);
         console.log(`Chat Area Top: ${metrics.chatArea.top}`);
         console.log(`Chat Area Bottom: ${metrics.chatArea.bottom}`);
         console.log(`Chat Area Height: ${metrics.chatArea.height}`);
         console.log(`Mascot Area Top: ${metrics.mascotArea.top}`);
         console.log(`Gap PB -> Chat: ${metrics.chatArea.top - metrics.progressBar.bottom}`);
         console.log(`Gap Chat -> Mascot: ${metrics.mascotArea.top - metrics.chatArea.bottom}`);
      } else {
         console.log('Failed to find one or more elements', metrics);
      }
      
      await page.screenshot({ path: `e2e-results/before-${vp.name}.png` });
    });
  }
});
