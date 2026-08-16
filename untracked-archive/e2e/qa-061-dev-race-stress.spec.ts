import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
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

test('061 stress: rapid-fire drilldown tab switching (race condition regression)', async ({ page, context }) => {
  test.setTimeout(90000);
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
  await useSession(context, verified.session!, DEV_BASE);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${DEV_BASE}/admin/retention`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const tabs = ['아이 상세', '가족 상세', '부모 상세'];
  // 30 rapid clicks with NO wait between them, cycling through all three tabs —
  // maximizes the chance of out-of-order fetch resolution if the race still exists.
  for (let i = 0; i < 30; i++) {
    const tab = tabs[i % tabs.length];
    await page.getByRole('button', { name: tab, exact: true }).click({ timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const isWhiteScreen = bodyText.trim().length < 20;

  console.log('[061-stress] pageErrors after 30 rapid clicks:', JSON.stringify(pageErrors));
  console.log('[061-stress] white screen after stress:', isWhiteScreen);
  console.log('[061-stress] final visible drilldown heading present:', bodyText.includes('사용자별 상세 드릴다운'));

  expect(pageErrors.length, 'no uncaught page errors should occur under rapid tab switching').toBe(0);
  expect(isWhiteScreen, 'page must not go blank').toBe(false);
});
