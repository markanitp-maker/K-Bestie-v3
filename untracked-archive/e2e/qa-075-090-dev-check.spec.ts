import { expect, test, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const PASSWORD = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

const KAKAO_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)";

const EVIDENCE_DIR = "/tmp/agy-qa-075-090-dev";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 120_000 });

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

async function loginAsQaParent(page: Page, targetPath: string = "/parent/home") {
  const loginUrl = `${BASE}/login?returnUrl=${encodeURIComponent(targetPath)}`;
  console.log("--> Navigating to login URL:", loginUrl);
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill("qa-parent");
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  
  await page.waitForTimeout(4000);
  console.log("Current URL after login:", page.url());

  // If still on /login or hub, navigate explicitly to targetPath
  if (!page.url().includes(targetPath)) {
    console.log("Navigating explicitly to targetPath:", targetPath);
    await page.goto(`${BASE}${targetPath}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    console.log("Final URL after explicit navigation:", page.url());
  }
}

test.describe("QA 대상 1 — 075 부모 홈 PWA 설치 배너 (/parent/home)", () => {
  test("시나리오 1 & 4: 일반 브라우저 접속 시 PWA 설치 배너 노출 및 레이아웃 가림/깨짐 확인", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsQaParent(page, "/parent/home");

    // PWA 배너 노출 확인 ("모바일 / 태블릿 / PC" + "앱 설치하기" 버튼)
    const bannerText = page.getByText("모바일 / 태블릿 / PC");
    const installButton = page.getByRole("button", { name: "앱 설치하기" });

    await expect(bannerText).toBeVisible({ timeout: 15000 });
    await expect(installButton).toBeVisible();

    // 기존 레이아웃 요소(하단 네비게이션 RealParentNav 등) 확인
    const parentNav = page.locator("nav").or(page.getByRole("navigation")).or(page.locator("a[href='/parent/home']"));
    await expect(parentNav.first()).toBeVisible();

    // 스크린샷 저장
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa075_01_pwa_banner_visible.png"),
      fullPage: false,
    });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa075_04_full_layout_check.png"),
      fullPage: true,
    });
  });

  test("시나리오 2: 배너 닫기(X) 클릭 시 배너 숨김 및 sessionStorage 재접속 숨김 확인", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsQaParent(page, "/parent/home");

    const bannerText = page.getByText("모바일 / 태블릿 / PC");
    await expect(bannerText).toBeVisible({ timeout: 15000 });

    // X 닫기 버튼 클릭
    const closeBtn = page.getByRole("button", { name: "닫기" });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // 배너가 화면에서 사라졌는지 확인
    await expect(bannerText).not.toBeVisible();

    // sessionStorage 값 확인
    const hidePwaValue = await page.evaluate(() => sessionStorage.getItem("hide_pwa_banner"));
    expect(hidePwaValue).toBe("true");

    // 스크린샷 저장
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa075_02_pwa_banner_dismissed.png"),
    });

    // 같은 세션 내 재접속(새로고침) 시 다시 나타나지 않는지 확인
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page.getByText("모바일 / 태블릿 / PC")).not.toBeVisible();
  });

  test("시나리오 3: 카카오톡 인앱 브라우저 UA override 후 '앱 설치하기' 클릭 시 KakaoInAppBrowserNotice 안내 화면 노출 확인", async ({ browser }) => {
    const kakaoContext = await browser.newContext({
      userAgent: KAKAO_USER_AGENT,
      viewport: { width: 390, height: 844 },
    });

    const page = await kakaoContext.newPage();
    await loginAsQaParent(page, "/parent/home");

    const installButton = page.getByRole("button", { name: "앱 설치하기" });
    await expect(installButton).toBeVisible({ timeout: 15000 });
    await installButton.click();
    await page.waitForTimeout(1000);

    // 카카오 인앱 안내 화면(KakaoInAppBrowserNotice) 렌더링 확인
    const kakaoNoticeText = page.getByText("Safari 또는 Chrome에서 계속해 주세요").or(page.getByText("카카오톡 브라우저 안내"));
    await expect(kakaoNoticeText.first()).toBeVisible({ timeout: 5000 });

    // 스크린샷 저장
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa075_03_kakao_inapp_notice.png"),
    });

    await kakaoContext.close();
  });
});

test.describe("QA 대상 2 — 090 관리자 출석 룰렛 화면 UX 개선 (/admin, 출석 룰렛 탭)", () => {
  test("시나리오 1~4: 다음 결과 예약, 녹색 성공 메시지 (3.5초), 보유 열쇠 유지, 안내 문구 표기, 예약 취소 검증", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsQaParent(page, "/admin/events-rewards?tab=attendance");

    console.log("Admin Attendance Roulette URL:", page.url());

    // 만약 /login으로 리다이렉트되었다면 URL 및 화면 확인
    expect(page.url()).not.toContain("/login");

    // 내부 테스트 계정 포함 체크박스 확인 및 선택
    const testAccountsCheckbox = page.getByRole("checkbox", { name: "내부 테스트 계정 포함" }).or(page.locator("input[type='checkbox']").first());
    if (await testAccountsCheckbox.isVisible() && !(await testAccountsCheckbox.isChecked())) {
      await testAccountsCheckbox.check();
      await page.waitForTimeout(2000);
    }

    // 아이 목록 행 찾기
    const tableRows = page.locator("tbody tr");
    await expect(tableRows.first()).toBeVisible({ timeout: 15000 });

    const targetRow = tableRows.first();

    // 시나리오 2: 저장 전 보유 열쇠 잔여 수치 기록 (5번째 td: index 4)
    const keyBalanceCell = targetRow.locator("td").nth(4);
    const initialKeyBalanceText = await keyBalanceCell.innerText();
    console.log("Initial Key Balance Text:", initialKeyBalanceText);

    // 시나리오 1: 결과 예약 설정 & 저장
    const selectBox = targetRow.locator("select").first();
    await selectBox.selectOption({ index: 0 }); // 첫 번째 옵션 선택

    const saveButton = targetRow.getByRole("button", { name: "다음 결과 예약" });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // 저장 직후 녹색 성공 메시지 표시 확인
    const successToast = page.getByText("예약되었습니다. 열쇠는 지금 지급되지 않으며 다음 룰렛에 1회 적용됩니다.");
    await expect(successToast.first()).toBeVisible({ timeout: 5000 });

    // 스크린샷 1: 녹색 성공 토스트
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa090_01_reservation_success_toast.png"),
    });

    // 시나리오 2 확인: 저장 직후 아이의 보유 열쇠 숫자가 즉시 변하지 않는지 검증
    const afterSaveKeyBalanceText = await keyBalanceCell.innerText();
    expect(afterSaveKeyBalanceText).toBe(initialKeyBalanceText);

    // 시나리오 3: "예약됨 · <결과>" 및 "다음 실제 룰렛 1회에 적용" 안내 문구가 표에 명확히 표시되는지 확인 (8번째 td: index 7)
    const reservationCell = targetRow.locator("td").nth(7);
    await expect(reservationCell).toContainText("예약됨 ·");
    await expect(reservationCell).toContainText("다음 실제 룰렛 1회에 적용");

    // 스크린샷 2: 표에 안내 문구 표기
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa090_02_pending_override_badge.png"),
    });

    // 약 3.5초 후 성공 메시지 사라짐 확인
    await page.waitForTimeout(4000);
    await expect(successToast).not.toBeVisible();

    // 시나리오 4: "예약 취소" 버튼으로 취소 시 성공 메시지 및 예약 상태("예약 없음") 갱신 확인
    const cancelButton = targetRow.getByRole("button", { name: "예약 취소" });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // 취소 직후 성공 메시지 확인
    const cancelSuccessToast = page.getByText("예약을 취소했습니다.");
    await expect(cancelSuccessToast.first()).toBeVisible({ timeout: 5000 });

    // 표 상태 "예약 없음" 갱신 확인
    await expect(reservationCell).toContainText("예약 없음");

    // 스크린샷 3: 예약 취소 완료
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa090_03_cancel_success.png"),
    });

    // 약 3.5초 후 취소 성공 메시지 사라짐 확인
    await page.waitForTimeout(4000);
    await expect(cancelSuccessToast).not.toBeVisible();
  });
});
