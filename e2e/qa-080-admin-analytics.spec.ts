import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3150";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;
let cookieHeader = "";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 180_000 });

async function attachQaParent(context: BrowserContext) {
  const auth = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email: "qa-parent@kbestie.local", password: PASSWORD });
  if (error || !data.session) throw error ?? new Error("QA_SESSION_MISSING");
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  let chunks: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => [], setAll: (next) => { chunks = next.filter((cookie) => cookie.value).map(({ name, value }) => ({ name, value })); } } });
  const { error: sessionError } = await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  if (sessionError || chunks.length === 0) throw sessionError ?? new Error("QA_AUTH_COOKIE_CREATE_FAILED");
  const verifier = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: () => chunks, setAll: () => undefined },
  });
  const { data: verified, error: verifyError } = await verifier.auth.getUser();
  if (verifyError || verified.user?.email !== "qa-parent@kbestie.local") {
    throw verifyError ?? new Error("QA_AUTH_COOKIE_VERIFY_FAILED");
  }
  await context.addCookies(chunks.map((cookie) => ({ ...cookie, domain: new URL(BASE).hostname, path: "/", httpOnly: false, secure: BASE.startsWith("https:"), sameSite: "Lax" as const })));
  const installed = await context.cookies(BASE);
  if (installed.filter((cookie) => cookie.name.startsWith(cookieName)).length !== chunks.length) {
    throw new Error("QA_AUTH_COOKIE_INSTALL_FAILED");
  }
  cookieHeader = chunks.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function captureCrashes(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

test.beforeEach(async ({ context }) => attachQaParent(context));

test("통합 API는 공통 필터와 테스트 3모드를 동일 응답에 적용한다", async () => {
  const payloads: Record<string, any> = {};
  for (const mode of ["exclude", "include", "only"]) {
    const response = await fetch(`${BASE}/api/admin/analytics?period=7d&scope=all&internalTest=${mode}`, { headers: { cookie: cookieHeader } });
    if (!response.ok) throw new Error(`analytics ${response.status}: ${await response.text()}`);
    payloads[mode] = await response.json();
    expect(payloads[mode].filters).toMatchObject({ period: "7d", scope: "all", internalTest: mode, timezone: "Asia/Seoul" });
    expect(Array.isArray(payloads[mode].retention?.overview?.dailyTrend)).toBe(true);
    if (!Array.isArray(payloads[mode].reporting?.quality)) {
      throw new Error(`reporting ${mode}: ${payloads[mode].errors?.reporting ?? "missing quality payload"}`);
    }
  }
  const included = payloads.include.retention.overview.kpis.activeChildren.value;
  const excluded = payloads.exclude.retention.overview.kpis.activeChildren.value;
  const only = payloads.only.retention.overview.kpis.activeChildren.value;
  expect(included).toBe(excluded + only);
});

test("기본 화면·scope·custom·품질 필터·상세 Drawer가 client exception 없이 동작한다", async ({ page }) => {
  const crashes = captureCrashes(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin/analytics`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "통합 분석 대시보드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "최근 7일" })).toBeVisible();
  await expect(page.getByText("전체 활성 사용자", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "행동 퍼널 / 리포트 생성 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "가입 코호트 리텐션" })).toBeVisible();

  await page.getByRole("button", { name: "부모", exact: true }).first().click();
  await expect(page.getByText("활성 부모", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "아이", exact: true }).first().click();
  await expect(page.getByText("활성 아이", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "직접 기간" }).click();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("시작일").fill(today);
  await page.getByLabel("종료일").fill(today);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page).toHaveURL(/period=custom/);
  await page.getByLabel("리포팅 상태").selectOption("pending");
  await expect(page).toHaveURL(/reportStatus=pending/, { timeout: 60_000 });

  const firstDetail = page.locator('tbody tr[tabindex="0"]').last();
  if (await firstDetail.count()) {
    await firstDetail.click();
    await expect(page.getByRole("dialog", { name: "분석 상세" })).toBeVisible();
    await expect(page.getByRole("link", { name: "사용자 관리에서 보기" })).toBeVisible();
  }
  expect(crashes.filter((message) => /client-side exception|undefined.*map/i.test(message))).toEqual([]);
});

test("CSV·XLSX는 화면과 같은 필터를 사용한다", async () => {
  const query = "period=7d&scope=child&internalTest=exclude";
  const csv = await fetch(`${BASE}/api/admin/analytics/export?${query}&format=csv`, { headers: { cookie: cookieHeader } });
  if (!csv.ok) throw new Error(`csv ${csv.status}: ${await csv.text()}`);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  const xlsx = await fetch(`${BASE}/api/admin/analytics/export?${query}&format=xlsx`, { headers: { cookie: cookieHeader } });
  expect(xlsx.ok).toBeTruthy();
  expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
});

test("기존 리텐션 URL은 통합 대시보드 리텐션 섹션으로 호환 이동한다", async ({ page }) => {
  await page.goto(`${BASE}/admin/retention`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/admin\/analytics\?section=retention/);
  await expect(page.getByRole("heading", { name: "통합 분석 대시보드" })).toBeVisible();
});
