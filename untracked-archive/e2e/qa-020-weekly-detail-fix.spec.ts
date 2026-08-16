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

const WEEKLY_SUMMARY_ID = 'df8da265-308b-4a25-b673-2008f3efb7e3'; // QA020 seed row
const TEST_CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // TestChild (Care Start / tier 1)

const TEST_CARDS = {
  school_academy_life: 'QA020검증-학교',
  peer_friendship: 'QA020검증-친구',
  emotion_hint: 'QA020검증-마음',
  interests_preferences: 'QA020검증-관심사',
  study_concerns: 'QA020검증-공부',
  digital_content_interests: 'QA020검증-디지털',
  future_dreams: 'QA020검증-미래',
  teacher_adults: 'QA020검증-선생님',
  recurring_stories: 'QA020검증-반복',
};

test('QA-020 weekly detail tab field-name fix verification', async ({ page, context }) => {
  test.setTimeout(60000);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // Setup: temporarily unlock detail tier + seed detail_dashboard_cards so the
  // fix (correct key names + new teacher_adults section) is actually exercised.
  await service.from('child_profiles').update({ tier: 2 }).eq('id', TEST_CHILD_ID);
  await service.from('weekly_summaries').update({ detail_dashboard_cards: TEST_CARDS }).eq('id', WEEKLY_SUMMARY_ID);

  try {
    await login(page, context);

    await page.goto(`${BASE}/parent/report/weekly`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    const card = page.getByText('QA020 테스트용 주간 요약입니다').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await page.waitForTimeout(1000);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByRole('tab', { name: /상세 보기/ }).click();
    await page.waitForTimeout(500);

    for (const [label, expected] of Object.entries(TEST_CARDS)) {
      await expect(dialog.getByText(expected), `${label} section should show real content, not fallback`).toBeVisible();
    }

    const fallbackCount = await dialog.getByText('이 항목은 확인할 대화가 충분하지 않아요').count();
    console.log('[QA020-weekly-fix] fallback text count (should be 0):', fallbackCount);
    expect(fallbackCount).toBe(0);

    console.log('[QA020-weekly-fix] ALL 9 SECTIONS SHOW REAL CONTENT — key-name bug fixed');
  } finally {
    // Teardown: restore original restricted-tier state so other QA-020 tests
    // (which rely on this account being Care Start) are unaffected.
    await service.from('child_profiles').update({ tier: 1 }).eq('id', TEST_CHILD_ID);
    await service.from('weekly_summaries').update({ detail_dashboard_cards: null }).eq('id', WEEKLY_SUMMARY_ID);
  }
});
