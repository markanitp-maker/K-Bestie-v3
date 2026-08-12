import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { rate, resolveAnalyticsFilters, type AnalyticsScope, type InternalTestMode } from "@/lib/admin/analytics";
import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

type StageStatus = "success" | "failure" | "pending";
type PipelineStage = "collection_1" | "collection_2" | "context_correction" | "memory_batch" | "daily_report";

const STAGES: Array<{ key: PipelineStage; label: string }> = [
  { key: "collection_1", label: "레거시 중간 수집" },
  { key: "collection_2", label: "하루 마감 수집" },
  { key: "context_correction", label: "보정" },
  { key: "memory_batch", label: "Memory Batch" },
  { key: "daily_report", label: "리포트 생성" },
];

function normalizeStatus(value: unknown): StageStatus {
  if (value === "completed") return "success";
  if (value === "failed") return "failure";
  return "pending";
}

function worstStatus(statuses: StageStatus[]): StageStatus {
  if (statuses.includes("failure")) return "failure";
  if (statuses.includes("pending")) return "pending";
  return "success";
}

function dateKey(childId: string, date: string): string {
  return `${childId}:${date}`;
}

function eventUnitId(event: any, scope: AnalyticsScope, childFamily: Map<string, string | null>, parentFamily: Map<string, string | null>): string | null {
  const familyId = event.family_id || (event.child_id ? childFamily.get(event.child_id) : null) || (event.actor_id ? parentFamily.get(event.actor_id) : null);
  if (scope === "family") return familyId || null;
  if (scope === "parent") return event.actor_type === "parent" && event.actor_id ? String(event.actor_id) : null;
  if (scope === "child") return event.child_id ? String(event.child_id) : null;
  if (event.actor_type === "parent" && event.actor_id) return `parent:${event.actor_id}`;
  if (event.child_id) return `child:${event.child_id}`;
  return null;
}

