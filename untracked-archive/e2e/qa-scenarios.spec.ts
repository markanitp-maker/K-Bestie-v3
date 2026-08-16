import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const DEV_URL = 'https://k-bestie-v3-dev.vercel.app';

test.describe('QA Auth Signup', () => {
  test('Scenario 6: Suspended account redirect', async ({ page }) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const email = `suspend-test-${Date.now()}@kbestie.local`;
    const password = 'password123';
    
    console.log(`Creating user: ${email}`);
    // 1. Create user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(authError).toBeNull();
    const user = authData.user!;
    
    // 2. Create parents row with SUSPENDED status
    const { error: dbError } = await supabase
      .from('parents')
      .upsert({
        id: user.id,
        email,
        name: 'Suspended QA',
        phone_number: '010-0000-0000',
        account_status: 'SUSPENDED'
      });
    expect(dbError).toBeNull();
    
    // 3. Generate a magic link to login
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${DEV_URL}/parent/dashboard` // Will try to go to dashboard
      }
    });
    expect(linkError).toBeNull();
    
    // 4. Visit the magic link
    console.log(`Navigating to magic link: ${linkData.properties.action_link}`);
    await page.goto(linkData.properties.action_link);
    
    // 5. Wait for network and navigation to settle
    await page.waitForLoadState('networkidle');
    
    // The page might redirect to /auth/callback then to /parent/dashboard and middleware should catch it and redirect to /account/suspended
    await page.waitForURL(/.*\/account\/suspended/, { timeout: 10000 });
    
    const currentUrl = page.url();
    console.log(`Current URL after redirect: ${currentUrl}`);
    expect(currentUrl).toContain('/account/suspended');
    
    await page.screenshot({ path: '/tmp/agy-qa-authsignup/scenario6_pass.png' });
  });

  test('Scenario 7: Mobile viewport signup', async ({ page }) => {
    // iPhone 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    
    await page.goto(`${DEV_URL}/signup?step=consent`);
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of step 1 (consent)
    await page.screenshot({ path: '/tmp/agy-qa-authsignup/scenario7_consent.png' });
    
    // Check horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    
    expect(hasHorizontalScroll).toBe(false);
  });
});
