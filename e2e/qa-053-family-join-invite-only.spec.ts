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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(username);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForTimeout(1_000);
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "가족 구성원으로 참여하기", exact: true }).click();

    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(
      page.getByText("기존 가족 구성원에게 아래 이메일로 초대를 요청해 주세요.", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("아직 도착한 초대가 없어요", { exact: true })).toBeVisible();
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