function countUnits(events: any[], names: string[], scope: AnalyticsScope, childFamily: Map<string, string | null>, parentFamily: Map<string, string | null>): number {
  const ids = new Set<string>();
  for (const event of events) {
    if (!names.includes(event.event_name)) continue;
    const id = eventUnitId(event, scope, childFamily, parentFamily);
    if (id) ids.add(id);
  }
  return ids.size;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const now = new Date();
  now.setHours(now.getHours() + 9);
  const todayStr = now.toISOString().slice(0, 10);
  let filters;
  try {
    filters = resolveAnalyticsFilters(req.nextUrl.searchParams, todayStr);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }
  const reportStatus = ["all", "success", "failure", "pending"].includes(req.nextUrl.searchParams.get("reportStatus") ?? "")
    ? req.nextUrl.searchParams.get("reportStatus")!
    : "all";
  const fromIso = `${filters.from}T00:00:00+09:00`;
  const toIso = `${filters.to}T23:59:59.999+09:00`;
  const service = createServiceClient();

  let testFamilyIds: Set<string>;
  try {
    testFamilyIds = await getTestFamilyIds(service);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "내부 테스트 범위를 확인하지 못했습니다." }, { status: 500 });
  }
  const matchesTestMode = (familyId: string | null | undefined, mode: InternalTestMode) => {
    if (mode === "include") return true;
    const isTest = !!familyId && testFamilyIds.has(familyId);
    return mode === "only" ? isTest : !isTest;
  };

  const settled = await Promise.allSettled([
    service.from("child_profiles").select("id,family_id,name,is_internal_test,is_test_account"),
    service.from("family_members").select("id,family_id,user_id,role,is_internal_test").in("role", ["owner_parent", "parent"]),
    service.from("behavior_events").select("event_name,actor_type,actor_id,family_id,child_id,session_id,occurred_at").gte("occurred_at", fromIso).lte("occurred_at", toIso),
    service.from("raw_daily_conversations_v3").select("child_id,business_date,collection_1_status,collection_2_status").gte("business_date", filters.from).lte("business_date", filters.to),
    service.from("corrected_daily_conversations_v3").select("child_id,business_date,correction_status").gte("business_date", filters.from).lte("business_date", filters.to),
    service.from("pipeline_jobs").select("child_id,business_date,job_type,status,last_error_code,last_error_summary,updated_at").gte("business_date", filters.from).lte("business_date", filters.to),
    service.from("daily_reports").select("id,child_id,business_date,created_at").gte("business_date", filters.from).lte("business_date", filters.to).is("deleted_at", null),
  ]);
  const labels = ["child_profiles", "family_members", "behavior_events", "raw_daily_conversations_v3", "corrected_daily_conversations_v3", "pipeline_jobs", "daily_reports"];
  const values: any[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === "rejected") return NextResponse.json({ error: `${labels[index]} 조회가 거부되었습니다.` }, { status: 500 });
    if (result.value.error) return NextResponse.json({ error: `${labels[index]} 조회 실패: ${result.value.error.message}` }, { status: 500 });
    values.push(result.value.data ?? []);
  }

  const [allChildren, allParents, allEvents, allRaw, allCorrected, allJobs, allReports] = values;
  const children = allChildren.filter((child: any) => matchesTestMode(child.family_id, filters.internalTest));
  const childFamily = new Map<string, string | null>(children.map((child: any) => [child.id, child.family_id]));
  const childName = new Map<string, string>(children.map((child: any) => [child.id, child.name || "이름 미등록"]));
  const validChildIds = new Set(childFamily.keys());
  const parents = allParents.filter((parent: any) => matchesTestMode(parent.family_id, filters.internalTest));
  const parentFamily = new Map<string, string | null>(parents.filter((parent: any) => parent.user_id).map((parent: any) => [parent.user_id, parent.family_id]));
  const validFamilyIds = new Set([...childFamily.values(), ...parentFamily.values()].filter(Boolean));
  const events = allEvents.filter((event: any) => {
    const familyId = event.family_id || (event.child_id ? childFamily.get(event.child_id) : null) || (event.actor_id ? parentFamily.get(event.actor_id) : null);
    return filters.internalTest === "include" ? (!familyId || validFamilyIds.has(familyId)) : matchesTestMode(familyId, filters.internalTest);
  });
  const raw = allRaw.filter((row: any) => validChildIds.has(row.child_id));
  const corrected = allCorrected.filter((row: any) => validChildIds.has(row.child_id));
  const jobs = allJobs.filter((row: any) => validChildIds.has(row.child_id));
  const reports = allReports.filter((row: any) => validChildIds.has(row.child_id));

  const rawByKey = new Map<string, any>(raw.map((row: any) => [dateKey(row.child_id, row.business_date), row] as [string, any]));
  const correctedByKey = new Map<string, any>(corrected.map((row: any) => [dateKey(row.child_id, row.business_date), row] as [string, any]));
  const reportByKey = new Map<string, any>(reports.map((row: any) => [dateKey(row.child_id, row.business_date), row] as [string, any]));
  const jobsByKey = new Map<string, any>();
  for (const job of jobs) {
    const key = `${dateKey(job.child_id, job.business_date)}:${job.job_type}`;
    const previous = jobsByKey.get(key);
    if (!previous || String(job.updated_at) > String(previous.updated_at)) jobsByKey.set(key, job);
  }

  const allTargets = new Set<string>([...rawByKey.keys(), ...correctedByKey.keys(), ...reportByKey.keys()]);
  for (const job of jobs) allTargets.add(dateKey(job.child_id, job.business_date));
  const stageStatus = (key: string, stage: PipelineStage): StageStatus => {
    const job = jobsByKey.get(`${key}:${stage}`);
    if (stage === "collection_1") return normalizeStatus(job?.status ?? rawByKey.get(key)?.collection_1_status);
    if (stage === "collection_2") return normalizeStatus(job?.status ?? rawByKey.get(key)?.collection_2_status);
    if (stage === "context_correction") return normalizeStatus(job?.status ?? correctedByKey.get(key)?.correction_status);
    if (stage === "daily_report" && reportByKey.has(key)) return "success";
    return normalizeStatus(job?.status);
  };

  const quality = STAGES.map((stage) => {
    const statuses = [...allTargets].map((key) => stageStatus(key, stage.key));
    const success = statuses.filter((status) => status === "success").length;
    const failure = statuses.filter((status) => status === "failure").length;
    const pending = statuses.filter((status) => status === "pending").length;
    return { key: stage.key, label: stage.label, target: statuses.length, success, failure, pending, successRate: rate(success, statuses.length) };
  });

  const reportDetails = [...allTargets].map((key) => {
    const [childId, businessDate] = key.split(":");
    const statuses = STAGES.map((stage) => stageStatus(key, stage.key));
    const status = worstStatus(statuses);
    const failedJob = jobs.find((job: any) => job.child_id === childId && job.business_date === businessDate && normalizeStatus(job.status) === "failure");
    return {
      childId,
      name: childName.get(childId) || "이름 미등록",
      businessDate,
      status,
      stages: Object.fromEntries(STAGES.map((stage, index) => [stage.key, statuses[index]])),
      errorCode: failedJob?.last_error_code || null,
    };
  }).filter((row) => reportStatus === "all" || row.status === reportStatus)
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.name.localeCompare(b.name, "ko"));

  const loginEvents = ["parent_login", "child_login"];
  const missionStarts = events.filter((event: any) => event.event_name === "mission_start");
  const missionCompletes = events.filter((event: any) => event.event_name === "mission_complete");
  const socialActivity = events.filter((event: any) => ["freechat_start", "play_start"].includes(event.event_name));
  const pipelineKeys = [...allTargets];
  const correctedSuccess = pipelineKeys.filter((key) => stageStatus(key, "context_correction") === "success").length;
  const memorySuccess = pipelineKeys.filter((key) => stageStatus(key, "memory_batch") === "success").length;
  const reportSuccess = pipelineKeys.filter((key) => stageStatus(key, "daily_report") === "success").length;
  const reportViewEvents = events.filter((event: any) => event.event_name === "parent_report_view");

  const eligibleUnits = filters.scope === "family"
    ? validFamilyIds.size
    : filters.scope === "parent"
      ? parentFamily.size
      : filters.scope === "child"
        ? validChildIds.size
        : parentFamily.size + validChildIds.size;
  const funnel = [
    { key: "access", label: "접속", target: eligibleUnits, completed: countUnits(events, loginEvents, filters.scope, childFamily, parentFamily) },
    { key: "mission_start", label: "미션 시작", target: validChildIds.size, completed: countUnits(missionStarts, ["mission_start"], filters.scope, childFamily, parentFamily) },
    { key: "mission_complete", label: "미션 완료", target: missionStarts.length, completed: missionCompletes.length },
    { key: "social", label: "자유대화/놀이 활동", target: validChildIds.size, completed: new Set(socialActivity.map((event: any) => event.child_id).filter(Boolean)).size },
    { key: "collection", label: "대화 수집", target: pipelineKeys.length, completed: rawByKey.size },
    { key: "correction", label: "보정 완료", target: rawByKey.size, completed: correctedSuccess },
    { key: "memory", label: "Memory Batch 완료", target: correctedSuccess, completed: memorySuccess },
    { key: "report", label: "리포트 생성", target: Math.max(memorySuccess, rawByKey.size), completed: reportSuccess },
    { key: "report_view", label: "부모 리포트 확인", target: reportSuccess, completed: Math.min(reportSuccess, reportViewEvents.length) },
  ].map((row) => ({ ...row, failed: Math.max(0, row.target - row.completed), completionRate: rate(row.completed, row.target) }));

  const reportTargetUsers = new Set(raw.map((row: any) => row.child_id));
  const reportGeneratedUsers = new Set(reports.map((row: any) => row.child_id));
  const reportViewingParents = new Set(reportViewEvents.map((event: any) => event.actor_id).filter(Boolean));

  return NextResponse.json({
    filters,
    funnel,
    quality,
    reportDetails,
    kpis: {
      missionStarts: missionStarts.length,
      missionCompletes: missionCompletes.length,
      missionCompletionRate: rate(missionCompletes.length, missionStarts.length),
      reportTargetUsers: reportTargetUsers.size,
      reportGeneratedUsers: reportGeneratedUsers.size,
      reportGenerationRate: rate(reportGeneratedUsers.size, reportTargetUsers.size),
      reportViewingParents: reportViewingParents.size,
      reportViewRate: rate(reportViewingParents.size, reportGeneratedUsers.size),
    },
    meta: {
      timezone: "Asia/Seoul",
      reportViewSource: "behavior_events.parent_report_view",
      generatedAt: new Date().toISOString(),
    },
  }, { headers: { "Cache-Control": "private, max-age=30" } });
}
