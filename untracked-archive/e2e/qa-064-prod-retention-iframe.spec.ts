import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const PROD_BASE = 'https://app.k-bestie.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();

function projectRef(url: string) {
  return new URL(url).hostname.split('.')[0];
}

async function useSession(context: BrowserContext, session: Session, url: string) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const cookieName = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: 'Lax' as const })));
}

async function login(page: import('@playwright/test').Page, context: BrowserContext) {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  await useSession(context, verified.session!, PROD_BASE);
}

test('064: retention tab embeds in admin common layout via iframe', async ({ page, context }) => {
  test.setTimeout(90000);
  if (!ADMIN_EMAIL) throw new Error('ADMIN_EMAILS not set');
  await login(page, context);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${PROD_BASE}/admin`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: '사용자 리텐션' }).click();
  await page.waitForTimeout(6000);

  // URL should stay at /admin (no navigation, matching how other tabs behave)
  console.log('[064] URL after clicking 사용자 리텐션:', page.url());
  expect(page.url()).toBe(`${PROD_BASE}/admin`);

  // exactly one outer "내친구 케이 — 관리자" header (from app/admin/layout.tsx), not duplicated
  const outerHeaderCount = await page.getByRole('heading', { name: '내친구 케이 — 관리자' }).count();
  console.log('[064] outer "내친구 케이 — 관리자" header count (should be 1):', outerHeaderCount);

  // iframe should exist pointing to the embed route
  const iframeEl = page.locator('iframe[src*="/admin/retention"]');
  await expect(iframeEl).toBeVisible({ timeout: 10000 });
  const src = await iframeEl.getAttribute('src');
  console.log('[064] iframe src:', src);
  expect(src).toContain('embed=1');

  const frame = page.frameLocator('iframe[src*="/admin/retention"]');
  await expect(frame.getByRole('button', { name: '전체 리텐션' })).toBeVisible({ timeout: 10000 });
  console.log('[064] scope tabs visible inside iframe: true');

  // duplicate header/title should be ABSENT inside the iframe (embed mode hides them)
  const dupTitleCount = await frame.getByText('사용자 리텐션 대시보드').count();
  const dupLinkCount = await frame.getByText('← 관리자 홈').count();
  console.log('[064] duplicate "사용자 리텐션 대시보드" title inside iframe (should be 0):', dupTitleCount);
  console.log('[064] duplicate "← 관리자 홈" link inside iframe (should be 0):', dupLinkCount);

  // iframe height should auto-adjust to real content (not a tiny stub, not absurdly large either)
  const iframeBox = await iframeEl.boundingBox();
  console.log('[064] iframe height (px):', iframeBox?.height);

  // no double scrollbar: iframe element itself should not be independently scrollable
  const iframeOverflow = await iframeEl.evaluate((el) => getComputedStyle(el).overflow);
  console.log('[064] iframe computed overflow (should be hidden):', iframeOverflow);

  await page.screenshot({ path: '/tmp/qa064-embedded-retention.png', fullPage: true }).catch(() => {});

  // functional check inside iframe: switch scope tab
  await frame.getByRole('button', { name: '아이 리텐션' }).click();
  await page.waitForTimeout(2000);
  const childTabVisible = await frame.getByText('활성 아이 수').count();
  console.log('[064] "활성 아이 수" visible after switching scope inside iframe:', childTabVisible > 0);

  // sidebar active-state check
  const navButton = page.getByRole('button', { name: '사용자 리텐션' });
  const navStyle = await navButton.evaluate((el) => getComputedStyle(el).fontWeight);
  console.log('[064] 사용자 리텐션 nav button fontWeight when active (should be bold, 700):', navStyle);

  console.log('[064] pageErrors (outer page):', JSON.stringify(pageErrors));
  expect(pageErrors.length).toBe(0);
});

test('064: direct /admin/retention access still shows standalone header (no regression)', async ({ page, context }) => {
  test.setTimeout(60000);
  await login(page, context);

  await page.goto(`${PROD_BASE}/admin/retention`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const bodyText = await page.locator('body').innerText();
  console.log('[064-direct] "사용자 리텐션 대시보드" title present (standalone mode):', bodyText.includes('사용자 리텐션 대시보드'));
  console.log('[064-direct] "관리자 홈" link present (standalone mode):', bodyText.includes('관리자 홈'));
  expect(bodyText).toContain('사용자 리텐션 대시보드');
});
