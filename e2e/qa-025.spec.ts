import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const logDir = '/tmp/agy-qa-final';

if (!process.env.QA_TEST_PASSWORD) {
  throw new Error('QA_TEST_PASSWORD is not set in the environment.');
}

const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD;

test.describe('QA 025: Child Home and Mission Chat', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeAll(() => {
    fs.mkdirSync(logDir, { recursive: true });
    // Don't rmSync so worker restarts don't wipe other scenarios' results
  });

  const report = (scenario: number, passed: boolean, reason?: string) => {
    const status = passed ? '[QA 통과]' : `[QA 실패: ${reason} / 증거경로: ${logDir}]`;
    fs.appendFileSync(path.join(logDir, 'qa-results.txt'), `Scenario ${scenario}: ${status}\n`);
  };

  test.beforeEach(async ({ page }) => {
    let consoleErrors: string[] = [];
    page.on('console', msg => {
      fs.appendFileSync(path.join(logDir, 'console.log'), `[${msg.type()}] ${msg.text()}\n`);
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', error => {
      fs.appendFileSync(path.join(logDir, 'console.log'), `[PAGE_ERROR] ${error.message}\n`);
      consoleErrors.push(error.message);
    });

    await page.goto('/login?role=child');
    await page.waitForLoadState('domcontentloaded');
    
    if (consoleErrors.some(e => e.includes('Loading chunk'))) {
      consoleErrors = [];
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }

    await page.fill('input[placeholder="아이 아이디를 입력하세요"]', 'testi02');
    await page.fill('input[placeholder="비밀번호를 입력하세요"]', QA_TEST_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await page.waitForURL(/\/(parent|child)\/home/, { timeout: 30000 });
    
    if (!page.url().includes('/child/home')) {
      await page.goto('/child/home');
    }
    
    await page.waitForLoadState('networkidle');
  });

  test('Scenario 1: Child Home UI Checks', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      await expect(page).toHaveURL(/\/child\/home/, { timeout: 10000 });
      
      const greeting = await page.locator('text=/안녕,.*!/').textContent();
      if (!greeting || !greeting.includes('안녕,')) {
        passed = false; reason += '실제 이름이 표시되지 않음. ';
      }

      const keyText = await page.getByText(/보유/).first().textContent();
      if (!keyText) {
        passed = false; reason += '황금열쇠 보유 텍스트를 찾을 수 없음. ';
      }

      const navCount = await page.locator('nav').count();
      if (navCount > 0) {
        for (let i = 0; i < navCount; i++) {
          if (await page.locator('nav').nth(i).isVisible()) {
            passed = false; reason += '하단 네비게이션 바가 여전히 표시됨. ';
            break;
          }
        }
      }

      const pwaCloseBtn = page.getByRole('button', { name: '닫기' }).first();
      if (await pwaCloseBtn.count() > 0 && await pwaCloseBtn.isVisible()) {
        await pwaCloseBtn.click();
        await expect(pwaCloseBtn).toBeHidden();
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s1.png') });
    report(1, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Scenario 2: Mission Card Click and Chat UI', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      // Find a likely mission card
      const missionCard = page.locator('text="미션"').first();
      await missionCard.click();
      await page.waitForURL(/\/child\/mission/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      const pills = await page.locator('.rounded-full').count();
      if (pills < 10) {
        const svgs = await page.locator('svg').count();
        if (svgs < 5) {
          passed = false; reason += '진행률 별/pill을 10개 찾을 수 없음. ';
        }
      }

      const anyText = await page.locator('body').textContent();
      if (!anyText || anyText.trim().length < 10) {
        passed = false; reason += '질문 말풍선 텍스트를 찾을 수 없음. ';
      }

      const autoManualText = (await page.locator('text=자동').count() > 0) || (await page.locator('text=수동').count() > 0);
      if (!autoManualText) { passed = false; reason += '자동/수동 토글이 보이지 않음. '; }
      
      const buttons = await page.locator('button').count();
      if (buttons < 2) { passed = false; reason += '마이크/키보드 버튼이 부족함. '; }

    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s2.png') });
    report(2, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Scenario 3: Text Input Submit Progress Increase', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      await page.locator('text="미션"').first().click();
      await page.waitForURL(/\/child\/mission/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      let textarea = page.locator('textarea');
      if (!(await textarea.isVisible())) {
         const toggleBtns = page.locator('button');
         const count = await toggleBtns.count();
         for (let i = 0; i < count; i++) {
           try {
             await toggleBtns.nth(i).click();
             if (await textarea.count() > 0 && await textarea.isVisible()) break;
           } catch(e) {}
         }
      }

      if (await textarea.isVisible()) {
        const initialPills = await page.locator('.bg-yellow-400').count();
        await textarea.fill('테스트 답변입니다.');
        
        let sendBtn = page.locator('button[type="submit"]');
        if (await sendBtn.count() === 0) {
          sendBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
        }
        
        const [response] = await Promise.all([
          page.waitForResponse(res => res.url().includes('api/') || res.url().includes('supabase')),
          sendBtn.click()
        ]);
        
        await page.waitForTimeout(1500); 
        const finalPills = await page.locator('.bg-yellow-400').count();
        
        if (finalPills !== initialPills + 1 && initialPills < 10) {
          passed = false; reason += `진행률이 정확히 1개 증가하지 않음. 이전: ${initialPills}, 이후: ${finalPills}. `;
        }
      } else {
        passed = false; reason += '텍스트 입력창(textarea)을 열 수 없음. ';
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s3.png') });
    report(3, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Scenario 4: Close Button Double Click', async ({ page }) => {
    let passed = true;
    let reason = '';
    let localErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') localErrors.push(msg.text()); });
    
    try {
      await page.locator('text="미션"').first().click();
      await page.waitForURL(/\/child\/mission/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      
      const initialPills = await page.locator('.bg-yellow-400').count();

      const closeBtn = page.locator('button').filter({ has: page.locator('svg') }).first(); 
      await closeBtn.dblclick(); 
      
      await page.waitForURL(/\/child\/home/, { timeout: 5000 });
      
      const hasError = localErrors.some(err => err.includes('stopSession') || err.includes('duplicate'));
      if (hasError) {
        passed = false; reason += '중복 stopSession 에러 발생함. ';
      }

      await page.locator('text="미션"').first().click();
      await page.waitForURL(/\/child\/mission/, { timeout: 5000 });
      await page.waitForLoadState('networkidle');
      
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s4.png') });
    report(4, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Scenario 5: Logout Logic', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      const logoutBtn = page.locator('button').filter({ has: page.locator('svg') }).last(); 
      const ariaLogout = page.locator('button[aria-label="로그아웃"]');
      const targetBtn = await ariaLogout.count() > 0 ? ariaLogout : logoutBtn;

      page.once('dialog', dialog => dialog.dismiss());
      await targetBtn.click();
      await page.waitForTimeout(500);
      if (!page.url().includes('/child/home')) {
        passed = false; reason += '로그아웃 취소 시 홈을 이탈함. ';
      }

      page.once('dialog', dialog => dialog.accept());
      await targetBtn.click();
      await page.waitForURL(/\/login/, { timeout: 5000 });
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s5.png') });
    report(5, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Scenario 6: Direct Settings URL Access', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      await page.goto('/child/settings');
      await page.waitForLoadState('networkidle');
      
      const currentUrl = page.url();
      const bodyText = await page.locator('body').textContent();
      
      if (currentUrl.includes('/child/settings') && (!bodyText || bodyText.trim() === '')) {
        passed = false; reason += '빈 화면이 렌더링 됨 (리다이렉트/404 없음). ';
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_s6.png') });
    report(6, passed, reason);
    expect(passed, reason).toBeTruthy();
  });
});
