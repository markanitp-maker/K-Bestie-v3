// 긴급: Production /chat 진입 시 무조건 1분 휴식 화면이 뜬다는 신고 재현.
// TestA(Production 승인 QA 계정)로 로그인 폼 대신 Supabase 클라이언트를 페이지
// 컨텍스트 안에서 직접 호출해 안정적으로 인증한 뒤, /chat 진입 시 실제 네트워크
// 응답을 그대로 캡처한다.
import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Production TestA: /chat 진입 시 실제 응답 캡처', async ({ page }) => {
  test.setTimeout(60000);

  page.on('response', async (res) => {
    if (res.url().includes('/api/chat/freechat-usage')) {
      const body = await res.text().catch(() => '');
      console.log(`[response ${res.request().method()}]`, res.status(), res.url(), body);
    }
  });
  page.on('console', (msg) => {
    if (/freechat/i.test(msg.text())) console.log('[console]', msg.text());
  });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
    if (attempt > 0) {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }
    const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
    await idInput.waitFor({ state: 'visible', timeout: 15000 });
    await idInput.click();
    await idInput.fill('');
    await idInput.type('testa', { delay: 50 });
    const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
    await pwInput.click();
    await pwInput.fill('');
    await pwInput.type(QA_PASSWORD, { delay: 50 });
    await page.waitForTimeout(300);
    const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
    const enabled = await loginBtn.isEnabled();
    console.log(`[attempt ${attempt}] login button enabled:`, enabled);
    if (!enabled) continue;
    await loginBtn.click();
    try {
      await page.waitForURL('**/child**', { timeout: 10000 });
      loggedIn = true;
    } catch {
      const errorText = await page.locator('text=/아이디 또는 비밀번호|오류|올바르지/').textContent().catch(() => null);
      console.log(`[attempt ${attempt}] failed, error on page:`, errorText, 'url:', page.url());
    }
  }

  expect(loggedIn).toBe(true);
  console.log('[login] success, url:', page.url());

  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const cooldownVisible = await page.getByText('지금은 잠깐 쉬는 시간이야').isVisible({ timeout: 3000 }).catch(() => false);
  console.log('[RESULT] cooldown screen visible:', cooldownVisible);
  await page.screenshot({ path: '/tmp/qa-prod-cooldown-repro.png', fullPage: true });
});
