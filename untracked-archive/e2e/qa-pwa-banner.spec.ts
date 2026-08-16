import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3910';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_DEV_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const serviceRoleKey =
  process.env.SUPABASE_DEV_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const adminEmail = 'markanitp@gmail.com';

const screenshotDir = '/tmp/agy-qa-pwa-banner';

function projectRef(url: string) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return 'mkrsaaedxqrcrktapaus';
  }
}

async function useSession(
  context: BrowserContext,
  session: Session,
  url: string,
  databaseUrl: string
) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const cookieName = `sb-${projectRef(databaseUrl)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));

  const isSecure = url.startsWith('https://');
  await context.addCookies(
    chunks.map((chunk) => ({ ...chunk, url, secure: isSecure, sameSite: 'Lax' as const }))
  );
}

test.describe('PWA Installation Banner QA', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('1. Child Home PWA Banner verification', async ({ page }) => {
    test.setTimeout(60_000);

    // 1-1. Child Login
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const childTab = page.getByRole('button', { name: '아이 로그인' });
    if (await childTab.isVisible()) {
      await childTab.click();
    }

    const usernameInput = page.getByPlaceholder('아이 아이디를 입력하세요');
    const passwordInput = page.getByPlaceholder('비밀번호를 입력하세요');

    await usernameInput.fill('qatesti-dev');
    await passwordInput.fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await page.waitForURL('**/child/home**', { timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Verify PWA Banner presence in /child/home
    const pwaBanner = page.locator('div.sticky.bottom-0');
    await expect(pwaBanner).toBeVisible({ timeout: 10_000 });

    // Check banner text & elements
    const bannerLabel = pwaBanner.getByText('모바일 / 태블릿 / PC');
    await expect(bannerLabel).toBeVisible();

    const installButton = pwaBanner.getByRole('button', { name: '앱 설치하기' });
    await expect(installButton).toBeVisible();

    const closeButton = pwaBanner.getByRole('button', { name: '닫기' });
    await expect(closeButton).toBeVisible();

    // Check duplicate explanatory text is NOT in banner
    const duplicateText = '현재 브라우저에서 이용 중이에요';
    const bannerContent = await pwaBanner.innerText();
    expect(bannerContent).not.toContain(duplicateText);

    // Verify whitespace-nowrap and min-w-[112px] on button
    const buttonStyle = await installButton.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        whiteSpace: computed.whiteSpace,
        minWidth: computed.minWidth,
        heightPx: el.getBoundingClientRect().height,
      };
    });

    expect(buttonStyle.whiteSpace).toBe('nowrap');
    expect(parseInt(buttonStyle.minWidth, 10)).toBeGreaterThanOrEqual(112);
    expect(buttonStyle.heightPx).toBeLessThanOrEqual(48);

    // Save desktop screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'child-home-desktop.png') });

    // 1-2. iPhone 390px Viewport test
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    await expect(pwaBanner).toBeVisible();
    await expect(installButton).toBeVisible();

    const mobileButtonStyle = await installButton.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        whiteSpace: computed.whiteSpace,
        heightPx: el.getBoundingClientRect().height,
      };
    });
    expect(mobileButtonStyle.whiteSpace).toBe('nowrap');
    expect(mobileButtonStyle.heightPx).toBeLessThanOrEqual(48);

    // Save 390px screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'child-home-iphone390.png') });
  });

  test('2. Parent Home PWA Banner verification', async ({ page, context }) => {
    test.setTimeout(60_000);

    expect(supabaseUrl).not.toBe('');
    expect(serviceRoleKey).not.toBe('');

    // 2-1. Admin Magiclink Auth
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authClient = () =>
      createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

    const { data: adminLink, error: adminLinkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email: adminEmail,
    });
    expect(adminLinkError).toBeNull();

    const adminAuth = authClient();
    const { data: verifiedAdmin, error: verifyAdminError } = await adminAuth.auth.verifyOtp({
      token_hash: adminLink.properties!.hashed_token,
      type: 'magiclink',
    });
    expect(verifyAdminError).toBeNull();
    await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl);

    // Navigate to /parent/home
    await page.goto(`${BASE}/parent/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Verify PWA Banner presence in /parent/home
    const pwaBanner = page.locator('div.sticky.bottom-0');
    await expect(pwaBanner).toBeVisible({ timeout: 10_000 });

    // Check banner text & elements
    const bannerLabel = pwaBanner.getByText('모바일 / 태블릿 / PC');
    await expect(bannerLabel).toBeVisible();

    const installButton = pwaBanner.getByRole('button', { name: '앱 설치하기' });
    await expect(installButton).toBeVisible();

    const closeButton = pwaBanner.getByRole('button', { name: '닫기' });
    await expect(closeButton).toBeVisible();

    // Check duplicate explanatory text is NOT in banner
    const duplicateText = '현재 브라우저에서 이용 중이에요';
    const bannerContent = await pwaBanner.innerText();
    expect(bannerContent).not.toContain(duplicateText);

    // Verify whitespace-nowrap and min-w-[112px] on button
    const buttonStyle = await installButton.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        whiteSpace: computed.whiteSpace,
        minWidth: computed.minWidth,
        heightPx: el.getBoundingClientRect().height,
      };
    });

    expect(buttonStyle.whiteSpace).toBe('nowrap');
    expect(parseInt(buttonStyle.minWidth, 10)).toBeGreaterThanOrEqual(112);
    expect(buttonStyle.heightPx).toBeLessThanOrEqual(48);

    // Save desktop screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'parent-home-desktop.png') });

    // 2-2. iPhone 390px Viewport test
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    await expect(pwaBanner).toBeVisible();
    await expect(installButton).toBeVisible();

    const mobileButtonStyle = await installButton.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        whiteSpace: computed.whiteSpace,
        heightPx: el.getBoundingClientRect().height,
      };
    });
    expect(mobileButtonStyle.whiteSpace).toBe('nowrap');
    expect(mobileButtonStyle.heightPx).toBeLessThanOrEqual(48);

    // Save 390px screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'parent-home-iphone390.png') });
  });
});
