import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

const SCREENSHOT_DIR = '/tmp/agy-qa-032b';

test.describe('QA-032 Mission Input State and Completion UX', () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page, context }, testInfo) => {
    await context.grantPermissions(['microphone']);
    errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/login');
    await page.getByPlaceholder(/아이디/).fill('testi02');
    await page.getByPlaceholder(/비밀번호/).fill(process.env.QA_TEST_PASSWORD || '');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    
    await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
    await page.goto('/child/missions');
    
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('대화 방식 테스트') || bodyText.includes('F안')) {
      throw new Error('잘못된 화면(테스트 하네스로 라우팅됨)');
    }

    await page.waitForSelector('button[aria-label="마이크 켜기"], button[aria-label="녹음 종료"]', { timeout: 15000 }).catch(() => {});
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const title = testInfo.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${title}_failure.png` });
    }
  });

  test('1. 로그인 후 미션 화면 진입 - 마이크 버튼, 자동/수동 토글, 키보드 버튼, 상태 카드가 모두 렌더링되는지 확인', async ({ page }) => {
    await expect(page.getByRole('button', { name: /마이크 켜기|녹음 종료/ })).toBeVisible({ timeout: 10000 });
    
    await expect(page.getByRole('button', { name: '자동' })).toBeVisible();
    await expect(page.getByRole('button', { name: '수동' })).toBeVisible();
    
    await expect(page.getByRole('button', { name: '텍스트로 답하기' })).toBeVisible();

    await expect(page.getByRole('button', { name: '자동' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('2. 키보드 버튼 클릭 - 텍스트 입력창이 열리고 입력창에 focus가 가는지, 자동/수동 토글이 "수동"으로 표시되는지 확인', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트로 답하기' }).click({ force: true });
    
    const textInput = page.getByPlaceholder('케이에게 텍스트로 답하기...');
    await expect(textInput).toBeVisible();
    await expect(textInput).toBeFocused();
    
    await expect(page.getByRole('button', { name: '수동' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('3. 텍스트 입력 후 전송 - 답변이 제출되고 입력창이 초기화되는지, 연속 클릭/Enter 연타로 중복 제출되지 않는지 확인', async ({ page }) => {
    let answerApiCallCount = 0;
    await page.route('**/api/mission/answer', async route => {
      answerApiCallCount++;
      // 약간의 딜레이를 주어 연타 방지가 제대로 되는지 확인
      await new Promise(r => setTimeout(r, 300));
      await route.continue();
    });

    await page.getByRole('button', { name: '텍스트로 답하기' }).click({ force: true });
    const textInput = page.getByPlaceholder('케이에게 텍스트로 답하기...');
    
    // 첫번째 전송 (클릭 연타)
    await textInput.fill('테스트 답변 1');
    const sendButton = page.getByRole('button', { name: '전송' });
    await sendButton.click();
    await sendButton.click({ force: true }).catch(() => {});
    
    await expect(textInput).toHaveValue('');
    
    // 두번째 전송 (엔터 연타)
    await textInput.fill('테스트 답변 2');
    await textInput.press('Enter');
    await textInput.press('Enter');
    
    await expect(textInput).toHaveValue('');

    await page.waitForTimeout(1000);
    
    // 최대 2번만 전송되었어야 함
    expect(answerApiCallCount).toBeLessThanOrEqual(2);
  });
  
  test('4. 텍스트 입력창을 닫기(있다면 X 버튼) 후에도 자동 모드로 되돌아가지 않고 수동 모드가 유지되는지 확인', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트로 답하기' }).click({ force: true });
    
    const closeBtn = page.getByRole('button', { name: '닫기' });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    
    // 닫힌 후 수동 모드 유지 여부 확인
    await expect(page.getByRole('button', { name: '수동' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('5. 페이지의 콘솔 에러를 수집해 마이크 상태 전환 중 에러가 없는지 확인', async ({ page }) => {
    await page.getByRole('button', { name: '수동' }).click();
    
    const micButton = page.getByRole('button', { name: /마이크 켜기|녹음 종료/ });
    if(await micButton.isVisible() && await micButton.isEnabled()) {
       await micButton.click({ force: true }).catch(() => {});
       await page.waitForTimeout(500);
       await micButton.click({ force: true }).catch(() => {});
    }
    
    await page.getByRole('button', { name: '자동' }).click();
    
    await page.waitForTimeout(500);

    const transitionErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('AudioContext') && 
      !e.includes('Autoplay') &&
      !e.includes('NotAllowedError') // 마이크 권한 에러 무시
    );
    
    expect(transitionErrors).toEqual([]);
  });
});
