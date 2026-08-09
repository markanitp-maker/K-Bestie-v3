import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: process.env.QA_ENV_FILE || ".env.local" });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3152";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial", timeout: 360_000 });

test("095: 신규 가입·Handoff·1회용 가족 초대를 실제 모바일 브라우저에서 완료한다", async ({ browserName, context, page }) => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY || !PASSWORD, "Dev QA 자격증명이 필요합니다.");
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  }
  const width = Number(process.env.QA_VIEWPORT_WIDTH || 390);
  const height = Number(process.env.QA_VIEWPORT_HEIGHT || 844);
  await page.setViewportSize({ width, height });

  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const ownerLoginId = `qa095owner${suffix}`;
  const joinerLoginId = `qa095join${suffix}`;
  const reuseLoginId = `qa095reuse${suffix}`;
  const ownerEmail = `${ownerLoginId}@kbestie.local`;
  const joinerEmail = `${joinerLoginId}@kbestie.local`;
  const reuseEmail = `${reuseLoginId}@kbestie.local`;
  const childLoginId = `q95c${suffix}`.slice(0, 20);
  const familyName = `QA095 가족 ${suffix.slice(-5)}`;
  const parentName = `QA095 보호자 ${suffix.slice(-4)}`;
  const childFamilyName = "김";
  const childGivenName = `온보딩${suffix.slice(-3)}`;
  const createdParentIds: string[] = [];
  let familyId: string | null = null;
  let childAuthUserId: string | null = null;

  async function createParent(email: string, name: string) {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
    const userId = data.user!.id;
    createdParentIds.push(userId);
    const probe = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: probeError } = await probe.auth.signInWithPassword({ email, password: PASSWORD });
    expect(probeError).toBeNull();
    await probe.auth.signOut();
    const { error: parentError } = await service.from("parents").upsert({
      id: userId,
      email,
      name: "",
      account_status: "AUTHENTICATED_INCOMPLETE",
    }, { onConflict: "id" });
    expect(parentError).toBeNull();
    return userId;
  }

  async function loginThroughBrowser(loginId: string) {
    await context.clearCookies();
    await page.goto(`${BASE}/login?role=child&login_id=${encodeURIComponent(loginId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("보호자 로그인", { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder("아이 아이디를 입력하세요")).toHaveValue(loginId);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(PASSWORD);
    const authResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/auth/v1/token") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const authResponse = await authResponsePromise;
    expect(authResponse.status()).toBe(200);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  }

  async function completeConsents() {
    await expect(page.getByText("1 / 4 약관 동의", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "전체 동의하기" }).click();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(7);
    await page.getByRole("button", { name: /다음/ }).click();
    await expect(page.getByText("2 / 4 보호자 정보", { exact: true })).toBeVisible();
  }

  async function dismissParentAnnouncement() {
    const button = page.getByRole("button", { name: "이벤트 확인" });
    const becameVisible = await button
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (becameVisible) {
      await button.click();
      await button.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
    }
  }

  try {
    const ownerId = await createParent(ownerEmail, parentName);
    const joinerId = await createParent(joinerEmail, "QA095 참여 보호자");
    await createParent(reuseEmail, "QA095 재사용 보호자");

    await loginThroughBrowser(ownerLoginId);
    await page.goto(`${BASE}/signup?step=consent`, { waitUntil: "domcontentloaded" });
    await completeConsents();

    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(page.getByText(/법정대리인이거나 적법한 동의 권한/)).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await page.getByPlaceholder("보호자 이름").fill(parentName);
    await page.locator("select").selectOption("legal_guardian");
    await page.getByRole("button", { name: "← 이전" }).click();
    await expect(page.getByText("1 / 4 약관 동의", { exact: true })).toBeVisible();
    expect(await page.locator('input[type="checkbox"]:checked').count()).toBe(7);
    await page.getByRole("button", { name: /다음/ }).click();
    await expect(page.getByPlaceholder("보호자 이름")).toHaveValue(parentName);
    await expect(page.locator("select")).toHaveValue("legal_guardian");
    await page.getByRole("button", { name: /다음/ }).click();

    await expect(page.getByText("3 / 4 가족 만들기", { exact: true })).toBeVisible();
    await expect(page.getByText("가족 구성원으로 참여하기", { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder(/이메일|초대 코드/)).toHaveCount(0);
    await page.getByPlaceholder("예) 안형진님의 가족").fill(familyName);
    await page.getByRole("button", { name: /가족 만들기/ }).click();
    await expect(page.getByText("4 / 4 아이 등록", { exact: true })).toBeVisible();

    const { data: ownerFamilies } = await service
      .from("families")
      .select("id")
      .eq("created_by", ownerId)
      .is("deleted_at", null);
    expect(ownerFamilies).toHaveLength(1);
    familyId = ownerFamilies![0].id;

    await expect(page.getByText(/공룡|우주|동물|관심사/)).toHaveCount(0);
    await page.getByPlaceholder("성").fill(childFamilyName);
    await page.getByPlaceholder("이름").fill(childGivenName);
    await page.getByRole("button", { name: "남자", exact: true }).click();
    await page.locator("select").selectOption("3학년");
    await page.getByPlaceholder("아이 로그인 아이디").fill(childLoginId);
    await page.getByPlaceholder("비밀번호 (6자 이상)").fill(PASSWORD);
    await page.getByPlaceholder("비밀번호 확인").fill(PASSWORD);
    await page.locator('input[type="checkbox"]').check();

    await page.getByRole("button", { name: "← 이전" }).click();
    await expect(page.getByPlaceholder("예) 안형진님의 가족")).toHaveValue(familyName);
    await page.getByRole("button", { name: "← 이전" }).click();
    await expect(page.getByPlaceholder("보호자 이름")).toHaveValue(parentName);
    await page.getByRole("button", { name: "← 이전" }).click();
    expect(await page.locator('input[type="checkbox"]:checked').count()).toBe(7);

    await page.getByRole("button", { name: /다음/ }).click();
    await page.getByRole("button", { name: /다음/ }).click();
    await page.getByRole("button", { name: /가족 만들기/ }).click();
    await expect(page.getByPlaceholder("아이 로그인 아이디")).toHaveValue(childLoginId);
    await expect(page.getByPlaceholder("비밀번호 (6자 이상)")).toHaveValue(PASSWORD);
    await page.getByRole("button", { name: /아이 등록하고 시작하기/ }).click();

    await expect(page.getByRole("heading", { name: "이제 아이가 케이를 시작할 차례예요." })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("준비가 끝났어요!", { exact: true })).toBeVisible();
    const qrValue = await page.locator("canvas[data-qr-value]").getAttribute("data-qr-value");
    expect(qrValue).toContain("/login?role=child");
    expect(qrValue).toContain(`login_id=${childLoginId}`);
    expect(qrValue).not.toMatch(/password|access_token|refresh_token|service_role|session/i);

    await page.getByRole("button", { name: "주소 복사" }).click();
    if (browserName === "chromium") {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(qrValue);
    }
    await page.getByRole("button", { name: "아이디 복사" }).click();
    if (browserName === "chromium") {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(childLoginId);
    }

    const { data: childRows, error: childRowsError } = await service
      .from("child_profiles")
      .select("id,member_id,interests")
      .eq("family_id", familyId);
    expect(childRowsError).toBeNull();
    expect(childRows).toHaveLength(1);
    expect(childRows![0].interests).toEqual([]);
    const { data: childMember } = await service
      .from("family_members")
      .select("user_id")
      .eq("id", childRows![0].member_id)
      .single();
    childAuthUserId = childMember?.user_id ?? null;

    await page.getByRole("button", { name: "보호자 홈으로 이동" }).click();
    await expect(page).toHaveURL(/\/parent\/home/, { timeout: 20_000 });
    await dismissParentAnnouncement();
    await expect(page.getByRole("button", { name: "아이 시작하기" })).toBeVisible();
    await page.getByRole("button", { name: "아이 시작하기" }).click();
    await expect(page.getByRole("dialog", { name: "아이 로그인 방법" })).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();

    await page.goto(`${BASE}/parent/settings`, { waitUntil: "domcontentloaded" });
    await page.getByText("아이 정보 관리", { exact: true }).click();
    await expect(page.getByRole("button", { name: "로그인 방법" }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "로그인 방법" }).first().click();
    await expect(page.getByRole("dialog", { name: "아이 로그인 방법" })).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();

    await page.getByText("보호자 설정", { exact: true }).click();
    await expect(page.getByRole("button", { name: "+ 가족 구성원 초대하기" })).toBeVisible({ timeout: 10_000 });

    const inviteResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/families/${familyId}/one-time-invites`)
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "+ 가족 구성원 초대하기" }).click();
    const inviteResponse = await inviteResponsePromise;
    expect(inviteResponse.status()).toBe(201);
    const inviteBody = await inviteResponse.json();
    const inviteUrl = inviteBody.invite.invite_url as string;
    expect(inviteUrl).toMatch(/\/family\/invite\/[A-Za-z0-9_-]{32,128}$/);
    expect(inviteBody.invite).not.toHaveProperty("invite_code");

    await loginThroughBrowser(joinerLoginId);
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kakao로 계속하기" })).toBeVisible();
    await page.getByRole("button", { name: "이미 로그인되어 있다면 참여 계속하기" }).click();
    await expect(page.getByText("1 / 4 약관 동의", { exact: true })).toBeVisible({ timeout: 20_000 });
    await completeConsents();
    await page.getByPlaceholder("보호자 이름").fill("QA095 참여 보호자");
    await page.locator("select").selectOption("father");
    await page.getByRole("button", { name: /다음/ }).click();
    await expect(page).toHaveURL(/\/parent\/home/, { timeout: 30_000 });
    await dismissParentAnnouncement();
    await expect(page.getByRole("button", { name: "아이 시작하기" })).toBeVisible();

    const { data: joinedMemberships } = await service
      .from("family_members")
      .select("family_id,role")
      .eq("user_id", joinerId)
      .is("deleted_at", null);
    expect(joinedMemberships).toEqual([{ family_id: familyId, role: "parent" }]);
    const { count: familyCount } = await service
      .from("families")
      .select("id", { count: "exact", head: true })
      .in("created_by", [ownerId, joinerId]);
    expect(familyCount).toBe(1);
    const { count: childCount } = await service
      .from("child_profiles")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId);
    expect(childCount).toBe(1);
    const { data: consumedInvite } = await service
      .from("family_join_requests")
      .select("status,consumed_by_user_id,consumed_at,requester_email")
      .eq("id", inviteBody.invite.id)
      .single();
    expect(consumedInvite).toMatchObject({
      status: "consumed",
      consumed_by_user_id: joinerId,
      requester_email: null,
    });
    expect(consumedInvite?.consumed_at).toBeTruthy();

    await loginThroughBrowser(reuseLoginId);
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "이미 사용된 초대 링크예요" })).toBeVisible();

    await loginThroughBrowser(joinerLoginId);
    await page.goto(`${BASE}/parent/home`, { waitUntil: "domcontentloaded" });
    await dismissParentAnnouncement();
    await page.getByRole("button", { name: "아이 시작하기" }).click();
    await page.getByRole("button", { name: "이 기기에서 아이 시작하기" }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?role=child&login_id=${childLoginId}`), { timeout: 20_000 });
    await expect(page.getByPlaceholder("아이 아이디를 입력하세요")).toHaveValue(childLoginId);
    await expect(page.getByText("보호자 로그인", { exact: true })).toHaveCount(0);
  } finally {
    if (familyId) {
      const { data: requests } = await service
        .from("child_approval_requests")
        .select("created_auth_user_id")
        .eq("family_id", familyId);
      childAuthUserId = childAuthUserId ?? requests?.find((row) => row.created_auth_user_id)?.created_auth_user_id ?? null;
      await service.from("families").delete().eq("id", familyId);
    }
    if (childAuthUserId) await service.auth.admin.deleteUser(childAuthUserId);
    for (const parentId of createdParentIds) {
      await service.from("parents").delete().eq("id", parentId);
      await service.auth.admin.deleteUser(parentId);
    }
  }
});
