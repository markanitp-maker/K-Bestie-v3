import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const isProductionQa = process.env.QA_TARGET === "prod";
const BASE =
  process.env.PLAYWRIGHT_BASE_URL ||
  (isProductionQa
    ? "https://app.k-bestie.com"
    : "https://k-bestie-v3-dev.vercel.app");
const supabaseUrl = isProductionQa
  ? process.env.NEXT_PUBLIC_SUPABASE_URL
  : process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const anonKey = isProductionQa
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const serviceRoleKey = isProductionQa
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const preservedAdminEmail = "markanitp@gmail.com";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(
  context: BrowserContext,
  session: Session,
  url: string,
  databaseUrl: string
) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const cookieName = `sb-${projectRef(databaseUrl)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(
    chunks.map((chunk) => ({
      ...chunk,
      url,
      secure: true,
      sameSite: "Lax" as const,
    }))
  );
}

test("QA-053: 신규 가족 생성부터 관리자 승인과 아이 로그인까지 완료한다", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  test.skip(
    isProductionQa && process.env.QA_PRODUCTION_E2E !== "RUN",
    "Production E2E는 QA_PRODUCTION_E2E=RUN 확인이 필요합니다."
  );
  test.skip(
    !supabaseUrl || !anonKey || !serviceRoleKey,
    "Dev Supabase 검증용 환경변수가 필요합니다."
  );

  const service = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authClient = () =>
    createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const parentEmail = `qa053-parent-${suffix}@example.com`;
  const parentPassword = `Qa053Parent!${suffix}`;
  const familyName = `QA053 가족 ${suffix}`;
  const childFamilyName = "테스트";
  const childGivenName = "아이";
  const childUsername = `qa053child_${suffix}`.slice(0, 20);
  const childPassword = `Qa053Child!${suffix}`;

  let parentUserId: string | null = null;
  let familyId: string | null = null;
  let childAuthUserId: string | null = null;

  try {
    // 소셜 로그인 제공자 화면은 자동화할 수 없으므로, Dev Auth에 신규 보호자 가입 결과를 만든 뒤
    // 동일한 실제 세션으로 온보딩 이후의 모든 사용자 화면과 API를 검증한다.
    const { data: createdParent, error: createParentError } =
      await service.auth.admin.createUser({
        email: parentEmail,
        password: parentPassword,
        email_confirm: true,
        user_metadata: { name: "QA053 신규 보호자" },
      });
    expect(createParentError).toBeNull();
    parentUserId = createdParent.user?.id ?? null;
    expect(parentUserId).toBeTruthy();

    const { error: parentProfileError } = await service.from("parents").upsert({
      id: parentUserId,
      email: parentEmail,
      name: "QA053 신규 보호자",
    });
    expect(parentProfileError).toBeNull();

    const parentAuth = authClient();
    const { data: parentSignedIn, error: parentSignInError } =
      await parentAuth.auth.signInWithPassword({
        email: parentEmail,
        password: parentPassword,
      });
    expect(parentSignInError).toBeNull();
    expect(parentSignedIn.session).toBeTruthy();
    await useSession(context, parentSignedIn.session!, BASE, supabaseUrl!);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
    await expect(page.getByText("내친구 케이에 오신 것을 환영해요")).toBeVisible();
    // 주입한 Supabase 세션이 최초 요청에서 갱신되면 온보딩 페이지가 한 차례 다시
    // 로드될 수 있다. 실제 버튼 동작 검증 전에 그 갱신을 끝까지 기다린다.
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "나중에 할게요 →" }).click();
    await page.waitForURL(/\/parent\/home/, { timeout: 20_000 });

    await expect(
      page.getByRole("button", { name: "가족 만들기", exact: true })
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(
        "베타 신청 시 등록한 이메일로 가입하셨다면, 새 가족을 만들어 주세요",
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByText("이미 만들어진 가족이 있다면, 보호자로 참여합니다.", {
        exact: true,
      })
    ).toBeVisible();

    await page.getByRole("button", { name: "가족 만들기", exact: true }).click();
    await page.getByPlaceholder("예) 서준이네 가족").fill(familyName);
    await page.getByRole("button", { name: "가족 만들기 →" }).click();
    await page.waitForURL(/\/parent\/settings\?open=add-child/, { timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const { data } = await service
            .from("families")
            .select("id")
            .eq("name", familyName)
            .maybeSingle();
          familyId = data?.id ?? null;
          return familyId;
        },
        { timeout: 20_000 }
      )
      .toBeTruthy();

    await expect(page.getByPlaceholder("아이디 (로그인용)")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByPlaceholder("성").fill(childFamilyName);
    await page.getByPlaceholder("이름").fill(childGivenName);
    await page.getByPlaceholder("아이디 (로그인용)").fill(childUsername);
    await page.getByPlaceholder("비밀번호 (6자 이상)").fill(childPassword);
    await page.getByRole("button", { name: "여자아이", exact: true }).click();
    await page.getByRole("button", { name: "3학년", exact: true }).click();
    await page.getByRole("button", { name: "과학", exact: true }).click();
    await page
      .getByText(
        "위 내용을 확인했으며, 법정대리인으로서 개인정보 수집·이용에 동의합니다",
        { exact: true }
      )
      .click();
    await page.getByRole("button", { name: "승인 요청 보내기" }).click();

    await expect(page.getByText("관리자 승인 대기 중", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const { data: pendingRequest, error: pendingError } = await service
      .from("child_approval_requests")
      .select("id, status, created_child_id, username, gender")
      .eq("family_id", familyId!)
      .eq("username", childUsername)
      .single();
    expect(pendingError).toBeNull();
    expect(pendingRequest).toMatchObject({
      status: "pending",
      created_child_id: null,
      username: childUsername,
      gender: "female",
    });

    const { count: childCountBefore } = await service
      .from("child_profiles")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId!);
    expect(childCountBefore).toBe(0);

    // 기존 관리자 비밀번호를 변경하지 않고 일회용 링크로 관리자 세션을 만든다.
    const { data: adminLink, error: adminLinkError } =
      await service.auth.admin.generateLink({
        type: "magiclink",
        email: preservedAdminEmail,
      });
    expect(adminLinkError).toBeNull();
    expect(adminLink.properties?.hashed_token).toBeTruthy();

    const adminAuth = authClient();
    const { data: verifiedAdmin, error: verifyAdminError } =
      await adminAuth.auth.verifyOtp({
        token_hash: adminLink.properties.hashed_token,
        type: "magiclink",
      });
    expect(verifyAdminError).toBeNull();
    expect(verifiedAdmin.session).toBeTruthy();
    await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl!);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "리포팅 수동 실행", exact: true })
    ).toBeVisible();
    const reportingChildrenResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/reporting/children") &&
        response.request().method() === "GET"
    );
    await page
      .getByRole("button", { name: "리포팅 수동 실행", exact: true })
      .click();
    await expect(
      page.getByText("리포팅 수동 실행", { exact: true })
    ).toBeVisible();
    expect((await reportingChildrenResponse).status()).toBe(200);

    await page.getByRole("button", { name: "아이 승인 요청", exact: true }).click();
    await expect(
      page.getByText(
        `${childFamilyName}${childGivenName} (3학년) — 승인 대기`,
        { exact: true }
      )
    ).toBeVisible({ timeout: 20_000 });

    const approveButton = page.getByRole("button", { name: "승인", exact: true });
    await expect(approveButton).toBeDisabled();
    await page.getByText("베타 신청 확인", { exact: true }).click();
    await expect(approveButton).toBeDisabled();
    await page.getByText("설문 완료 확인", { exact: true }).click();
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    await expect(
      page.getByText("승인 처리되었습니다. 아이 계정이 생성됐어요.", { exact: true })
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const { data } = await service
            .from("child_approval_requests")
            .select("status, created_auth_user_id, created_child_id")
            .eq("id", pendingRequest.id)
            .single();
          childAuthUserId = data?.created_auth_user_id ?? null;
          return data?.status;
        },
        { timeout: 20_000 }
      )
      .toBe("approved");

    const { data: createdChild, error: createdChildError } = await service
      .from("child_profiles")
      .select("id, tier, gender, family_name, given_name")
      .eq("family_id", familyId!)
      .single();
    expect(createdChildError).toBeNull();
    expect(createdChild).toMatchObject({
      tier: 2,
      gender: "female",
      family_name: childFamilyName,
      given_name: childGivenName,
    });

    await context.clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(childUsername);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(childPassword);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/setup-password/, { timeout: 20_000 });
    await page.getByRole("button", { name: "기존 비밀번호 유지하기" }).click();
    await expect(page).toHaveURL(/\/child\/home/, { timeout: 30_000 });

    const missionPreflight = await page.evaluate(async (childId) => {
      const response = await fetch("/api/mission/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          roundType: "common",
          checkOnly: true,
        }),
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    }, createdChild!.id);
    expect(missionPreflight.status).toBe(200);
    expect(missionPreflight.body).toMatchObject({
      checkOnly: true,
      tier: 2,
    });
  } finally {
    // 테스트가 중간에 실패해도 이번 테스트가 만든 행과 계정만 정리한다.
    if (familyId) {
      const { data: requestRows } = await service
        .from("child_approval_requests")
        .select("created_auth_user_id")
        .eq("family_id", familyId);
      childAuthUserId =
        childAuthUserId ??
        requestRows?.find((row) => row.created_auth_user_id)?.created_auth_user_id ??
        null;
      await service.from("families").delete().eq("id", familyId);
    }
    if (childAuthUserId) {
      await service.auth.admin.deleteUser(childAuthUserId);
    }
    if (parentUserId) {
      await service.from("parents").delete().eq("id", parentUserId);
      await service.auth.admin.deleteUser(parentUserId);
    }
  }
});
