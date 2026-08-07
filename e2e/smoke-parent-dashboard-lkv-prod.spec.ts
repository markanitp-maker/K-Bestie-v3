import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  buildDashboardCardInsights,
  DASHBOARD_CARD_FIELDS,
  type DashboardCardField,
  type DashboardCardReportRow,
} from "../lib/reports/dashboardCardInsights";

const BASE = "https://app.k-bestie.com";
const PROD_URL = process.env.QA_PROD_SUPABASE_URL!;
const PROD_ANON_KEY = process.env.QA_PROD_SUPABASE_ANON_KEY!;
const PROD_SERVICE_KEY = process.env.QA_PROD_SUPABASE_SERVICE_ROLE_KEY!;

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

const FORBIDDEN = ["합니다.", "새로운 이야기가 있어요", "분석을 준비 중이에요"];

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

async function useSession(context: BrowserContext, session: Session) {
  const ref = new URL(PROD_URL).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunks = value.length <= 3180
    ? [{ name: cookieName, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(chunks.map((chunk) => ({
    ...chunk,
    url: BASE,
    secure: true,
    sameSite: "Lax" as const,
  })));
}

test("Production 실제 부모 홈에서 안서아·안서현 8카드 LKV를 검증한다", async ({ page, context }) => {
  test.setTimeout(120_000);
  const service = createClient(PROD_URL, PROD_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(PROD_URL, PROD_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: children, error: childError } = await service
    .from("child_profiles")
    .select("id, name, family_id")
    .in("name", ["안서아", "안서현"])
    .order("name");
  if (childError || children?.length !== 2) {
    throw childError ?? new Error("Production children missing");
  }
  expect(new Set(children.map((child) => child.family_id)).size).toBe(1);

  const expectedByName = new Map<string, ReturnType<typeof buildDashboardCardInsights>>();
  for (const child of children) {
    const { data: rows, error } = await service
      .from("daily_reports")
      .select("dashboard_cards, business_date, emotion_level")
      .eq("child_id", child.id)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    expectedByName.set(child.name, buildDashboardCardInsights((rows ?? []) as DashboardCardReportRow[]));
  }

  const familyId = children[0].family_id;
  const { data: members, error: memberError } = await service
    .from("family_members")
    .select("user_id, role")
    .eq("family_id", familyId)
    .is("deleted_at", null);
  if (memberError) throw memberError;
  const parentId = members?.find((member) => member.user_id && member.role !== "child")?.user_id;
  if (!parentId) throw new Error("Production parent membership missing");

  const { data: parentAuth, error: parentAuthError } = await service.auth.admin.getUserById(parentId);
  const parentEmail = parentAuth.user?.email;
  if (parentAuthError || !parentEmail) throw parentAuthError ?? new Error("Production parent auth missing");

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: parentEmail,
  });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("Magic link missing");
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verified.session) throw verifyError ?? new Error("Production parent session missing");
  await useSession(context, verified.session);

  for (const child of children) {
    const response = await context.request.get(`${BASE}/api/parent/reports?childId=${child.id}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.childName).toBe(child.name);
    const expected = expectedByName.get(child.name)!;
    for (const field of DASHBOARD_CARD_FIELDS) {
      expect(body.insights[field].value).toBe(expected[field].value);
      expect(body.insights[field].last_observed_at).toBe(expected[field].last_observed_at);
    }
  }

  await page.goto(`${BASE}/parent/home`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "자녀 선택" })).toBeVisible({ timeout: 30_000 });
  const eventConfirm = page.getByRole("button", { name: "이벤트 확인" });
  if (await eventConfirm.isVisible()) await eventConfirm.click();

  for (const child of children) {
    await page.getByRole("button", { name: "자녀 선택" }).click();
    await page.getByRole("option", { name: new RegExp(child.name) }).click();
    await expect(page.getByRole("button", { name: "자녀 선택" })).toContainText(child.name);

    const expected = expectedByName.get(child.name)!;
    for (const field of DASHBOARD_CARD_FIELDS) {
      const insight = expected[field];
      if (!insight.value || !insight.last_observed_at) {
        throw new Error(`${child.name}.${field} source value missing`);
      }
      const card = page.getByText(TITLES[field], { exact: true }).locator("xpath=../../..");
      await expect(card).toContainText(insight.value);
      await expect(card).toContainText(relativeDate(insight.last_observed_at));
    }
    for (const forbidden of FORBIDDEN) {
      await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
    }
  }
});
