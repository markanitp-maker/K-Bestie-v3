/**
 * e2e/qa-child-approval-start-loop.spec.ts
 *
 * 회원가입 4/4 아이 등록·자동 승인 성공 화면에서 '시작하기' 클릭 시
 * 다시 아이 등록 화면으로 돌지 않고 즉시 /parent/home으로 진입함을 실증하는 E2E 테스트.
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

test.describe("Production 아이 등록 승인 완료 후 시작하기 루프 방지 E2E 실증", () => {
  test.setTimeout(90000);
  let svc: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("아이 등록 → 승인되었습니다 → 시작하기 → 보호자 홈 진입 및 새로고침 유지 입증", async ({ page, context }) => {
    const ts = Date.now();
    const email = `qa-approve-loop-${ts}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "승인테스트보호자",
        phone_number: "010-3333-3333",
        relationship_to_child: "father",
        account_status: "ONBOARDING",
      });

      await svc.from("signup_consents").insert({
        user_id: userId,
        consent_type: "service_terms",
        agreed: true,
      });

      const { data: famRows } = await svc.rpc("create_family_with_owner", { p_user_id: userId, p_name: "승인가족" });
      const familyId = famRows[0].family_id;

      const session = await realSignIn(email, password);
      const cookie = makeCookie(session);
      await context.addCookies([{ ...cookie, url: BASE, secure: true, httpOnly: false, sameSite: "Lax" }]);

      // 1. /signup?step=child 접속
      await page.goto(`${BASE}/signup?step=child`);
      await page.waitForSelector("text=아이 등록");
      console.log(`✅ [STEP 4/4] 아이 등록 폼 진입 성공`);

      // 2. 아이 정보 작성 및 제출
      await page.fill("input[placeholder='성']", "김");
      await page.fill("input[placeholder='이름']", "나리");
      await page.click("button:has-text('여아')");
      await page.click("button:has-text('2학년')");
      await page.click("button:has-text('우주')");
      await page.fill("input[placeholder='아이 로그인 아이디']", `nari${ts}`);
      await page.fill("input[placeholder='비밀번호 (6자 이상)']", "123456");
      await page.fill("input[placeholder='비밀번호 확인']", "123456");
      await page.click("input[type='checkbox']");

      await page.click("button:has-text('아이 등록하고 시작하기 →')");

      // 3. 🎉 승인되었습니다 성공 화면 노출 확인
      await page.waitForSelector("text=승인되었습니다", { timeout: 20000 });
      console.log(`✅ [SUCCESS UI] 🎉 승인되었습니다 노출 확인!`);

      // 4. '시작하기 →' 버튼 클릭
      await page.click("button:has-text('시작하기 →')");

      // 5. 서버 membership-status 재확인 후 보호자 홈(/parent/home)으로 진입하는지 검증
      await page.waitForURL((url) => url.pathname.includes("/parent/home"), { timeout: 20000 });
      console.log(`✅ [PROOF] '시작하기' 클릭 후 보호자 홈 진입 성공! URL: ${page.url()}`);

      // 6. 새로고침 후에도 아이 등록 화면으로 튕기지 않고 보호자 홈이 유지되는지 검증
      await page.reload();
      await page.waitForURL((url) => url.pathname.includes("/parent/home"), { timeout: 15000 });
      console.log(`✅ [RELOAD PROOF] 새로고침 후에도 /parent/home 100% 유지 성공!`);

    } finally {
      await svc.from("child_profiles").delete().eq("name", "김나리");
      await svc.from("family_members").delete().eq("user_id", userId);
      const { data: fams } = await svc.from("families").select("id").eq("name", "승인가족");
      if (fams) for (const f of fams) await svc.from("families").delete().eq("id", f.id);
      await svc.from("signup_consents").delete().eq("user_id", userId);
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });
});
