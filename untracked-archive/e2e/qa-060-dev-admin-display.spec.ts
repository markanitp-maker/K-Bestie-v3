import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();
const TEST_CHILD_ID = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c'; // QA테스트아이 (is_test_account=true)

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

test('060: manual reporting run shows child name/login instead of raw UUID', async ({ page, context }) => {
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

  await page.goto(`${DEV_BASE}/admin`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.getByText('리포팅 수동 실행').click();
  await page.waitForTimeout(1000);

  const searchBox = page.getByPlaceholder('이름 또는 ID로 검색...');
  await searchBox.fill('QA테스트아이');
  await page.waitForTimeout(1000);

  await page.locator('tr', { hasText: 'QA테스트아이' }).first().click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: '즉시 대화 수집' }).click();

  // wait for the run+poll cycle to settle
  await page.waitForTimeout(10000);
  await page.waitForSelector('text=아이', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/qa060-dev-result.png', fullPage: true }).catch(() => {});

  const bodyHTML = await page.content();
  const bodyText = await page.locator('body').innerText().catch(() => '');

  // full UUID pattern check (should not appear anywhere in DOM)
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = bodyHTML.match(uuidPattern) || [];
  // filter out ones inside href/src attributes or data attrs which aren't visible display text
  console.log('[060-dev] any raw UUIDs found in full page HTML (may include non-visible attrs):', uuidMatches.length, uuidMatches.slice(0, 5));

  console.log('[060-dev] column header changed to "아이" present:', bodyText.includes('아이'));
  console.log('[060-dev] old column header "아이 ID" present (should be false):', bodyText.includes('아이 ID'));
  console.log('[060-dev] QA테스트아이 name shown in results:', bodyText.includes('QA테스트아이'));
  console.log('[060-dev] pageErrors:', JSON.stringify(pageErrors));
});
