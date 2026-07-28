import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const password = process.env.QA_TEST_PASSWORD;
if (!password) {
  throw new Error('QA_TEST_PASSWORD is not set in environment variables');
}

test.describe("027 자녀 프로필 수정 및 요금제 변경 요청", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3910/login?role=parent');
    
    // member login (regular login form)
    await page.getByPlaceholder('아이디').fill('testp02');
    await page.getByPlaceholder('비밀번호').fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    
    await page.waitForURL('**/parent**');
    await page.goto('http://localhost:3910/parent/home');
    await page.waitForLoadState('networkidle');
    
    await page.goto('http://localhost:3910/parent/settings');
    
    // Open the child profile menu block
    const menuToggle = page.getByText('아이 정보 관리').first();
    await menuToggle.waitFor({ state: 'visible' });
    await menuToggle.click();
    
    // Click '수정하기' on the first child
    const editBtn = page.getByRole('button', { name: '수정하기' }).first();
    await editBtn.waitFor({ state: 'visible' });
    await editBtn.click();
    
    // Wait for the modal to be visible
    await expect(page.getByText('자녀 프로필 수정').first()).toBeVisible();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const timestamp = new Date().getTime();
      const safeTitle = testInfo.title.replace(/[\s/]/g, '_');
      const dir = '/tmp/agy-qa-final';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${safeTitle}_${timestamp}.png` });
    }
  });

  test("1. 기존 성/이름 자동 표시 확인", async ({ page }) => {
    const familyNameInput = page.getByPlaceholder('성');
    const givenNameInput = page.getByPlaceholder('이름');
    
    const familyName = await familyNameInput.inputValue();
    const givenName = await givenNameInput.inputValue();
    
    expect(familyName.trim().length).toBeGreaterThan(0);
    expect(givenName.trim().length).toBeGreaterThan(0);
  });

  test("2. 성/이름 빈칸 검증 및 서버 요청 차단", async ({ page }) => {
    const familyNameInput = page.getByPlaceholder('성');
    await familyNameInput.fill('');
    
    let requestMade = false;
    page.on('request', request => {
      if (request.url().includes('/api/child') && ['PUT', 'POST', 'PATCH'].includes(request.method())) {
        requestMade = true;
      }
    });

    await page.getByRole('button', { name: /^저장$/ }).click();
    
    await expect(page.getByText('성을 입력해 주세요.')).toBeVisible();
    
    await page.waitForTimeout(500);
    expect(requestMade).toBe(false);

    await familyNameInput.fill('테스트성');
    const givenNameInput = page.getByPlaceholder('이름');
    await givenNameInput.fill('');
    
    await page.getByRole('button', { name: /^저장$/ }).click();
    await expect(page.getByText('이름을 입력해 주세요.')).toBeVisible();
    
    await page.waitForTimeout(500);
    expect(requestMade).toBe(false);
  });

  test("3. 관심사 미선택 오류 검증", async ({ page }) => {
    const interestsContainer = page.locator('div').filter({ hasText: /^관심사$/ }).locator('..');
    const interestButtons = interestsContainer.locator('button');
    const count = await interestButtons.count();
    
    for (let i = 0; i < count; i++) {
      const btn = interestButtons.nth(i);
      const className = await btn.getAttribute('class');
      if (className && className.includes('bg-[var(--color-k-orange)]')) {
        await btn.click();
      }
    }
    
    await page.getByRole('button', { name: /^저장$/ }).click();
    await expect(page.getByText('관심사를 한 개 이상 선택해 주세요.')).toBeVisible();
  });

  test("4. 유효한 값으로 저장 성공", async ({ page }) => {
    const givenNameInput = page.getByPlaceholder('이름');
    await givenNameInput.fill('테스트' + Math.floor(Math.random() * 1000));
    
    const interestsContainer = page.locator('div').filter({ hasText: /^관심사$/ }).locator('..');
    const firstInterest = interestsContainer.locator('button').first();
    const className = await firstInterest.getAttribute('class');
    if (className && !className.includes('bg-[var(--color-k-orange)]')) {
      await firstInterest.click();
    }

    await page.getByRole('button', { name: /^저장$/ }).click();
    
    await expect(page.getByText('자녀 정보가 저장되었어요.')).toBeVisible();
    await expect(page.getByText('자녀 프로필 수정').first()).not.toBeVisible();
  });

  test("5. 요금제 변경 요청 생성 및 완료 화면 확인", async ({ page }) => {
    const planButtons = page.locator('button', { hasText: /케어/ });
    const count = await planButtons.count();
    let clicked = false;
    
    for (let i = 0; i < count; i++) {
      const btn = planButtons.nth(i);
      const text = await btn.textContent();
      if (!text?.includes('현재 이용 중') && !text?.includes('승인 대기 중')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      test.skip(true, "클릭 가능한 다른 요금제가 없습니다 (모두 승인 대기 또는 현재 이용 중).");
      return;
    }
    
    await expect(page.getByText('요금제 변경을 요청할까요?')).toBeVisible();
    await page.getByRole('button', { name: '변경 요청' }).click();
    
    await expect(page.getByText('요금제 변경 요청이 접수되었어요')).toBeVisible();
    await page.getByRole('button', { name: '확인' }).click();
  });

  test("6. 모달 재진입 시 요금제 요청 상태 확인 및 중복 생성 방지", async ({ page }) => {
    const checkPending = async () => {
      const badge = page.getByText('승인 대기 중', { exact: true });
      return (await badge.count()) > 0;
    };
    
    if (!(await checkPending())) {
      const planButtons = page.locator('button', { hasText: /케어/ });
      const count = await planButtons.count();
      for (let i = 0; i < count; i++) {
        const btn = planButtons.nth(i);
        const text = await btn.textContent();
        if (!text?.includes('현재 이용 중') && !text?.includes('승인 대기 중')) {
          await btn.click();
          break;
        }
      }
      
      const confirmDialog = page.getByText('요금제 변경을 요청할까요?');
      if (await confirmDialog.isVisible()) {
        await page.getByRole('button', { name: '변경 요청' }).click();
        await page.getByRole('button', { name: '확인' }).click();
        
        await page.getByText('아이 정보 관리').first().click();
        await page.getByRole('button', { name: '수정하기' }).first().click();
        await expect(page.getByText('자녀 프로필 수정').first()).toBeVisible();
      }
    }
    
    await expect(page.getByText('승인 대기 중', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '요청 취소' })).toBeVisible();
    
    const pendingBtn = page.locator('button', { hasText: '승인 대기 중' }).first();
    await expect(pendingBtn).toBeDisabled();
    
    await pendingBtn.click({ force: true });
    await expect(page.getByText('요금제 변경을 요청할까요?')).not.toBeVisible();
  });
});
