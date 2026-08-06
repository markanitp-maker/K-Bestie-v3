import { test, expect } from "@playwright/test";
import fs from "fs";

// 071 Production 스모크: 그룹 렌더링·기존 페이지 이동이 정상인지만 가볍게 확인.
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test("QA-071-prod-smoke: 그룹 메뉴 렌더링 + 기존 페이지 정상 이동", async ({ page, context }) => {
  test.setTimeout(90_000);
  const cookieInfo = JSON.parse(fs.readFileSync("/tmp/admin-cookie-prod.json", "utf8"));
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

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  for (const label of ["대시보드", "사용자 관리", "고객 접수", "리포팅·분석", "이벤트·보상", "운영 도구"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible({ timeout: 10000 });
  }
  // 베타 신청 관리는 메뉴에서 제거되어야 한다.
  await expect(page.getByRole("button", { name: "베타 신청 관리" })).toHaveCount(0);

  // 기존 페이지 정상 이동 스모크 — 다른 그룹의 메뉴 클릭.
  await page.getByRole("button", { name: "리포팅·분석" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "사용자 리텐션" }).click();
  await page.waitForTimeout(1000);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.screenshot({ path: "/tmp/qa-071-prod-smoke.png", fullPage: false });
});
