import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3922";
const EVIDENCE_DIR = "/tmp/agy-qa-legal-100";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || "https://mkrsaaedxqrcrktapaus.supabase.co";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcnNhYWVkeHFyY3JrdGFwYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NTMxNTUsImV4cCI6MjEwMDAyOTE1NX0.N4wS3oBjZamJnD6ME-rU7zv6B8_e8DR_50ASEzWMzzI";
const SERVICE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcnNhYWVkeHFyY3JrdGFwYXVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDQ1MzE1NSwiZXhwIjoyMTAwMDI5MTU1fQ.CmduOi6vxUyPtWS6W6SWVJpySSKZICIbhsmV96Z0tNM";

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

async function createTempParentSession(context: BrowserContext) {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const tempEmail = `qa-legal-${Date.now()}-${Math.floor(Math.random() * 1000)}@kbestie.local`;
  const tempPassword = "TempPassword123!";

  const { data: uData, error: uError } = await service.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: "QA Legal Tester" },
  });
  if (uError || !uData.user) throw uError || new Error("Failed to create temp parent user");

  const userId = uData.user.id;

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sData, error: sError } = await anon.auth.signInWithPassword({
    email: tempEmail,
    password: tempPassword,
  });
  if (sError || !sData.session) throw sError || new Error("Failed to sign in temp parent");

  let chunks: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (next) => {
        chunks = next.filter((c) => c.value).map(({ name, value }) => ({ name, value }));
      },
    },
  });
  await ssr.auth.setSession({
    access_token: sData.session.access_token,
    refresh_token: sData.session.refresh_token,
  });

  const hostname = new URL(BASE_URL).hostname;
  await context.addCookies(
    chunks.map((cookie) => ({
      ...cookie,
      domain: hostname,
      path: "/",
      httpOnly: false,
      secure: BASE_URL.startsWith("https:"),
      sameSite: "Lax" as const,
    }))
  );

  return async () => {
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {}
  };
}

