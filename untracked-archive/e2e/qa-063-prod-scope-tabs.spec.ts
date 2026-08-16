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

test('063: retention scope tabs (all/parent/child) work without errors', async ({ page, context }) => {
  test.setTimeout(120000);
  if (!ADMIN_EMAIL) throw new Error('ADMIN_EMAILS not set');

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

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${PROD_BASE}/admin/retention`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/qa063-all-tab.png', fullPage: true }).catch(() => {});

  console.log('[063] default tab is "전체 리텐션":', await page.getByRole('button', { name: '전체 리텐션' }).evaluate(el => el.getAttribute('style')?.includes('rgb') ?? false).catch(() => 'unknown'));
  console.log('[063] "전체 활성 사용자 수" card present:', (await page.locator('body').innerText()).includes('전체 활성 사용자 수'));

  // switch to 부모 리텐션
  await page.getByRole('button', { name: '부모 리텐션' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/qa063-parent-tab.png', fullPage: true }).catch(() => {});
  let bodyText = await page.locator('body').innerText();
  console.log('[063] parent tab shows "활성 부모 수":', bodyText.includes('활성 부모 수'));
  console.log('[063] parent tab drilldown title:', bodyText.includes('부모 상세'));

  // switch to 아이 리텐션
  await page.getByRole('button', { name: '아이 리텐션' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/qa063-child-tab.png', fullPage: true }).catch(() => {});
  bodyText = await page.locator('body').innerText();
  console.log('[063] child tab shows "활성 아이 수":', bodyText.includes('활성 아이 수'));
  console.log('[063] child tab drilldown title:', bodyText.includes('아이 상세'));

  // back to 전체, check drilldown merges with 유형 column
  await page.getByRole('button', { name: '전체 리텐션' }).click();
  await page.waitForTimeout(2500);
  bodyText = await page.locator('body').innerText();
  console.log('[063] all tab drilldown title:', bodyText.includes('전체 상세'));
  console.log('[063] all tab has 유형 column header:', bodyText.includes('유형'));

  // family view toggle
  await page.getByRole('button', { name: '가족 상세 보기' }).click();
  await page.waitForTimeout(2000);
  bodyText = await page.locator('body').innerText();
  console.log('[063] family view title shown:', bodyText.includes('가족 상세'));
  await page.screenshot({ path: '/tmp/qa063-family-view.png', fullPage: true }).catch(() => {});

  // full-page UUID check
  const html = await page.content();
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = html.match(uuidPattern) || [];
  console.log('[063] raw UUIDs in page HTML:', uuidMatches.length, uuidMatches.slice(0, 3));

  // rapid scope-switch stress (race condition check, same class of bug as 061)
  const scopeButtons = ['전체 리텐션', '부모 리텐션', '아이 리텐션'];
  for (let i = 0; i < 15; i++) {
    await page.getByRole('button', { name: scopeButtons[i % 3] }).click({ timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);
  const finalBodyText = await page.locator('body').innerText().catch(() => '');
  const isWhiteScreen = finalBodyText.trim().length < 20;

  console.log('[063] pageErrors total:', JSON.stringify(pageErrors));
  console.log('[063] white screen after rapid scope-switch stress:', isWhiteScreen);

  expect(pageErrors.length, 'no uncaught errors across all scope/drilldown interactions').toBe(0);
  expect(isWhiteScreen, 'page must survive rapid scope switching').toBe(false);
});
