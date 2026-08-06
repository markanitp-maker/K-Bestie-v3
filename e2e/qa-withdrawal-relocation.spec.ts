import { test, expect } from "@playwright/test";
import fs from "fs";

// 회원 탈퇴 메뉴가 보호자 설정 내부로 이동했는지 UI 구조만 검증한다.
// 실제 탈퇴는 절대 실행하지 않는다(1단계 폼 노출까지만 확인).

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test("QA-withdrawal-relocation: 보호자 설정 안에서만 회원탈퇴 접근 가능", async ({ page, context }) => {
  test.setTimeout(90_000);

  // 부모 세션 쿠키 파일이 있으면 사용(관리자 쿠키 스크립트를 부모 계정으로 재사용).
  const cookiePath = "/tmp/parent-cookie.json";
  test.skip(!fs.existsSync(cookiePath), "부모 세션 쿠키가 없습니다.");
  const cookieInfo = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
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

  await page.goto(`${BASE}/parent/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // 최상위에는 "회원 탈퇴" 카드가 더 이상 없어야 한다(보호자 설정이 닫혀있는 기본 상태).
  await expect(page.getByText("계정과 모든 데이터를 삭제합니다")).toHaveCount(0);
  await expect(page.getByText("계정과 관련 데이터를 삭제합니다")).toHaveCount(0);

  // "보호자 설정"을 펼친다.
  await page.getByText("보호자 설정").first().click();
  await page.waitForTimeout(500);

  // 이제 내부에 "회원 탈퇴" 위험 작업 행이 보여야 한다.
  const withdrawalRow = page.getByText("계정과 관련 데이터를 삭제합니다");
  await expect(withdrawalRow).toBeVisible({ timeout: 10000 });

  // 클릭해서 1단계 폼(탈퇴 사유 textarea)까지만 확인, 실제 탈퇴 버튼은 누르지 않는다.
  await page.getByText("회원 탈퇴", { exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByPlaceholder("탈퇴 사유를 남겨주시면 서비스 개선에 큰 도움이 됩니다. (선택)")).toBeVisible({ timeout: 10000 });

  // 로그아웃 버튼은 여전히 하단에 그대로 있어야 한다.
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});
