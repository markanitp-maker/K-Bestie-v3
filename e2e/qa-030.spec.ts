import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const password = process.env.QA_TEST_PASSWORD;
if (!password) {
  throw new Error('QA_TEST_PASSWORD is not set in environment variables');
}

test.describe("030 부모 일간 리포트 및 히스토리 달력 검증", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3910/login?role=parent');
    await page.getByPlaceholder('아이디').fill('testp02');
    await page.getByPlaceholder('비밀번호').fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL('**/parent**');
    await page.goto('http://localhost:3910/parent/report');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const timestamp = new Date().getTime();
      const safeTitle = testInfo.title.replace(/[\s/]/g, '_');
      const dir = '/tmp/agy-qa-030-final';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${safeTitle}_${timestamp}.png` });
    }
  });

  test("1. 로그인 후 /parent/report 진입 - 일간 탭 기본 활성, 최근 7일 요약 카드와 일간 리포트 카드 목록 확인", async ({ page }) => {
    const dailyTab = page.getByText('일간', { exact: true });
    await expect(dailyTab).toBeVisible();
    await expect(dailyTab).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByText('최근 7일').first()).toBeVisible();
    await expect(page.getByText('대화').first()).toBeVisible(); // '전체 대화횟수' 등
    await expect(page.getByText('요일별 상태점').first()).toBeVisible();
    
    await expect(page.getByRole('button', { name: '지난 이력 보기' })).toBeVisible();
  });

  test("2. 일간 리포트 카드에 대화횟수/시간대/생성시각 하단 Metadata 없음 확인", async ({ page }) => {
    const mainContent = page.locator('main');
    const text = await mainContent.innerText();

    expect(text).not.toContain('대화 횟수:');
    expect(text).not.toContain('시간대:');
    expect(text).not.toContain('생성 시각:');
  });

  test("3. 지난 이력 보기 클릭 - 달력 Bottom Sheet 열림, 미래 날짜 비활성 확인", async ({ page }) => {
    await page.getByRole('button', { name: '지난 이력 보기' }).click();
    
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    
    // 달력 요소가 있는지 (보통 aria-label="달력" 또는 DayPicker 요소)
    const disabledDays = dialog.locator('button:disabled');
    expect(await disabledDays.count()).toBeGreaterThanOrEqual(1);
  });

  test("4. 달력에서 리포트 있는 날짜 선택 - 상세 페이지 이동", async ({ page }) => {
    await page.getByRole('button', { name: '지난 이력 보기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // aria-disabled가 아닌 날짜 중 오늘/과거 날짜를 찾기 위해 (rdp-day 클래스 등이 있을 수 있음)
    // button 중에 숫자 텍스트만 가지고 disabled가 아닌 버튼
    const activeDays = dialog.locator('button:not([disabled])').filter({ hasText: /^\d+$/ });
    const count = await activeDays.count();
    
    if (count > 0) {
      await activeDays.first().click();
      // url 변경 감지
      await page.waitForURL('**/parent/report/daily/**');
      expect(page.url()).toContain('/parent/report/daily/');
    }
  });

  test("5. 달력 ESC로 닫기 - 포커스 복귀", async ({ page }) => {
    const historyBtn = page.getByRole('button', { name: '지난 이력 보기' });
    await historyBtn.click();
    
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    
    await page.keyboard.press('Escape');
    
    await expect(dialog).not.toBeVisible();
    await expect(historyBtn).toBeFocused();
  });

  test("6. 주간 탭 클릭 - 주간 리포트 이동", async ({ page }) => {
    const weeklyTab = page.getByText('주간', { exact: true });
    await weeklyTab.click();
    
    await expect(weeklyTab).toHaveAttribute('aria-selected', 'true');
    // URL에 week가 포함되거나 컴포넌트가 바뀌는지 확인
    expect(page.url()).toContain('tab=weekly');
  });
});