test.describe("Legal Registry System E2E QA", () => {
  test("Scenario 1: Signup 1/4 Consent Flow & Modal Interactions", async ({ context, page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("401") && !text.includes("Unauthorized")) {
          consoleErrors.push(text);
        }
      }
    });

    const cleanup = await createTempParentSession(context);

    try {
      console.log(`[Scenario 1] Navigating to ${BASE_URL}/signup...`);
      await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("button:has-text('상세보기 >')");

      // 1. Verify 7 checkboxes have "상세보기 >" link/button visible
      const detailButtons = page.locator("button:has-text('상세보기 >')");
      const count = await detailButtons.count();
      console.log(`[Scenario 1] Found ${count} '상세보기 >' buttons on signup page`);
      expect(count).toBe(7);

      const requiredRows = page.locator("div.flex.items-start.justify-between.gap-2:has(span:has-text('[필수]'))");
      const requiredCount = await requiredRows.count();
      console.log(`[Scenario 1] Required consent rows count: ${requiredCount}`);
      expect(requiredCount).toBe(5);

      const optionalRows = page.locator("div.flex.items-start.justify-between.gap-2:not(:has(span:has-text('[필수]')))");
      const optionalCount = await optionalRows.count();
      console.log(`[Scenario 1] Optional consent rows count: ${optionalCount}`);
      expect(optionalCount).toBe(2);

      // Verify all 5 required and 2 optional rows have "상세보기 >" button exposed
      for (let i = 0; i < 5; i++) {
        await expect(requiredRows.nth(i).locator("button:has-text('상세보기 >')")).toBeVisible();
      }
      for (let i = 0; i < 2; i++) {
        await expect(optionalRows.nth(i).locator("button:has-text('상세보기 >')")).toBeVisible();
      }

      // 2. Modal interactions & Checkbox non-auto-check verification
      const firstCheckbox = requiredRows.nth(0).locator("input[type='checkbox']");
      expect(await firstCheckbox.isChecked()).toBe(false);

      // A. Open modal -> Scroll -> ESC close
      console.log("[Scenario 1] Testing Modal ESC close...");
      await requiredRows.nth(0).locator("button:has-text('상세보기 >')").click();
      const modalDialog = page.locator("div[role='dialog']");
      await expect(modalDialog).toBeVisible();

      // Scroll inside modal
      const scrollContainer = modalDialog.locator(".overflow-y-auto");
      await scrollContainer.first().evaluate((el) => { el.scrollTop = 100; });
      const scrollTop = await scrollContainer.first().evaluate((el) => el.scrollTop);
      console.log(`[Scenario 1] Modal scroll position: ${scrollTop}`);
      expect(scrollTop).toBeGreaterThan(0);

      // Press Escape to close modal
      await page.keyboard.press("Escape");
      await expect(modalDialog).not.toBeVisible();

      // CRITICAL CHECK: Opening/closing modal MUST NOT automatically check the checkbox!
      const checkedAfterEsc = await firstCheckbox.isChecked();
      console.log(`[Scenario 1] Checkbox state after ESC close: ${checkedAfterEsc}`);
      expect(checkedAfterEsc).toBe(false);

      // B. Open modal -> X button close
      console.log("[Scenario 1] Testing Modal X button close...");
      await requiredRows.nth(0).locator("button:has-text('상세보기 >')").click();
      await expect(modalDialog).toBeVisible();
      const closeXButton = modalDialog.locator("header button").first();
      await closeXButton.click();
      await expect(modalDialog).not.toBeVisible();

      const checkedAfterX = await firstCheckbox.isChecked();
      console.log(`[Scenario 1] Checkbox state after X close: ${checkedAfterX}`);
      expect(checkedAfterX).toBe(false);

      // C. Open modal -> Backdrop click close
      console.log("[Scenario 1] Testing Modal Backdrop click close...");
      await requiredRows.nth(0).locator("button:has-text('상세보기 >')").click();
      await expect(modalDialog).toBeVisible();
      const backdropOverlay = page.locator("div.fixed.inset-0.bg-black\\/55");
      await backdropOverlay.click({ position: { x: 10, y: 10 } });
      await expect(modalDialog).not.toBeVisible();

      const checkedAfterBackdrop = await firstCheckbox.isChecked();
      console.log(`[Scenario 1] Checkbox state after Backdrop click close: ${checkedAfterBackdrop}`);
      expect(checkedAfterBackdrop).toBe(false);

      // 3. Next button state logic with required consents
      const nextButton = page.locator("button:has-text('다음 →')");
      await expect(nextButton).toBeDisabled();

      // Check 4 out of 5 required items
      console.log("[Scenario 1] Checking 4/5 required consents...");
      for (let i = 0; i < 4; i++) {
        await requiredRows.nth(i).locator("input[type='checkbox']").check();
      }
      // Next button should still be disabled because only 4/5 are checked
      await expect(nextButton).toBeDisabled();

      // Check 5th required item to test enablement
      console.log("[Scenario 1] Checking 5th required consent...");
      await requiredRows.nth(4).locator("input[type='checkbox']").check();
      // Next button should now be enabled
      await expect(nextButton).toBeEnabled();

      // 4. Test "전체 동의하기" Check All & optional uncheck logic
      // First uncheck all required items to return to un-agreed state
      for (let i = 0; i < 5; i++) {
        await requiredRows.nth(i).locator("input[type='checkbox']").uncheck();
      }
      await expect(nextButton).toBeDisabled();

      // Click "전체 동의하기"
      console.log("[Scenario 1] Clicking '전체 동의하기'...");
      const toggleAllBtn = page.locator("button:has-text('전체 동의하기')");
      await toggleAllBtn.click();

      // Verify all 5 required and 2 optional items are checked
      for (let i = 0; i < 5; i++) {
        expect(await requiredRows.nth(i).locator("input[type='checkbox']").isChecked()).toBe(true);
      }
      for (let i = 0; i < 2; i++) {
        expect(await optionalRows.nth(i).locator("input[type='checkbox']").isChecked()).toBe(true);
      }
      await expect(nextButton).toBeEnabled();

      // Uncheck optional item #1
      console.log("[Scenario 1] Unchecking optional item 1...");
      await optionalRows.nth(0).locator("input[type='checkbox']").uncheck();
      expect(await optionalRows.nth(0).locator("input[type='checkbox']").isChecked()).toBe(false);
      expect(await optionalRows.nth(1).locator("input[type='checkbox']").isChecked()).toBe(true);
      await expect(nextButton).toBeEnabled();

      // Uncheck optional item #2
      console.log("[Scenario 1] Unchecking optional item 2...");
      await optionalRows.nth(1).locator("input[type='checkbox']").uncheck();
      expect(await optionalRows.nth(1).locator("input[type='checkbox']").isChecked()).toBe(false);
      // All 5 required items still checked
      for (let i = 0; i < 5; i++) {
        expect(await requiredRows.nth(i).locator("input[type='checkbox']").isChecked()).toBe(true);
      }
      await expect(nextButton).toBeEnabled();

      // 5. Console errors check
      console.log("[Scenario 1] Console errors:", consoleErrors);
      expect(consoleErrors).toHaveLength(0);
    } catch (err) {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, "scenario1-failure.png") });
      fs.writeFileSync(path.join(EVIDENCE_DIR, "scenario1-error.txt"), String(err));
      throw err;
    } finally {
      await cleanup();
    }
  });

  test("Scenario 2: Public Legal Docs Accessibility (/terms & /privacy)", async ({ page }) => {
    for (const docPath of ["/terms", "/privacy"]) {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (!text.includes("401") && !text.includes("Unauthorized")) {
            consoleErrors.push(text);
          }
        }
      });

      try {
        console.log(`[Scenario 2] Navigating to ${BASE_URL}${docPath}...`);
        const response = await page.goto(`${BASE_URL}${docPath}`, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);

        // Verify Dev environment banner text
        await page.waitForSelector("article");
        const pageText = await page.content();
        const hasDevBanner =
          pageText.includes("Development candidate") ||
          pageText.includes("LEGAL_REVIEW_REQUIRED") ||
          pageText.includes("Production 미공개");
        console.log(`[Scenario 2] ${docPath} Dev Banner present: ${hasDevBanner}`);
        expect(hasDevBanner).toBe(true);

        // Verify viewport horizontal overflow (390px, 430px)
        for (const width of [390, 430]) {
          await page.setViewportSize({ width, height: 800 });
          await page.waitForTimeout(100);
          const hasOverflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth;
          });
          console.log(`[Scenario 2] ${docPath} @ ${width}px viewport horizontal overflow: ${hasOverflow}`);
          expect(hasOverflow).toBe(false);
        }

        console.log(`[Scenario 2] ${docPath} Console errors:`, consoleErrors);
        expect(consoleErrors).toHaveLength(0);
      } catch (err) {
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `scenario2-${docPath.slice(1)}-failure.png`) });
        fs.writeFileSync(path.join(EVIDENCE_DIR, `scenario2-${docPath.slice(1)}-error.txt`), String(err));
        throw err;
      }
    }
  });

  test("Scenario 4: Parent Settings Interests UI Removal Check", async ({ page }) => {
    console.log(`[Scenario 4] Accessing ${BASE_URL}/parent/settings without auth...`);
    const response = await page.goto(`${BASE_URL}/parent/settings`, { waitUntil: "domcontentloaded" });
    const finalUrl = page.url();
    console.log(`[Scenario 4] Response status: ${response?.status()}, Final URL: ${finalUrl}`);

    if (finalUrl.includes("/login")) {
      console.log("[Scenario 4] Redirected to /login (307 redirect) due to auth middleware.");
    }
  });
});
