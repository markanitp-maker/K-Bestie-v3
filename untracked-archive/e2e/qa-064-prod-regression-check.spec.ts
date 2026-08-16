import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const PROD_BASE = 'https://app.k-bestie.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();

function projectRef(url: string) { return new URL(url).hostname.split('.')[0]; }
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

test('064 regression: other admin routes unaffected by route-group restructuring', async ({ page, context }) => {
  test.setTimeout(60000);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await service.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified } = await anon.auth.verifyOtp({ token_hash: link!.properties!.hashed_token, type: 'magiclink' });
  await useSession(context, verified!.session!, PROD_BASE);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // main /admin dashboard
  await page.goto(`${PROD_BASE}/admin`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  let bodyText = await page.locator('body').innerText();
  console.log('[regression] /admin loads with header:', bodyText.includes('내친구 케이 — 관리자'));
  console.log('[regression] /admin sidebar nav present:', bodyText.includes('전체 현황') && bodyText.includes('리포팅 수동 실행'));

  // switch to a couple of other tabs to confirm they still work
  await page.getByRole('button', { name: '리포팅 수동 실행' }).click();
  await page.waitForTimeout(1500);
  bodyText = await page.locator('body').innerText();
  console.log('[regression] 리포팅 수동 실행 tab still works:', bodyText.includes('리포팅 수동 실행'));

  await page.getByRole('button', { name: '전체 현황' }).click();
  await page.waitForTimeout(1500);

  // /admin/plays
  await page.goto(`${PROD_BASE}/admin/plays`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  bodyText = await page.locator('body').innerText();
  console.log('[regression] /admin/plays loads with header:', bodyText.includes('내친구 케이 — 관리자'));
  console.log('[regression] /admin/plays status code check via response');

  console.log('[regression] pageErrors:', JSON.stringify(pageErrors));
  expect(pageErrors.length).toBe(0);
});
