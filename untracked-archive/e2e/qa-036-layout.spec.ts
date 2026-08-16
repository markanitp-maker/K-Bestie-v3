import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('QA-036 Mission Layout Verification', async ({ page }) => {
  test.setTimeout(120000);
  const screenshotsDir = '/tmp/agy-qa-036';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore some common non-fatal errors if needed, but let's log them all
      errors.push(text);
    }
  });

  // 1. Login
  await page.goto('http://localhost:3910/login');
  await page.getByPlaceholder(/아이디/).fill('testi02');
  // Use QA_TEST_PASSWORD
  await page.getByPlaceholder(/비밀번호/).fill(process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!');
  // Click exact submit button
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: path.join(screenshotsDir, '1-home.png') });

  // 2. Go to mission
  await page.goto('http://localhost:3910/child/missions');
  await page.waitForTimeout(3000); // let UI settle and mascot load
  
  // If restart button exists, click it to get a fresh state
  const restartButton = page.locator('button:has-text("다시 할래요")');
  if (await restartButton.isVisible().catch(() => false)) {
    await restartButton.click();
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(screenshotsDir, '2-mission-screen.png') });

  // 3. Verify Mascot Size
  // Let's find the K mascot image or its container
  const mascot = page.locator('canvas[aria-label="케이 마스코트"]').or(page.locator('img[alt="케이 마스코트"]')).first();
  await expect(mascot).toBeVisible();
  const mascotBox = await mascot.boundingBox();
  console.log(`[QA] Mascot Size: ${mascotBox?.width}x${mascotBox?.height}`);
  // Should be reasonably large (e.g. > 150px)
  expect(mascotBox?.width).toBeGreaterThan(150);

  // 4. Verify Side Cards Position (Sound / Chat Status)
  // Let's find the flex container. The side cards are usually in the same flex row as the mascot.
  // The layout changed to put them next to the mascot.
  // Sound card has '소리 켜짐' or '소리 꺼짐'
  const soundCard = page.locator('text=소리 켜짐').or(page.locator('text=소리 꺼짐')).first().locator('..');
  
  // Chat card has state text like 대기 중, 듣는 중, 생각 중, 말하는 중
  const chatCard = page.locator('text=대기 중').or(page.locator('text=듣는 중')).or(page.locator('text=생각 중')).or(page.locator('text=말하는 중')).first().locator('..');
  
  await expect(soundCard).toBeVisible();
  await expect(chatCard).toBeVisible();

  const soundBox = await soundCard.boundingBox();
  const chatBox = await chatCard.boundingBox();
  
  console.log(`[QA] Sound Card Position: x=${soundBox?.x}, width=${soundBox?.width}`);
  console.log(`[QA] Chat Card Position: x=${chatBox?.x}, width=${chatBox?.width}`);
  console.log(`[QA] Mascot Position: x=${mascotBox?.x}, width=${mascotBox?.width}`);

  // The cards should be adjacent to the mascot. 
  // Let's just check the distance between the elements.
  if (soundBox && mascotBox && chatBox) {
    // Assuming Sound is on the left, and Chat is on the right
    // Or vice versa. Let's calculate distance to mascot edges.
    
    // Sort them by x position
    const boxes = [
      { name: 'sound', box: soundBox },
      { name: 'chat', box: chatBox },
      { name: 'mascot', box: mascotBox }
    ].sort((a, b) => a.box.x - b.box.x);
    
    console.log(`[QA] Order from left to right: ${boxes.map(b => b.name).join(', ')}`);
    
    const leftCard = boxes[0];
    const centerMascot = boxes[1];
    const rightCard = boxes[2];
    
    expect(centerMascot.name).toBe('mascot');
    
    const distLeft = centerMascot.box.x - (leftCard.box.x + leftCard.box.width);
    const distRight = rightCard.box.x - (centerMascot.box.x + centerMascot.box.width);
    console.log(`[QA] Distance to Left Card: ${distLeft}px`);
    console.log(`[QA] Distance to Right Card: ${distRight}px`);
    
    // Assert they are close (not at far ends of the screen, e.g. < 150px gap on desktop/tablet)
    expect(distLeft).toBeLessThan(150);
    expect(distRight).toBeLessThan(150);
  }

  // 5. Verify Question Bubble text size
  const questionText = page.locator('p.text-\\[\\#3a2f2a\\]').first();
  await expect(questionText).toBeVisible();
  
  const computedStyle = await questionText.evaluate((el) => {
    return window.getComputedStyle(el).fontSize;
  });
  console.log(`[QA] Question Text Font Size: ${computedStyle}`);
  
  // Also take a screenshot for visual proof
  await page.screenshot({ path: path.join(screenshotsDir, '2b-mission-layout-details.png') });

  // 6. Test text input, send, mic
  // First switch to text mode if not already
  const textModeBtn = page.locator('button[aria-label="텍스트로 답하기"]');
  if (await textModeBtn.isVisible().catch(() => false)) {
    await textModeBtn.click();
    await page.waitForTimeout(1000);
  } else {
    // fallback toggle
    const toggleBtn = page.locator('button:has-text("텍스트 대화")');
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInput).toBeVisible();
  await textInput.fill('안녕');
  
  const sendBtn = page.locator('button[aria-label="전송"]');
  await expect(sendBtn).toBeVisible();
  await sendBtn.click();
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(screenshotsDir, '3-after-send.png') });

  // Check console errors
  // We filter out harmless react warnings or hydration errors if any, but ideally 0
  const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_'));
  console.log(`[QA] Console errors count: ${realErrors.length}`);
  if (realErrors.length > 0) {
    console.error('[QA] Errors:', realErrors);
  }
  // Wait, some non-fatal errors might happen, but instruction says "콘솔 에러 없음."
  expect(realErrors.length).toBe(0);
});
