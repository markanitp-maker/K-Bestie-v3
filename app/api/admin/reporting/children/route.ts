import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { isRealCalendarDate } from "@/lib/admin/reportingDateValidation";
import {
  countSatisfiedGoals,
  getCompletionThreshold,
  type ConversationGoal,
} from "@/lib/mission-v3/goalEngine";

export const runtime = "nodejs";

const MISSION_TARGET_TURNS = 10;
const DISPLAY_CHILD_LIMIT = 50;
const ID_CHUNK_SIZE = 200;
const QUERY_PAGE_SIZE = 1000;

type MissionPhase = 1 | 2;

type MissionProgressSummary = {
  started: boolean;
  validTurns: number;
  targetTurns: number;
  completed: boolean;
  savedMessageCount: number;
  collectedMessageCount: number;
};

type ChatSessionRow = {
  id: string;
  child_id: string;
  session_type: string;
  mission_phase: number | null;
};

type MissionProgressRow = {
  session_id: string;
  child_id: string;
  round_type: string;
  status: string | null;
  valid_answer_count: number | null;
  required_valid_count: number | null;
};

type ConversationGoalRow = {
  mission_session_id: string;
  status: string;
};

type ChatMessageRow = {
  session_id: string;
  role: string;
};

type RawConversationRow = {
  id: string;
  child_id: string;
};

type RawMessageRow = {
  child_id: string;
  mission_phase: number | null;
  session_type: string;
  role: string;
  collection_job_id: string | null;
};

type PipelineJobRow = {
  id: string;
  child_id: string;
  job_type: string;
  collection_phase: number | null;
  status: string;
  last_error_code: string | null;
  last_error_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type ChildRow = {
  id: string;
  name: string;
};

const phaseForRoundType = (roundType: string): MissionPhase | null => {
  // Phase 1/2는 raw/report의 historical physical slot이다. 신규 daily_single은
  // 하루 마감 슬롯(2)에 저장하되 정책상 두 번째 미션이라는 뜻은 아니다.
  if (roundType === "daily_single") return 2;
  if (roundType === "round1_day") return 1;
  if (roundType === "round2_night") return 2;
  return null;
};

const phaseForSession = (session: ChatSessionRow | undefined): MissionPhase | null => {
  if (session?.mission_phase === 1 || session?.mission_phase === 2) return session.mission_phase;
  return null;
};

const collectionPhaseForJob = (job: PipelineJobRow | undefined): MissionPhase | null => {
  if (job?.collection_phase === 1 || job?.collection_phase === 2) return job.collection_phase;
  if (job?.job_type === "collection_1") return 1;
  if (job?.job_type === "collection_2") return 2;
  return null;
};

async function fetchAllPages<T>(
  queryPage: (rangeFrom: number, rangeTo: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const result = await queryPage(offset, offset + QUERY_PAGE_SIZE - 1);
    if (result.error) throw new Error(`${label} 조회 실패: ${result.error.message}`);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) return rows;
    offset += QUERY_PAGE_SIZE;
  }
}

async function fetchInChunks<T>(
  ids: string[],
  queryPage: (chunk: string[], rangeFrom: number, rangeTo: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + ID_CHUNK_SIZE);
    const chunkRows = await fetchAllPages<T>((rangeFrom, rangeTo) => queryPage(chunk, rangeFrom, rangeTo), label);
    rows.push(...chunkRows);
  }

  return rows;
}

