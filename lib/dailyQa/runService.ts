// 요청서 019 §3-9, §3-10, §3-15, §3-17, §3-19, §3-20, §3-21, §3-22, §3-26
// 일일 24시간 대화 자동 QA Run 오케스트레이터 서비스.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDailyQaWindow } from "./window";
import {
  runRuleDetectors,
  type DailyQaMessage,
  type DailyQaDetection,
} from "./ruleDetectors";
import { aggregateDetections, type DailyQaIssueDraft } from "./aggregate";
import { resolveTrendStatus } from "./trendStatus";
import {
  findDailyQaTaxonomy,
  HYBRID_TAXONOMY_CODES,
} from "./taxonomy";
import {
  buildJudgeContext,
  buildJudgePrompt,
  parseJudgeResponse,
} from "./judgeContext";
import { offsetCalendarDate } from "../admin/analyticsKst";

/**
 * 이 시간을 넘긴 RUNNING Run 은 죽은 것으로 본다(리뷰 지적, 2026-08-19).
 *
 * 90분: 이 배치는 24시간 대화를 한 번 훑는 작업이라 정상적으로도 수 분이 걸릴 수 있다.
 * 너무 짧게 잡으면 아직 도는 중인 실행을 빼앗아 같은 window 를 두 프로세스가 동시에
 * 분석한다. 하루 한 번 도는 배치라 넉넉하게 잡아도 복구가 늦어지는 손해가 거의 없다.
 */
const STALE_RUNNING_MS = 90 * 60 * 1000;

export interface DailyQaRunDeps {
  db: SupabaseClient; // service_role
  nowIso: string; // Date.now() 를 쓰지 마라. 항상 주입받는다.
  triggerSource: "cron" | "manual";
  /** HYBRID 판정용. 없으면 규칙 기반만 돌린다(§3-7 을 건너뛰되 Run 은 성공시킨다). */
  judge?: (prompt: string) => Promise<string>;
}

export interface DailyQaRunResult {
  runId: string;
  executionKey: string;
  businessDate: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  isExistingRun: boolean;
  totalChildren: number;
  totalSessions: number;
  missionSessions: number;
  freeChatSessions: number;
  analyzedSessions: number;
  skippedTestSessions: number;
  totalMessages: number;
  analyzedMessages: number;
  issueCount: number;
  blockerCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  failedSessionCount: number;
  errorSummary: string | null;
  hybridSkippedReason?: string;
}

