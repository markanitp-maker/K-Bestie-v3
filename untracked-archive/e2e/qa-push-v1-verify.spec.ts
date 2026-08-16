import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

require('dotenv').config({ path: '.env.local' });

const PROD_BASE = 'https://app.k-bestie.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();
const OUTPUT_DIR = '/tmp/agy-qa-push-verify';

function projectRef(url: string) {
  return new URL(url).hostname.split('.')[0];
}

async function useAdminSession(context: BrowserContext, session: Session, url: string) {
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

test('Verify Production Push Subscription and Push Delivery after VAPID Key Update', async ({ browser }) => {
  test.setTimeout(120000);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(`[${new Date().toISOString()}] ${msg}`);
  };

  log('Starting E2E Push Verification Test...');

  // Step 1: Create Child Browser Context with Explicit Permission Grant for PROD_BASE
  const childContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  });
  await childContext.grantPermissions(['notifications'], { origin: PROD_BASE });

  const childPage = await childContext.newPage();

  const networkLogs: any[] = [];
  childPage.on('console', (msg) => log(`[Child Console] ${msg.type()}: ${msg.text()}`));
  childPage.on('response', async (res) => {
    if (res.url().includes('/api/notifications/subscribe') || res.url().includes('/api/admin/push-test')) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch (e) {}
      networkLogs.push({
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
        body: bodyText,
      });
      log(`[Network Response] ${res.status()} ${res.url()} => ${bodyText.slice(0, 300)}`);
    }
  });

  // Navigate & Login as TestA child
  log('Navigating to child login page...');
  await childPage.goto(`${PROD_BASE}/login`, { waitUntil: 'networkidle' });

  const idInput = childPage.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.fill('testa');

  const pwInput = childPage.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.fill('TestA12345!@#');

  const loginBtn = childPage.getByRole('button', { name: '로그인', exact: true });
  await loginBtn.click();

  await childPage.waitForTimeout(3000);
  log(`Child logged in. Current URL: ${childPage.url()}`);

  if (!childPage.url().includes('/chat')) {
    await childPage.goto(`${PROD_BASE}/chat`, { waitUntil: 'networkidle' });
  }

  await childPage.waitForTimeout(2000);
  await childPage.screenshot({ path: path.join(OUTPUT_DIR, '01_child_main.png') });

  // Browser Push Evaluation after permission grant
  const evalResult = await childPage.evaluate(async () => {
    const report: any = {
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'no-Notification',
      hasSW: 'serviceWorker' in navigator,
      hasPushManager: 'PushManager' in window,
      installationId: localStorage.getItem('kbestie_push_installation_id'),
    };

    const newInstId = crypto.randomUUID();
    localStorage.setItem('kbestie_push_installation_id', newInstId);
    report.newInstallationId = newInstId;

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        report.swActive = Boolean(reg.active);

        let sub = await reg.pushManager.getSubscription();
        report.existingSubscription = sub ? sub.toJSON() : null;

        const subRes = await fetch(`/api/notifications/subscribe?installationId=${newInstId}`);
        report.getSubscribeStatus = subRes.status;
        if (subRes.ok) {
          report.getSubscribeData = await subRes.json();
        }
      }
    } catch (e: any) {
      report.evalError = e.message;
    }

    return report;
  });

  log(`Child Browser Push Evaluation (granted): ${JSON.stringify(evalResult, null, 2)}`);

  // Reload page so usePushSubscription hook automatically registers subscription when permission is granted
  await childPage.reload({ waitUntil: 'networkidle' });
  await childPage.waitForTimeout(4000);

  // Look for any notification onboarding modal or button if visible
  const allowBtn = childPage.getByRole('button', { name: /알림 받기|미션 알림 받기|알림 켜기/ });
  if (await allowBtn.count() > 0) {
    log('Clicking notification onboarding button...');
    await allowBtn.first().click().catch(() => {});
    await childPage.waitForTimeout(4000);
  }

  await childPage.screenshot({ path: path.join(OUTPUT_DIR, '02_child_subscription_done.png') });

  // Query DB via Supabase service role to verify push subscription entry for TestA (11111111-1111-1111-1111-111111111111)
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  
  const { data: dbSubs, error: dbErr } = await service
    .from('push_subscriptions')
    .select('*')
    .eq('child_id', '11111111-1111-1111-1111-111111111111')
    .order('created_at', { ascending: false });

  log(`DB push_subscriptions count: ${dbSubs?.length ?? 0} (Err: ${dbErr?.message})`);
  if (dbSubs && dbSubs.length > 0) {
    log(`Latest push subscription DB entry: ${JSON.stringify(dbSubs[0])}`);
  }

  // Step 2: Admin Login & Push Test Execution
  log('Starting Admin portion of test...');
  if (!ADMIN_EMAIL) {
    log('ADMIN_EMAIL is missing!');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'logs.txt'), logs.join('\n'));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'network.json'), JSON.stringify(networkLogs, null, 2));
    throw new Error('ADMIN_EMAIL not configured');
  }

  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const adminPage = await adminContext.newPage();

  adminPage.on('console', (msg) => log(`[Admin Console] ${msg.type()}: ${msg.text()}`));
  adminPage.on('response', async (res) => {
    if (res.url().includes('/api/admin/push-test')) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch (e) {}
      networkLogs.push({
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
        body: bodyText,
      });
      log(`[Admin Network Response] ${res.status()} ${res.url()} => ${bodyText}`);
    }
  });

  // Generate Admin Session
  log(`Generating admin magic link for ${ADMIN_EMAIL}...`);
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
  if (linkErr) {
    log(`generateLink failed: ${linkErr.message}`);
    throw new Error(`generateLink failed: ${linkErr.message}`);
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) {
    log(`verifyOtp failed: ${verifyErr.message}`);
    throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  }

  await useAdminSession(adminContext, verified.session!, PROD_BASE);

  log('Navigating to Admin Push Test page (/admin/operations?tab=push)...');
  await adminPage.goto(`${PROD_BASE}/admin/operations?tab=push`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(2000);
  await adminPage.screenshot({ path: path.join(OUTPUT_DIR, '03_admin_page.png') });

  // Open Child Search modal
  log('Opening Child Search modal...');
  const searchModalBtn = adminPage.getByRole('button', { name: '아이 검색' });
  await expect(searchModalBtn).toBeVisible({ timeout: 10000 });
  await searchModalBtn.click();

  await adminPage.waitForTimeout(1000);
  const searchInput = adminPage.getByPlaceholder('이름 또는 아이디 검색');
  await searchInput.fill('TestA');
  await adminPage.waitForTimeout(1500);

  await adminPage.screenshot({ path: path.join(OUTPUT_DIR, '04_admin_search_modal.png') });

  // Select TestA child item from search list
  const testAItem = adminPage.locator('li', { hasText: 'TestA' }).first();
  await expect(testAItem).toBeVisible({ timeout: 10000 });
  await testAItem.click();

  await adminPage.waitForTimeout(1000);
  await adminPage.screenshot({ path: path.join(OUTPUT_DIR, '05_admin_child_selected.png') });

  // Click "미션 1 즉시 발송"
  log('Clicking "미션 1 즉시 발송"...');
  const sendMission1Btn = adminPage.getByRole('button', { name: '미션 1 즉시 발송' });
  
  const isEnabled = await sendMission1Btn.isEnabled().catch(() => false);
  log(`"미션 1 즉시 발송" button enabled status: ${isEnabled}`);

  if (!isEnabled) {
    log('Button is disabled. Checking status message on page...');
    const bodyText = await adminPage.locator('body').innerText();
    log(`Admin page text: ${bodyText.slice(0, 1000)}`);
    await adminPage.screenshot({ path: path.join(OUTPUT_DIR, '06_admin_send_disabled.png') });
  } else {
    await sendMission1Btn.click();
    await adminPage.waitForTimeout(5000);
    await adminPage.screenshot({ path: path.join(OUTPUT_DIR, '07_admin_send_result.png') });
  }

  // Save logs & network output
  fs.writeFileSync(path.join(OUTPUT_DIR, 'logs.txt'), logs.join('\n'));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'network.json'), JSON.stringify(networkLogs, null, 2));

  log('Test completed.');
});