const createMissionSummary = (): MissionProgressSummary => ({
  started: false,
  validTurns: 0,
  targetTurns: MISSION_TARGET_TURNS,
  completed: false,
  savedMessageCount: 0,
  collectedMessageCount: 0,
});

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const businessDate = req.nextUrl.searchParams.get("businessDate");
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !isRealCalendarDate(businessDate)) {
    return NextResponse.json({ error: "Invalid businessDate" }, { status: 400 });
  }

  const search = req.nextUrl.searchParams.get("search")?.trim().toLowerCase() || "";
  const db = createServiceClient();
  const startAt = `${businessDate}T00:00:00+09:00`;
  const endAt = `${businessDate}T23:59:59.999+09:00`;

  try {
    let children = await fetchAllPages<ChildRow>(
      (rangeFrom, rangeTo) => db.from("child_profiles").select("id, name").order("id").range(rangeFrom, rangeTo),
      "child_profiles"
    );
    if (search) {
      children = children.filter((child) => child.name.toLowerCase().includes(search) || child.id.toLowerCase().includes(search));
    }

    const candidateChildIds = children.map((child) => child.id);
    const candidateSessions = await fetchInChunks<ChatSessionRow>(
      candidateChildIds,
      (chunk, rangeFrom, rangeTo) => db
        .from("chat_sessions")
        .select("id, child_id, session_type, mission_phase")
        .in("child_id", chunk)
        .gte("started_at", startAt)
        .lte("started_at", endAt)
        .order("id")
        .range(rangeFrom, rangeTo),
      "chat_sessions"
    );

    if (!search) {
      const activeChildIds = new Set(candidateSessions.map((session) => session.child_id));
      children.sort((a, b) => {
        const aHasActivity = activeChildIds.has(a.id) ? 1 : 0;
        const bHasActivity = activeChildIds.has(b.id) ? 1 : 0;
        return aHasActivity !== bHasActivity ? bHasActivity - aHasActivity : a.name.localeCompare(b.name);
      });
    }

    children = children.slice(0, DISPLAY_CHILD_LIMIT);
    const childIds = children.map((child) => child.id);
    const displayedChildIds = new Set(childIds);
    const sessions = candidateSessions.filter((session) => displayedChildIds.has(session.child_id));
    const missionSessionIds = sessions.filter((session) => session.session_type === "mission").map((session) => session.id);

    const initialResults = await Promise.allSettled([
      fetchInChunks<MissionProgressRow>(
        childIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("mission_progress")
          .select("session_id, child_id, round_type, status, valid_answer_count, required_valid_count")
          .in("child_id", chunk)
          .eq("business_date", businessDate)
          .order("session_id")
          .range(rangeFrom, rangeTo),
        "mission_progress"
      ),
      fetchInChunks<RawConversationRow>(
        childIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("raw_daily_conversations_v3")
          .select("id, child_id")
          .in("child_id", chunk)
          .eq("business_date", businessDate)
          .order("id")
          .range(rangeFrom, rangeTo),
        "raw_daily_conversations_v3"
      ),
      fetchInChunks<Record<string, unknown>>(
        childIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("daily_reports")
          .select("*")
          .in("child_id", chunk)
          .eq("business_date", businessDate)
          .is("deleted_at", null)
          .order("id")
          .range(rangeFrom, rangeTo),
        "daily_reports"
      ),
      fetchInChunks<PipelineJobRow>(
        childIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("pipeline_jobs")
          .select("id, child_id, job_type, collection_phase, status, last_error_code, last_error_summary, started_at, completed_at, updated_at")
          .in("child_id", chunk)
          .eq("business_date", businessDate)
          .order("id")
          .range(rangeFrom, rangeTo),
        "pipeline_jobs"
      ),
    ]);

    if (initialResults.some((result) => result.status === "rejected")) {
      console.error("[admin/reporting/children] bulk query rejected", initialResults);
      return NextResponse.json({ error: "관리자 리포트 데이터 조회 실패" }, { status: 500 });
    }

    const [progressRows, rawConversations, reports, jobs] = initialResults.map((result) =>
      result.status === "fulfilled" ? result.value : []
    ) as [MissionProgressRow[], RawConversationRow[], Record<string, unknown>[], PipelineJobRow[]];
    const rawConversationIds = rawConversations.map((conversation) => conversation.id);
    const v3ProgressRows = progressRows.filter((progress) => progress.round_type === "daily_single");
    const v3SessionIds = Array.from(new Set(v3ProgressRows.map((progress) => progress.session_id).filter(Boolean)));

    const [messagesResult, rawMessagesResult, goalsResult] = await Promise.allSettled([
      fetchInChunks<ChatMessageRow>(
        missionSessionIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("chat_messages")
          .select("session_id, role")
          .in("session_id", chunk)
          .order("id")
          .range(rangeFrom, rangeTo),
        "chat_messages"
      ),
      fetchInChunks<RawMessageRow>(
        rawConversationIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("raw_daily_conversation_messages_v3")
          .select("child_id, mission_phase, session_type, role, collection_job_id")
          .in("raw_daily_conversation_v3_id", chunk)
          .order("id")
          .range(rangeFrom, rangeTo),
        "raw_daily_conversation_messages_v3"
      ),
      fetchInChunks<ConversationGoalRow>(
        v3SessionIds,
        (chunk, rangeFrom, rangeTo) => db
          .from("conversation_goals")
          .select("mission_session_id, status")
          .in("mission_session_id", chunk)
          .order("mission_session_id")
          .range(rangeFrom, rangeTo),
        "conversation_goals"
      ),
    ]);

    if (messagesResult.status === "rejected" || rawMessagesResult.status === "rejected") {
      console.error("[admin/reporting/children] detail query rejected", { messagesResult, rawMessagesResult });
      return NextResponse.json({ error: "관리자 리포트 상세 데이터 조회 실패" }, { status: 500 });
    }

    const messages = messagesResult.status === "fulfilled" ? messagesResult.value : [];
    const rawMessages = rawMessagesResult.status === "fulfilled" ? rawMessagesResult.value : [];

    let conversationGoalRows: ConversationGoalRow[] = [];
    if (goalsResult.status === "fulfilled") {
      conversationGoalRows = goalsResult.value;
    } else {
      console.error("[admin/reporting/children] conversation_goals 조회 실패, V2 계산식으로 대체:", goalsResult.reason);
    }

    const goalsBySession = new Map<string, ConversationGoalRow[]>();
    for (const goal of conversationGoalRows) {
      const sessionGoals = goalsBySession.get(goal.mission_session_id) ?? [];
      sessionGoals.push(goal);
      goalsBySession.set(goal.mission_session_id, sessionGoals);
    }

    const sessionsByChild = new Map<string, ChatSessionRow[]>();
    const sessionsById = new Map<string, ChatSessionRow>();
    for (const session of sessions) {
      const childSessions = sessionsByChild.get(session.child_id) ?? [];
      childSessions.push(session);
      sessionsByChild.set(session.child_id, childSessions);
      sessionsById.set(session.id, session);
    }

    const representativeProgress = new Map<string, {
      validTurns: number;
      targetTurns: number;
      completed: boolean;
    }>();
    for (const progress of progressRows) {
      const phase = phaseForRoundType(progress.round_type) ?? phaseForSession(sessionsById.get(progress.session_id));
      if (!phase) continue;

      let candidate: {
        validTurns: number;
        targetTurns: number;
        completed: boolean;
      };

      if (progress.round_type === "daily_single") {
        const sessionGoals = goalsBySession.get(progress.session_id);
        if (sessionGoals && sessionGoals.length > 0) {
          const goals = sessionGoals as unknown as ConversationGoal[];
          const targetTurns = getCompletionThreshold(goals);
          const rawValidTurns = countSatisfiedGoals(goals);
          candidate = {
            validTurns: Math.min(rawValidTurns, targetTurns),
            targetTurns,
            completed: progress.status === "COMPLETED",
          };
        } else {
          // Fail-safe: 조회 실패하거나 goals가 없으면 기존 V2 계산식으로 fallback
          console.error(`[admin/reporting/children] V3 session(${progress.session_id}) goals 부재/조회실패 - V2 계산식으로 fallback`);
          const targetTurns = progress.required_valid_count && progress.required_valid_count > 0
            ? progress.required_valid_count
            : MISSION_TARGET_TURNS;
          const rawValidTurns = Math.max(0, progress.valid_answer_count ?? 0);
          candidate = {
            validTurns: Math.min(rawValidTurns, targetTurns),
            targetTurns,
            completed: progress.status === "COMPLETED" || rawValidTurns >= targetTurns,
          };
        }
      } else {
        // V2 (round1_day, round2_night 등): 기존 로직 유지
        const targetTurns = progress.required_valid_count && progress.required_valid_count > 0
          ? progress.required_valid_count
          : MISSION_TARGET_TURNS;
        const rawValidTurns = Math.max(0, progress.valid_answer_count ?? 0);
        candidate = {
          validTurns: Math.min(rawValidTurns, targetTurns),
          targetTurns,
          completed: progress.status === "COMPLETED" || rawValidTurns >= targetTurns,
        };
      }

      const key = `${progress.child_id}:${phase}`;
      const current = representativeProgress.get(key);
      if (
        !current ||
        (candidate.completed && !current.completed) ||
        (candidate.completed === current.completed && candidate.validTurns > current.validTurns)
      ) {
        representativeProgress.set(key, candidate);
      }
    }

    const messagesBySession = new Map<string, number>();
    for (const message of messages) {
      if (message.role !== "child" && message.role !== "k") continue;
      messagesBySession.set(message.session_id, (messagesBySession.get(message.session_id) ?? 0) + 1);
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const rawMessagesByChildAndPhase = new Map<string, number>();
    for (const message of rawMessages) {
      if (message.session_type !== "mission") continue;
      if (message.role !== "child" && message.role !== "k") continue;
      const jobPhase = collectionPhaseForJob(
        message.collection_job_id ? jobsById.get(message.collection_job_id) : undefined
      );
      // legacy_mission_phase_time_fallback.sql의 수집 조건상 mission_phase가 NULL인 레거시
      // 미션 메시지는 collection_2만 처리한다. job FK가 유실된 레거시 행도 2차로 명시 집계한다.
      const collectionPhase = jobPhase ?? (message.mission_phase === null ? 2 : message.mission_phase);
      if (collectionPhase !== 1 && collectionPhase !== 2) continue;
      const key = `${message.child_id}:${collectionPhase}`;
      rawMessagesByChildAndPhase.set(key, (rawMessagesByChildAndPhase.get(key) ?? 0) + 1);
    }

    const reportsByChild = new Map<string, Record<string, unknown>>();
    for (const report of reports) {
      const childId = String(report.child_id);
      const existing = reportsByChild.get(childId);
      if (!existing || new Date(String(report.created_at)).getTime() > new Date(String(existing.created_at)).getTime()) {
        reportsByChild.set(childId, report);
      }
    }

    const jobsByChild = new Map<string, Record<string, unknown>>();
    for (const job of jobs) {
      const childJobs = jobsByChild.get(job.child_id) ?? {
        collection_1: null, collection_2: null, context_correction: null, memory_batch: null, daily_report: null,
      };
      const existing = childJobs[job.job_type] as { updated_at?: string } | null;
      if (!existing || new Date(job.updated_at).getTime() > new Date(existing.updated_at ?? 0).getTime()) childJobs[job.job_type] = job;
      jobsByChild.set(job.child_id, childJobs);
    }

    const result = children.map((child) => {
      const childSessions = sessionsByChild.get(child.id) ?? [];
      const missions: Record<MissionPhase, MissionProgressSummary> = { 1: createMissionSummary(), 2: createMissionSummary() };

      for (const session of childSessions) {
        if (session.session_type !== "mission" || (session.mission_phase !== 1 && session.mission_phase !== 2)) continue;
        const mission = missions[session.mission_phase];
        mission.started = true;
        mission.savedMessageCount += messagesBySession.get(session.id) ?? 0;
      }

      for (const phase of [1, 2] as const) {
        const progress = representativeProgress.get(`${child.id}:${phase}`);
        if (progress) {
          missions[phase].started = true;
          missions[phase].validTurns = progress.validTurns;
          missions[phase].targetTurns = progress.targetTurns;
          missions[phase].completed = progress.completed;
        }
        missions[phase].collectedMessageCount = rawMessagesByChildAndPhase.get(`${child.id}:${phase}`) ?? 0;
      }

      const report = reportsByChild.get(child.id);
      const reportFields = report ? [
        report.school_academy_life, report.peer_friendship, report.emotion_hint, report.interests_preferences,
        report.study_concerns, report.digital_content_interests, report.future_dreams, report.recurring_stories,
      ] : [];

      return {
        childId: child.id,
        name: child.name,
        missionSessionCount: childSessions.filter((session) => session.session_type === "mission").length,
        freeChatSessionCount: childSessions.filter((session) => session.session_type !== "mission").length,
        mission1: missions[1],
        mission2: missions[2],
        // 기존 API 소비자의 호환 필드. 새 UI의 phase별 수집 표시는 mission1/mission2를 사용한다.
        collected: rawConversations.some((conversation) => conversation.child_id === child.id),
        collection1Count: missions[1].collectedMessageCount,
        collection2Count: missions[2].collectedMessageCount,
        reportExists: Boolean(report),
        dashboardFieldCount: reportFields.filter((field) => field && String(field).trim().length > 0).length || null,
        lastReportGeneratedAt: report?.updated_at ?? report?.created_at ?? null,
        generationSource: report?.generation_source ?? null,
        generationVersion: report?.generation_version ?? null,
        jobs: jobsByChild.get(child.id) ?? null,
      };
    });

    return NextResponse.json({ children: result });
  } catch (error) {
    console.error("[admin/reporting/children] paginated query failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "관리자 리포트 데이터 조회 실패" },
      { status: 500 }
    );
  }
}
