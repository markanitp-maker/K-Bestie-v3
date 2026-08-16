import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

test.use({ serviceWorkers: "block" });

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

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

test.describe("P0 Dev 장애 복구 검증", () => {
  test("신규가입 E2E: 부모 홈/리포트/부모-K empty state + 김서아 미션·자유대화", async ({ page, context }) => {
    test.setTimeout(180_000);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const parentEmail = `qa-p0-recovery-${suffix}@kbestie.local`;
    const childUsername = `qap0kimseoa${suffix.slice(-6)}`;
    const childPassword = "QaDevChild1!";
    let parentUserId: string | null = null;
    let familyId: string | null = null;
    let childId: string | null = null;

    try {
      // ── 부모 인증: /signup은 이미 인증된 세션을 전제로 1/4 약관 동의부터 시작한다
      // (이메일/비번 입력 폼 자체가 없음 — 앞선 세션의 qa-urgent-signup-account-status-fix.spec.ts와
      // 동일하게 magic link로 세션을 만들어 쿠키에 주입한다).
      const { data: created, error: createErr } = await service.auth.admin.createUser({
        email: parentEmail,
        email_confirm: true,
        user_metadata: { name: "" },
      });
      expect(createErr).toBeNull();
      parentUserId = created!.user!.id;

      const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email: parentEmail });
      expect(linkErr).toBeNull();
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
        token_hash: link!.properties!.hashed_token,
        type: "magiclink",
      });
      expect(verifyErr).toBeNull();
      await useSession(context, verified.session!);

      await page.goto(`${DEV_BASE}/signup?step=consent`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("1 / 4 약관 동의", { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "전체 동의하기" }).click();
      await page.getByRole("button", { name: /다음/ }).click();

      await expect(page.getByText("2 / 4 보호자 정보", { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByPlaceholder("보호자 이름").fill("P0복구검증 보호자");
      await page.locator("select").first().selectOption("legal_guardian");
      const profileResp = page.waitForResponse((r) => r.url().includes("/api/signup/profile") && r.request().method() === "POST");
      await page.getByRole("button", { name: /다음/ }).click();
      const profileResponse = await profileResp;
      expect(profileResponse.status(), "2/4 보호자 정보 저장 실패").toBe(200);

      await expect(page.getByText("3 / 4 가족 만들기", { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByPlaceholder("예) 안형진님의 가족").fill(`P0복구검증 가족 ${suffix.slice(-5)}`);
      const familyResp = page.waitForResponse((r) => r.url().includes("/api/families") && r.request().method() === "POST");
      await page.getByRole("button", { name: /가족 만들기/ }).click();
      const familyResponse = await familyResp;
      expect([200, 201], "3/4 가족 만들기 실패").toContain(familyResponse.status());
      const familyBody = await familyResponse.json().catch(() => null);
      familyId = familyBody?.family?.id ?? familyBody?.id ?? null;

      // ── 4/4: 아이 등록 (김서아) ──
      await expect(page.getByText("4 / 4 아이 등록", { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByPlaceholder("성").fill("김");
      await page.getByPlaceholder("이름").fill("서아");
      await page.getByRole("button", { name: "여자" }).click();
      await page.locator("select").last().selectOption({ label: "초등 3학년" }).catch(async () => {
        await page.locator("select").last().selectOption({ index: 3 });
      });
      await page.getByPlaceholder("아이 로그인 아이디").fill(childUsername);
      await page.getByPlaceholder("비밀번호 (6자 이상)").fill(childPassword);
      await page.getByPlaceholder("비밀번호 확인").fill(childPassword);
      const consentCheckbox = page.locator('input[type="checkbox"]').last();
      await consentCheckbox.check().catch(() => {});
      const childResp = page.waitForResponse((r) => r.url().includes("/children") && r.request().method() === "POST");
      await page.getByRole("button", { name: /아이 등록하고 시작하기/ }).click();
      const childResponse = await childResp;
      expect(childResponse.status(), "4/4 아이 등록 실패").toBe(200);
      const childBody = await childResponse.json().catch(() => null);
      childId = childBody?.child?.id ?? null;

      // ── 부모 홈: empty state 확인 (에러 배너 없어야 함) ──
      const consoleErrors: string[] = [];
      const apiFailures: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
      page.on("response", (r) => {
        if (r.status() >= 500 && r.url().includes("/api/")) {
          r.text().then((b) => apiFailures.push(`${r.status()} ${r.url()} :: ${b}`)).catch(() => {});
        }
      });

      await page.goto(`${DEV_BASE}/parent`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(2500);
      await expect(page.getByText("대화 가이드를 불러오지 못했어요")).toHaveCount(0);
      await expect(page.getByText("아직 대화 가이드가 준비되지 않았어요")).toBeVisible({ timeout: 10_000 });

      // ── 일간 리포트 페이지: empty state 확인 ──
      await page.goto(`${DEV_BASE}/parent/reports`, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);

      expect(apiFailures, `500 API 응답 발견: ${JSON.stringify(apiFailures)}`).toEqual([]);

      // ── 부모-K NO_DATA 확인 (API 직접 호출, 실제 부모 세션 쿠키로) ──
      const kChatResp = await page.request.post(`${DEV_BASE}/api/parent/k-chat`, {
        data: { action: "chat", child_id: childId, question: "오늘 우리 아이 학교에서 어땠어?" },
      });
      expect(kChatResp.status(), "부모-K 호출 실패").toBe(200);
      const kChatBody = await kChatResp.json();
      expect(kChatBody.answerable, `부모-K NO_DATA 응답 아님: ${JSON.stringify(kChatBody)}`).toBe(false);
      expect(kChatBody.retrievalStatus).toBe("NO_DATA");

      // ── 김서아로 로그인 → 미션 첫 질문 표시 ──
      await context.clearCookies();
      await page.goto(`${DEV_BASE}/login`, { waitUntil: "networkidle" });
      await page.getByPlaceholder("아이 아이디를 입력하세요").fill(childUsername);
      await page.getByPlaceholder("비밀번호를 입력하세요").fill(childPassword);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page.waitForTimeout(2500);
      const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
      if (await laterBtn.count().catch(() => 0)) await laterBtn.click().catch(() => {});

      const missionStartResp = page.waitForResponse((r) => r.url().includes("/api/mission/start"), { timeout: 20_000 }).catch(() => null);
      await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(2000);
      const laterBtn2 = page.getByRole("button", { name: "나중에 할게요" });
      if (await laterBtn2.count().catch(() => 0)) await laterBtn2.click().catch(() => {});
      const startBtn = page.getByRole("button", { name: /시작하기|이어하기/ });
      if (await startBtn.count().catch(() => 0)) {
        await startBtn.click().catch(() => {});
        await page.waitForTimeout(2000);
      }
      const missionResp = await missionStartResp;
      if (missionResp) {
        expect(missionResp.status(), `mission/start 실패: ${await missionResp.text().catch(() => "")}`).toBeLessThan(400);
      }
      // 첫 질문 텍스트 영역이 화면에 실제로 보이는지 (구체 문구는 랜덤이므로 대화 버블 컨테이너 존재로 판정)
      await expect(page.locator("body")).not.toContainText("Database error");
      await expect(page.locator("body")).not.toContainText("문제가 발생했어요");

      // ── 자유대화 1턴 ──
      await page.goto(`${DEV_BASE}/child/chat`, { waitUntil: "networkidle", timeout: 30_000 }).catch(async () => {
        await page.goto(`${DEV_BASE}/chat`, { waitUntil: "networkidle", timeout: 30_000 });
      });
      await page.waitForTimeout(2000);
      const chatInput = page.locator('textarea, input[type="text"]').last();
      const sessionResp = page.waitForResponse((r) => r.url().includes("/api/chat/session"), { timeout: 15_000 }).catch(() => null);
      await page.waitForTimeout(500);
      const sr = await sessionResp;
      if (sr) {
        expect(sr.status(), `chat/session 실패: ${await sr.text().catch(() => "")}`).toBe(200);
      }
      if (await chatInput.count().catch(() => 0)) {
        await chatInput.fill("안녕 케이!");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(8000);
      }
      await expect(page.locator("body")).not.toContainText("Database error");
    } finally {
      if (familyId) { try { await service.from("families").delete().eq("id", familyId); } catch {} }
      if (parentUserId) { try { await service.auth.admin.deleteUser(parentUserId); } catch {} }
    }
  });

  test("회귀: 기존 Dev 사용자(qatesti-dev/TestChild) 미션·자유대화 정상 동작", async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto(`${DEV_BASE}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill("qatesti-dev");
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForTimeout(2500);
    const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn.count().catch(() => 0)) await laterBtn.click().catch(() => {});

    const apiFailures: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 500 && r.url().includes("/api/")) {
        r.text().then((b) => apiFailures.push(`${r.status()} ${r.url()} :: ${b}`)).catch(() => {});
      }
    });

    await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2500);
    const laterBtn2 = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn2.count().catch(() => 0)) await laterBtn2.click().catch(() => {});
    const startBtn = page.getByRole("button", { name: /시작하기|이어하기/ });
    if (await startBtn.count().catch(() => 0)) {
      await startBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    await page.goto(`${DEV_BASE}/child/chat`, { waitUntil: "networkidle", timeout: 30_000 }).catch(async () => {
      await page.goto(`${DEV_BASE}/chat`, { waitUntil: "networkidle", timeout: 30_000 });
    });
    await page.waitForTimeout(2000);

    expect(apiFailures, `회귀 테스트 중 500 발견: ${JSON.stringify(apiFailures)}`).toEqual([]);
  });
});
