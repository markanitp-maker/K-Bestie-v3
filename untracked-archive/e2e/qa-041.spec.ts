import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({ viewport: { width: 375, height: 812 } });

test('QA-041: Parent Home Insight Cards Non-interactive', async ({ page }) => {
  const password = process.env.QA_TEST_PASSWORD;
  if (!password) {
    throw new Error('QA_TEST_PASSWORD is not set. Please set it in env.');
  }

  const logDir = '/tmp/agy-qa-041';
  fs.mkdirSync(logDir, { recursive: true });

  let results: string[] = [];

  try {
    await page.goto('https://k-bestie-v3-dev.vercel.app/login?role=parent');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="text"]', 'testp02');
    await page.fill('input[type="password"]', password);
    
    const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
    await Promise.all([
      page.waitForNavigation(),
      loginBtn.click()
    ]);
    
    // In case it didn't go to /parent/home, manually go
    await page.goto('https://k-bestie-v3-dev.vercel.app/parent/home');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // 1. 8개 상태 카드 정상 표시 확인
    const labels = [
      '학교·학원 생활', '친구 관계', '마음 흐름', '관심사·취향', 
      '공부 고민', '디지털·콘텐츠', '선생님·어른', '반복 이야기'
    ];

    for (const label of labels) {
      const el = page.locator(`text="${label}"`).first();
      await expect(el).toBeVisible();
    }
    
    await page.screenshot({ path: path.join(logDir, '1_cards_visible.png') });
    results.push('1. 8개 상태 카드 정상 표시: PASS');

    // 2 & 3. Hover / Click test
    const firstCardTitle = page.locator(`text="학교·학원 생활"`).first();
    const cardContainer = firstCardTitle.locator('..').locator('..'); // Attempt to find container

    const cursorStyle = await firstCardTitle.evaluate((node) => {
      const container = node.closest('.bg-white') || node.parentElement;
      return window.getComputedStyle(container).cursor;
    });
    
    if (cursorStyle === 'pointer') {
      results.push('3. 카드 Hover 시 커서(pointer) 변화 없음: FAIL (pointer 됨)');
    } else {
      results.push('3. 카드 Hover 시 커서 변화 없음: PASS');
    }

    const currentUrl = page.url();
    await firstCardTitle.evaluate((node) => {
      const container = node.closest('.bg-white') || node;
      (container as HTMLElement).click();
    });
    
    await page.waitForTimeout(1000); 
    await page.screenshot({ path: path.join(logDir, '2_after_click.png') });
    
    // Check if modal exists
    const modalVisible = await page.locator('[role="dialog"]').count() > 0;
    const urlChanged = page.url() !== currentUrl;

    if (modalVisible || urlChanged) {
      results.push(`2. 클릭 시 페이지 이동이나 모달 없음: FAIL (이동: ${urlChanged}, 모달: ${modalVisible})`);
    } else {
      results.push('2. 클릭 시 페이지 이동이나 모달 없음: PASS');
    }

    // 4. 리포트 탭 정상 이동 확인
    const reportTab = page.locator('text="리포트"').first();
    await expect(reportTab).toBeVisible();
    
    await Promise.all([
      page.waitForNavigation(),
      reportTab.click()
    ]);
    
    await page.screenshot({ path: path.join(logDir, '3_report_tab.png') });

    if (page.url().includes('/parent/report')) {
      results.push('4. 하단 리포트 탭 정상 이동: PASS');
    } else {
      results.push('4. 하단 리포트 탭 정상 이동: FAIL (경로 다름: ' + page.url() + ')');
    }

  } catch (error: any) {
    console.error('Test execution error:', error.message);
    results.push('Test Execution Error: ' + error.message);
  }

  console.log('--- TEST RESULTS ---');
  results.forEach(r => console.log(r));
  fs.writeFileSync(path.join(logDir, 'results.txt'), results.join('\n'));
});
