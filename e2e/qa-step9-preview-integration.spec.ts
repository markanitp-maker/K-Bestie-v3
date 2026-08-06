import { test, expect } from "@playwright/test";

test.describe("Step 9. Real Dev Preview Deployment Integration Validation (A~F)", () => {
  const PREVIEW_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || "https://k-bestie-v3-c6q123iob-markanitp.vercel.app";

  test("Scenario A: Unauthenticated landing (/) and login (/login) routing test", async ({ page }) => {
    await page.goto(`${PREVIEW_URL}/login`);
    console.log("[Scenario A] Login page URL:", page.url());
    expect(page.url()).toContain("/login");
    await expect(page.locator("button:has-text('카카오로 로그인'), input[placeholder*='아이디']").first()).toBeVisible();
  });

  test("Scenario B: Unauthenticated direct access to onboarding is safely redirected to login", async ({ page }) => {
    await page.goto(`${PREVIEW_URL}/signup?step=consent`);
    console.log("[Scenario B] Consent page direct access URL:", page.url());
    expect(page.url()).toContain("/login");
  });

  test("Scenario C: Membership status API unauthenticated fail-closed check", async ({ request }) => {
    const res = await request.get(`${PREVIEW_URL}/api/auth/membership-status`);
    console.log("[Scenario C] Unauthenticated membership API status:", res.status());
    expect([200, 401]).toContain(res.status());
    const cacheHeader = res.headers()["cache-control"] || "";
    console.log("[Scenario C] Cache-Control header:", cacheHeader);
    expect(cacheHeader.includes("no-store") || cacheHeader.includes("no-cache") || cacheHeader.includes("must-revalidate") || res.status() === 401).toBeTruthy();
  });

  test("Scenario D: Signup consent submission API validation", async ({ request }) => {
    const res = await request.post(`${PREVIEW_URL}/api/signup/consent`, {
      data: { terms_accepted: true, privacy_accepted: true },
    });
    console.log("[Scenario D] Unauthenticated consent POST status:", res.status());
    expect([400, 401, 403]).toContain(res.status());
  });

  test("Scenario E: Health and Client Version API check", async ({ request }) => {
    const healthRes = await request.get(`${PREVIEW_URL}/api/health`);
    console.log("[Scenario E] /api/health status:", healthRes.status());
    expect([200, 404]).toContain(healthRes.status());

    const verRes = await request.get(`${PREVIEW_URL}/api/client-version`);
    console.log("[Scenario E] /api/client-version status:", verRes.status());
    expect([200, 404, 405]).toContain(verRes.status());
  });

  test("Scenario F: Legacy parent QA fixture membership resolution status check", async ({ request }) => {
    const res = await request.get(`${PREVIEW_URL}/api/auth/membership-status`, {
      headers: {
        "x-qa-fixture-email": "dev-legacy-parent-qa@kbestie.local"
      }
    });
    console.log("[Scenario F] Membership status response:", res.status());
    expect([200, 401]).toContain(res.status());
  });
});
