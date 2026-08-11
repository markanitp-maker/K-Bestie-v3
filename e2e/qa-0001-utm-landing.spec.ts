import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3921";
const LANDING_PATH = "/?utm_source=a&utm_medium=b&utm_campaign=c&returnUrl=%2Fparent%2Freport";

function expectPreservedLoginUrl(rawUrl: string, entry: string) {
  const url = new URL(rawUrl);
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("entry")).toBe(entry);
  expect(url.searchParams.get("utm_source")).toBe("a");
  expect(url.searchParams.get("utm_medium")).toBe("b");
  expect(url.searchParams.get("utm_campaign")).toBe("c");
  expect(url.searchParams.get("returnUrl")).toBe("/parent/report");
}

test.describe("QA-0001 landing UTM / returnUrl preservation", () => {
  test("1. 비로그인 랜딩은 기존 getUser 401에도 공개 랜딩을 유지한다", async ({ page }) => {
    await page.goto(`${BASE}${LANDING_PATH}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${LANDING_PATH.replace(/[?]/g, "\\?")}$`));
  });

  test("2. 헤더 로그인·회원가입 링크가 UTM과 returnUrl을 보존한다", async ({ page }) => {
    await page.goto(`${BASE}${LANDING_PATH}`);
    const accountMenu = page.getByRole("navigation", { name: "계정 메뉴" });
    for (const [name, entry] of [["로그인", "header_login"], ["회원가입", "header_signup"]] as const) {
      const href = await accountMenu.getByRole("link", { name }).getAttribute("href");
      expect(href).not.toBeNull();
      expectPreservedLoginUrl(new URL(href!, BASE).href, entry);
    }
  });

  test("3. 새 탭으로 CTA를 열어도 내비게이션 완료 후 보존 URL로 이동한다", async ({ page, context }) => {
    await page.goto(`${BASE}${LANDING_PATH}`);
    const cta = page.getByRole("main").getByRole("link", { name: "베타 무료로 시작하기" }).first();
    const popupPromise = context.waitForEvent("page");
    await cta.click({ button: "middle" });
    const popup = await popupPromise;
    await popup.waitForURL((url) => url.href !== "about:blank", { timeout: 5_000 });
    expectPreservedLoginUrl(popup.url(), "landing_start");
    await popup.close();
  });

  test("4. 일반 클릭 후 로그인 URL이 안정화되고 뒤로 가기도 원래 랜딩 URL을 복원한다", async ({ page }) => {
    await page.goto(`${BASE}${LANDING_PATH}`);
    await page.getByRole("main").getByRole("link", { name: "베타 무료로 시작하기" }).first().click();
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 8_000 });
    await page.waitForLoadState("networkidle");
    expectPreservedLoginUrl(page.url(), "landing_start");
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 8_000 });
    expect(new URL(page.url()).search).toBe(new URL(`${BASE}${LANDING_PATH}`).search);
  });

  test("5. 모든 랜딩 시작 CTA가 같은 보존 URL을 제공한다", async ({ page }) => {
    await page.goto(`${BASE}${LANDING_PATH}`);
    const ctas = page.getByRole("link", { name: "베타 무료로 시작하기" });
    expect(await ctas.count()).toBeGreaterThan(0);
    for (let index = 0; index < await ctas.count(); index++) {
      const href = await ctas.nth(index).getAttribute("href");
      expect(href).not.toBeNull();
      expectPreservedLoginUrl(new URL(href!, BASE).href, "landing_start");
    }
  });

  test("6. 허용하지 않은 쿼리는 로그인 링크로 전달하지 않는다", async ({ page }) => {
    await page.goto(`${BASE}${LANDING_PATH}&debug=ignore-me`);
    const href = await page.getByRole("main").getByRole("link", { name: "베타 무료로 시작하기" }).first().getAttribute("href");
    expect(href).not.toBeNull();
    const url = new URL(href!, BASE);
    expect(url.searchParams.get("debug")).toBeNull();
    expectPreservedLoginUrl(url.href, "landing_start");
  });
});
