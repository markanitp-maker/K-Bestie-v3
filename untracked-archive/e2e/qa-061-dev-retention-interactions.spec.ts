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

test('061 debug: try every interaction on Production /admin/retention', async ({ page, context }) => {
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
  await useSession(context, verified.session!, DEV_BASE);

  const errors: { step: string; consoleErrors: string[]; pageErrors: string[] }[] = [];
  let currentStep = 'initial-load';
  let stepConsoleErrors: string[] = [];
  let stepPageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') stepConsoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    stepPageErrors.push(`${err.message}`);
  });

  const snapshot = (step: string) => {
    errors.push({ step, consoleErrors: [...stepConsoleErrors], pageErrors: [...stepPageErrors] });
    stepConsoleErrors = [];
    stepPageErrors = [];
  };

  await page.goto(`${DEV_BASE}/admin/retention`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  snapshot('initial-load(7d,includeInternal=OFF)');

  const periods = ['최근 14일', '최근 30일', '이번 달', '전체'];
  for (const p of periods) {
    currentStep = `period=${p}`;
    await page.getByRole('button', { name: p, exact: true }).click().catch((e) => stepPageErrors.push(`click failed: ${e.message}`));
    await page.waitForTimeout(2000);
    const isWhiteScreen = await page.locator('body').innerText().then(t => t.trim().length < 20).catch(() => true);
    if (isWhiteScreen) stepPageErrors.push('BODY TEXT EMPTY/WHITE SCREEN AFTER THIS ACTION');
    snapshot(currentStep);
  }

  // back to 7d then toggle includeInternal ON
  await page.getByRole('button', { name: '최근 7일', exact: true }).click().catch(() => {});
  await page.waitForTimeout(1500);
  snapshot('reset-to-7d');

  currentStep = 'toggle-includeInternal-ON';
  await page.getByText('내부 테스트 계정 포함').click().catch((e) => stepPageErrors.push(`click failed: ${e.message}`));
  await page.waitForTimeout(2000);
  let isWhiteScreen = await page.locator('body').innerText().then(t => t.trim().length < 20).catch(() => true);
  if (isWhiteScreen) stepPageErrors.push('BODY TEXT EMPTY/WHITE SCREEN AFTER THIS ACTION');
  snapshot(currentStep);
  await page.screenshot({ path: '/tmp/qa061-after-includeInternal-on.png', fullPage: true }).catch(() => {});

  currentStep = 'toggle-includeInternal-OFF-again';
  await page.getByText('내부 테스트 계정 포함').click().catch((e) => stepPageErrors.push(`click failed: ${e.message}`));
  await page.waitForTimeout(2000);
  snapshot(currentStep);

  // drilldown tabs
  for (const tabName of ['아이 상세', '가족 상세', '부모 상세']) {
    currentStep = `drilldown-tab=${tabName}`;
    await page.getByRole('button', { name: tabName, exact: true }).click().catch((e) => stepPageErrors.push(`click failed: ${e.message}`));
    await page.waitForTimeout(1500);
    isWhiteScreen = await page.locator('body').innerText().then(t => t.trim().length < 20).catch(() => true);
    if (isWhiteScreen) stepPageErrors.push('BODY TEXT EMPTY/WHITE SCREEN AFTER THIS ACTION');
    snapshot(currentStep);
  }

  // hard reload
  currentStep = 'hard-reload';
  await page.reload({ waitUntil: 'load' }).catch((e) => stepPageErrors.push(`reload failed: ${e.message}`));
  await page.waitForTimeout(2500);
  isWhiteScreen = await page.locator('body').innerText().then(t => t.trim().length < 20).catch(() => true);
  if (isWhiteScreen) stepPageErrors.push('BODY TEXT EMPTY/WHITE SCREEN AFTER THIS ACTION');
  snapshot(currentStep);
  await page.screenshot({ path: '/tmp/qa061-after-reload.png', fullPage: true }).catch(() => {});

  console.log('[061-interactions] RESULTS:', JSON.stringify(errors, null, 2));

  const anyErrors = errors.some(e => e.consoleErrors.length > 0 || e.pageErrors.length > 0);
  console.log('[061-interactions] any errors found across all steps:', anyErrors);
});