export async function runDailyConversationQa(deps: DailyQaRunDeps): Promise<DailyQaRunResult> {
  const window = resolveDailyQaWindow(deps.nowIso);
  let runId: string | null = null;

  // 1. 중복 Run 방지(§3-21)
  // execution_key UNIQUE 제약조건으로 동시 실행 및 중복 생성 방지
  const { data: insertedRun, error: insertError } = await deps.db
    .from("daily_conversation_qa_runs")
    .insert({
      window_start: window.windowStart,
      window_end: window.windowEnd,
      business_date: window.businessDate,
      execution_key: window.executionKey,
      trigger_source: deps.triggerSource,
      status: "RUNNING",
    })
    .select()
    .maybeSingle();

  if (insertError || !insertedRun) {
    // UNIQUE 충돌 또는 기존 Run 존재 확인
    const { data: existingRun } = await deps.db
      .from("daily_conversation_qa_runs")
      .select()
      .eq("execution_key", window.executionKey)
      .maybeSingle();

    // 리뷰 지적(2026-08-19 MAJOR): 앞 실행이 크래시하면 Run 이 RUNNING 으로 남고,
    // 그 뒤로는 같은 window 가 영구히 재실행되지 않는다. 관리자가 "지금 다시 점검" 을
    // 눌러도 그 RUNNING 을 그대로 돌려주기만 한다 — 탈출 경로가 없었다.
    //
    // 일정 시간을 넘긴 RUNNING 은 죽은 것으로 본다. FAILED 로 마감하고 이 실행이 이어받는다.
    // 시간을 넉넉히 두는 이유: 정상 실행이 아직 도는 중인데 빼앗으면 같은 window 를
    // 두 프로세스가 동시에 분석한다. 하루 한 번 도는 배치라 넉넉해도 손해가 없다.
    if (existingRun && existingRun.status === "RUNNING") {
      const startedAtMs = existingRun.started_at ? new Date(existingRun.started_at).getTime() : NaN;
      const ageMs = Number.isNaN(startedAtMs) ? Infinity : new Date(deps.nowIso).getTime() - startedAtMs;
      if (ageMs > STALE_RUNNING_MS) {
        await deps.db
          .from("daily_conversation_qa_runs")
          .update({
            status: "FAILED",
            error_summary: "이전 실행이 응답 없이 중단됐다(stale RUNNING). 이 실행이 이어받는다.",
            completed_at: deps.nowIso,
          })
          .eq("id", existingRun.id);
        // 같은 execution_key 를 재사용한다 — 새 Run 을 만들면 UNIQUE 에 다시 걸린다.
        // 이 Run 을 RUNNING 으로 되돌려 이어서 분석한다.
        await deps.db
          .from("daily_conversation_qa_runs")
          .update({
            status: "RUNNING",
            trigger_source: deps.triggerSource,
            started_at: deps.nowIso,
            completed_at: null,
            error_summary: null,
          })
          .eq("id", existingRun.id);
        runId = existingRun.id;
      }
    }

    if (existingRun && runId === null) {
      return {
        runId: existingRun.id,
        executionKey: existingRun.execution_key,
        businessDate: existingRun.business_date,
        status: existingRun.status,
        isExistingRun: true,
        totalChildren: existingRun.total_children ?? 0,
        totalSessions: existingRun.total_sessions ?? 0,
        missionSessions: existingRun.mission_sessions ?? 0,
        freeChatSessions: existingRun.free_chat_sessions ?? 0,
        analyzedSessions: existingRun.analyzed_sessions ?? 0,
        skippedTestSessions: existingRun.skipped_test_sessions ?? 0,
        totalMessages: existingRun.total_messages ?? 0,
        analyzedMessages: existingRun.analyzed_messages ?? 0,
        issueCount: existingRun.issue_count ?? 0,
        blockerCount: existingRun.blocker_count ?? 0,
        highCount: existingRun.high_count ?? 0,
        mediumCount: existingRun.medium_count ?? 0,
        lowCount: existingRun.low_count ?? 0,
        failedSessionCount: existingRun.failed_session_count ?? 0,
        errorSummary: existingRun.error_summary ?? null,
      };
    }
  }

  if (runId === null) runId = insertedRun?.id ?? null;

  try {
    if (!runId) {
      throw new Error(`Failed to initialize Run record for execution key: ${window.executionKey}`);
    }

    // 2. window 안의 chat_messages 조회 (deleted_at is null 필수)
    const { data: rawMessages, error: msgError } = await deps.db
      .from("chat_messages")
      .select("id, session_id, role, content, raw_transcript, mode, created_at, deleted_at")
      .gte("created_at", window.windowStart)
      .lt("created_at", window.windowEnd)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (msgError) {
      throw new Error(`Failed to query chat_messages: ${msgError.message}`);
    }

    const messages = rawMessages ?? [];
    const rawSessionIds = Array.from(new Set(messages.map((m) => m.session_id).filter(Boolean)));

    // 3. chat_sessions 조회 (child_id, session_type)
    let sessions: Array<{ id: string; child_id: string; session_type: string | null }> = [];
    if (rawSessionIds.length > 0) {
      const { data: sessionRows, error: sessionErr } = await deps.db
        .from("chat_sessions")
        .select("id, child_id, session_type")
        .in("id", rawSessionIds);

      if (sessionErr) {
        throw new Error(`Failed to query chat_sessions: ${sessionErr.message}`);
      }
      sessions = sessionRows ?? [];
    }

    const sessionById = new Map<string, { id: string; child_id: string; session_type: string | null }>();
    for (const s of sessions) {
      sessionById.set(s.id, s);
    }

    const rawChildIds = Array.from(new Set(sessions.map((s) => s.child_id).filter(Boolean)));

    // 4. child_profiles 조회 및 테스트 계정 필터링(§3-26)
    // is_test_account 또는 is_internal_test 가 true인 계정은 분석에서 제외한다.
    let children: Array<{ id: string; is_test_account?: boolean | null; is_internal_test?: boolean | null }> = [];
    if (rawChildIds.length > 0) {
      const { data: childRows, error: childErr } = await deps.db
        .from("child_profiles")
        .select("id, is_test_account, is_internal_test")
        .in("id", rawChildIds);

      if (childErr) {
        throw new Error(`Failed to query child_profiles: ${childErr.message}`);
      }
      children = childRows ?? [];
    }

    const testChildIdSet = new Set<string>();
    for (const c of children) {
      if (c.is_test_account === true || c.is_internal_test === true) {
        testChildIdSet.add(c.id);
      }
    }

    // 세션별 메타데이터 및 테스트 여부 분류
    let skippedTestSessions = 0;
    const validSessionIds = new Set<string>();
    const sessionModeMap = new Map<string, "mission" | "free_chat">();
    const sessionChildMap = new Map<string, string>();

    for (const s of sessions) {
      if (testChildIdSet.has(s.child_id)) {
        skippedTestSessions++;
      } else {
        validSessionIds.add(s.id);
        const mode: "mission" | "free_chat" = s.session_type === "mission" ? "mission" : "free_chat";
        sessionModeMap.set(s.id, mode);
        sessionChildMap.set(s.id, s.child_id);
      }
    }

    // 5. 분석 대상 DailyQaMessage 구성 (테스트 계정 세션 제외)
    const sessionMessagesMap = new Map<string, DailyQaMessage[]>();
    for (const sId of validSessionIds) {
      sessionMessagesMap.set(sId, []);
    }

    let totalMessages = messages.length;
    let analyzedMessagesCount = 0;

    for (const m of messages) {
      if (!validSessionIds.has(m.session_id)) continue;

      const sessionMode = sessionModeMap.get(m.session_id) ?? "free_chat";
      const messageMode: "mission" | "free_chat" =
        m.mode === "mission" ? "mission" : sessionMode;
      const childId = sessionChildMap.get(m.session_id) ?? "unknown";

      const dailyMsg: DailyQaMessage = {
        id: m.id,
        sessionId: m.session_id,
        childId,
        role: m.role as "child" | "k",
        content: m.content,
        rawTranscript: m.raw_transcript ?? null,
        mode: messageMode,
        createdAt: m.created_at,
      };

      sessionMessagesMap.get(m.session_id)?.push(dailyMsg);
    }

    // 6. 세션별 격리 분석 (일부 세션 실패 시 status='PARTIAL' 처리, §3-22)
    let failedSessionCount = 0;
    const sessionErrors: string[] = [];
    const confirmedDetections: DailyQaDetection[] = [];
    let analyzedSessionsCount = 0;
    let missionSessionsCount = 0;
    let freeChatSessionsCount = 0;
    let hybridSkippedReason: string | undefined = undefined;

    for (const [sessionId, sessionMsgs] of sessionMessagesMap.entries()) {
      try {
        const firstMsg = sessionMsgs[0];
        const sMode = firstMsg?.mode ?? sessionModeMap.get(sessionId) ?? "free_chat";
        if (sMode === "mission") {
          missionSessionsCount++;
        } else {
          freeChatSessionsCount++;
        }

        analyzedSessionsCount++;
        analyzedMessagesCount += sessionMsgs.length;

        if (sessionMsgs.length === 0) continue;

        // 1차 규칙 기반 탐지
        const detections = runRuleDetectors(sessionMsgs, window.windowEnd);

        // 2차 HYBRID 판정 처리 (§3-7, §3-8)
        let hasHybridCandidate = false;
        for (const detection of detections) {
          if (HYBRID_TAXONOMY_CODES.includes(detection.taxonomyCode)) {
            hasHybridCandidate = true;
            if (deps.judge) {
              const taxonomy = findDailyQaTaxonomy(detection.taxonomyCode);
              const ctx = buildJudgeContext(detection.taxonomyCode, sessionMsgs, detection.messageId);
              if (ctx) {
                const prompt = buildJudgePrompt(ctx, taxonomy?.description ?? detection.taxonomyCode);
                const judgeRaw = await deps.judge(prompt);
                const verdict = parseJudgeResponse(judgeRaw);
                if (verdict.verdict === "CONFIRMED" || verdict.verdict === "LIKELY") {
                  confirmedDetections.push(detection);
                }
                // FALSE_POSITIVE 는 버린다
              }
            } else {
              hybridSkippedReason = "no_judge_provided";
            }
          } else {
            confirmedDetections.push(detection);
          }
        }

        if (!hasHybridCandidate && !hybridSkippedReason) {
          hybridSkippedReason = "no_hybrid_candidates_in_rule_detectors";
        }
      } catch (sessionErr: any) {
        failedSessionCount++;
        sessionErrors.push(`Session ${sessionId}: ${sessionErr?.message || String(sessionErr)}`);
      }
    }

    // 7. 이슈 집계 및 trend_status 계산 (§3-4, §3-11, §3-12)
    let issueDrafts: DailyQaIssueDraft[] = aggregateDetections(confirmedDetections);

    // 어제 Run 정보 조회
    const yesterdayBusinessDate = offsetCalendarDate(window.businessDate, -1);
    const { data: yesterdayRun } = await deps.db
      .from("daily_conversation_qa_runs")
      .select("id, analyzed_sessions")
      .eq("business_date", yesterdayBusinessDate)
      .in("status", ["SUCCESS", "PARTIAL"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const yesterdayIssuesMap = new Map<string, { event_count: number; affected_sessions_count: number }>();
    if (yesterdayRun?.id) {
      const { data: yesterdayIssues } = await deps.db
        .from("daily_conversation_qa_issues")
        .select("taxonomy_code, event_count, affected_sessions_count")
        .eq("run_id", yesterdayRun.id);

      if (yesterdayIssues) {
        for (const issue of yesterdayIssues) {
          yesterdayIssuesMap.set(issue.taxonomy_code, {
            event_count: issue.event_count,
            affected_sessions_count: issue.affected_sessions_count,
          });
        }
      }
    }

    const trendStatusMap = new Map<string, string>();
    const prevEventCountMap = new Map<string, number | null>();
    const prevAffectedSessionsMap = new Map<string, number | null>();

    for (const draft of issueDrafts) {
      let prevEventCount: number | null = null;
      let prevAffectedSessions: number | null = null;
      let prevAnalyzedSessions: number | null = null;

      if (yesterdayRun) {
        prevAnalyzedSessions = yesterdayRun.analyzed_sessions ?? null;
        const yIssue = yesterdayIssuesMap.get(draft.taxonomyCode);
        if (yIssue) {
          prevEventCount = yIssue.event_count;
          prevAffectedSessions = yIssue.affected_sessions_count;
        } else {
          // 어제 Run 은 있었으나 해당 taxonomy 는 발생하지 않음 (0건)
          prevEventCount = 0;
          prevAffectedSessions = 0;
        }
      } else {
        // 어제 Run 자체가 없음 (null)
        prevEventCount = null;
        prevAffectedSessions = null;
        prevAnalyzedSessions = null;
      }

      // 어제 이전 발생 이력 확인 (hadHistoryBeforeYesterday)
      const { count: pastCount } = await deps.db
        .from("daily_conversation_qa_issues")
        .select("id", { count: "exact", head: true })
        .eq("taxonomy_code", draft.taxonomyCode)
        .lt("business_date", yesterdayBusinessDate);

      const hadHistoryBeforeYesterday = (pastCount ?? 0) > 0;

      const trendStatus = resolveTrendStatus({
        eventCount: draft.eventCount,
        prevEventCount,
        hadHistoryBeforeYesterday,
        analyzedSessions: analyzedSessionsCount,
        prevAnalyzedSessions,
      });

      // trendStatus 가 null 이면 보고할 문제가 아니다 — 과거에도 없었고 오늘도 0건.
      // 이슈 행을 만들지 않는다(리뷰 지적, 2026-08-19).
      if (trendStatus === null) continue;

      trendStatusMap.set(draft.taxonomyCode, trendStatus);
      prevEventCountMap.set(draft.taxonomyCode, prevEventCount);
      prevAffectedSessionsMap.set(draft.taxonomyCode, prevAffectedSessions);
    }

    // trendStatus 가 없는 draft 는 저장 대상에서 뺀다.
    issueDrafts = issueDrafts.filter((draft) => trendStatusMap.has(draft.taxonomyCode));

    // 8. daily_conversation_qa_issues 저장 (UPSERT)
    if (issueDrafts.length > 0) {
      const issueRows = issueDrafts.map((draft) => ({
        run_id: runId,
        business_date: window.businessDate,
        taxonomy_code: draft.taxonomyCode,
        severity: draft.severity,
        trend_status: trendStatusMap.get(draft.taxonomyCode) ?? "NEW",
        title: draft.title,
        summary: draft.title,
        event_count: draft.eventCount,
        affected_children_count: draft.affectedChildrenCount,
        affected_sessions_count: draft.affectedSessionsCount,
        analyzed_sessions: analyzedSessionsCount,
        prev_event_count: prevEventCountMap.get(draft.taxonomyCode) ?? null,
        prev_affected_sessions: prevAffectedSessionsMap.get(draft.taxonomyCode) ?? null,
        first_detected_at: draft.firstDetectedAt,
        last_detected_at: draft.lastDetectedAt,
        representative_examples: draft.representativeExamples,
        session_ids: draft.sessionIds,
        message_ids: draft.messageIds,
        root_cause_hint: null,
      }));

      const { error: upsertErr } = await deps.db
        .from("daily_conversation_qa_issues")
        .upsert(issueRows, { onConflict: "run_id,taxonomy_code" });

      if (upsertErr) {
        throw new Error(`Failed to upsert daily_conversation_qa_issues: ${upsertErr.message}`);
      }
    }

    // 9. Run 마감 및 상태 결정 (§3-22)
    let finalStatus: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";
    if (validSessionIds.size > 0 && analyzedSessionsCount === 0 && failedSessionCount > 0) {
      finalStatus = "FAILED";
    } else if (failedSessionCount > 0) {
      finalStatus = "PARTIAL";
    }

    const blockerCount = issueDrafts.filter((i) => i.severity === "BLOCKER").length;
    const highCount = issueDrafts.filter((i) => i.severity === "HIGH").length;
    const mediumCount = issueDrafts.filter((i) => i.severity === "MEDIUM").length;
    const lowCount = issueDrafts.filter((i) => i.severity === "LOW").length;
    const errorSummary = sessionErrors.length > 0 ? sessionErrors.join("\n").slice(0, 1000) : null;

    const totalChildrenCount = rawChildIds.length;
    const totalSessionsCount = rawSessionIds.length;

    await deps.db
      .from("daily_conversation_qa_runs")
      .update({
        status: finalStatus,
        total_children: totalChildrenCount,
        total_sessions: totalSessionsCount,
        mission_sessions: missionSessionsCount,
        free_chat_sessions: freeChatSessionsCount,
        analyzed_sessions: analyzedSessionsCount,
        skipped_test_sessions: skippedTestSessions,
        total_messages: totalMessages,
        analyzed_messages: analyzedMessagesCount,
        issue_count: issueDrafts.length,
        blocker_count: blockerCount,
        high_count: highCount,
        medium_count: mediumCount,
        low_count: lowCount,
        failed_session_count: failedSessionCount,
        error_summary: errorSummary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      runId,
      executionKey: window.executionKey,
      businessDate: window.businessDate,
      status: finalStatus,
      isExistingRun: false,
      totalChildren: totalChildrenCount,
      totalSessions: totalSessionsCount,
      missionSessions: missionSessionsCount,
      freeChatSessions: freeChatSessionsCount,
      analyzedSessions: analyzedSessionsCount,
      skippedTestSessions,
      totalMessages,
      analyzedMessages: analyzedMessagesCount,
      issueCount: issueDrafts.length,
      blockerCount,
      highCount,
      mediumCount,
      lowCount,
      failedSessionCount,
      errorSummary,
      hybridSkippedReason,
    };
  } catch (err: any) {
    // 전체 예외 발생 시 RUNNING 으로 남지 않도록 FAILED 로 마감 (§3-22)
    const errorMsg = err?.message || String(err);
    if (runId) {
      try {
        await deps.db
          .from("daily_conversation_qa_runs")
          .update({
            status: "FAILED",
            error_summary: errorMsg.slice(0, 1000),
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      } catch {
        // DB 연결 실패 시 추가 무시
      }
    }

    return {
      runId: runId ?? "failed_before_init",
      executionKey: window.executionKey,
      businessDate: window.businessDate,
      status: "FAILED",
      isExistingRun: false,
      totalChildren: 0,
      totalSessions: 0,
      missionSessions: 0,
      freeChatSessions: 0,
      analyzedSessions: 0,
      skippedTestSessions: 0,
      totalMessages: 0,
      analyzedMessages: 0,
      issueCount: 0,
      blockerCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      failedSessionCount: 0,
      errorSummary: errorMsg,
    };
  }
}
