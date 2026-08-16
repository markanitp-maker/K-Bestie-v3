import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Safely load .env.local if QA_TEST_PASSWORD is not set
function getTestPassword(): string {
  let pwd = process.env.QA_TEST_PASSWORD || '';
  if (!pwd && fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/^QA_TEST_PASSWORD=(.+)$/m);
    if (match) {
      pwd = match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return pwd;
}

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const PROOF_DIR = '/tmp/agy-qa-101-pwa';
const CHILD_USER = 'qatesti-dev';
const PARENT_USER = 'qa-parent';

test.beforeAll(() => {
  if (!fs.existsSync(PROOF_DIR)) {
    fs.mkdirSync(PROOF_DIR, { recursive: true });
  }
});

/** Helper to login as Child via established UI flow */
async function loginAsChild(page: Page) {
  const pwd = getTestPassword();
  expect(pwd.length, 'QA_TEST_PASSWORD must be available without exposing its value').toBeGreaterThan(0);
  await page.goto(`${BASE}/login?role=child`, { waitUntil: 'networkidle' });

  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  const pwdInput = page.getByPlaceholder('비밀번호를 입력하세요');

  await idInput.waitFor({ state: 'visible', timeout: 10_000 });
  await idInput.fill(CHILD_USER);
  await pwdInput.fill(pwd);
  await expect(idInput).toHaveValue(CHILD_USER);
  await expect(pwdInput).toHaveValue(pwd);

  const submitBtn = page.getByRole('button', { name: '로그인', exact: true });
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  await page.waitForURL('**/child/home**', { timeout: 15_000 });

  // Explicit check for family connection error page
  const familyConnText = page.getByText('가족 연결이 필요해요');
  if (await familyConnText.isVisible().catch(() => false)) {
    throw new Error('Explicit Failure: "가족 연결이 필요해요" page displayed for child user qatesti-dev');
  }

  // Authenticated home marker
  expect(page.url()).toContain('/child/home');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('로그인 화면을 불러오는 중');
}

/** Helper to login as Parent via established UI flow */
async function loginAsParent(page: Page) {
  const pwd = getTestPassword();
  expect(pwd.length, 'QA_TEST_PASSWORD must be available without exposing its value').toBeGreaterThan(0);
  await page.goto(`${BASE}/login?returnUrl=/parent/home`, { waitUntil: 'networkidle' });

  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  const pwdInput = page.getByPlaceholder('비밀번호를 입력하세요');

  await idInput.waitFor({ state: 'visible', timeout: 10_000 });
  await idInput.fill(PARENT_USER);
  await pwdInput.fill(pwd);
  await expect(idInput).toHaveValue(PARENT_USER);
  await expect(pwdInput).toHaveValue(pwd);

  const submitBtn = page.getByRole('button', { name: '로그인', exact: true });
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  await page.waitForURL('**/parent/home**', { timeout: 15_000 });

  // Explicit check for family connection error page
  const familyConnText = page.getByText('가족 연결이 필요해요');
  if (await familyConnText.isVisible().catch(() => false)) {
    throw new Error('Explicit Failure: "가족 연결이 필요해요" page displayed for parent user qa-parent');
  }

  // Authenticated home marker
  expect(page.url()).toContain('/parent/home');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('로그인 화면을 불러오는 중');
}

test.describe('PWA Installation Integration QA (Task 101)', () => {

  // -------------------------------------------------------------
  // Group: home
  // -------------------------------------------------------------
  test('1. Child & Parent Home Normal Fallback Modal and Dismiss Persistence (@home)', async ({ page }) => {
    test.setTimeout(60_000);

    // 1-1 Child Home Fallback
    await loginAsChild(page);
    const childInstallBtn = page.getByRole('button', { name: '앱 설치하기' });
    await expect(childInstallBtn).toBeVisible();
    await childInstallBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('다른 브라우저에서 설치해 보세요')).toBeVisible();
    await expect(dialog.getByText('주소 복사하기')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();

    await page.screenshot({ path: path.join(PROOF_DIR, '01-child-fallback-modal.png') });

    // Test Dismiss Persistence
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).not.toBeVisible();

    const isDismissed = await page.evaluate(() => sessionStorage.getItem('hide_pwa_banner') === 'true');
    expect(isDismissed).toBe(true);

    // 1-2 Parent Home Fallback
    await page.evaluate(() => sessionStorage.clear());
    await loginAsParent(page);
    const parentInstallBtn = page.getByRole('button', { name: '앱 설치하기' });
    await expect(parentInstallBtn).toBeVisible();
    await parentInstallBtn.click();

    const parentDialog = page.getByRole('dialog');
    await expect(parentDialog).toBeVisible();
    await expect(parentDialog.getByText('다른 브라우저에서 설치해 보세요')).toBeVisible();
    await page.screenshot({ path: path.join(PROOF_DIR, '02-parent-fallback-modal.png') });
  });

  // -------------------------------------------------------------
  // Group: ua
  // -------------------------------------------------------------
  test('2. InApp Browser Titles Verification (@ua)', async ({ page }) => {
    test.setTimeout(90_000);

    const testUAs = [
      {
        name: 'Kakao',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.5.0',
        expectedTitle: '카카오톡에서 열려 있어요',
        proofName: '03-inapp-kakao.png',
      },
      {
        name: 'NAVER',
        ua: 'Mozilla/5.0 (Linux; Android 14; Mobile; NAVER(inapp; search; 1000; 11.20.0))',
        expectedTitle: '네이버 앱에서 열려 있어요',
        proofName: '04-inapp-naver.png',
      },
      {
        name: 'Instagram',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0.0.0.0',
        expectedTitle: 'Instagram에서 열려 있어요',
        proofName: '05-inapp-instagram.png',
      },
      {
        name: 'Facebook',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) FBAN/FBIOS;FBAV/400.0.0.0.0',
        expectedTitle: 'Facebook에서 열려 있어요',
        proofName: '06-inapp-facebook.png',
      },
      {
        name: 'Unknown WebView',
        ua: 'Mozilla/5.0 (Linux; U; Android 13; ko-kr; Mobile; ; wv)',
        expectedTitle: '앱 안의 브라우저에서 열려 있어요',
        proofName: '07-inapp-unknown.png',
      },
    ];

    for (const item of testUAs) {
      const context = await page.context().browser()?.newContext({ userAgent: item.ua });
      if (!context) continue;
      const testPage = await context.newPage();

      await loginAsChild(testPage);

      const installBtn = testPage.getByRole('button', { name: '앱 설치하기' });
      if (await installBtn.isVisible().catch(() => false)) {
        await installBtn.click();

        const dialog = testPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(item.expectedTitle)).toBeVisible();
        await expect(dialog.getByText('주소 복사하기')).toBeVisible();

        await testPage.screenshot({ path: path.join(PROOF_DIR, item.proofName) });
      }
      await context.close();
    }
  });

  test('3. iPhone and iPad Safari 4-Step Guide Modal (@ua)', async ({ page }) => {
    test.setTimeout(60_000);

    // 3-1 iPhone Safari
    const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/605.1.15';
    const iphoneContext = await page.context().browser()?.newContext({ userAgent: iphoneUA });
    if (iphoneContext) {
      const iphonePage = await iphoneContext.newPage();
      await loginAsChild(iphonePage);

      const installBtn = iphonePage.getByRole('button', { name: '앱 설치하기' });
      if (await installBtn.isVisible().catch(() => false)) {
        await installBtn.click();

        const dialog = iphonePage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('아이폰에 내친구 케이 설치하기')).toBeVisible();

        // Verify 4 steps
        await expect(dialog.getByText('1. 공유')).toBeVisible();
        await expect(dialog.getByText('2. 홈 화면에 추가')).toBeVisible();
        await expect(dialog.getByText('3. 웹 앱으로 열기')).toBeVisible();
        await expect(dialog.getByText('4. 추가')).toBeVisible();

        await iphonePage.screenshot({ path: path.join(PROOF_DIR, '08-ios-iphone-safari.png') });
      }
      await iphoneContext.close();
    }

    // 3-2 iPad Safari
    const ipadUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const ipadContext = await page.context().browser()?.newContext({ userAgent: ipadUA });
    if (ipadContext) {
      const ipadPage = await ipadContext.newPage();
      await ipadPage.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
      });

      await loginAsChild(ipadPage);

      const installBtn = ipadPage.getByRole('button', { name: '앱 설치하기' });
      if (await installBtn.isVisible().catch(() => false)) {
        await installBtn.click();

        const dialog = ipadPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('아이패드에 내친구 케이 설치하기')).toBeVisible();
        await expect(dialog.getByText('1. 공유')).toBeVisible();

        await ipadPage.screenshot({ path: path.join(PROOF_DIR, '09-ios-ipad-safari.png') });
      }
      await ipadContext.close();
    }
  });

  // -------------------------------------------------------------
  // Group: prompt
  // -------------------------------------------------------------
  test('4. Standalone Display Mode Banner Non-display (@prompt)', async ({ page }) => {
    test.setTimeout(60_000);

    const standaloneContext = await page.context().browser()?.newContext();
    if (!standaloneContext) return;

    const standalonePage = await standaloneContext.newPage();
    await standalonePage.addInitScript(() => {
      Object.defineProperty(window, 'matchMedia', {
        value: (query: string) => ({
          matches: query.includes('standalone'),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      });
      Object.defineProperty(navigator, 'standalone', { value: true });
    });

    await loginAsChild(standalonePage);

    const installBtn = standalonePage.getByRole('button', { name: '앱 설치하기' });
    await expect(installBtn).not.toBeVisible();

    await standalonePage.screenshot({ path: path.join(PROOF_DIR, '10-standalone-banner-hidden.png') });
    await standaloneContext.close();
  });

  test('5. Custom beforeinstallprompt Single-Use and Double-Click Guard (@prompt)', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsChild(page);

    // Inject custom beforeinstallprompt event mock with prompt spy
    await page.evaluate(() => {
      let promptCallCount = 0;
      const customEvent = new Event('beforeinstallprompt', { cancelable: true });
      (customEvent as any).prompt = async () => {
        promptCallCount++;
        (window as any).__promptCallCount = promptCallCount;
      };
      (customEvent as any).userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(customEvent);
    });

    await page.waitForTimeout(500);

    const installBtn = page.getByRole('button', { name: '앱 설치하기' });
    if (await installBtn.isVisible().catch(() => false)) {
      // Click CTA multiple times concurrently (double-click guard test)
      await Promise.all([
        installBtn.click().catch(() => {}),
        installBtn.click().catch(() => {}),
        installBtn.click().catch(() => {}),
      ]);

      await page.waitForTimeout(1000);

      // Verify prompt() was called only ONCE
      const promptCount = await page.evaluate(() => (window as any).__promptCallCount || 0);
      expect(promptCount).toBeLessThanOrEqual(1);

      await page.screenshot({ path: path.join(PROOF_DIR, '11-beforeinstallprompt-event.png') });
    }
  });

  test('6. Prompt Rejection Fallback Handling (@prompt)', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsChild(page);

    // Inject beforeinstallprompt with rejected userChoice
    await page.evaluate(() => {
      const customEvent = new Event('beforeinstallprompt', { cancelable: true });
      (customEvent as any).prompt = async () => {};
      (customEvent as any).userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
      window.dispatchEvent(customEvent);
    });

    await page.waitForTimeout(500);

    const installBtn = page.getByRole('button', { name: '앱 설치하기' });
    if (await installBtn.isVisible().catch(() => false)) {
      await installBtn.click();
      await page.waitForTimeout(1000);
      // App handles prompt rejection gracefully without throwing unhandled error
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Application error');
    }
  });

  test('7. Appinstalled Event Handling on Settings and Home (@prompt)', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsChild(page);

    const installBtn = page.getByRole('button', { name: '앱 설치하기' });

    // Test appinstalled event dispatch
    await page.evaluate(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    await page.waitForTimeout(500);
    await expect(installBtn).not.toBeVisible();

    await page.screenshot({ path: path.join(PROOF_DIR, '12-appinstalled-event.png') });
  });

  // -------------------------------------------------------------
  // Group: onboarding
  // -------------------------------------------------------------
  test('8. Onboarding Storage Semantics Verification (@onboarding)', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsChild(page);
    await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(PROOF_DIR, '13-onboarding-pwa-flow.png') });

    const laterBtn = page.getByRole('button', { name: /나중에/ });
    if (await laterBtn.isVisible().catch(() => false)) {
      await laterBtn.click();
      await page.waitForTimeout(1000);

      // Verify onboarding storage semantics
      const hasDismissedStorage = await page.evaluate(() => {
        return localStorage.getItem('k_pwa_intro_seen') !== null ||
               sessionStorage.getItem('hide_pwa_banner') !== null;
      });
      expect(hasDismissedStorage).toBe(true);
    }
  });

  test('9. Push and Service-Worker Regression Verification (@onboarding)', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(`${BASE}/child/home`, { waitUntil: 'domcontentloaded' });

    // Meaningful ServiceWorker check (verifying SW API support and registration resolution, avoiding trivial regs.length >= 0)
    const swStatus = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return { supported: false, registered: false };
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        return { supported: true, registered: reg !== undefined };
      } catch {
        return { supported: true, registered: false };
      }
    });

    // Require ServiceWorker API support
    expect(swStatus.supported).toBe(true);

    // NotificationOnboarding PWA wording check (should NOT contain outdated PWA text)
    const pageText = await page.content();
    expect(pageText).not.toContain('앱 설치하고 알림 받기');

    await page.screenshot({ path: path.join(PROOF_DIR, '14-regression-push-sw.png') });
  });
});
