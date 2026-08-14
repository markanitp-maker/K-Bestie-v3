import { expect, test, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const QA_ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim();

async function attachAdminSession(context: BrowserContext) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !QA_ADMIN_EMAIL) {
    throw new Error("Dev Supabase QA credentials and ADMIN_EMAILS are required");
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: QA_ADMIN_EMAIL,
  });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("QA magic link generation failed");

  const auth = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await auth.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error || !data.session) throw error ?? new Error("QA session is missing");

  let cookies: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (next) => {
        cookies = next.filter((cookie) => cookie.value).map(({ name, value }) => ({ name, value }));
      },
    },
  });
  const { error: sessionError } = await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError || cookies.length === 0) throw sessionError ?? new Error("QA cookie creation failed");

  await context.addCookies(cookies.map((cookie) => ({
    ...cookie,
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: false,
    secure: BASE.startsWith("https:"),
    sameSite: "Lax" as const,
  })));
}

test.beforeEach(async ({ context, page }) => {
  await attachAdminSession(context);
  await page.route("**/api/auth/membership-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "AUTHENTICATED_INCOMPLETE",
        familyId: "00000000-0000-4000-8000-000000000001",
        onboardingStep: "child",
      }),
    });
  });
});

test("두 비밀번호 input이 같은 브라우저 task에서 갱신돼도 값이 유실되지 않는다", async ({ page }) => {
  await page.goto(`${BASE}/signup?step=child`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("4 / 4 아이 등록", { exact: true })).toBeVisible();

  await page.getByPlaceholder("성").fill("김");
  await page.getByPlaceholder("이름").fill("테스트");
  await page.getByRole("button", { name: "남자" }).click();
  await page.locator("select").selectOption("5학년");
  await page.getByPlaceholder("아이 로그인 아이디").fill("password-batch-qa");
  await page.getByRole("checkbox").check();

  const password = "QaChild9!";
  await page.evaluate((nextPassword) => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    if (inputs.length !== 2) throw new Error("PASSWORD_INPUT_PAIR_MISSING");
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("NATIVE_VALUE_SETTER_MISSING");
    for (const input of inputs) {
      valueSetter.call(input, nextPassword);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, password);

  const first = page.getByPlaceholder("비밀번호 (6자 이상)");
  const second = page.getByPlaceholder("비밀번호 확인");
  await expect(first).toHaveValue(password);
  await expect(second).toHaveValue(password);
  await expect(page.getByRole("button", { name: /아이 등록하고 시작하기/ })).toBeEnabled();

  await second.fill("QaChild8!");
  await second.blur();
  await expect(page.getByText("비밀번호가 서로 달라요. 두 입력을 다시 확인해 주세요.")).toBeVisible();
  await expect(second).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: /아이 등록하고 시작하기/ })).toBeDisabled();

  await second.fill(password);
  await expect(page.getByText("비밀번호가 서로 달라요. 두 입력을 다시 확인해 주세요.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /아이 등록하고 시작하기/ })).toBeEnabled();
});
