import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const BASE = 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const PARENT_EMAIL = 'qatest-parent-dev@kbestie.local';

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
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: PARENT_EMAIL });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  await useSession(context, verified.session!, BASE);
  await page.goto(`${BASE}/parent/home`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
}

test('QA-020 direct: daily report modal', async ({ page, context }) => {
  test.setTimeout(60000);
  await login(page, context);

  await page.goto(`${BASE}/parent/report`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/qa020-list-daily.png', fullPage: true });

  const card = page.getByText('QA020 테스트용 리포트입니다').first();
  await expect(card, 'seeded QA020 report should be visible in list').toBeVisible({ timeout: 8000 });

  const urlBefore = page.url();
  await card.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/qa020-modal-daily.png', fullPage: true });

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog, 'modal should open').toBeVisible({ timeout: 5000 });
  expect(page.url()).toBe(urlBefore);

  await expect(dialog.getByText('빠른 요약')).toBeVisible();
  await expect(dialog.getByText('QA020 감정 힌트').or(dialog.getByText('QA020 테스트용 리포트입니다'))).toBeVisible();

  // 이 QA 계정은 Care Start(제한) 요금제라 상세/가이드 탭이 잠겨있다(🔒) — 실제 내용
  // 또는 업그레이드 안내(LockedTabNotice) 둘 중 하나만 있으면 정상(요금제 제한 로직이
  // 모달에서도 그대로 동작함을 확인하는 것도 이 테스트의 목적).
  await dialog.getByRole('tab', { name: /상세 보기/ }).click();
  await page.waitForTimeout(300);
  const detailContent = dialog.getByText('QA020 학교 이야기').or(dialog.getByText('QA020 친구 이야기'));
  const detailLocked = dialog.getByText('업그레이드').first();
  await expect(detailContent.or(detailLocked)).toBeVisible();

  await dialog.getByRole('tab', { name: /추천 가이드/ }).click();
  await page.waitForTimeout(300);
  const guideContent = dialog.getByText('QA020 테스트 가이드 문구');
  const guideLocked = dialog.getByText('업그레이드').first();
  await expect(guideContent.or(guideLocked)).toBeVisible();

  // focus trap
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  const focusInDialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return dlg ? dlg.contains(document.activeElement) : false;
  });
  console.log('[QA020] focus trap OK:', focusInDialog);
  expect(focusInDialog).toBe(true);

  // close via Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
  expect(page.url()).toBe(urlBefore);

  // reopen, close via backdrop click (top-left corner, outside modal card).
  // NB: on PC viewports this app renders a device-mockup frame (DemoFrame)
  // that intentionally scopes position:fixed via transform:translateZ(0)
  // (see app/demo/components/DemoFrame.tsx), so absolute page coords like
  // (5,5) can land outside the mockup entirely. Click relative to the
  // dialog's own bounding box instead so this works in both modes.
  await card.click();
  await page.waitForTimeout(800);
  await expect(dialog).toBeVisible({ timeout: 5000 });
  const dialogBox = await dialog.boundingBox();
  if (!dialogBox) throw new Error('dialog has no bounding box');
  // +30 (not +5) to clear the device-mockup's rounded corner clip radius
  await page.mouse.click(dialogBox.x + 30, dialogBox.y + 30);
  await page.waitForTimeout(500);
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // reopen, close via back button, then verify a second back navigates further (no stuck history)
  await card.click();
  await page.waitForTimeout(800);
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await page.goBack();
  await page.waitForTimeout(500);
  await expect(dialog, 'back button should close modal').not.toBeVisible({ timeout: 5000 });
  const urlAfterModalClose = page.url();
  await page.goBack();
  await page.waitForTimeout(800);
  const urlAfterSecondBack = page.url();
  console.log('[QA020] url after modal-close back:', urlAfterModalClose, '| after 2nd back:', urlAfterSecondBack);
  expect(urlAfterSecondBack).not.toBe(urlAfterModalClose);

  console.log('[QA020] ALL SCENARIOS PASS');
});

test('QA-020 direct: weekly report modal', async ({ page, context }) => {
  test.setTimeout(60000);
  await login(page, context);

  await page.goto(`${BASE}/parent/report/weekly`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/qa020-list-weekly.png', fullPage: true });

  const card = page.getByText('QA020 테스트용 주간 요약입니다').first();
  await expect(card, 'seeded QA020 weekly report should be visible').toBeVisible({ timeout: 8000 });

  const urlBefore = page.url();
  await card.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/qa020-modal-weekly.png', fullPage: true });

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog, 'weekly modal should open').toBeVisible({ timeout: 5000 });
  expect(page.url()).toBe(urlBefore);

  await dialog.getByText('상세 보기').click();
  await page.waitForTimeout(300);
  const weeklyDetailContent = dialog.getByText('QA020 상세 텍스트').or(dialog.getByText('QA020 주간 가이드'));
  const weeklyLocked = dialog.getByText('업그레이드').first();
  await expect(weeklyDetailContent.or(weeklyLocked)).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  console.log('[QA020] weekly PASS');
});
