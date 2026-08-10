import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/codex-qa-075-090";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim();
const KAKAO_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 120_000 });

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(context: BrowserContext, session: Session) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const name = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
  const chunks = value.length <= 3180
    ? [{ name, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${name}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(chunks.map((chunk) => ({ ...chunk, url: DEV_BASE, secure: true, sameSite: "Lax" as const })));
}

async function sessionForEmail(email: string) {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("MAGIC_LINK_TOKEN_MISSING");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error || !data.session) throw error ?? new Error("MAGIC_LINK_SESSION_MISSING");
  return data.session;
}

async function latestTestParentEmail() {
  // parents 테이블에는 is_test_account 컬럼이 없다 — Dev 지정 QA 가족(family_members.role=owner_parent)의
  // parents.email을 직접 조회한다. family_id는 "QA테스트 가족"(child_profiles.name='TestChild') 고정값.
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: child, error: childError } = await service
    .from("child_profiles")
    .select("family_id")
    .eq("name", "TestChild")
    .order("created_at", { ascending: false })
    .limit(1);
  if (childError) throw new Error(`TEST_FAMILY_QUERY_FAILED: ${childError.message}`);
  const familyId = child?.[0]?.family_id;
  if (!familyId) throw new Error("TEST_FAMILY_NOT_FOUND");

  const { data: members, error: memberError } = await service
    .from("family_members")
    .select("user_id, role")
    .eq("family_id", familyId)
    .in("role", ["owner_parent", "parent"]);
  if (memberError) throw new Error(`TEST_FAMILY_MEMBERS_QUERY_FAILED: ${memberError.message}`);
  const parentUserId = members?.[0]?.user_id;
  if (!parentUserId) throw new Error("TEST_PARENT_MEMBER_NOT_FOUND");

  const { data: parent, error: parentError } = await service
    .from("parents")
    .select("email")
    .eq("id", parentUserId)
    .maybeSingle();
  if (parentError) throw new Error(`TEST_PARENT_QUERY_FAILED: ${parentError.message}`);
  const email = parent?.email;
  if (!email) throw new Error("TEST_PARENT_NOT_FOUND");
  return email;
}

async function captureOnFailure(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}-failure.png`), fullPage: true }).catch(() => undefined);
}

// 부모 홈은 로그인 이벤트 안내 팝업(AppEventAnnouncementModal)이 데이터 로딩 직후 자동으로
// 뜰 수 있다("이벤트 확인" 버튼). PWA 배너와 무관한 별개 기능이므로 있으면 닫고 진행한다.
async function dismissEventModalIfPresent(page: Page) {
  const ack = page.getByRole("button", { name: "이벤트 확인", exact: true });
  if (await ack.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await ack.click();
    await expect(ack).not.toBeVisible({ timeout: 5_000 }).catch(() => undefined);
  }
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("075: QA 테스트 부모의 PWA 설치 배너가 닫기와 동일 세션 재접속을 처리한다", async ({ page, context }) => {
  try {
    await useSession(context, await sessionForEmail(await latestTestParentEmail()));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await dismissEventModalIfPresent(page);

    const banner = page.getByText("모바일 / 태블릿 / PC", { exact: true });
    const install = page.getByRole("button", { name: "앱 설치하기", exact: true });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(install).toBeVisible();
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(page.getByText(/오늘의 대화|대화 가이드|알림/).first()).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa075-banner-and-layout.png"), fullPage: true });

    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(banner).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("hide_pwa_banner"))).toBe("true");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa075-banner-dismissed.png"), fullPage: true });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(banner).not.toBeVisible();
  } catch (error) {
    await captureOnFailure(page, "qa075");
    throw error;
  }
});

test("075 선택: 카카오 인앱 UA에서 설치 클릭은 안내를 연다", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: KAKAO_USER_AGENT, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await useSession(context, await sessionForEmail(await latestTestParentEmail()));
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: "domcontentloaded" });
    await dismissEventModalIfPresent(page);
    await expect(page.getByRole("button", { name: "앱 설치하기", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "앱 설치하기", exact: true }).click();
    await expect(page.getByText(/Safari 또는 Chrome에서/).first()).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa075-kakao-notice.png"), fullPage: true });
  } catch (error) {
    await captureOnFailure(page, "qa075-kakao");
    throw error;
  } finally {
    await context.close();
  }
});

test("090: 관리자 테스트 아이의 다음 결과 예약은 지급 없이 표시되고 취소된다", async ({ page, context }) => {
  let saved = false;
  let row: ReturnType<Page["locator"]> | undefined;
  try {
    if (!ADMIN_EMAIL) throw new Error("ADMIN_EMAILS_NOT_SET");
    await useSession(context, await sessionForEmail(ADMIN_EMAIL));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${DEV_BASE}/admin/events-rewards?tab=attendance`, { waitUntil: "domcontentloaded" });
    const includeTests = page.getByRole("checkbox", { name: "내부 테스트 계정 포함" });
    await expect(includeTests).toBeVisible({ timeout: 20_000 });
    await includeTests.check();
    // Dev 현재 데이터에는 is_test_account/is_internal_test가 true인 아이가 없어 "[테스트]" 배지가
    // 뜨지 않는다 — 대신 지정 QA 아이 이름("TestChild")으로 행을 찾는다.
    row = page.locator("tbody tr", { has: page.getByText("TestChild", { exact: true }) }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const balance = row.locator("td").nth(4);
    const beforeBalance = (await balance.innerText()).trim();
    await row.locator("select").selectOption("KEY_1");
    await row.getByRole("button", { name: "다음 결과 예약", exact: true }).click();
    saved = true;

    const reserveMessage = page.getByText("예약되었습니다. 열쇠는 지금 지급되지 않으며 다음 룰렛에 1회 적용됩니다.", { exact: true });
    await expect(reserveMessage).toBeVisible({ timeout: 8_000 });
    expect((await balance.innerText()).trim()).toBe(beforeBalance);
    const pending = row.locator("td").nth(7);
    await expect(pending).toContainText("예약됨 · 황금열쇠 +1");
    await expect(pending).toContainText("다음 실제 룰렛 1회에 적용");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa090-reserved.png"), fullPage: true });
    await expect(reserveMessage).not.toBeVisible({ timeout: 5_500 });

    await row.getByRole("button", { name: "예약 취소", exact: true }).click();
    saved = false;
    const cancelMessage = page.getByText("예약을 취소했습니다.", { exact: true });
    await expect(cancelMessage).toBeVisible({ timeout: 8_000 });
    await expect(pending).toContainText("예약 없음");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "qa090-cancelled.png"), fullPage: true });
    await expect(cancelMessage).not.toBeVisible({ timeout: 5_500 });
  } catch (error) {
    await captureOnFailure(page, "qa090");
    throw error;
  } finally {
    if (saved && row) {
      await row.getByRole("button", { name: "예약 취소", exact: true }).click().catch(() => undefined);
    }
  }
});
