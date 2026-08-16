import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
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

test.use({ viewport: { width: 390, height: 844 } });

test('064 mobile: retention embed layout check', async ({ page, context }) => {
  test.setTimeout(60000);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await service.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified } = await anon.auth.verifyOtp({ token_hash: link!.properties!.hashed_token, type: 'magiclink' });
  await useSession(context, verified!.session!, DEV_BASE);

  await page.goto(`${DEV_BASE}/admin`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '사용자 리텐션' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/qa064-mobile.png', fullPage: true }).catch(() => {});

  const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
  console.log('[064-mobile] horizontal scroll present (should be false):', hasHorizontalScroll);
});
