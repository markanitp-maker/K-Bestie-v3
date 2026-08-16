import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-support";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;

const MOBILE_VIEWPORT = { width: 390, height: 844 }; // iPhone 12

test.use({
  viewport: MOBILE_VIEWPORT,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1",
});

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
  await context.addInitScript(() => {
    localStorage.setItem("k_pwa_intro_seen", "1");
  });
}

async function getQAParentSession() {
  const email = "qatesti-dev@kbestie.local";
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("MAGIC_LINK_TOKEN_MISSING");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error || !data.session) throw error ?? new Error("MAGIC_LINK_SESSION_MISSING");
  return data.session;
}

async function getFirstRequestId(): Promise<string> {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: parent } = await service.from("parents").select("id").eq("email", "qatesti-dev@kbestie.local").single();
  if (!parent?.id) throw new Error("QA parent not found");

  const { data: requests } = await service
    .from("support_requests")
    .select("id")
    .eq("user_id", parent.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!requests || requests.length === 0) {
    throw new Error("No support request found for QA parent");
  }
  return requests[0].id;
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("Support Request Detail Close Button & Navigation E2E", () => {
  let knownRequestId = "";

  test.beforeEach(async ({ context }) => {
    const session = await getQAParentSession();
    await useSession(context, session);
    knownRequestId = await getFirstRequestId();
  });

  test("E2E-1 & E2E-2: 기본 흐름 (목록 -> 상세 -> 닫기 -> 목록) 및 닫기 후 뒤로가기", async ({ page }) => {
    // 0. 시작 화면을 /parent/home으로 진입하여 이전 히스토리 항목 생성
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: "domcontentloaded" });
    const initialUrl = page.url();

    // 1. /support/requests 진입
    await page.goto(`${DEV_BASE}/support/requests`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(`${DEV_BASE}/support/requests`);
    await page.waitForSelector("header h1:has-text('내 접수')", { timeout: 10_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e1-01-requests-list.png") });

    // 2. 항목 하나 클릭 -> 상세 진입
    const firstItem = page.locator("ul li a").first();
    await expect(firstItem).toBeVisible({ timeout: 10_000 });
    await firstItem.click();

    await page.waitForURL(new RegExp(`/support/requests/${knownRequestId}`), { timeout: 10_000 });
    const detailUrl = page.url();
    await page.waitForSelector("header h1:has-text('접수 상세')", { timeout: 10_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e1-02-request-detail.png") });

    // 3. 상단 닫기 버튼 클릭
    const closeBtn = page.getByRole("button", { name: "닫기" });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // 4. 목록 화면으로 왔는가? URL이 /support/requests인가?
    await page.waitForURL(`${DEV_BASE}/support/requests`, { timeout: 10_000 });
    expect(page.url()).toBe(`${DEV_BASE}/support/requests`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e1-03-requests-list-after-close.png") });
    console.log(`[E2E-1] List URL: ${DEV_BASE}/support/requests, Detail URL: ${detailUrl}, After Close URL: ${page.url()}`);

    // --- E2E-2. 닫기 후 브라우저 뒤로가기 ---
    // 5. 브라우저 뒤로가기 1회 -> 어디로 갔는가?
    await page.goBack();
    await page.waitForTimeout(1000);
    const back1Url = page.url();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e2-04-back-1.png") });
    console.log(`[E2E-2] Back 1 URL: ${back1Url}`);

    // 상세 화면(/support/requests/<id>)으로 되돌아가면 FAIL
    expect(back1Url).not.toContain(`/support/requests/${knownRequestId}`);

    // 6. 다시 뒤로가기 1회 -> 어디로 갔는가?
    await page.goBack();
    await page.waitForTimeout(1000);
    const back2Url = page.url();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e2-05-back-2.png") });
    console.log(`[E2E-2] Back 2 URL: ${back2Url}`);

    // 상세 화면으로 되돌아가면 FAIL
    expect(back2Url).not.toContain(`/support/requests/${knownRequestId}`);
  });

  test("E2E-3: 닫기를 안 쓰고 브라우저 뒤로가기만", async ({ page }) => {
    // 0. 이전 화면 히스토리 생성
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: "domcontentloaded" });

    // 1. /support/requests 진입 -> 항목 클릭 -> 상세
    await page.goto(`${DEV_BASE}/support/requests`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(`${DEV_BASE}/support/requests`);

    const firstItem = page.locator("ul li a").first();
    await expect(firstItem).toBeVisible({ timeout: 10_000 });
    await firstItem.click();

    await page.waitForURL(new RegExp(`/support/requests/${knownRequestId}`), { timeout: 10_000 });
    const detailUrl = page.url();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e3-01-detail.png") });

    // 2. 브라우저 뒤로가기 1회 -> 목록으로 가는가?
    await page.goBack();
    await page.waitForURL(`${DEV_BASE}/support/requests`, { timeout: 10_000 });
    const back1Url = page.url();
    expect(back1Url).toBe(`${DEV_BASE}/support/requests`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e3-02-back1-list.png") });

    // 3. 다시 뒤로가기 1회 -> 목록 이전 화면으로 나가는가? (상세로 되돌아가면 FAIL)
    await page.goBack();
    await page.waitForTimeout(1000);
    const back2Url = page.url();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e3-03-back2-previous.png") });
    console.log(`[E2E-3] Detail: ${detailUrl} -> Back 1: ${back1Url} -> Back 2: ${back2Url}`);

    expect(back2Url).not.toContain(`/support/requests/${knownRequestId}`);
    expect(back2Url).toContain(`/parent/home`);
  });

  test("E2E-4: 상세로 직접 진입한 경우", async ({ page }) => {
    // 상세 URL을 주소창에 직접 입력해서 진입
    await page.goto(`${DEV_BASE}/support/requests/${knownRequestId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header h1:has-text('접수 상세')", { timeout: 10_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e4-01-direct-detail.png") });

    // 닫기를 누르면 목록으로 가는가?
    const closeBtn = page.getByRole("button", { name: "닫기" });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await page.waitForURL(`${DEV_BASE}/support/requests`, { timeout: 10_000 });
    const afterCloseUrl = page.url();
    expect(afterCloseUrl).toBe(`${DEV_BASE}/support/requests`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e4-02-direct-after-close.png") });
    console.log(`[E2E-4] Direct Detail Close -> URL: ${afterCloseUrl}`);
  });

  test("E2E-5: 닫기 버튼 노출 조건 (로딩 및 에러 상태)", async ({ page }) => {
    // 1. 에러 상태: 존재하지 않는 id로 접속
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`${DEV_BASE}/support/requests/${nonExistentId}`, { waitUntil: "domcontentloaded" });
    
    // 에러 상태 메시지 확인
    await page.waitForSelector("text=접수 내용을 확인하지 못했어요", { timeout: 10_000 });
    const closeBtnOnError = page.getByRole("button", { name: "닫기" });
    await expect(closeBtnOnError).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e5-01-error-state.png") });

    // 에러 상태에서 닫기 클릭 시 목록으로 정상 이동하는가?
    await closeBtnOnError.click();
    await page.waitForURL(`${DEV_BASE}/support/requests`, { timeout: 10_000 });
    expect(page.url()).toBe(`${DEV_BASE}/support/requests`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e5-02-error-after-close.png") });

    // 2. 로딩 상태: API 응답을 지연시켜 로딩 중 닫기 버튼 노출 확인
    await page.route(`**/api/support/${knownRequestId}*`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.goto(`${DEV_BASE}/support/requests/${knownRequestId}`);
    // 로딩 문구와 닫기 버튼이 함께 보이는지 확인
    const loadingText = page.locator("text=접수 내용을 불러오고 있어요");
    const closeBtnOnLoading = page.getByRole("button", { name: "닫기" });
    
    await expect(loadingText).toBeVisible({ timeout: 2000 });
    await expect(closeBtnOnLoading).toBeVisible({ timeout: 2000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e5-03-loading-state.png") });

    // 로딩 완료 대기
    await page.waitForSelector("header h1:has-text('접수 상세')", { timeout: 10_000 });
  });

  test("E2E-6: 회귀 — 상세 화면 및 목록 화면 주요 표시 항목 검증", async ({ page }) => {
    // 1. 상세 화면 진입
    await page.goto(`${DEV_BASE}/support/requests/${knownRequestId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header h1:has-text('접수 상세')", { timeout: 10_000 });

    // 접수 번호 확인 (REQ-로 시작)
    const reqNumLocator = page.locator("span:has-text('REQ-')").first();
    await expect(reqNumLocator).toBeVisible();
    const reqNumText = await reqNumLocator.textContent();

    // 상태 뱃지 확인 (접수 완료 / 처리 중 / 답변 완료 등)
    const statusBadge = page.locator("span.rounded-full").first();
    await expect(statusBadge).toBeVisible();
    const statusText = await statusBadge.textContent();

    // 카테고리·제목 확인
    const subjectHeading = page.locator("section h2").first();
    await expect(subjectHeading).toBeVisible();
    const subjectText = await subjectHeading.textContent();

    // 등록 일시 확인 (YYYY년 MM월 DD일)
    const dateLocator = page.locator("section p:has-text('년')").first();
    await expect(dateLocator).toBeVisible();
    const dateText = await dateLocator.textContent();

    // 접수 본문 확인
    const bodyLocator = page.locator("section p.whitespace-pre-wrap").first();
    await expect(bodyLocator).toBeVisible();
    const bodyText = await bodyLocator.textContent();

    // 관리자 답변 영역 확인
    const adminResponseSection = page.locator("section.bg-orange-50");
    await expect(adminResponseSection).toBeVisible();
    const adminHeading = adminResponseSection.locator("h2");
    await expect(adminHeading).toHaveText("관리자 답변");

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e6-01-detail-regression.png") });
    console.log(`[E2E-6] Detail elements - ReqNum: ${reqNumText}, Status: ${statusText}, Subject: ${subjectText}, Date: ${dateText}, Body: ${bodyText?.substring(0, 30)}...`);

    // 2. 목록 화면 회귀 확인
    await page.goto(`${DEV_BASE}/support/requests`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header h1:has-text('내 접수')", { timeout: 10_000 });

    const listItems = page.locator("ul li a");
    const count = await listItems.count();
    expect(count).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e6-02-list-regression.png") });
    console.log(`[E2E-6] List items count: ${count}`);
  });

  test("E2E-7: 모바일 레이아웃 (390x844) 검증", async ({ page }) => {
    await page.goto(`${DEV_BASE}/support/requests/${knownRequestId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header h1:has-text('접수 상세')", { timeout: 10_000 });

    // 헤더 요소들 bbox 확인
    const titleEl = page.locator("header h1:has-text('접수 상세')");
    const closeBtn = page.getByRole("button", { name: "닫기" });

    await expect(titleEl).toBeVisible();
    await expect(closeBtn).toBeVisible();

    const titleBox = await titleEl.boundingBox();
    const closeBox = await closeBtn.boundingBox();

    expect(titleBox).not.toBeNull();
    expect(closeBox).not.toBeNull();

    if (titleBox && closeBox) {
      // 겹침(overlap) 검증: titleBox.x + titleBox.width < closeBox.x 여야 겹치지 않음
      const overlap = (titleBox.x + titleBox.width) > closeBox.x;
      expect(overlap).toBe(false);
      console.log(`[E2E-7] Title box: x=${titleBox.x}, w=${titleBox.width} | Close box: x=${closeBox.x}, w=${closeBox.width}, h=${closeBox.height}`);

      // 닫기 버튼 터치 영역 (대략 44x44 이상 권장)
      // 패딩 포함 높이/너비 확인
      expect(closeBox.height).toBeGreaterThanOrEqual(36); // 모바일 버튼
      expect(closeBox.width).toBeGreaterThanOrEqual(44);
    }

    // 가로 스크롤 여부 확인
    const scrollInfo = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      return { scrollWidth, clientWidth, hasHorizontalScroll: scrollWidth > clientWidth };
    });

    console.log(`[E2E-7] Scroll info: scrollWidth=${scrollInfo.scrollWidth}, clientWidth=${scrollInfo.clientWidth}`);
    expect(scrollInfo.hasHorizontalScroll).toBe(false);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "e2e7-01-mobile-layout.png") });
  });
});
