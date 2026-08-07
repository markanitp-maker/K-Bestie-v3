import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3128";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;
let qaCookieHeader = "";

async function attachQaParent(context: BrowserContext) {
  const auth = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({
    email: "qa-parent@kbestie.local",
    password: PASSWORD,
  });
  if (error || !data.session) throw error ?? new Error("QA_SESSION_MISSING");
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  let chunks: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (next) => { chunks = next.filter((cookie) => cookie.value).map(({ name, value }) => ({ name, value })); },
    },
  });
  const { error: sessionError } = await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError || chunks.length === 0) throw sessionError ?? new Error("QA_AUTH_COOKIE_CREATE_FAILED");
  const verifier = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: () => chunks, setAll: () => undefined },
  });
  const { data: verified, error: verifyError } = await verifier.auth.getUser();
  if (verifyError || verified.user?.email !== "qa-parent@kbestie.local") {
    throw verifyError ?? new Error("QA_AUTH_COOKIE_VERIFY_FAILED");
  }
  await context.addCookies(chunks.map((chunk) => ({
    ...chunk,
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: false,
    secure: BASE.startsWith("https:"),
    sameSite: "Lax" as const,
  })));
  const installed = await context.cookies(BASE);
  if (installed.filter((cookie) => cookie.name.startsWith(cookieName)).length !== chunks.length) {
    throw new Error("QA_AUTH_COOKIE_INSTALL_FAILED");
  }
  qaCookieHeader = chunks.map((chunk) => `${chunk.name}=${chunk.value}`).join("; ");
}

test.beforeEach(async ({ context }) => {
  await attachQaParent(context);
});

test("API count, filtering, onboarding protection, CSV minimization", async () => {
  const byMode: Record<string, any> = {};
  for (const mode of ["exclude", "include", "only"]) {
    const response = await fetch(`${BASE}/api/admin/users/overview?tab=families&internalTest=${mode}&pageSize=100`, { headers: { cookie: qaCookieHeader } });
    if (!response.ok) throw new Error(`overview ${response.status}: ${await response.text()}`);
    byMode[mode] = await response.json();
  }

  for (const key of ["families", "parents", "children"]) {
    expect(byMode.include.kpi[key]).toBe(byMode.exclude.kpi[key] + byMode.only.kpi[key]);
  }
  expect(byMode.exclude.meta.softDeletedExcluded).toBe(true);

  const onboardingResponse = await fetch(`${BASE}/api/admin/users/overview?tab=parents&status=ONBOARDING&internalTest=include&pageSize=100`, { headers: { cookie: qaCookieHeader } });
  expect(onboardingResponse.ok).toBeTruthy();
  const onboarding = await onboardingResponse.json();
  expect(onboarding.items.every((row: any) => row.status === "ONBOARDING")).toBe(true);

  const childResponse = await fetch(`${BASE}/api/admin/users/overview?tab=children&search=testa&internalTest=include&pageSize=100`, { headers: { cookie: qaCookieHeader } });
  expect(childResponse.ok).toBeTruthy();
  const child = await childResponse.json();
  expect(child.items.some((row: any) => String(row.loginId).toLowerCase() === "testa")).toBe(true);
  expect(child.items.every((row: any) => row.approval === "등록 완료")).toBe(true);

  const csvResponse = await fetch(`${BASE}/api/admin/users/overview?tab=children&internalTest=only&format=csv`, { headers: { cookie: qaCookieHeader } });
  expect(csvResponse.ok).toBeTruthy();
  const csv = await csvResponse.text();
  expect(csv).toContain("로그인 아이디");
  expect(csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  expect(csv.toLowerCase()).not.toContain("access_token");
});

test("desktop tabs, search, drawer, and request sub-tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  expect(page.url(), await page.locator("body").innerText()).toContain("/admin/users");
  await expect(page.getByRole("heading", { name: "사용자 관리" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^가족/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("body")).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

  const firstRow = page.locator('tbody tr[tabindex="0"]').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await expect(page.getByRole("dialog", { name: "가족 상세" })).toBeVisible();
  await page.getByRole("button", { name: "상세 닫기" }).click();

  await page.getByRole("tab", { name: /^아이/ }).click();
  await page.getByRole("combobox").filter({ has: page.locator("option[value='include']") }).selectOption("include");
  await page.getByPlaceholder("가족명, 부모/아이 이름, 로그인 아이디 또는 이메일 검색").fill("testa");
  await expect(page.getByText("TestA", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "승인 대기" }).click();
  await expect(page.getByText(/처리 대기 요청이 없습니다.|승인|거절/).first()).toBeVisible();

  await page.getByRole("tab", { name: /^부모/ }).click();
  await page.getByRole("tab", { name: "계정 복구 요청" }).click();
  await expect(page.getByText(/처리 대기 요청이 없습니다.|승인|거절/).first()).toBeVisible();
  await page.getByRole("tab", { name: "요금제 변경 요청" }).click();
  await expect(page.getByText(/요금제 변경 요청|요청 내역이 없습니다|승인/).first()).toBeVisible();
});

test("mobile cards and full-screen drawer have no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin/users?tab=children`, { waitUntil: "networkidle" });
  expect(page.url(), await page.locator("body").innerText()).toContain("/admin/users");
  await expect(page.getByRole("heading", { name: "사용자 관리" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const card = page.locator('div.lg\\:hidden [role="button"]').first();
  await expect(card).toBeVisible();
  await card.click();
  const drawer = page.getByRole("dialog", { name: "아이 상세" });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
