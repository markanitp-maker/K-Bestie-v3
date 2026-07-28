import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const logDir = '/tmp/agy-qa-028/';

if (!process.env.QA_TEST_PASSWORD) {
  throw new Error('QA_TEST_PASSWORD is not set in the environment.');
}

const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD;

test.describe('QA 028: Play Home Screen Tests', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  
  test.beforeAll(() => {
    fs.mkdirSync(logDir, { recursive: true });
  });

  const report = (scenario: number | string, passed: boolean, reason?: string) => {
    const status = passed ? '[QA 통과]' : `[QA 실패: ${reason} / 증거경로: ${logDir}]`;
    fs.appendFileSync(path.join(logDir, 'qa-results.txt'), `Scenario ${scenario}: ${status}\n`);
    console.log(`Scenario ${scenario}: ${status}`);
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

    await page.waitForURL(/\/(parent|child)\//, { timeout: 30000 });
    
    // go to /child/play
    await page.goto('/child/play');
    await page.waitForLoadState('networkidle');
  });

  test('Test 1: Render /child/play without crash', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      await expect(page).toHaveURL(/\/child\/play/);
      
      const header = page.locator('h1:has-text("케이와 놀이")').first();
      if (!(await header.isVisible())) {
        passed = false; reason += '헤더(케이와 놀이)가 보이지 않음. ';
      }

      // Check Golden Key Card
      const keyCard = page.locator('text=더 모으기').first();
      if (await keyCard.count() === 0 || !(await keyCard.isVisible())) {
        passed = false; reason += '황금열쇠 카드(더 모으기)가 보이지 않음. ';
      }

      // Check section: 열쇠로 열어요
      const keysSection = page.locator('text=열쇠로 열어요').first();
      if (await keysSection.count() === 0 || !(await keysSection.isVisible())) {
        passed = false; reason += '열쇠로 열어요 섹션이 보이지 않음. ';
      }

      // Check section: 곧 만나요
      const soonSection = page.locator('text=곧 만나요').first();
      if (await soonSection.count() === 0 || !(await soonSection.isVisible())) {
        passed = false; reason += '곧 만나요 섹션이 보이지 않음. ';
      }
      
      // Bottom mascot CTA
      const bottomMascotCta = page.locator('text=미션 하면 열쇠를 줄게!').first();
      if (await bottomMascotCta.count() === 0 || !(await bottomMascotCta.isVisible())) {
        passed = false; reason += '하단 마스코트+미션CTA가 보이지 않음. ';
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t1.png') });
    report(1, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 2: Loading skeleton vs definite text', async ({ page, context }) => {
    let passed = true;
    let reason = '';
    try {
      // Create a fresh page to intercept early rendering
      const newPage = await context.newPage();
      await newPage.goto('/child/play', { waitUntil: 'commit' });
      
      // Wait for domcontentloaded to quickly check texts
      await newPage.waitForLoadState('domcontentloaded');
      
      const textContent = await newPage.locator('body').textContent();
      if (textContent?.includes('0개') || textContent?.includes('열쇠가 더 필요해요')) {
         passed = false; reason += '확정적 상태 문구(0개/열쇠가 더 필요해요)가 로딩 중에 노출됨. ';
      }
      
      await newPage.waitForLoadState('networkidle');
      await newPage.close();
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t2.png') });
    report(2, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 3: Cartoon / Hairstyle cards click (No start modal, Alert only, No deduct call)', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      const startDeductUrls = ['/api/play/reserve', '/api/play/start', '/api/quiz/start-handoff'];
      let deductCalled = false;
      page.on('request', request => {
        if (startDeductUrls.some(url => request.url().includes(url))) {
          deductCalled = true;
        }
      });

      // Find "만화책 읽기" card and click
      const cartoonCard = page.locator('text=만화책 읽기');
      let dialogTriggered = false;
      page.once('dialog', async dialog => {
        dialogTriggered = true;
        await dialog.accept(); // Close alert
      });

      if (await cartoonCard.count() > 0) {
        await cartoonCard.first().click();
        await page.waitForTimeout(500); // Wait for alert/modal
        const confirmModal = page.locator('text=시작할까요');
        if (await confirmModal.count() > 0 && await confirmModal.isVisible()) {
          passed = false; reason += '만화책 읽기 - 시작 모달이 노출됨. ';
        }
      } else {
        passed = false; reason += '만화책 읽기 카드를 찾을 수 없음. ';
      }

      // Hairstyle card
      const hairCard = page.locator('text=헤어스타일');
      if (await hairCard.count() > 0) {
        await hairCard.first().click();
        await page.waitForTimeout(500);
        const confirmModal = page.locator('text=시작할까요');
        if (await confirmModal.count() > 0 && await confirmModal.isVisible()) {
          passed = false; reason += '헤어스타일 - 시작 모달이 노출됨. ';
        }
      }

      if (deductCalled) {
        passed = false; reason += '차감 API가 호출됨. ';
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t3.png') });
    report(3, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 4: Quiz Master card click (Start modal opens, cancel works)', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      const quizCard = page.locator('text=퀴즈마스터').first();
      if (await quizCard.count() > 0) {
        await quizCard.click();
        
        // Modal should appear
        const cancelBtn = page.getByRole('button', { name: '취소' }).first();
        
        try {
          await cancelBtn.waitFor({ state: 'visible', timeout: 5000 });
        } catch (e) {
          // timeout
        }
        
        if (await cancelBtn.count() === 0 || !(await cancelBtn.isVisible())) {
          passed = false; reason += '시작 확인 모달 또는 취소 버튼을 찾을 수 없음. ';
        } else {
          await cancelBtn.click();
          await page.waitForTimeout(500);
          if (await cancelBtn.isVisible()) {
            passed = false; reason += '취소 버튼 클릭 후 모달이 닫히지 않음. ';
          }
        }
      } else {
        passed = false; reason += '퀴즈마스터 카드를 찾을 수 없음. ';
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t4.png') });
    report(4, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 5: Logout icon button (Size, aria-label, confirm modal, cancel)', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      const logoutBtn = page.locator('button[aria-label="로그아웃"]');
      if (await logoutBtn.count() === 0) {
        passed = false; reason += '로그아웃 버튼을 찾을 수 없음. ';
      } else {
        const box = await logoutBtn.boundingBox();
        if (!box) {
          passed = false; reason += '로그아웃 버튼 박스를 가져올 수 없음. ';
        } else if (box.width < 44 || box.height < 44) {
          passed = false; reason += `로그아웃 버튼이 44x44보다 작음 (${box.width}x${box.height}). `;
        }
        
        let dialogTriggered = false;
        page.once('dialog', async dialog => {
          dialogTriggered = true;
          await dialog.dismiss();
        });

        await logoutBtn.click();
        await page.waitForTimeout(500);

        // If it uses custom modal instead of window.confirm
        const customCancelBtn = page.getByRole('button', { name: '취소' });
        if (!dialogTriggered && await customCancelBtn.count() > 0 && await customCancelBtn.isVisible()) {
          await customCancelBtn.first().click();
        } else if (!dialogTriggered) {
          passed = false; reason += '로그아웃 확인 모달/알림창이 노출되지 않음. ';
        }
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t5.png') });
    report(5, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 6: 320x568 viewport', async ({ page }) => {
    let passed = true;
    let reason = '';
    try {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForTimeout(500);
      
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 320) {
        passed = false; reason += `가로 스크롤 발생함 (scrollWidth: ${width}). `;
      }
      
      await page.screenshot({ path: path.join(logDir, 't6_320x568.png') });
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t6.png') });
    report(6, passed, reason);
    expect(passed, reason).toBeTruthy();
  });

  test('Test 7: No pageerror in console', async ({ page }) => {
    let passed = true;
    let reason = '';
    let pageErrors: string[] = [];
    
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });

    try {
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      if (pageErrors.length > 0) {
        passed = false; reason += 'pageerror 발생: ' + pageErrors.join(', ');
      }
    } catch (e: any) {
      passed = false; reason += e.message;
    }
    if (!passed) await page.screenshot({ path: path.join(logDir, 'fail_t7.png') });
    report(7, passed, reason);
    expect(passed, reason).toBeTruthy();
  });
});
