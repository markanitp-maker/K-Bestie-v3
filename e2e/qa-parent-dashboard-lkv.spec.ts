import { expect, test } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  buildDashboardCardInsights,
  DASHBOARD_CARD_FIELDS,
  type DashboardCardField,
  type DashboardCardReportRow,
} from "../lib/reports/dashboardCardInsights";

const BASE = process.env.PLAYWRIGHT_BASE_URL!;
const PROD_URL = process.env.QA_PROD_SUPABASE_URL!;
const PROD_SERVICE_KEY = process.env.QA_PROD_SUPABASE_SERVICE_ROLE_KEY!;
const DEV_URL = process.env.QA_DEV_SUPABASE_URL!;
const DEV_ANON_KEY = process.env.QA_DEV_SUPABASE_ANON_KEY!;
const DEV_SERVICE_KEY = process.env.QA_DEV_SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.QA_TEST_PASSWORD!;

const TITLES: Record<DashboardCardField, string> = {
  school_academy_life: "학교·학원 생활",
  peer_friendship: "친구 관계",
  emotion_hint: "마음 흐름",
  interests_preferences: "관심사·취향",
  study_concerns: "공부 고민",
  digital_content_interests: "디지털·콘텐츠",
  teacher_adults: "선생님·어른",
  recurring_stories: "반복 이야기",
};

function authCookie(session: Session) {
  const ref = new URL(DEV_URL).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  return { name: `sb-${ref}-auth-token`, value, url: BASE, secure: true, sameSite: "Lax" as const };
}

function relativeDate(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "1일 전";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return "오래전";
}

test("안서아·안서현 실제 카드 이력으로 Dev API와 부모 홈을 검증한다", async ({ page, context }) => {
  test.setTimeout(180_000);
  const prod = createClient(PROD_URL, PROD_SERVICE_KEY, { auth: { persistSession: false } });
  const dev = createClient(DEV_URL, DEV_SERVICE_KEY, { auth: { persistSession: false } });
  const email = `qa-parent-lkv-${Date.now()}@kbestie.local`;
  let userId: string | null = null;
  let familyId: string | null = null;
  const childIds: string[] = [];

  try {
    const { data: prodChildren, error: prodChildError } = await prod
      .from("child_profiles")
      .select("id, name")
      .in("name", ["안서아", "안서현"])
      .order("name");
    if (prodChildError || prodChildren?.length !== 2) {
      throw prodChildError ?? new Error("Production source children missing");
    }

    const source = new Map<string, DashboardCardReportRow[]>();
    for (const child of prodChildren) {
      const { data: rows, error } = await prod
        .from("daily_reports")
        .select("dashboard_cards, business_date, emotion_level")
        .eq("child_id", child.id)
        .is("deleted_at", null)
        .order("business_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      source.set(child.name, (rows ?? []) as DashboardCardReportRow[]);
    }

    const { data: created, error: createError } = await dev.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("Dev QA user creation failed");
    userId = created.user.id;

    const { error: parentError } = await dev.from("parents").upsert({
      id: userId,
      email,
      name: "부모홈LKV-QA",
      phone_number: "010-0000-0000",
      relationship_to_child: "guardian",
      account_status: "ACTIVE",
      onboarding_completed_at: new Date().toISOString(),
    });
    if (parentError) throw parentError;

    const { data: familyRows, error: familyError } = await dev.rpc("create_family_with_owner", {
      p_user_id: userId,
      p_name: `부모홈LKV-QA-${Date.now()}`,
    });
    if (familyError || !familyRows?.[0]?.family_id) throw familyError ?? new Error("Dev QA family missing");
    familyId = familyRows[0].family_id;

    for (const name of ["안서아", "안서현"]) {
      const { data: child, error: childError } = await dev
        .from("child_profiles")
        .insert({ family_id: familyId, name, grade: "초4", interests: ["QA"] })
        .select("id")
        .single();
      if (childError) throw childError;
      childIds.push(child.id);

      const reportRows = source.get(name) ?? [];
      const fixtureRows = reportRows.map((row) => ({
        child_id: child.id,
        business_date: row.business_date,
        summary_line: "부모 홈 카드 QA",
        mood_score: 5,
        emotion_tags: [],
        parent_guide: "",
        emotion_level: row.emotion_level ?? "safe",
        dashboard_cards: row.dashboard_cards,
      }));
      const { error: reportError } = await dev.from("daily_reports").insert(fixtureRows);
      if (reportError) throw reportError;
    }

    const auth = createClient(DEV_URL, DEV_ANON_KEY);
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError || !signedIn.session) throw signInError ?? new Error("Dev QA session missing");
    await context.addCookies([authCookie(signedIn.session)]);

    for (let index = 0; index < childIds.length; index += 1) {
      const name = index === 0 ? "안서아" : "안서현";
      const childId = childIds[index];
      const expected = buildDashboardCardInsights(source.get(name) ?? []);
      const response = await context.request.get(`${BASE}/api/parent/reports?childId=${childId}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.childName).toBe(name);
      for (const field of DASHBOARD_CARD_FIELDS) {
        expect(body.insights[field].value).toBe(expected[field].value);
        expect(body.insights[field].last_observed_at).toBe(expected[field].last_observed_at);
      }
    }

    await page.goto(`${BASE}/parent/home`);
    await expect(page.getByText("안서아", { exact: true })).toBeVisible({ timeout: 20_000 });
    const eventConfirm = page.getByRole("button", { name: "이벤트 확인" });
    if (await eventConfirm.isVisible()) await eventConfirm.click();

    for (const name of ["안서아", "안서현"]) {
      if (name === "안서현") {
        await page.getByRole("button", { name: "자녀 선택" }).click();
        await page.getByRole("option", { name: /안서현/ }).click();
      }

      const expected = buildDashboardCardInsights(source.get(name) ?? []);
      for (const field of DASHBOARD_CARD_FIELDS) {
        const insight = expected[field];
        if (!insight.value || !insight.last_observed_at) throw new Error(`${name}.${field} source missing`);
        const card = page.getByText(TITLES[field], { exact: true }).locator("xpath=../../..");
        await expect(card).toContainText(insight.value);
        await expect(card).toContainText(relativeDate(insight.last_observed_at));
        await expect(card).not.toContainText("합니다.");
        await expect(card).not.toContainText("새로운 이야기가 있어요");
        await expect(card).not.toContainText("분석을 준비 중이에요");
      }
    }
  } finally {
    if (childIds.length > 0) await dev.from("daily_reports").delete().in("child_id", childIds);
    if (childIds.length > 0) await dev.from("child_profiles").delete().in("id", childIds);
    if (familyId) {
      await dev.from("family_members").delete().eq("family_id", familyId);
      await dev.from("families").delete().eq("id", familyId);
    }
    if (userId) {
      await dev.from("parents").delete().eq("id", userId);
      await dev.auth.admin.deleteUser(userId);
    }
  }
});
