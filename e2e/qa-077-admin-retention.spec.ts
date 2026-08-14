import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const QA_ADMIN_EMAIL = "qa-parent@kbestie.local";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(context: BrowserContext, session: Session) {
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const cookieName = `sb-${projectRef(SUPABASE_URL!)}-auth-token`;
  const chunks = value.length <= 3180
    ? [{ name: cookieName, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(chunks.map((chunk) => ({
    ...chunk,
    url: BASE,
    secure: BASE.startsWith("https:"),
    sameSite: "Lax" as const,
  })));
}

async function loginAsAdmin(context: BrowserContext) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) throw new Error("Dev Supabase QA credentials are required");
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email: QA_ADMIN_EMAIL });
  if (linkError || !link.properties?.hashed_token) throw new Error("QA admin magic link generation failed");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error || !data.session) throw new Error("QA admin magic link verification failed");
  await useSession(context, data.session);
}

async function apiJson(page: Page, path: string) {
  const response = await page.request.get(`${BASE}${path}`);
  if (!response.ok()) throw new Error(`${path} ${response.status()}: ${await response.text()}`);
  return response.json();
}

test.beforeEach(async ({ context }) => loginAsAdmin(context));
test.describe.configure({ timeout: 180_000 });

test("아이·부모 API는 동일 필터와 report_views 계약을 사용한다", async ({ page }) => {
  const childModes: Record<string, number> = {};
  for (const mode of ["exclude", "include", "only"]) {
    const payload = await apiJson(page, `/api/admin/analytics/children?period=7d&internalTest=${mode}&pageSize=100`);
    childModes[mode] = payload.total;
    expect(payload.filters).toMatchObject({ period: "7d", internalTest: mode, timezone: "Asia/Seoul" });
    expect(payload.meta.reportViewSource).toBe("report_views");
    expect(Array.isArray(payload.rows)).toBe(true);
  }
  expect(childModes.include).toBe(childModes.exclude + childModes.only);

  const parents = await apiJson(page, "/api/admin/analytics/parents?period=7d&internalTest=include&pageSize=100");
  expect(parents.meta).toMatchObject({ reportViewSource: "report_views", reportViewIdentity: "family" });
  expect(parents.meta.reportViewIdentityReason).toContain("viewer_id");
  if (parents.rows[0]) {
    expect(parents.rows[0]).toHaveProperty("children");
    expect(parents.rows[0]).toHaveProperty("reportViewRate");
  }
});

test("통합 화면에서 아이별·부모별 필터·상세·export가 동작한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/admin/analytics`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "통합 분석 대시보드" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "전체 개요" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "아이별 분석" }).click();
  await expect(page.getByRole("heading", { name: "아이별 분석" })).toBeVisible();
  await expect(page.getByText(/총 \d+명/)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("D7 필터").selectOption("pending");
  await expect(page.getByRole("link", { name: "CSV" })).toHaveAttribute("href", /tab=children/);
  await expect(page.getByRole("link", { name: "CSV" })).toHaveAttribute("href", /d7=pending/);

  await page.getByRole("tab", { name: "부모별 분석" }).click();
  await expect(page.getByRole("heading", { name: "부모별 분석" })).toBeVisible();
  await expect(page.getByText(/report_views에 viewer_id가 없어/)).toBeVisible({ timeout: 60_000 });
  const firstParentRow = page.locator("tbody tr[tabindex='0']").first();
  if (await firstParentRow.count()) {
    await firstParentRow.click();
    await expect(page.getByRole("dialog", { name: "부모 분석 상세" })).toBeVisible();
  }

  const csvHref = await page.getByRole("link", { name: "CSV" }).getAttribute("href");
  const csv = await page.request.get(new URL(csvHref as string, BASE).toString());
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const xlsxHref = await page.getByRole("link", { name: "XLSX" }).getAttribute("href");
  const xlsx = await page.request.get(new URL(xlsxHref as string, BASE).toString());
  expect(xlsx.ok()).toBeTruthy();
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
});
