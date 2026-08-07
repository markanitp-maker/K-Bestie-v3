import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PLAYWRIGHT_BASE_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;

function authCookie(session: { access_token: string; refresh_token: string; [key: string]: unknown }) {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  return { name: `sb-${ref}-auth-token`, value, url: BASE, secure: true, sameSite: "Lax" as const };
}

async function attachSession(context: BrowserContext, email: string) {
  const auth = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error("QA_SESSION_MISSING");
  await context.addCookies([authCookie(data.session)]);
  await context.addInitScript(() => localStorage.setItem("k_pwa_intro_seen", "1"));
}

test.describe.serial("landing auth membership routing", () => {
  test.setTimeout(60_000);

  for (const scenario of [
    { name: "new auth user", expected: "consent", setup: "new" },
    { name: "consent completed", expected: "profile", setup: "consent" },
    { name: "parent profile completed", expected: "family", setup: "profile" },
    { name: "family completed", expected: "child", setup: "family" },
  ] as const) {
    test(`${scenario.name} resumes at ${scenario.expected}`, async ({ page, context }) => {
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const email = `qa-landing-${scenario.setup}-${Date.now()}@kbestie.local`;
      const { data: created, error: createError } = await svc.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (createError || !created.user) throw createError ?? new Error("QA_USER_CREATE_FAILED");
      const userId = created.user.id;
      let familyId: string | null = null;

      try {
        if (scenario.setup !== "new") {
          const { error: consentError } = await svc.from("signup_consents").insert({
            user_id: userId,
            consent_type: "service_terms",
            document_version: "2026-07-16",
            agreed: true,
          });
          if (consentError) throw consentError;
        }
        if (scenario.setup === "profile" || scenario.setup === "family") {
          const { error: parentError } = await svc.from("parents").upsert({
            id: userId,
            email,
            name: "랜딩QA",
            phone_number: "010-0000-0000",
            relationship_to_child: "guardian",
            account_status: "ONBOARDING",
          });
          if (parentError) throw parentError;
        }
        if (scenario.setup === "family") {
          const { data: familyRows, error: familyError } = await svc.rpc("create_family_with_owner", {
            p_user_id: userId,
            p_name: `랜딩QA-${Date.now()}`,
          });
          if (familyError) throw familyError;
          familyId = familyRows?.[0]?.family_id ?? null;
        }

        await attachSession(context, email);
        await page.goto(BASE);
        await page.waitForURL((url) => url.pathname === "/signup", { timeout: 20_000 });
        expect(new URL(page.url()).searchParams.get("step")).toBe(scenario.expected);
      } finally {
        if (familyId) {
          await svc.from("family_members").delete().eq("family_id", familyId);
          await svc.from("families").delete().eq("id", familyId);
        }
        await svc.from("signup_consents").delete().eq("user_id", userId);
        await svc.from("parents").delete().eq("id", userId);
        await svc.auth.admin.deleteUser(userId);
      }
    });
  }

  test("active parent bypasses signup", async ({ page, context }) => {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const email = `qa-landing-active-${Date.now()}@kbestie.local`;
    const { data: created, error: createError } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("QA_USER_CREATE_FAILED");
    const userId = created.user.id;
    let familyId: string | null = null;
    let childId: string | null = null;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "랜딩활성QA",
        phone_number: "010-0000-0000",
        relationship_to_child: "guardian",
        account_status: "ACTIVE",
        onboarding_completed_at: new Date().toISOString(),
      });
      const { data: familyRows, error: familyError } = await svc.rpc("create_family_with_owner", {
        p_user_id: userId,
        p_name: `랜딩활성QA-${Date.now()}`,
      });
      if (familyError) throw familyError;
      familyId = familyRows?.[0]?.family_id ?? null;
      const { data: member, error: memberError } = await svc
        .from("family_members")
        .select("id")
        .eq("user_id", userId)
        .single();
      if (memberError || !familyId) throw memberError ?? new Error("QA_FAMILY_MISSING");
      const { data: child, error: childError } = await svc
        .from("child_profiles")
        .insert({
          family_id: familyId,
          member_id: member.id,
          name: "랜딩QA아이",
          given_name: "QA아이",
          family_name: "랜딩",
          gender: "other",
          grade: "초1",
          interests: ["과학"],
          guardian_consent: true,
          guardian_consent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (childError) throw childError;
      childId = child.id;

      await attachSession(context, email);
      await page.goto(BASE);
      await page.waitForURL((url) => url.pathname === "/parent/home", { timeout: 20_000 });
      expect(page.url()).not.toContain("/signup");
    } finally {
      if (childId) await svc.from("child_profiles").delete().eq("id", childId);
      if (familyId) {
        await svc.from("family_members").delete().eq("family_id", familyId);
        await svc.from("families").delete().eq("id", familyId);
      }
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });
});
