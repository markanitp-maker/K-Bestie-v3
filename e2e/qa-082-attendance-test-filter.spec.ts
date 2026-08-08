import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3912";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 180_000 });

async function attachQaParent(context: BrowserContext) {
  const auth = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email: "qa-parent@kbestie.local", password: PASSWORD });
  if (error || !data.session) throw error ?? new Error("QA_SESSION_MISSING");
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
  await context.addCookies(chunks.map((cookie) => ({
    ...cookie,
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: false,
    secure: BASE.startsWith("https:"),
    sameSite: "Lax" as const,
  })));
  const installed = await context.cookies(BASE);
  if (installed.filter((cookie) => cookie.name.startsWith("sb-")).length < chunks.length) {
    throw new Error("QA_AUTH_COOKIE_INSTALL_FAILED");
  }
}

async function protectedState() {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const [ledger, spins, overrides] = await Promise.all([
    service.from("gold_key_ledger").select("*", { count: "exact", head: true }),
    service.from("attendance_roulette_spins").select("*", { count: "exact", head: true }),
    service.from("attendance_roulette_overrides").select("id,child_id,result_code,status,consumed_spin_id,updated_at").order("id"),
  ]);
  if (ledger.error || spins.error || overrides.error) throw ledger.error ?? spins.error ?? overrides.error;
  return { ledgerCount: ledger.count, spinCount: spins.count, overrides: overrides.data };
}

test.beforeEach(async ({ context }) => attachQaParent(context));

test("기본 제외·포함·검색·badge·동일 KPI 모수와 원장 무변경을 검증한다", async ({ page }) => {
  const before = await protectedState();
  try {
    const excludedResponse = await page.context().request.get(`${BASE}/api/admin/events/attendance-roulette`);
    const includedResponse = await page.context().request.get(`${BASE}/api/admin/events/attendance-roulette?includeTestAccounts=true`);
    if (!excludedResponse.ok()) throw new Error(`exclude ${excludedResponse.status()}: ${await excludedResponse.text()}`);
    if (!includedResponse.ok()) throw new Error(`include ${includedResponse.status()}: ${await includedResponse.text()}`);
    const excluded = await excludedResponse.json();
    const included = await includedResponse.json();

    expect(excluded.includeTestAccounts).toBe(false);
    expect(included.includeTestAccounts).toBe(true);
    expect(excluded.children.every((child: { isInternalTest: boolean }) => !child.isInternalTest)).toBe(true);
    const testChildren = included.children.filter((child: { isInternalTest: boolean }) => child.isInternalTest);
    expect(testChildren.length).toBeGreaterThan(0);
    expect(included.summary.targetChildren).toBe(included.children.length);
    expect(excluded.summary.targetChildren).toBe(excluded.children.length);
    for (const payload of [excluded, included]) {
      expect(payload.summary.participatedChildren + payload.summary.notParticipatedChildren).toBe(payload.summary.targetChildren);
    }
    expect(included.summary.targetChildren).toBeGreaterThan(excluded.summary.targetChildren);

    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "이벤트·보상", exact: true }).click();
    await page.getByRole("button", { name: "출석 룰렛", exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: "내부 테스트 계정 포함" });
    await expect(checkbox).not.toBeChecked();
    const search = page.getByPlaceholder("이름 또는 로그인 ID 검색");
    await search.fill(testChildren[0].name);
    await expect(page.getByText("조건에 맞는 아이가 없습니다.")).toBeVisible();

    await checkbox.check();
    await expect(checkbox).toBeChecked();
    const testRow = page.locator("tbody tr").filter({ hasText: testChildren[0].name }).filter({ hasText: "[테스트]" }).first();
    await expect(testRow).toBeVisible({ timeout: 30_000 });
    await expect(testRow.getByText("[테스트]", { exact: true })).toBeVisible();
  } finally {
    expect(await protectedState()).toEqual(before);
  }
});
