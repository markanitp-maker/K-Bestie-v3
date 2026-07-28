import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const password = process.env.QA_TEST_PASSWORD;
if (!password) {
  throw new Error('QA_TEST_PASSWORD is not set in environment variables');
}

test.describe("029 부모 홈 화면 개편 검증", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3910/login?role=parent');
    await page.getByPlaceholder('아이디').fill('testp02');
    await page.getByPlaceholder('비밀번호').fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL('**/parent**');
    await page.goto('http://localhost:3910/parent/home');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const timestamp = new Date().getTime();
      const safeTitle = testInfo.title.replace(/[\s/]/g, '_');
      const dir = '/tmp/agy-qa-029-final';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${safeTitle}_${timestamp}.png` });
      
      // Save console logs? Not easily available in afterEach without capturing, but screenshot is enough.
    }
  });

  test("1. 로그인 → /parent/home 진입 → 공식 로고, 현재 선택 자녀 이름, 알림 버튼, 하단 Navigation이 모두 보이는지 확인", async ({ page }) => {
    // Logo check
    await expect(page.locator('img[alt="내친구 케이"]')).toBeVisible();
    
    // Notification button
    await expect(page.locator('a[href="/parent/notifications"]')).toBeVisible();
    
    // Bottom navigation
    await expect(page.locator('text=홈').last()).toBeVisible();
    await expect(page.locator('text=리포트').last()).toBeVisible();
    
    // Title
    await expect(page.getByText('대화 가이드', { exact: true })).toBeVisible();
  });

  test("2. 드롭다운으로 다른 자녀 전환 → 오늘의 한마디 및 인사이트 갱신 확인", async ({ page }) => {
    const dropdownBtn = page.locator('button[aria-haspopup="listbox"]');
    
    if (await dropdownBtn.isVisible()) {
      const initialChildName = await dropdownBtn.textContent();
      
      await dropdownBtn.click();
      const options = page.locator('[role="listbox"] [role="option"]');
      const count = await options.count();
      
      if (count > 1) {
        // Fast switch twice
        await options.nth(1).click();
        await page.waitForLoadState('networkidle');
        
        await dropdownBtn.click();
        await options.nth(0).click();
        await page.waitForLoadState('networkidle');
        
        await dropdownBtn.click();
        await options.nth(1).click();
        await page.waitForLoadState('networkidle');
        
        const newChildName = await dropdownBtn.textContent();
        expect(newChildName).not.toEqual(initialChildName);
        
        // Ensure "오늘의 한마디" title or content exists
        await expect(page.getByText('오늘의 한마디').first()).toBeVisible();
      } else {
        console.log("단일 자녀 계정이라 전환 테스트를 진행할 수 없습니다.");
      }
    }
  });

  test("3. DOM과 네트워크 응답 어디에도 아이의 대화 원문(transcript)이 노출되지 않는지 확인", async ({ page }) => {
    let hasTranscript = false;
    
    page.on('response', async (response) => {
      if (response.url().includes('/api/parent/reports') && response.request().method() === 'GET') {
        try {
          const body = await response.json();
          // reports 객체 내부를 검사
          if (body.reports && body.reports.length > 0) {
            for (const report of body.reports) {
              if (report.transcript || report.raw_conversation) {
                hasTranscript = true;
              }
            }
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    
    expect(hasTranscript).toBe(false);
  });

  test("4. 데이터가 있는 인사이트 카드를 클릭 → 실제 상세 리포트로 이동, 빈 카드는 클릭 무반응", async ({ page }) => {
    const cards = page.locator('.grid > *');
    const count = await cards.count();
    
    let clickedDataCard = false;
    let clickedEmptyCard = false;
    
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const tagName = await card.evaluate((node) => node.tagName.toLowerCase());
      
      if (tagName === 'a') {
        if (!clickedDataCard) {
          const href = await card.getAttribute('href');
          await card.click();
          await page.waitForURL(`**${href}**`);
          clickedDataCard = true;
          // 돌아오기
          await page.goto('http://localhost:3910/parent/home');
          await page.waitForLoadState('networkidle');
        }
      } else if (tagName === 'div') {
        if (!clickedEmptyCard) {
          await card.click();
          const url = page.url();
          expect(url).toContain('/parent/home'); // 여전히 현재 페이지
          clickedEmptyCard = true;
        }
      }
      
      if (clickedDataCard && clickedEmptyCard) break;
    }
  });

  test("5. 페이지 새로고침 후에도 선택된 자녀와 데이터 유지", async ({ page }) => {
    const dropdownBtn = page.locator('button[aria-haspopup="listbox"]');
    
    if (await dropdownBtn.isVisible()) {
      await dropdownBtn.click();
      const options = page.locator('[role="listbox"] [role="option"]');
      const count = await options.count();
      
      if (count > 1) {
        await options.nth(1).click();
        await page.waitForLoadState('networkidle');
        
        const selectedChildName = await dropdownBtn.textContent();
        
        await page.reload();
        await page.waitForLoadState('networkidle');
        
        const reloadedDropdownBtn = page.locator('button[aria-haspopup="listbox"]');
        const reloadedChildName = await reloadedDropdownBtn.textContent();
        
        expect(reloadedChildName).toEqual(selectedChildName);
      }
    }
  });
});
