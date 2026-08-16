import { test, expect } from '@playwright/test';

const CHILD_ID = '11111111-1111-1111-1111-111111111111';

test.describe('TTS Mute Sound Off Network & API 5-Turn Verification', () => {

  test('Dev Environment 5-Turn Verification', async ({ page }) => {
    let ttsRequestCountMuted = 0;
    let ttsRequestCountUnmuted = 0;
    let isMutedState = false;

    page.on('request', request => {
      if (request.url().includes('/api/voice/tts')) {
        if (isMutedState) {
          ttsRequestCountMuted++;
          console.log('[DEV MUTED API CALL]', request.url());
        } else {
          ttsRequestCountUnmuted++;
          console.log('[DEV UNMUTED API CALL]', request.url());
        }
      }
    });

    await page.goto('http://localhost:3000/child/home');
    await page.evaluate((cid) => {
      localStorage.setItem('k_child_id', cid);
      localStorage.setItem('k_voice_input_mode:' + cid, 'stt_tts');
    }, CHILD_ID);

    isMutedState = false;
    await page.goto('http://localhost:3000/child/missions');
    await page.waitForTimeout(3000);

    // 온보딩 또는 시작 버튼 클릭 시도
    const startBtn = page.locator('button:has-text("시작"), button:has-text("미션"), button:has-text("대화 시작")').first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    console.log(`[DEV BEFORE MUTE] Unmuted Calls: ${ttsRequestCountUnmuted}`);

    // 소리 끄기 버튼 클릭
    const toggleBtn = page.locator('button').filter({ hasText: /소리 켜짐|소리 꺼짐|🔊|🔇/i }).first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(1000);
    }
    isMutedState = true;

    // 소리 꺼짐 상태에서 5턴 실행
    for (let turn = 1; turn <= 5; turn++) {
      const input = page.locator('input[type="text"], textarea').first();
      if (await input.isVisible()) {
        await input.fill(`Dev Mute Turn ${turn}`);
        const sendBtn = page.locator('button').filter({ hasText: /전송|보내기/i }).first();
        if (await sendBtn.isVisible()) await sendBtn.click();
        else await input.press('Enter');
        await page.waitForTimeout(2000);
      }
    }

    console.log(`[DEV RESULTS] Unmuted Calls: ${ttsRequestCountUnmuted}, Muted Calls: ${ttsRequestCountMuted}`);
    expect(ttsRequestCountMuted).toBe(0);
  });

  test('Production Environment 5-Turn Verification', async ({ page }) => {
    let ttsRequestCountMuted = 0;
    let ttsRequestCountUnmuted = 0;
    let isMutedState = false;

    page.on('request', request => {
      if (request.url().includes('/api/voice/tts')) {
        if (isMutedState) {
          ttsRequestCountMuted++;
          console.log('[PROD MUTED API CALL]', request.url());
        } else {
          ttsRequestCountUnmuted++;
          console.log('[PROD UNMUTED API CALL]', request.url());
        }
      }
    });

    await page.goto('https://k-bestie-v3.vercel.app/child/home');
    await page.evaluate((cid) => {
      localStorage.setItem('k_child_id', cid);
      localStorage.setItem('k_voice_input_mode:' + cid, 'stt_tts');
    }, CHILD_ID);

    isMutedState = false;
    await page.goto('https://k-bestie-v3.vercel.app/child/missions');
    await page.waitForTimeout(3000);

    const startBtn = page.locator('button:has-text("시작"), button:has-text("미션"), button:has-text("대화 시작")').first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    console.log(`[PROD BEFORE MUTE] Unmuted Calls: ${ttsRequestCountUnmuted}`);

    const toggleBtn = page.locator('button').filter({ hasText: /소리 켜짐|소리 꺼짐|🔊|🔇/i }).first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(1000);
    }
    isMutedState = true;

    for (let turn = 1; turn <= 5; turn++) {
      const input = page.locator('input[type="text"], textarea').first();
      if (await input.isVisible()) {
        await input.fill(`Prod Mute Turn ${turn}`);
        const sendBtn = page.locator('button').filter({ hasText: /전송|보내기/i }).first();
        if (await sendBtn.isVisible()) await sendBtn.click();
        else await input.press('Enter');
        await page.waitForTimeout(2000);
      }
    }

    console.log(`[PROD RESULTS] Unmuted Calls: ${ttsRequestCountUnmuted}, Muted Calls: ${ttsRequestCountMuted}`);
    expect(ttsRequestCountMuted).toBe(0);
  });

});
