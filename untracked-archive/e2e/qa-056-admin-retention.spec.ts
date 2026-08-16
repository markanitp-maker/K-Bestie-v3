import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

// requests/056-admin-retention-internal-test-account-filter.md 게이트② 동적 QA.
// 관리자 로그인은 Kakao/Google OAuth뿐이라 UI 자동화가 불가능하므로, e2e/qa-053-full-onboarding-approval.spec.ts와
// 동일한 방식(service-role magiclink → verifyOtp → 세션 쿠키 직접 주입)으로 실제 관리자 세션을 만든다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const adminEmail = "markanitp@gmail.com";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(
  context: BrowserContext,
  session: Session,
  url: string,
  databaseUrl: string
) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const cookieName = `sb-${projectRef(databaseUrl)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(
    chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: "Lax" as const }))
  );
}

test("QA-056: 관리자 리텐션 페이지 내부 테스트 계정 포함/제외 토글", async ({ page, context }) => {
  test.setTimeout(120_000);
  test.skip(
    !supabaseUrl || !serviceRoleKey || !anonKey,
    "Dev Supabase 검증용 환경변수가 필요합니다."
  );

  const service = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authClient = () =>
    createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  const { data: adminLink, error: adminLinkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: adminEmail,
  });
  expect(adminLinkError).toBeNull();
  expect(adminLink.properties?.hashed_token).toBeTruthy();

  const adminAuth = authClient();
  const { data: verifiedAdmin, error: verifyAdminError } = await adminAuth.auth.verifyOtp({
    token_hash: adminLink.properties!.hashed_token,
    type: "magiclink",
  });
  expect(verifyAdminError).toBeNull();
  expect(verifiedAdmin.session).toBeTruthy();
  await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl!);

  // 1) 기본값 OFF: 테스트 가족(Mark An / 박서아 등, TestA/TestB)이 목록에 보이지 않아야 한다.
  const overviewOffPromise = page.waitForResponse(
    (r) => r.url().includes("/api/admin/retention/overview") && r.request().method() === "GET"
  );
  await page.goto(`${BASE}/admin/retention`, { waitUntil: "networkidle" });
  const checkbox = page.getByRole("checkbox", { name: /내부 테스트 계정 포함/ });
  await expect(checkbox).not.toBeChecked();

  const overviewOff = await overviewOffPromise;
  const offBody = await overviewOff.json();
  expect(offBody?.meta?.testAccountsExcluded).toBe(true);

  // 2) ON으로 토글하면 API가 재호출되고 테스트 계정이 포함된다.
  const overviewOnPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/retention/overview") &&
      r.url().includes("includeTestAccounts=true")
  );
  await checkbox.check();
  const overviewOn = await overviewOnPromise;
  expect(overviewOn.ok()).toBeTruthy();
  const onBody = await overviewOn.json();
  expect(onBody?.meta?.testAccountsExcluded).toBe(false);

  // 3) ON 상태에서 자녀 상세 드릴다운이 404가 아니라 정상 응답해야 한다(리뷰가 지적한 핵심 버그).
  const { data: testChild } = await service
    .from("child_profiles")
    .select("id")
    .eq("is_test_account", true)
    .limit(1)
    .maybeSingle();
  expect(testChild?.id, "Dev DB에 is_test_account=true인 아이가 있어야 재현 가능").toBeTruthy();

  const detailResOn = await page.request.get(
    `${BASE}/api/admin/retention/children/${testChild!.id}?includeTestAccounts=true`
  );
  expect(detailResOn.status(), "ON 상태에서는 테스트 계정 상세가 404가 아니어야 한다").not.toBe(404);

  // 4) OFF 상태에서는 같은 계정이 여전히 차단(404)돼야 한다.
  const detailResOff = await page.request.get(
    `${BASE}/api/admin/retention/children/${testChild!.id}?includeTestAccounts=false`
  );
  expect(detailResOff.status()).toBe(404);

  // 5) 다시 OFF로 되돌리면 목록에서 제외된다.
  const overviewOffAgainPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/retention/overview") &&
      r.url().includes("includeTestAccounts=false")
  );
  await checkbox.uncheck();
  const overviewOffAgain = await overviewOffAgainPromise;
  const offAgainBody = await overviewOffAgain.json();
  expect(offAgainBody?.meta?.testAccountsExcluded).toBe(true);
});
