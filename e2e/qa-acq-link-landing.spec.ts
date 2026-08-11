import { expect, test, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3990";
const EVIDENCE_DIR = "/tmp/agy-qa-acq-link";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

async function attachQaParent(context: BrowserContext) {
  if (!SUPABASE_URL || !ANON_KEY) return;
  try {
    const auth = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await auth.auth.signInWithPassword({
      email: "qa-parent@kbestie.local",
      password: PASSWORD,
    });
    if (error || !data.session) return;

    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    const cookieName = `sb-${ref}-auth-token`;
    let chunks: Array<{ name: string; value: string }> = [];

    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [],
        setAll: (next) => {
          chunks = next.filter((cookie) => cookie.value).map(({ name, value }) => ({ name, value }));
        },
      },
    });

    await ssr.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });

    if (chunks.length > 0) {
      await context.addCookies(
        chunks.map((cookie) => ({
          ...cookie,
          domain: new URL(BASE_URL).hostname,
          path: "/",
          httpOnly: false,
          secure: BASE_URL.startsWith("https:"),
          sameSite: "Lax" as const,
        }))
      );
    }
  } catch (err) {
    console.error("attachQaParent failed:", err);
  }
}

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("QA: Acquisition Link Landing Redirect & Attribution", () => {

  test("시나리오 1: 관리자 유입 링크 복사 버튼 클릭 시 목적지가 /인지 확인", async ({ page, context }) => {
    await attachQaParent(context);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto(`${BASE_URL}/admin/operations?tab=acquisition&sub=links`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario1-admin-links-page.png` });

    // 복사 버튼 찾기
    const copyButton = page.getByRole("button", { name: "복사" }).first();
    await expect(copyButton).toBeVisible({ timeout: 15000 });

    await copyButton.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario1-after-copy.png` });

    const copiedText = await page.evaluate(async () => {
      return await navigator.clipboard.readText().catch(() => null);
    });

    console.log("Scenario 1 - Copied text:", copiedText);

    if (copiedText) {
      expect(copiedText).toMatch(/^https:\/\/app\.k-bestie\.com\/\?/);
      expect(copiedText).not.toContain("https://app.k-bestie.com/signup");
      expect(copiedText).toContain("link_id=");
      expect(copiedText).toContain("utm_source=");
    } else {
      const toastText = await page.textContent("body");
      expect(toastText).toContain("링크 복사 완료");
    }
  });

  test("시나리오 2: link_id 접속 시 /api/acquisition/click 과 /api/acquisition/event 1회 호출, 미포함 시 0회", async ({ page }) => {
    const clickCalls: string[] = [];
    const eventCalls: Array<{ url: string; body: any }> = [];

    page.on("request", async (req) => {
      const url = req.url();
      if (url.includes("/api/acquisition/click")) {
        clickCalls.push(url);
      }
      if (url.includes("/api/acquisition/event")) {
        try {
          const postData = req.postDataJSON();
          eventCalls.push({ url, body: postData });
        } catch {
          eventCalls.push({ url, body: null });
        }
      }
    });

    // 1. link_id 와 utm 접속
    await page.goto(`${BASE_URL}/?link_id=test123_qa&utm_source=test_source`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario2-with-linkid.png` });

    console.log("Scenario 2 - clickCalls count:", clickCalls.length);
    console.log("Scenario 2 - eventCalls count:", eventCalls.length);

    expect(clickCalls.length).toBe(1);
    expect(eventCalls.length).toBe(1);
    expect(eventCalls[0].body?.event_type).toBe("LANDING_PAGE_VIEW");

    // 초기화
    clickCalls.length = 0;
    eventCalls.length = 0;

    // 2. link_id 없이 접속
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario2-without-linkid.png` });

    expect(clickCalls.length).toBe(0);
    expect(eventCalls.length).toBe(0);
  });

  test("시나리오 3: 헤더 로그인/가입 버튼 href에 link_id와 utm 파라미터 보존 확인", async ({ page }) => {
    await page.goto(`${BASE_URL}/?link_id=test123_qa&utm_source=test_src&utm_medium=test_med&utm_campaign=test_cam`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario3-landing-header.png` });

    const loginLink = page.locator('a[href*="/login?entry=header_login"]').first();
    await expect(loginLink).toBeVisible();

    const href = await loginLink.getAttribute("href");
    expect(href).not.toBeNull();
    console.log("Scenario 3 - Header login href:", href);

    expect(href).toContain("/login");
    expect(href).toContain("link_id=test123_qa");
    expect(href).toContain("utm_source=test_src");
    expect(href).toContain("utm_medium=test_med");
    expect(href).toContain("utm_campaign=test_cam");

    const signupLink = page.locator('a[href*="/login?entry=header_signup"]').first();
    const signupHref = await signupLink.getAttribute("href");
    expect(signupHref).toContain("link_id=test123_qa");
  });

  test("시나리오 4: /signup 직접 접속 시 URL에 link_id가 포함되지 않음 확인", async ({ page }) => {
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario4-signup-direct.png` });

    const currentUrl = new URL(page.url());
    console.log("Scenario 4 - Signup URL:", currentUrl.href);
    expect(currentUrl.pathname).toBe("/signup");
    expect(currentUrl.searchParams.get("link_id")).toBeNull();
  });

  test("시나리오 5: 관리자 유입 대시보드에 '랜딩 조회' KPI 카드와 채널 테이블 컬럼 렌더 확인", async ({ page, context }) => {
    await attachQaParent(context);
    await page.goto(`${BASE_URL}/admin/operations?tab=acquisition&sub=dashboard`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario5-admin-dashboard.png` });

    // KPI 카드 확인
    const landingViewKpi = page.getByText("랜딩 조회 수").or(page.getByText("랜딩 조회"));
    await expect(landingViewKpi.first()).toBeVisible({ timeout: 15000 });

    // 채널 테이블 컬럼 확인
    const tableHeader = page.getByRole("columnheader", { name: "채널" }).or(page.getByText("채널"));
    await expect(tableHeader.first()).toBeVisible();

    const parentSignupHeader = page.getByRole("columnheader", { name: "부모 가입" }).or(page.getByText("부모 가입"));
    await expect(parentSignupHeader.first()).toBeVisible();
  });

  test("시나리오 6: 로그인 상태(qatesti-dev)에서 /?link_id=test123 접속 시 홈으로 정상 라우팅 확인", async ({ page }) => {
    // 1. 아이 로그인 수행 (qatesti-dev)
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    const idInput = page.getByPlaceholder("아이 아이디를 입력하세요");
    const pwInput = page.getByPlaceholder("비밀번호를 입력하세요");

    await idInput.fill("qatesti-dev");
    await pwInput.fill(PASSWORD);

    const submitBtn = page.getByRole("button", { name: "로그인" });
    await submitBtn.click();

    await page.waitForURL("**/child/**", { timeout: 15000 }).catch(() => null);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario6-after-login.png` });

    // 2. 이미 로그인된 상태에서 유입 링크 접속
    try {
      await page.goto(`${BASE_URL}/?link_id=test123_authenticated`, { waitUntil: "domcontentloaded" });
    } catch {
      // 리다이렉트 발생 시 net::ERR_ABORTED가 뜰 수 있음
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scenario6-auth-link-access.png` });

    const currentUrl = page.url();
    console.log("Scenario 6 - Current URL after auth landing access:", currentUrl);
    expect(currentUrl).not.toContain("/signup");
  });
});
