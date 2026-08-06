import { test, expect } from "@playwright/test";
import fs from "fs";

// 071: 관리자 사이드바 그룹 아코디언 개편 검증 — 그룹 펼침/접힘, 하위메뉴 활성 반영,
// 새로고침 시 현재 그룹 자동 펼침, 모바일 드로어 동작, 가로 스크롤 없음을 확인한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  const cookieInfo = JSON.parse(fs.readFileSync("/tmp/admin-cookie.json", "utf8"));
  const domain = new URL(BASE).hostname;
  await context.addCookies(
    cookieInfo.cookies.map((c: { name: string; value: string }) => ({
      name: c.name,
      value: c.value,
      domain,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax" as const,
    }))
  );
});

test("QA-071-desktop: 그룹 펼침/접힘, 하위메뉴 선택, 새로고침 자동펼침", async ({ page }) => {
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // 기본(overview)이 활성 상태이므로 "대시보드" 그룹은 자동 펼침 상태여야 한다.
  const overviewBtn = page.getByRole("button", { name: "전체 현황" });
  await expect(overviewBtn).toBeVisible({ timeout: 15000 });

  // 다른 그룹("고객 접수")은 접혀 있어야 한다 — 하위 메뉴가 안 보여야 함.
  const inquiriesBtn = page.getByRole("button", { name: "문의 접수" });
  await expect(inquiriesBtn).not.toBeVisible();

  // "고객 접수" 그룹 토글을 펼친다.
  const supportGroupBtn = page.getByRole("button", { name: "고객 접수" });
  await expect(supportGroupBtn).toBeVisible();
  await expect(supportGroupBtn).toHaveAttribute("aria-expanded", "false");
  await supportGroupBtn.click();
  await page.waitForTimeout(300);
  await expect(supportGroupBtn).toHaveAttribute("aria-expanded", "true");
  await expect(inquiriesBtn).toBeVisible();

  // 대시보드 그룹은 여전히 펼쳐져 있어야 한다(여러 그룹 동시 펼침).
  await expect(overviewBtn).toBeVisible();

  // 하위 메뉴("건의 접수") 클릭 → 활성 메뉴 전환 확인.
  const suggestionsBtn = page.getByRole("button", { name: "건의 접수" });
  await suggestionsBtn.click();
  await page.waitForTimeout(500);

  const activeColor = await suggestionsBtn.evaluate((el) => getComputedStyle(el).color);
  console.log("suggestions active color:", activeColor);

  // 새로고침 후 "고객 접수" 그룹이 활성 메뉴를 포함하므로 자동 펼침 유지되어야 한다.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // 새로고침으로 activeMenuId는 overview로 리셋되지만(SPA state), 사용자가 방금
  // sessionStorage에 "고객 접수"를 펼쳐놨으므로 여전히 펼쳐진 상태여야 한다.
  await expect(page.getByRole("button", { name: "건의 접수" })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, "가로스크롤 발생").toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.screenshot({ path: "/tmp/qa-071-desktop.png", fullPage: false });
});

test("QA-071-mobile: 드로어 그룹 펼침/접힘, 하위메뉴 선택시 드로어 닫힘", async ({ page }) => {
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const menuToggle = page.getByRole("button", { name: "메뉴 열기" });
  await menuToggle.click();
  await page.waitForTimeout(300);

  // 데스크톱 사이드바는 CSS(max-lg:hidden)로만 숨겨질 뿐 DOM에는 남아있으므로,
  // 동일 텍스트 버튼이 2개 매칭된다 — 뒤에 렌더링되는(DOM 순서상 나중) 모바일
  // 드로어 쪽을 특정한다.
  const eventsGroupBtn = page.getByRole("button", { name: "이벤트·보상" }).last();
  await expect(eventsGroupBtn).toBeVisible({ timeout: 10000 });
  await eventsGroupBtn.click();
  await page.waitForTimeout(300);

  const eventsOverviewBtn = page.getByRole("button", { name: "이벤트 현황" }).last();
  await expect(eventsOverviewBtn).toBeVisible();

  // 그룹 토글은 드로어를 닫지 않아야 한다 — 하위 메뉴 버튼이 여전히 DOM에 남아있어야 함
  // (드로어는 isMobileMenuOpen && (...) 조건부 렌더링이라 닫히면 서브트리째 사라진다).
  await expect(eventsOverviewBtn).toBeVisible();

  // 하위 메뉴 클릭 시 드로어가 닫혀야 한다. 클릭 직후 activeMenuId가 바뀌면서 데스크톱
  // 사이드바(CSS로만 숨겨져 DOM엔 항상 존재) 쪽 "이벤트·보상" 그룹도 자동펼침되어
  // "이벤트 현황" 매칭이 1개는 남을 수 있으므로(정상 동작), 드로어 오버레이(다크 배경
  // + fixed inset-0 컨테이너) 자체가 사라졌는지로 판정한다.
  await eventsOverviewBtn.click();
  await page.waitForTimeout(500);
  const drawerOverlay = page.locator('div[style*="rgba(0, 0, 0, 0.5)"], div[style*="rgba(0,0,0,0.5)"]');
  await expect(drawerOverlay).toHaveCount(0);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, "가로스크롤 발생(모바일)").toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.screenshot({ path: "/tmp/qa-071-mobile.png", fullPage: false });
});
