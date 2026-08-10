import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;

test.use({ serviceWorkers: "block" });

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

test("긴급: 신규 관리자 계정 1/4→2/4→3/4 signup Database error 회귀 확인", async ({ page, context }) => {
  test.setTimeout(120_000);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `qa-urgent-signup-${suffix}@kbestie.local`;

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: "" },
  });
  expect(createErr).toBeNull();
  const userId = created!.user!.id;

  try {
    // handle_new_user() 트리거가 parents row를 AUTHENTICATED_INCOMPLETE로 생성했는지 그대로 확인 (덮어쓰지 않음)
    const { data: parentRow, error: parentRowErr } = await service
      .from("parents")
      .select("account_status")
      .eq("id", userId)
      .maybeSingle();
    expect(parentRowErr).toBeNull();
    expect(parentRow?.account_status).toBe("AUTHENTICATED_INCOMPLETE");

    const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email });
    expect(linkErr).toBeNull();
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: link!.properties!.hashed_token,
      type: "magiclink",
    });
    expect(verifyErr).toBeNull();
    await useSession(context, verified.session!);

    // 1/4 약관 동의
    await page.goto(`${DEV_BASE}/signup?step=consent`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("1 / 4 약관 동의", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "전체 동의하기" }).click();
    await page.getByRole("button", { name: /다음/ }).click();

    // 2/4 보호자 정보 — 여기가 원래 Database error가 났던 단계
    await expect(page.getByText("2 / 4 보호자 정보", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("보호자 이름").fill("QA긴급확인 보호자");
    await page.locator("select").selectOption("legal_guardian");
    const profileResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/signup/profile") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /다음/ }).click();
    const profileResponse = await profileResponsePromise;
    expect(profileResponse.status(), "2/4 보호자 정보 저장 API가 실패(Database error)했습니다").toBe(200);

    // 3/4 가족 만들기
    await expect(page.getByText("3 / 4 가족 만들기", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("예) 안형진님의 가족").fill(`QA긴급확인 가족 ${suffix.slice(-5)}`);
    const familyResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/families") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /가족 만들기/ }).click();
    const familyResponse = await familyResponsePromise;
    expect([200, 201], "3/4 가족 만들기 API가 실패했습니다").toContain(familyResponse.status());
    await expect(page.getByText("4 / 4 아이 등록", { exact: true })).toBeVisible({ timeout: 10_000 });

    const { data: parentAfter } = await service.from("parents").select("account_status, name, relationship_to_child").eq("id", userId).maybeSingle();
    expect(parentAfter?.account_status).toBe("ONBOARDING");
    expect(parentAfter?.name).toBe("QA긴급확인 보호자");
  } finally {
    // 정리: 이 테스트가 만든 계정만 삭제 (실제 계정 무관)
    const { data: fam } = await service.from("families").select("id").eq("created_by", userId);
    for (const f of fam ?? []) {
      await service.from("families").delete().eq("id", f.id);
    }
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
  }
});
