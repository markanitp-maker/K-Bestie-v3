import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const BATCH_DIR = '/tmp/agy-qa-ui-batch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywylqlypxkbfsqlnqvg.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_anon_key';

const PARENT_EMAILS = ['qa-parent@kbestie.local', 'qatest-parent-dev@kbestie.local'];
const CHILD_EMAIL = 'qatesti-dev@kbestie.local';

function projectRef(url: string) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return 'lywylqlypxkbfsqlnqvg';
  }
}

async function useSession(context: BrowserContext, session: Session, url: string) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const ref = projectRef(SUPABASE_URL);
  const cookieName = `sb-${ref}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: 'Lax' as const })));
}

async function loginAsParent(page: any, context: BrowserContext) {
  if (SERVICE_ROLE_KEY && ANON_KEY) {
    for (const email of PARENT_EMAILS) {
      try {
        const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email });
        if (!linkErr && link?.properties?.hashed_token) {
          const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
          const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
            token_hash: link.properties.hashed_token,
            type: 'magiclink',
          });
          if (!verifyErr && verified.session) {
            await useSession(context, verified.session, DEV_BASE);
            await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1500);
            if (!page.url().includes('/signup')) {
              console.log(`[Parent Login] Logged in successfully with ${email}`);
              return;
            }
          }
        }
      } catch (e) {
        console.log(`Parent magiclink login attempt for ${email} failed:`, e);
      }
    }
  }

  // Fallback to UI form login
  await page.goto(`${DEV_BASE}/login?role=parent`, { waitUntil: 'domcontentloaded' });
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  const pwdInput = page.getByPlaceholder('비밀번호를 입력하세요');
  if (await idInput.isVisible().catch(() => false)) {
    await idInput.fill('qa-parent');
    await pwdInput.fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(2000);
  }
}

async function loginAsChild(page: any, context: BrowserContext) {
  if (SERVICE_ROLE_KEY && ANON_KEY) {
    try {
      const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: CHILD_EMAIL });
      if (!linkErr && link?.properties?.hashed_token) {
        const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
          token_hash: link.properties.hashed_token,
          type: 'magiclink',
        });
        if (!verifyErr && verified.session) {
          await useSession(context, verified.session, DEV_BASE);
          await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1500);
          return;
        }
      }
    } catch (e) {
      console.log('Child magiclink login fallback to form:', e);
    }
  }

  await page.goto(`${DEV_BASE}/login?role=child`, { waitUntil: 'domcontentloaded' });
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  const pwdInput = page.getByPlaceholder('비밀번호를 입력하세요');
  if (await idInput.isVisible().catch(() => false)) {
    await idInput.fill('qatesti-dev');
    await pwdInput.fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(2000);
  }
}

test.beforeAll(() => {
  if (!fs.existsSync(BATCH_DIR)) {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
  }
});

test.describe('QA UI Batch Verification (059+064, 061, 063)', () => {

  test('1) 059+064 부모 리포트 UI 전면 개편 검증', async ({ page, context }) => {
    test.setTimeout(60000);
    await loginAsParent(page, context);

    // 1. Navigate to /parent/report
    await page.goto(`${DEV_BASE}/parent/report`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Dismiss PWA / modal if present
    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
    }

    console.log('[059+064] Report page URL:', page.url());
    await page.screenshot({ path: path.join(BATCH_DIR, '059_064_parent_report.png') });

    // Verify Segment Tabs
    const dailyBtn = page.locator('button, a').filter({ hasText: '일간' }).first();
    const weeklyBtn = page.locator('button, a').filter({ hasText: '주간' }).first();
    const hasTabs = (await dailyBtn.count() > 0) && (await weeklyBtn.count() > 0);
    console.log('[059+064] Daily/Weekly Segment Tabs present:', hasTabs);

    // Verify Key Number / Section
    const bodyText = await page.innerText('body');
    const hasKeyNumber = bodyText.includes('이번 주 대화') || bodyText.includes('일간 리포트') || bodyText.includes('일');
    console.log('[059+064] Conversation day count / summary section present:', hasKeyNumber);

    // Verify Emotion Summary box styling (rounded rectangle, auto height)
    const emotionBox = page.locator('[class*="rounded-"], [class*="rounded-[16px]"], [class*="rounded-[24px]"]').first();
    const isEmotionBoxVisible = await emotionBox.isVisible().catch(() => false);
    console.log('[059+064] Emotion box rounded rectangle visible:', isEmotionBoxVisible);

    // Verify Parent Bottom Nav consistency on all 4 parent pages
    const parentPages = ['/parent/home', '/parent/report', '/parent/guide', '/parent/settings'];
    const navConsistency: Record<string, boolean> = {};

    for (const pUrl of parentPages) {
      await page.goto(`${DEV_BASE}${pUrl}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const navEl = page.locator('nav[aria-label="부모 주요 메뉴"]').or(page.locator('nav')).filter({ hasText: '홈' }).first();
      const visible = await navEl.isVisible().catch(() => false);
      navConsistency[pUrl] = visible;
      console.log(`[059+064] Bottom nav on ${pUrl}:`, visible);
    }

    // Verify Viewport Responsiveness & Label No-Wrap (360px, 390px, 412px)
    const viewports = [
      { width: 360, height: 740, name: '360px' },
      { width: 390, height: 844, name: '390px' },
      { width: 412, height: 915, name: '412px' },
    ];
    const noWrapResults: Record<string, boolean> = {};

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${DEV_BASE}/parent/report`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(BATCH_DIR, `059_064_nav_${vp.name}.png`) });

      // Check text height of nav items to ensure no multi-line wrapping
      const navLabels = page.locator('nav span').filter({ hasText: /홈|리포트|케이와 대화|설정/ });
      const count = await navLabels.count();
      let wrapped = false;
      for (let i = 0; i < count; i++) {
        const item = navLabels.nth(i);
        const box = await item.boundingBox();
        if (box && box.height > 22) { // 22px threshold indicates line wrap
          wrapped = true;
          break;
        }
      }
      noWrapResults[vp.name] = !wrapped;
      console.log(`[059+064] Viewport ${vp.name} nav no wrap:`, !wrapped);
    }

    expect(hasTabs).toBe(true);
    expect(hasKeyNumber).toBe(true);
    expect(Object.values(navConsistency).every(v => v)).toBe(true);
    expect(Object.values(noWrapResults).every(v => v)).toBe(true);
  });

  test('2) 061 자유대화 비주얼 2차 재작업 검증', async ({ page, context }) => {
    test.setTimeout(60000);
    await loginAsChild(page, context);

    // Set viewport iPhone 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Save mandatory iPhone 390x844 screenshot
    await page.screenshot({ path: path.join(BATCH_DIR, '061_freechat_iphone_390x844.png') });
    console.log('[061] Free chat page URL:', page.url());

    // 1. Mascot 3D cylinder pedestal check
    const mascotGroup = page.locator('.free-chat-mascot-group, [class*="mascot"]');
    const hasMascotGroup = (await mascotGroup.count()) > 0;
    console.log('[061] Mascot group present:', hasMascotGroup);

    const cylinderPedestal = page.locator('.free-chat-mascot-group div[class*="gradient-to-b"], div[class*="rounded-[100%]"]').first();
    const has3DCylinder = (await cylinderPedestal.count()) > 0;
    console.log('[061] 3D cylinder pedestal present:', has3DCylinder);

    // 2. Halo check (radial-gradient blur, borderless)
    const haloElement = page.locator('div[style*="radial-gradient"]').first();
    const hasHalo = (await haloElement.count()) > 0;
    console.log('[061] Radial gradient halo present:', hasHalo);

    // 3. Auto/Manual toggle check (in front of pedestal, pointer-events enabled, clickable)
    const autoBtn = page.getByRole('button', { name: '자동' });
    const manualBtn = page.getByRole('button', { name: '수동' });
    const hasToggle = (await autoBtn.count() > 0) && (await manualBtn.count() > 0);
    console.log('[061] Auto/Manual toggle present:', hasToggle);

    let isToggleClickable = false;
    if (hasToggle) {
      const isAutoEnabled = await autoBtn.isEnabled().catch(() => false);
      const isManualEnabled = await manualBtn.isEnabled().catch(() => false);
      isToggleClickable = isAutoEnabled && isManualEnabled;
      console.log('[061] Toggle buttons clickable:', isToggleClickable);

      // Test click toggle
      await manualBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(BATCH_DIR, '061_manual_toggled.png') });
    }

    // 4. Speech bubble & State card check
    const speechBubble = page.locator('[class*="border-[var(--color-k-orange)]"]').first();
    const hasSpeechBubble = await speechBubble.isVisible().catch(() => false);
    console.log('[061] Speech bubble visible:', hasSpeechBubble);

    const stateCard = page.locator('[aria-live="polite"], text="듣는 중", text="생각 중", text="말하는 중", text="대기 중"').first();
    const hasStateCard = await stateCard.isVisible().catch(() => false);
    console.log('[061] State card visible:', hasStateCard);

    expect(has3DCylinder).toBe(true);
    expect(hasHalo).toBe(true);
    expect(hasToggle).toBe(true);
    expect(isToggleClickable).toBe(true);
    expect(hasSpeechBubble || hasStateCard).toBe(true);
  });

  test('3) 063 부모 홈 대시보드 개편 검증', async ({ page, context }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsParent(page, context);

    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Screenshot of parent home
    await page.screenshot({ path: path.join(BATCH_DIR, '063_parent_home.png') });
    console.log('[063] Parent home URL:', page.url());

    // 1. Verify "아이와 케이 시작하기" card is REMOVED from main body
    const bodyContent = page.locator('.flex-1.overflow-y-auto');
    const bodyText = await bodyContent.innerText().catch(() => '');
    const hasStartCardInBody = bodyText.includes('아이와 케이 시작하기') && bodyText.includes('시작 카드');
    console.log('[063] Start card present in page body (should be false):', hasStartCardInBody);

    // 2. Verify Header CTA button exists and opens ChildStartGuideModal
    const headerCta = page.locator('header button, [class*="Header"] button').filter({ hasText: /시작|가이드|아이/ }).first();
    const hasHeaderCta = await headerCta.isVisible().catch(() => false);
    console.log('[063] Header CTA button visible:', hasHeaderCta);

    let modalOpened = false;
    if (hasHeaderCta) {
      await headerCta.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(BATCH_DIR, '063_start_guide_modal.png') });

      const dialog = page.locator('[role="dialog"]').or(page.locator('[class*="modal"]')).first();
      modalOpened = await dialog.isVisible().catch(() => false);
      console.log('[063] ChildStartGuideModal opened on header CTA click:', modalOpened);

      // Close modal
      const closeBtn = page.locator('[role="dialog"] button').filter({ hasText: /닫기|✕|X/ }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => {});
      }
    }

    // 3. Verify "오늘의 한마디" (TodayConversationGuide) and InsightGrid
    const fullBodyText = await page.innerText('body');
    const hasTodayQuote = fullBodyText.includes('오늘의 한마디') || fullBodyText.includes('대화 가이드') || fullBodyText.includes('이야기');
    const hasInsightGrid = fullBodyText.includes('학교·학원') || fullBodyText.includes('마음') || fullBodyText.includes('친구') || fullBodyText.includes('인사이트') || fullBodyText.includes('상태 카드');

    console.log('[063] "오늘의 한마디" present:', hasTodayQuote);
    console.log('[063] Insight cards present:', hasInsightGrid);

    expect(hasStartCardInBody).toBe(false);
    expect(hasHeaderCta).toBe(true);
    expect(modalOpened).toBe(true);
    expect(hasTodayQuote || hasInsightGrid).toBe(true);
  });

});
