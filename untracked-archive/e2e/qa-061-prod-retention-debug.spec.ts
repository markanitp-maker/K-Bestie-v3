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

test('061 debug: capture console/network errors on Production /admin/retention', async ({ page, context }) => {
  test.setTimeout(60000);

  if (!ADMIN_EMAIL) throw new Error('ADMIN_EMAILS not set in .env.local');

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

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const apiResponses: { url: string; status: number; contentType: string | null; body: string }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.message}\n${err.stack ?? ''}`);
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/admin/retention') || res.url().includes('/api/admin/')) {
      let body = '';
      try { body = (await res.text()).slice(0, 3000); } catch {}
      apiResponses.push({
        url: res.url(),
        status: res.status(),
        contentType: res.headers()['content-type'] ?? null,
        body,
      });
    }
  });

  await page.goto(`${PROD_BASE}/admin/retention`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  await page.screenshot({ path: '/tmp/qa061-prod-retention.png', fullPage: true }).catch(() => {});
  const bodyText = await page.locator('body').innerText().catch(() => '(failed to read body)');

  console.log('[061-debug] final URL:', page.url());
  console.log('[061-debug] visible body text (first 500 chars):', bodyText.slice(0, 500));
  console.log('[061-debug] consoleErrors:', JSON.stringify(consoleErrors, null, 2));
  console.log('[061-debug] pageErrors:', JSON.stringify(pageErrors, null, 2));
  console.log('[061-debug] admin API responses:', JSON.stringify(apiResponses, null, 2));
});
