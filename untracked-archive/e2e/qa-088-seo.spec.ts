import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const ARTIFACT_DIR = '/tmp/agy-qa-seo';

test.beforeAll(() => {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }
});

test.describe('QA-088 SEO/AEO/GEO Integrated Optimization Verification', () => {
  test.setTimeout(90000);

  // --------------------------------------------------------------------------
  // Scenario 1: Logged-in root "/" navigation & "시작하기" button check
  // --------------------------------------------------------------------------
  test('Scenario 1: Logged-in state entry to "/" redirects to home & start button test', async ({ page }) => {
    console.log('[Scenario 1] Starting login test...');
    await page.setViewportSize({ width: 390, height: 844 });
    
    // Login as child qatesti-dev
    await page.goto(`${DEV_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    // Wait for redirect after login
    await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 });
    const homeUrl = page.url();
    console.log('[Scenario 1] Login successful, current URL:', homeUrl);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario1_01_logged_in_home.png') });

    // Now navigate to root "/"
    console.log('[Scenario 1] Navigating to "/" while logged in...');
    
    // We want to observe loading spinner / transition when accessing "/"
    let loadingSpinnerSeen = false;
    page.on('domcontentloaded', async () => {
      const content = await page.content();
      if (content.includes('animate-spin') || content.includes('Loading') || content.includes('로딩')) {
        loadingSpinnerSeen = true;
      }
    });

    const response = await page.goto(`${DEV_BASE}/`, { waitUntil: 'commit' });
    
    // Check if "시작하기" button is clicked in case it appears briefly
    const startBtn = page.locator('a:has-text("시작하기"), button:has-text("시작하기")').first();
    if (await startBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('[Scenario 1] "시작하기" button visible during transition, tapping it...');
      await startBtn.click().catch(() => {});
    }

    // Wait for final navigation
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    console.log('[Scenario 1] Final URL after accessing "/":', finalUrl);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario1_02_final_redirect.png') });

    // Assert that logged-in user is NOT at /login
    expect(finalUrl).not.toContain('/login');
    // Assert user ended up on home or onboarding
    expect(finalUrl).toMatch(/\/(child|parent|onboarding)/);
    console.log('[Scenario 1] PASSED');
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Unauthenticated guest landing & anchor scroll check (#features, #faq)
  // --------------------------------------------------------------------------
  test('Scenario 2: Unauthenticated guest landing & anchor scrolling (#features, #faq)', async ({ page }) => {
    console.log('[Scenario 2] Starting guest landing test...');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${DEV_BASE}/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario2_01_landing_top.png') });

    // Check FAQ section visibility
    const faqHeading = page.locator('#faq, [id="faq"], h2:has-text("FAQ"), h2:has-text("자주 묻는 질문")').first();
    const faqExists = await faqHeading.count() > 0;
    console.log('[Scenario 2] FAQ section exists:', faqExists);
    expect(faqExists).toBe(true);

    // Test #features anchor scroll
    console.log('[Scenario 2] Navigating to #features anchor...');
    await page.goto(`${DEV_BASE}/#features`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const scrollYFeatures = await page.evaluate(() => window.scrollY);
    console.log('[Scenario 2] scrollY at #features:', scrollYFeatures);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario2_02_features_anchor.png') });

    const featuresElement = page.locator('#features, [id="features"]').first();
    expect(await featuresElement.count()).toBeGreaterThan(0);

    // Test #faq anchor scroll
    console.log('[Scenario 2] Navigating to #faq anchor...');
    await page.goto(`${DEV_BASE}/#faq`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const scrollYFaq = await page.evaluate(() => window.scrollY);
    console.log('[Scenario 2] scrollY at #faq:', scrollYFaq);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario2_03_faq_anchor.png') });

    expect(await faqHeading.count()).toBeGreaterThan(0);
    expect(scrollYFaq).toBeGreaterThan(0);

    console.log('[Scenario 2] PASSED');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Raw HTML Meta tags check ("/", "/privacy", "/signup", "/invite/xxx")
  // --------------------------------------------------------------------------
  test('Scenario 3: Meta tags in raw HTML (og:title, og:description, og:image, og:url, twitter:card)', async ({ request }) => {
    console.log('[Scenario 3] Starting raw HTML meta tag checks...');
    const paths = ['/', '/privacy', '/signup', '/invite/accept?token=qa-test-token'];
    const requiredTags = ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'];

    const metaResults: Record<string, Record<string, string | null>> = {};

    for (const p of paths) {
      console.log(`[Scenario 3] Fetching raw HTML for ${p}...`);
      const res = await request.get(`${DEV_BASE}${p}`);
      expect(res.status()).toBe(200);
      const html = await res.text();

      // Save raw HTML for evidence log
      const safeFileName = p.replace(/\//g, '_') || '_root';
      fs.writeFileSync(path.join(ARTIFACT_DIR, `scenario3_raw_${safeFileName}.html`), html);

      const foundTags: Record<string, string | null> = {};
      for (const tag of requiredTags) {
        let val: string | null = null;
        if (tag.startsWith('og:')) {
          const match = html.match(new RegExp(`property=["']${tag}["']\\s+content=["']([^"']+)["']`, 'i')) ||
                        html.match(new RegExp(`content=["']([^"']+)["']\\s+property=["']${tag}["']`, 'i')) ||
                        html.match(new RegExp(`\\\\?"property\\\\?":\\\\?"${tag}\\\\?",\\\\?"content\\\\?":\\\\?"([^"\\\\]+)`, 'i'));
          val = match ? match[1] : null;
        } else if (tag.startsWith('twitter:')) {
          const match = html.match(new RegExp(`name=["']${tag}["']\\s+content=["']([^"']+)["']`, 'i')) ||
                        html.match(new RegExp(`content=["']([^"']+)["']\\s+name=["']${tag}["']`, 'i')) ||
                        html.match(new RegExp(`\\\\?"name\\\\?":\\\\?"${tag}\\\\?",\\\\?"content\\\\?":\\\\?"([^"\\\\]+)`, 'i'));
          val = match ? match[1] : null;
        }
        foundTags[tag] = val;
      }
      metaResults[p] = foundTags;
      console.log(`[Scenario 3] ${p} meta tags:`, foundTags);
    }

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'scenario3_meta_summary.json'), JSON.stringify(metaResults, null, 2));

    // Verify all required tags are present across the pages
    for (const p of paths) {
      for (const tag of requiredTags) {
        const val = metaResults[p][tag];
        expect(val, `Missing ${tag} on ${p}`).not.toBeNull();
        expect(val!.length, `Empty ${tag} on ${p}`).toBeGreaterThan(0);
      }
    }
    console.log('[Scenario 3] PASSED');
  });

  // --------------------------------------------------------------------------
  // Scenario 4: /robots.txt & /sitemap.xml check & KakaoTalk preview card verification
  // --------------------------------------------------------------------------
  test('Scenario 4: /robots.txt & /sitemap.xml inspection & KakaoTalk preview card rule check', async ({ request }) => {
    console.log('[Scenario 4] Fetching /robots.txt...');
    const robotsRes = await request.get(`${DEV_BASE}/robots.txt`);
    expect(robotsRes.status()).toBe(200);
    const robotsTxt = await robotsRes.text();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'scenario4_robots.txt'), robotsTxt);
    console.log('[Scenario 4] robots.txt snippet:\n', robotsTxt.substring(0, 300));

    // Check disallow rules for /signup, /invite/, /family/
    expect(robotsTxt).toContain('Disallow: /signup');
    expect(robotsTxt).toContain('Disallow: /invite/');
    expect(robotsTxt).toContain('Disallow: /family/');

    console.log('[Scenario 4] Fetching /sitemap.xml...');
    const sitemapRes = await request.get(`${DEV_BASE}/sitemap.xml`);
    expect(sitemapRes.status()).toBe(200);
    const sitemapXml = await sitemapRes.text();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'scenario4_sitemap.xml'), sitemapXml);
    console.log('[Scenario 4] sitemap.xml snippet:\n', sitemapXml);

    expect(sitemapXml).toContain('<?xml');
    expect(sitemapXml).toContain('<urlset');
    expect(sitemapXml).toContain('https://app.k-bestie.com/');

    console.log('[Scenario 4] Note on KakaoTalk card scraper:');
    console.log('Robots.txt disallows /signup, /invite/, /family/ for User-agent: *.');
    console.log('KakaoTalk scraper obeys robots.txt and will fail to scrape preview cards for disallowed pages.');
    console.log('However, rendering in actual KakaoTalk chat UI cannot be verified live without external Kakao server API.');
    console.log('[Scenario 4] PARTIAL PASS / UNVERIFIED KAKAO SCRAPER LIVE CARD');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Check "월간" text occurrence on landing page
  // --------------------------------------------------------------------------
  test('Scenario 5: Landing page text contains 0 occurrences of "월간"', async ({ page }) => {
    console.log('[Scenario 5] Checking landing page text for "월간"...');
    await page.goto(`${DEV_BASE}/`, { waitUntil: 'networkidle' });

    const fullText = await page.locator('body').innerText();
    const wolganMatches = (fullText.match(/월간/g) || []);
    console.log('[Scenario 5] Matches for "월간":', wolganMatches.length);

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'scenario5_landing_text.txt'), fullText);

    if (wolganMatches.length > 0) {
      console.error('[Scenario 5] FAILED: "월간" found in landing text!');
    }
    expect(wolganMatches.length).toBe(0);
    console.log('[Scenario 5] PASSED');
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Offline entry retry screen check
  // --------------------------------------------------------------------------
  test('Scenario 6: Offline entry maintains retry screen', async ({ context, page }) => {
    console.log('[Scenario 6] Testing offline entry...');
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Visit /offline page online first
    await page.goto(`${DEV_BASE}/offline`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario6_01_offline_page_online.png') });

    // 2. Set browser offline
    console.log('[Scenario 6] Setting browser offline...');
    await context.setOffline(true);

    try {
      // 3. Interact with /offline page (e.g. click "다시 시도" button while offline)
      const retryBtn = page.locator('button:has-text("다시 시도")').first();
      expect(await retryBtn.isVisible()).toBe(true);

      console.log('[Scenario 6] Clicking "다시 시도" button while offline...');
      await retryBtn.click().catch(() => {});
      await page.waitForTimeout(1000);

      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'scenario6_02_offline_after_retry_click.png') });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.log('[Scenario 6] Offline body text snippet:', bodyText.substring(0, 200));

      const hasOfflineUI = bodyText.includes('인터넷 연결이 끊겼어요') && 
                           bodyText.includes('다시 시도');

      console.log('[Scenario 6] Offline UI maintained:', hasOfflineUI);
      expect(hasOfflineUI).toBe(true);
      console.log('[Scenario 6] PASSED');
    } finally {
      await context.setOffline(false);
    }
  });
});
