import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;

test("QA-053: 가족 참여는 내 이메일 초대 대기 방식만 제공한다", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!supabaseUrl || !serviceRoleKey, "Dev Supabase 자격증명이 필요합니다.");

  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `qa053join_${suffix}`;
  const email = `${username}@kbestie.local`;
  const password = `Qa053!${suffix}`;
  let userId: string | null = null;

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "QA053 초대대기" },
    });
    expect(createError).toBeNull();
    userId = created.user?.id ?? null;
    expect(userId).toBeTruthy();

    const { error: parentError } = await admin.from("parents").upsert({
      id: userId,
      email,
      name: "QA053 초대대기",
    });
    expect(parentError).toBeNull();

    const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    expect(signedIn.session).toBeTruthy();

    const projectRef = new URL(supabaseUrl!).hostname.split(".")[0];
    const encodedSession = `base64-${Buffer.from(
      JSON.stringify(signedIn.session),
      "utf8"
    ).toString("base64url")}`;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: encodedSession,
        url: BASE,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });

    await expect(
      page.getByText("베타 신청 시 등록한 이메일로 가입하셨다면, 새 가족을 만들어 주세요", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByText("이미 만들어진 가족이 있다면, 보호자로 참여합니다.", { exact: true })
    ).toBeVisible();

    await page.getByRole("button", { name: "가족 구성원으로 참여하기", exact: true }).click();

    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(
      page.getByText("기존 가족 구성원에게 아래 이메일로 초대를 요청해 주세요.", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("아직 도착한 초대가 없어요", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "가족 대표가 보호자를 추가한 뒤, 새로 고침을 하면 초대장을 확인하실 수 있어요.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.getByPlaceholder("오너의 이메일 주소")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "신청하기 →", exact: true })).toHaveCount(0);
    await expect(page.getByText("해당 이메일로 만든 가족을 찾을 수 없어요", { exact: true })).toHaveCount(0);
  } finally {
    if (userId) {
      await admin.from("parents").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
