import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

// requests/055-admin-manual-report-pipeline-upsert.md 게이트② 동적 QA.
// "즉시 리포트 생성"(action=generate)을 같은 아이·날짜로 두 번 연속 실행해, daily_reports가
// 새 행을 추가하지 않고 UPSERT되며 generation_version이 1→2로 증가하는지 실제 관리자 API
// 폴링 흐름으로 검증한다. Context Correction(Gemini)의 출력 정확도는 이 지시서의 범위 밖이므로
// corrected_daily_conversations_v3/corrected_daily_conversation_messages_v3를 직접 시딩해
// Memory Batch·Daily Report 단계(§5/§6/§9 UPSERT·이력 요구사항)만 검증한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const adminEmail = "markanitp@gmail.com";
const TEST_CHILD_ID = "4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c"; // QA테스트아이 (Dev)

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
    chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: "Lax" as const }))
  );
}

function todayKstDateStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function runAndPoll(
  page: import("@playwright/test").Page,
  businessDate: string,
  action: "collect" | "generate" | "collect_and_generate"
) {
  const runRes = await page.request.post(`${BASE}/api/admin/reporting/run`, {
    data: { businessDate, action, target: { scope: "single", childId: TEST_CHILD_ID } },
  });
  expect(runRes.ok(), await runRes.text()).toBeTruthy();
  const runData = await runRes.json();
  expect(runData.v3).toBe(true);

  if (runData.completed) return runData;

  const executionId = runData.execution_id;
  const targetCount = runData.targetCount ?? 1;
  let last: any = null;
  for (let i = 0; i < 40; i++) {
    const pulseRes = await page.request.post(`${BASE}/api/admin/reporting/pulse`, {
      data: { executionId, action, targetCount },
    });
    expect(pulseRes.ok(), await pulseRes.text()).toBeTruthy();
    last = await pulseRes.json();
    if (last.isComplete) return last;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Execution ${executionId} did not complete within polling budget: ${JSON.stringify(last)}`);
}

test("QA-055: 수집 후 리포트 즉시 생성 2연속 실행 시 daily_reports UPSERT + 버전 증가", async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  test.skip(
    !supabaseUrl || !serviceRoleKey || !anonKey,
    "Dev Supabase 검증용 환경변수가 필요합니다."
  );

  const service = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authClient = () =>
    createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  const { data: adminLink, error: adminLinkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: adminEmail,
  });
  expect(adminLinkError).toBeNull();
  const adminAuth = authClient();
  const { data: verifiedAdmin, error: verifyAdminError } = await adminAuth.auth.verifyOtp({
    token_hash: adminLink.properties!.hashed_token,
    type: "magiclink",
  });
  expect(verifyAdminError).toBeNull();
  await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl!);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });

  const businessDate = todayKstDateStr();

  // 정리: 이 테스트 아이의 기존 daily_reports를 소프트 삭제해 깨끗한 상태에서 검증한다.
  await service
    .from("daily_reports")
    .update({ deleted_at: new Date().toISOString() })
    .eq("child_id", TEST_CHILD_ID)
    .eq("business_date", businessDate)
    .is("deleted_at", null);

  // 1차 실행: 메모리 배치 → 리포트 생성 (수집·보정은 별도로 이미 확인됨 — 여기서는
  // 미리 시딩해둔 corrected_daily_conversations_v3를 그대로 사용)
  await runAndPoll(page, businessDate, "generate");

  const { data: reportsAfterFirst, error: err1 } = await service
    .from("daily_reports")
    .select("id, generation_version, generation_source")
    .eq("child_id", TEST_CHILD_ID)
    .eq("business_date", businessDate)
    .is("deleted_at", null);
  expect(err1).toBeNull();
  expect(reportsAfterFirst?.length, "1차 실행 후 리포트가 정확히 1건이어야 한다").toBe(1);
  expect(reportsAfterFirst![0].generation_version).toBe(1);
  expect(reportsAfterFirst![0].generation_source).toBe("manual");
  const firstReportId = reportsAfterFirst![0].id;

  // 2차 실행: 같은 아이·날짜로 리포트만 재생성 (이미 수집·보정된 데이터 재사용)
  await runAndPoll(page, businessDate, "generate");

  const { data: reportsAfterSecond, error: err2 } = await service
    .from("daily_reports")
    .select("id, generation_version, generation_source")
    .eq("child_id", TEST_CHILD_ID)
    .eq("business_date", businessDate)
    .is("deleted_at", null);
  expect(err2).toBeNull();
  expect(reportsAfterSecond?.length, "2차 실행 후에도 새 행이 추가되지 않고 1건만 유지돼야 한다").toBe(1);
  expect(reportsAfterSecond![0].id).toBe(firstReportId);
  expect(reportsAfterSecond![0].generation_version, "재생성 시 generation_version이 증가해야 한다").toBe(2);
});
