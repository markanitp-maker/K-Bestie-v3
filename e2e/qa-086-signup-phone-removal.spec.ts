import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3152";
const TARGET = process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "prod" : "dev";
const SUPABASE_URL = TARGET === "prod"
  ? process.env.NEXT_PUBLIC_SUPABASE_URL!
  : process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const ANON_KEY = TARGET === "prod"
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  : process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const SERVICE_KEY = TARGET === "prod"
  ? process.env.SUPABASE_SERVICE_ROLE_KEY!
  : process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 120_000 });

async function attachQaParent(context: BrowserContext) {
  const auth = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({
    email: "qa-parent@kbestie.local",
    password: PASSWORD,
  });
  if (error || !data.session || !data.user) throw error ?? new Error("QA_SESSION_MISSING");

  let chunks: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (next) => {
        chunks = next.filter((cookie) => cookie.value).map(({ name, value }) => ({ name, value }));
      },
    },
  });
  const { error: sessionError } = await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError || chunks.length === 0) throw sessionError ?? new Error("QA_COOKIE_MISSING");

  await context.addCookies(chunks.map((cookie) => ({
    ...cookie,
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: false,
    secure: BASE.startsWith("https:"),
    sameSite: "Lax" as const,
  })));
  return data.user.id;
}

test("전화번호 없이 보호자 정보 2/4에서 가족 만들기 3/4로 진행한다", async ({ context, page }) => {
  const userId = await attachQaParent(context);
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: original, error: originalError } = await service
    .from("parents")
    .select("name,phone_number,relationship_to_child,legal_guardian_confirmed_at,account_status")
    .eq("id", userId)
    .single();
  if (originalError || !original) throw originalError ?? new Error("QA_PARENT_MISSING");

  await context.route("**/api/families", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ families: [] }) });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`${BASE}/signup?step=profile`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("2 / 4 보호자 정보", { exact: true })).toBeVisible();
    await expect(page.getByText("보호자 기본정보", { exact: true })).toBeVisible();
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(page.getByPlaceholder(/휴대전화|전화번호/)).toHaveCount(0);

    await page.getByPlaceholder("보호자 이름").fill(original.name || "QA 보호자");
    await page.locator("select").selectOption(original.relationship_to_child || "legal_guardian");
    await page.locator('input[type="checkbox"]').check();

    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/signup/profile") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /다음/ }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = response.request().postDataJSON();
    expect(body).toMatchObject({
      name: original.name || "QA 보호자",
      relationship: original.relationship_to_child || "legal_guardian",
      legalGuardianConfirmed: true,
    });
    expect(body).not.toHaveProperty("phone");

    await expect(page.getByText("3 / 4 가족 만들기", { exact: true })).toBeVisible();
    await expect(page.getByText("가족 만들기", { exact: true })).toBeVisible();

    const { data: after, error: afterError } = await service
      .from("parents")
      .select("phone_number")
      .eq("id", userId)
      .single();
    if (afterError) throw afterError;
    expect(after?.phone_number).toBe(original.phone_number);
  } finally {
    const { error: restoreError } = await service
      .from("parents")
      .update(original)
      .eq("id", userId);
    if (restoreError) throw restoreError;
  }
});
