import { test, expect } from '@playwright/test';

const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD;

test.describe('KChatbotWidget Draggable on Parent Screen', () => {
  test.beforeEach(async ({ page }) => {
    if (!QA_TEST_PASSWORD) {
      throw new Error('QA_TEST_PASSWORD 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.');
    }
    await page.goto('/login');
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill('testp02');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_TEST_PASSWORD);
    
    // There are two buttons with text '로그인', one is '로그인 중...' or '로그인' for member.
    // The member login button is inside the form.
    await page.locator('form').getByRole('button', { name: '로그인' }).click();
    
    // Wait for redirect to /parent/home
    await page.waitForURL('**/parent/home**', { timeout: 10000 });
    
    // Clear localStorage to start fresh
    await page.evaluate(() => localStorage.removeItem('k_chatbot_widget_position'));
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('Scenario (1) Long press without move (>400ms) then release should open modal', async ({ page }) => {
    const btn = page.getByRole('button', { name: /문의하기 열기/ });
    await expect(btn).toBeVisible();

    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    
    // Perform long press without move
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    
    await page.waitForTimeout(500); // > 400ms
    await page.mouse.up();
    
    // Check if modal is opened
    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('text=케이에게 알려주세요')).toBeVisible();
  });

  test('Scenario (2) & (3) Drag button > 10px snaps to grid, and releasing does not open modal, persists on reload', async ({ page }) => {
    const btn = page.getByRole('button', { name: /문의하기 열기/ });
    await expect(btn).toBeVisible();

    let box = await btn.boundingBox();
    expect(box).not.toBeNull();
    
    // Drag
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    // Move to roughly middle-left of the screen
    const targetX = 10;
    const targetY = 300; // middle height
    
    // Move multiple steps to simulate drag
    await page.mouse.move(startX - 50, startY + 50, { steps: 5 });
    await page.mouse.move(targetX, targetY, { steps: 10 });
    
    // (3) Releasing does not open modal
    await page.mouse.up();
    
    const modal = page.locator('div[role="dialog"]');
    await expect(modal).not.toBeVisible({ timeout: 1000 });
    
    // Wait a bit for transition
    await page.waitForTimeout(500);
    
    // Check local storage for new position
    const savedPos = await page.evaluate(() => localStorage.getItem('k_chatbot_widget_position'));
    expect(savedPos).not.toBeNull();
    const pos = JSON.parse(savedPos!);
    expect(pos.edge).toBe('left');
    
    let newBox = await btn.boundingBox();
    expect(Math.abs(newBox!.x - box!.x)).toBeGreaterThan(10);
    
    // (2) Check if position is preserved after reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    const btnAfterReload = page.getByRole('button', { name: /문의하기 열기/ });
    await expect(btnAfterReload).toBeVisible();
    const boxAfterReload = await btnAfterReload.boundingBox();
    
    // The position should be approximately the same as before reload
    expect(Math.abs(boxAfterReload!.x - newBox!.x)).toBeLessThan(5);
    expect(Math.abs(boxAfterReload!.y - newBox!.y)).toBeLessThan(5);
  });
});
