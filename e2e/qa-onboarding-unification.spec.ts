/**
 * e2e/qa-onboarding-unification.spec.ts
 *
 * 온보딩 단일 경로 & 가족 만들기 반복 방지 5대 시나리오 E2E 실증:
 * ① 신규 가입 가족 생성 후 4/4 아이 등록 이동
 * ② 가족이 이미 있는 ONBOARDING 사용자는 아이 등록부터 재개 (/signup?step=child)
 * ③ 아이 등록 완료 후 보호자 홈 진입 (/parent/home)
 * ④ 재접속 시 가족 만들기 화면 재노출 없음
 * ⑤ 탈퇴 계정은 복구 화면 우선 표시 (/account/withdrawn)
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) { return new URL(url).hostname.split(".")[0]; }

async function realSignIn(email: string, pass: string) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "apikey": anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: pass }),
  });
  if (!res.ok) throw new Error(`Supabase login failed: ${res.status}`);
  return res.json();
}

function makeCookie(session: any) {
  const ref = projectRef(supabaseUrl);
  const rawValue = JSON.stringify([session.access_token, session.refresh_token]);
  const encodedValue = `base64-${Buffer.from(rawValue, "utf8").toString("base64")}`;
  return { name: `sb-${ref}-auth-token`, value: encodedValue };
}

test.describe("Production 온보딩 단일화 & 가족만들기 중복방지 5대 검증", () => {
  test.setTimeout(90000);
  let svc: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  // ① & ② & ③: 온보딩 순차 진행 (가족생성 -> 아이등록 -> 보호자홈 진입) 및 멱등 재개
  test("①~③ 신규가입 → 가족생성 → 아이등록 → 보호자홈 진입 및 재개 검증", async ({ page, context }) => {
    const ts = Date.now();
    const email = `qa-flow-${ts}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      // 1. 약관 및 프로필 동의 상태 시드
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "온보딩보호자",
        phone_number: "010-8888-8888",
        relationship_to_child: "mother",
        account_status: "ONBOARDING",
      });

      await svc.from("signup_consents").insert({
        user_id: userId,
        consent_type: "service_terms",
        agreed: true,
      });

      const session = await realSignIn(email, password);
      const cookie = makeCookie(session);
      await context.addCookies([{ ...cookie, url: BASE, secure: true, httpOnly: false, sameSite: "Lax" }]);

      // ① 루팅 페이지 진입 시 미완료 사용자는 /signup?step=family 로 이동
      await page.goto(BASE);
      await page.waitForURL((url) => url.pathname.includes("/signup"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ①-1] 가입 미완료 접속 시 이동 URL: ${page.url()}`);
      expect(page.url()).toContain("step=family");

      // ①-2 가족 생성
      await page.fill("input[placeholder*='가족']", "케이가족");
      await page.click("button:has-text('가족 만들기 →')");

      // ①-3 가족 생성 성공 후 반드시 4/4 아이 등록으로 이동
      await page.waitForURL((url) => url.search.includes("step=child") || page.url().includes("step=child"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ①-2] 가족 생성 완료 후 아이 등록 이동 URL: ${page.url()}`);
      await expect(page.locator("text=아이 등록")).toBeVisible();

      // ② 가족이 이미 있는 상태에서 새로고침/재진입 시 아이 등록 단계부터 재개
      await page.goto(`${BASE}/parent/home`);
      await page.waitForURL((url) => url.pathname.includes("/signup") && url.search.includes("step=child"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ②] 가족 존재하는 상태에서 /parent/home 접근 시 아이등록 재개 URL: ${page.url()}`);

      // ③ 아이 등록 완료 및 보호자 홈 진입
      await page.fill("input[placeholder='성']", "홍");
      await page.fill("input[placeholder='이름']", "길동");
      await page.click("button:has-text('남아')");
      await page.click("button:has-text('1학년')");
      await page.click("button:has-text('과학')");
      await page.fill("input[placeholder='아이 로그인 아이디']", `child${ts}`);
      await page.fill("input[placeholder='비밀번호 (6자 이상)']", "123456");
      await page.fill("input[placeholder='비밀번호 확인']", "123456");
      await page.click("input[type='checkbox']");

      await page.click("button:has-text('아이 등록하고 시작하기 →')");
      await page.waitForURL((url) => url.pathname.includes("/parent/home") || url.pathname.includes("/onboarding"), { timeout: 20000 });
      console.log(`✅ [SCENARIO ③] 아이 등록 완료 후 최종 진입 URL: ${page.url()}`);

      // ④ 재접속 시 가족 만들기 화면 재노출 없음
      await page.goto(BASE);
      await page.waitForURL((url) => url.pathname.includes("/parent/home"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ④] 재접속 시 대시보드 직접 진입 URL: ${page.url()}`);
      await expect(page.locator("text=가족 만들기")).not.toBeVisible();

    } finally {
      await svc.from("child_profiles").delete().eq("name", "홍길동");
      await svc.from("family_members").delete().eq("user_id", userId);
      const { data: fam } = await svc.from("families").select("id").eq("name", "케이가족").single();
      if (fam) await svc.from("families").delete().eq("id", fam.id);
      await svc.from("signup_consents").delete().eq("user_id", userId);
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });

  // ⑤ 탈퇴 계정은 복구 화면 우선 표시
  test("⑤ WITHDRAWN 계정은 /account/withdrawn 복구 화면 우선 이동", async ({ page, context }) => {
    const ts = Date.now();
    const email = `qa-withdrawn-${ts}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "탈퇴보호자",
        account_status: "WITHDRAWN_PENDING",
        withdrawn_at: new Date().toISOString(),
        purge_scheduled_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const session = await realSignIn(email, password);
      const cookie = makeCookie(session);
      await context.addCookies([{ ...cookie, url: BASE, secure: true, httpOnly: false, sameSite: "Lax" }]);

      await page.goto(BASE);
      await page.waitForURL((url) => url.pathname.includes("/account/withdrawn"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ⑤] 탈퇴 계정 재접속 시 복구 화면 URL: ${page.url()}`);
      await expect(page.locator("text=탈퇴 처리된 계정입니다")).toBeVisible();
    } finally {
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });
});
