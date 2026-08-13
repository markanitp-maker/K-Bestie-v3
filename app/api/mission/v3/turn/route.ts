import { NextRequest, NextResponse } from "next/server";

import { createGenAIClient } from "@/app/api/_lib/ai";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import {
  checkSafetyPreflight,
  type EngineOutput,
  type GenerateArgs,
} from "@/lib/k-conversation";
import {
  assessBoredom,
  resolveBoredomAssessment,
  type BoredomAssessment,
} from "@/lib/k-conversation/boredomDetection";
import { fetchSameSessionTurns } from "@/lib/k-conversation/memory/sameSession";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { assessGoalsFromUtterance } from "@/lib/mission-v3/goalAssessor";
import { hasMissionGoalThreshold, type GoalAssessment } from "@/lib/mission-v3/goalEngine";
import { respondToMissionTurn } from "@/lib/mission-v3/missionAdapter";
import { awardMissionV3Reward } from "@/lib/mission-v3/rewardPolicy";
import {
  buildCompletionKMessage,
  buildGoalProgress,
  fetchMissionGoals,
  fetchRecentMissionHistory,
  loadMissionPromptGoals,
  parseStoredGoalAssessments,
} from "@/lib/mission-v3/routeSupport";
import { isMissionSafetyLockEnabled } from "@/lib/mission/missionSafetyLockFlag";
import { getEffectiveContentGrade, parseGrade } from "@/lib/mission/selectQuestions";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface TurnBody {
  sessionId?: string;
  clientTurnId?: string;
  answerText?: string;
  voiceMode?: "live" | "stt_tts";
  displaySequence?: number;
}

interface StartTurnRpcRow {
  turn_status: string;
  answer_result: unknown;
  k_response_draft: string | null;
  previous_prompted_goal_id: string | null;
  prompted_goal_id: string | null;
  engine_category: EngineOutput["category"] | null;
  safety_subcategory: string | null;
  boredom_early_finish: boolean;
  already_processed: boolean;
}

interface MarkAssessedRpcRow {
  turn_status: string;
  already_assessed: boolean;
}

interface StoreOutputRpcRow {
  k_response_draft: string;
  prompted_goal_id: string | null;
  engine_category: EngineOutput["category"];
  safety_subcategory: string | null;
  boredom_early_finish: boolean;
  already_stored: boolean;
}

interface FinalizeTurnRpcRow {
  progress_status: string;
  k_response: string;
  prompted_goal_id: string | null;
  safety_paused: boolean;
  early_ended: boolean;
  already_finalized: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(["COMPLETED", "SAFETY_PAUSED", "FORCE_ENDED"]);

const firstRow = <T,>(value: T | T[] | null): T | null => (
  Array.isArray(value) ? value[0] ?? null : value
);

const computeBoredomIndependently = async (
  service: ReturnType<typeof createServiceClient>,
  childId: string,
  sessionId: string,
): Promise<BoredomAssessment> => {
  try {
    const turns = await fetchSameSessionTurns(service, childId, sessionId);
    return assessBoredom(
      turns.filter((turn) => turn.role === "child").map((turn) => turn.content),
    );
  } catch (error) {
    console.error("[mission/v3/turn] same-session boredom lookup failed", error);
    return assessBoredom([]);
  }
};

const fetchTurnRecord = async (
  service: ReturnType<typeof createServiceClient>,
  sessionId: string,
  clientTurnId: string,
) => {
  const { data, error } = await service
    .from("mission_turns")
    .select(
      "status, child_message_id, k_message_id, answer_result, k_response_draft, previous_prompted_goal_id, prompted_goal_id, engine_category, safety_subcategory, boredom_early_finish",
    )
    .eq("session_id", sessionId)
    .eq("client_turn_id", clientTurnId)
    .maybeSingle();
  if (error) throw new Error(`Mission turn 조회 실패: ${error.message}`);
  return data;
};

const resolveCompletedRewardStatus = async (
  service: ReturnType<typeof createServiceClient>,
  sessionId: string,
): Promise<string> => {
  const { data, error } = await service
    .from("gold_key_ledger")
    .select("id")
    .eq("source_session_id", sessionId)
    .eq("reward_type", "mission_v3_complete")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[mission/v3/turn] 기존 보상 조회 실패", error.message);
    return "already_completed";
  }
  return data ? "already_rewarded" : "completed_without_reward";
};

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: TurnBody;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    body = parsed as TurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const clientTurnId = typeof body.clientTurnId === "string" ? body.clientTurnId.trim() : "";
  const answerText = typeof body.answerText === "string" ? body.answerText.trim() : "";
  if (!UUID_PATTERN.test(sessionId)
    || !clientTurnId
    || clientTurnId.length > 200
    || !answerText
    || (body.answerText?.length ?? 0) > 500
    || (body.voiceMode !== "live" && body.voiceMode !== "stt_tts")
    || !Number.isSafeInteger(body.displaySequence)
    || (body.displaySequence ?? -1) < 0
    || (body.displaySequence ?? Number.MAX_SAFE_INTEGER) >= Number.MAX_SAFE_INTEGER) {
    return NextResponse.json({ error: "Invalid turn payload" }, { status: 400 });
  }

  const displaySequence = body.displaySequence as number;
  const service = createServiceClient();
  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, child_id, session_type")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session || session.session_type !== "mission") {
    return NextResponse.json({ error: "Mission session not found" }, { status: 404 });
  }

  const access = await requireChildAccess(service, user.id, session.child_id);
  if (!access.allowed || access.role !== "child") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: progress, error: progressError } = await service
    .from("mission_progress")
    .select("status, business_date, round_type, mission_policy_version")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (progressError || !progress) {
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }
  if (progress.round_type !== "daily_single" || progress.mission_policy_version !== "v3_single_daily") {
    return NextResponse.json({ error: "This endpoint only serves Mission v3 sessions" }, { status: 400 });
  }

  const consentBlocked = await checkConsentForSession(sessionId);
  if (consentBlocked) return consentBlocked;
  const approvalBlocked = await checkApprovalForSession(sessionId);
  if (approvalBlocked) return approvalBlocked;

  let existingTurn;
  try {
    existingTurn = await fetchTurnRecord(service, sessionId, clientTurnId);
  } catch (error) {
    console.error("[mission/v3/turn] 기존 턴 조회 실패", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
  if (TERMINAL_STATUSES.has(progress.status ?? "") && !existingTurn) {
    return NextResponse.json({
      error: progress.status === "COMPLETED" ? "Mission is already completed" : "Mission is not active",
      status: progress.status,
    }, { status: 423 });
  }

  const { data: startData, error: startError } = await service.rpc("start_mission_turn_v3", {
    p_session_id: sessionId,
    p_client_turn_id: clientTurnId,
    p_answer_text: answerText,
    p_voice_mode: body.voiceMode,
    p_display_sequence: displaySequence,
  });
  if (startError) {
    console.error("[mission/v3/turn] 아이 발화 저장 실패", {
      sessionId,
      clientTurnId,
      code: startError.code,
      message: startError.message,
    });
    if (startError.code === "55000") {
      const { data: latest } = await service
        .from("mission_progress")
        .select("status")
        .eq("session_id", sessionId)
        .maybeSingle();
      return NextResponse.json({
        error: "다른 턴을 처리 중이거나 미션이 종료되었어요.",
        code: "MISSION_TURN_BLOCKED",
        status: latest?.status ?? null,
      }, { status: 423 });
    }
    const conflict = startError.code === "22023" || startError.code === "23505";
    return NextResponse.json({
      error: conflict ? "같은 턴의 요청 내용이 달라요." : "대화를 저장하지 못했어요.",
      code: conflict ? "TURN_PAYLOAD_CONFLICT" : "TURN_START_FAILED",
    }, { status: conflict ? 409 : 503 });
  }

  const started = firstRow(startData as StartTurnRpcRow[] | null);
  if (!started) {
    return NextResponse.json({ error: "턴 저장 결과가 비어 있어요." }, { status: 503 });
  }
  if (started.already_processed
    && started.turn_status !== "FINALIZED"
    && !started.k_response_draft) {
    return NextResponse.json({
      error: "같은 턴을 처리하고 있어요. 잠시 후 다시 시도해 주세요.",
      code: "TURN_IN_PROGRESS",
    }, { status: 409 });
  }

  let turnRecord;
  try {
    turnRecord = await fetchTurnRecord(service, sessionId, clientTurnId);
  } catch (error) {
    console.error("[mission/v3/turn] 저장된 턴 재조회 실패", error);
    return NextResponse.json({ error: "저장된 대화를 불러오지 못했어요." }, { status: 500 });
  }
  if (!turnRecord?.child_message_id) {
    return NextResponse.json({ error: "저장된 아이 발화를 찾지 못했어요." }, { status: 500 });
  }

  let outputStoredByAnotherRequest = false;
  if (!started.k_response_draft && started.turn_status !== "FINALIZED") {
    // Safety must run before the Goal assessor or any generative model. The
    // v3 finalizer records the event and SAFETY_PAUSED transition atomically.
    const safetyLockEnabled = isMissionSafetyLockEnabled();
    const safetyOutput = await checkSafetyPreflight(service, sessionId, answerText, {
      persistEvent: !safetyLockEnabled,
      childId: session.child_id,
      mode: "MISSION",
    });

    let engineOutput: EngineOutput;
    let promptedGoalId: string | null = null;

    if (safetyOutput) {
      if (started.answer_result === null) {
        const { data: markData, error: markError } = await service.rpc("mark_mission_turn_v3_assessed", {
          p_session_id: sessionId,
          p_client_turn_id: clientTurnId,
          p_goal_assessments: [],
        });
        const marked = firstRow(markData as MarkAssessedRpcRow[] | null);
        if (markError || !marked) {
          console.error("[mission/v3/turn] 안전 턴 판정 상태 저장 실패", markError?.message);
          return NextResponse.json({ error: "안전 응답을 저장하지 못했어요." }, { status: 503 });
        }
      }
      engineOutput = safetyOutput;
    } else {
      const { data: childProfile, error: childError } = await service
        .from("child_profiles")
        .select("grade")
        .eq("id", session.child_id)
        .maybeSingle();
      const realGrade = parseGrade(childProfile?.grade);
      if (childError || realGrade === null || realGrade < 1 || realGrade > 7) {
        return NextResponse.json({ error: "아이 학년 정보를 확인하지 못했어요." }, { status: 500 });
      }

      let promptGoals;
      try {
        const goals = await fetchMissionGoals(service, sessionId);
        const openGoals = goals.filter((goal) => goal.status === "PENDING" || goal.status === "PARTIAL");
        promptGoals = await loadMissionPromptGoals({
          db: service,
          childId: session.child_id,
          grade: getEffectiveContentGrade(realGrade),
          goals: openGoals,
        });
      } catch (error) {
        console.error("[mission/v3/turn] 열린 Goal 복원 실패", error);
        return NextResponse.json({ error: "미션 대화 목표를 불러오지 못했어요." }, { status: 500 });
      }

      let recentHistory: Array<{ role: "child" | "k"; text: string }> = [];
      try {
        const [historyResult] = await Promise.allSettled([
          fetchRecentMissionHistory({
            db: service,
            sessionId,
            currentTurnId: clientTurnId,
          }),
        ]);
        if (historyResult.status === "fulfilled") {
          recentHistory = historyResult.value;
        } else {
          console.error("[mission/v3/turn] 최근 미션 히스토리 조회 실패", historyResult.reason);
        }
      } catch (error) {
        console.error("[mission/v3/turn] 최근 미션 히스토리 조회 예외", error);
      }
      const lazyAi: GenerateArgs["ai"] = {
        models: {
          generateContent: (params) => createGenAIClient({ provider: "vertex" }).models.generateContent(params),
        },
      };

      let assessments: GoalAssessment[];
      if (started.answer_result !== null) {
        try {
          assessments = parseStoredGoalAssessments(started.answer_result, promptGoals);
        } catch (error) {
          console.error("[mission/v3/turn] 저장된 Goal 판정 복원 실패", error);
          return NextResponse.json({ error: "저장된 Goal 판정을 불러오지 못했어요." }, { status: 500 });
        }
      } else {
        assessments = await assessGoalsFromUtterance({
          ai: lazyAi,
          modelId: getLlmModel("childAnswerClassification"),
          currentUtterance: answerText,
          recentHistory,
          goals: promptGoals,
        });

        const { data: markData, error: markError } = await service.rpc("mark_mission_turn_v3_assessed", {
          p_session_id: sessionId,
          p_client_turn_id: clientTurnId,
          p_goal_assessments: assessments,
        });
        if (markError) {
          console.error("[mission/v3/turn] Goal 판정 저장 실패", markError.message);
          return NextResponse.json({ error: "Goal 판정을 저장하지 못했어요." }, { status: 503 });
        }
        const marked = firstRow(markData as MarkAssessedRpcRow[] | null);
        if (!marked) {
          return NextResponse.json({ error: "Goal 판정 저장 결과가 비어 있어요." }, { status: 503 });
        }
        if (marked.already_assessed) {
          const firstWriterTurn = await fetchTurnRecord(service, sessionId, clientTurnId);
          try {
            assessments = parseStoredGoalAssessments(firstWriterTurn?.answer_result, promptGoals);
          } catch (error) {
            console.error("[mission/v3/turn] 최초 Goal 판정 복원 실패", error);
            return NextResponse.json({ error: "최초 Goal 판정을 불러오지 못했어요." }, { status: 500 });
          }
        }
      }

      try {
        const adapterResult = await respondToMissionTurn({
          db: service,
          ai: lazyAi,
          modelId: getLlmModel("missionGeneral"),
          childId: session.child_id,
          sessionId,
          currentUtterance: answerText,
          sourceTurnId: turnRecord.child_message_id,
          goals: promptGoals,
          assessments,
          previousPromptedGoalId: started.previous_prompted_goal_id,
        });
        engineOutput = adapterResult.engineOutput;
        promptedGoalId = adapterResult.promptedGoalId;
      } catch (error) {
        console.error("[mission/v3/turn] 케이 응답 생성 실패", error);
        return NextResponse.json({ error: "케이 응답을 만들지 못했어요." }, { status: 503 });
      }
    }

    const generatedKMessage = engineOutput.text.trim();
    const boredomEarlyFinish = engineOutput.category === "safety"
      ? false
      : (await resolveBoredomAssessment(
        engineOutput.boredom,
        () => computeBoredomIndependently(service, session.child_id, sessionId),
      )).suggestedAdjustment?.allowEarlyFinish === true;
    const storedEngineCategory = (!safetyLockEnabled && engineOutput.category === "safety")
      ? "deterministic"
      : engineOutput.category;
    const { data: storeData, error: storeError } = await service.rpc("store_mission_turn_v3_output", {
      p_session_id: sessionId,
      p_client_turn_id: clientTurnId,
      p_k_response_draft: generatedKMessage,
      p_prompted_goal_id: promptedGoalId,
      p_engine_category: storedEngineCategory,
      p_safety_subcategory: engineOutput.safetySubcategory ?? null,
      p_boredom_early_finish: boredomEarlyFinish,
    });
    if (storeError) {
      console.error("[mission/v3/turn] 케이 응답 초안 저장 실패", storeError.message);
      return NextResponse.json({ error: "케이 응답을 저장하지 못했어요." }, { status: 503 });
    }
    const stored = firstRow(storeData as StoreOutputRpcRow[] | null);
    if (!stored) {
      return NextResponse.json({ error: "케이 응답 저장 결과가 비어 있어요." }, { status: 503 });
    }
    outputStoredByAnotherRequest = stored.already_stored;
  }

  const { data: finalizeData, error: finalizeError } = await service.rpc("finalize_mission_turn_v3", {
    p_session_id: sessionId,
    p_client_turn_id: clientTurnId,
    p_k_display_sequence: displaySequence + 1,
  });
  if (finalizeError) {
    console.error("[mission/v3/turn] v3 턴 원자적 마무리 실패", finalizeError.message);
    return NextResponse.json({ error: "대화를 마무리하지 못했어요." }, { status: 503 });
  }
  const finalized = firstRow(finalizeData as FinalizeTurnRpcRow[] | null);
  if (!finalized?.k_response?.trim()) {
    return NextResponse.json({ error: "턴 마무리 결과가 비어 있어요." }, { status: 503 });
  }

  let updatedGoals;
  try {
    updatedGoals = await fetchMissionGoals(service, sessionId);
  } catch (error) {
    console.error("[mission/v3/turn] 갱신 Goal 조회 실패", error);
    return NextResponse.json({ error: "Goal 진행상태를 불러오지 못했어요." }, { status: 500 });
  }

  const { data: latestProgress, error: latestProgressError } = await service
    .from("mission_progress")
    .select("status, business_date")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (latestProgressError || !latestProgress) {
    return NextResponse.json({ error: "미션 완료 상태를 확인하지 못했어요." }, { status: 500 });
  }

  let rewardStatus = "none";
  if (hasMissionGoalThreshold(updatedGoals) && latestProgress.status === "IN_PROGRESS") {
    try {
      const reward = await awardMissionV3Reward({
        db: service,
        childId: session.child_id,
        sourceSessionId: sessionId,
        businessDate: latestProgress.business_date,
        goals: updatedGoals,
      });
      rewardStatus = reward.rewarded ? "awarded" : reward.reason;
    } catch (error) {
      console.error("[mission/v3/turn] 완료 보상 지급 실패", error);
      return NextResponse.json({ error: "미션 완료 보상을 처리하지 못했어요." }, { status: 503 });
    }
  } else if (latestProgress.status === "COMPLETED") {
    rewardStatus = await resolveCompletedRewardStatus(service, sessionId);
  }

  const { data: finalProgress, error: finalProgressError } = await service
    .from("mission_progress")
    .select("status")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (finalProgressError || !finalProgress) {
    return NextResponse.json({ error: "최종 미션 상태를 확인하지 못했어요." }, { status: 500 });
  }

  let finalKMessage = finalized.k_response;
  if (finalProgress.status === "COMPLETED") {
    finalKMessage = buildCompletionKMessage(finalized.k_response);
    try {
      await service
        .from("chat_messages")
        .update({ content: finalKMessage })
        .eq("session_id", sessionId)
        .eq("turn_id", `${clientTurnId}:k`)
        .eq("role", "k");
      await service
        .from("mission_turns")
        .update({ k_response_draft: finalKMessage })
        .eq("session_id", sessionId)
        .eq("client_turn_id", clientTurnId);
    } catch (e) {
      console.error("[mission/v3/turn] 마무리 멘트 DB 업데이트 실패", e);
    }
  }

  return NextResponse.json({
    kMessage: finalKMessage,
    status: finalProgress.status,
    completed: finalProgress.status === "COMPLETED",
    safetyPaused: finalProgress.status === "SAFETY_PAUSED",
    earlyEnded: finalized.early_ended || (
      finalProgress.status === "FORCE_ENDED" && started.boredom_early_finish
    ),
    rewardStatus,
    goalProgress: buildGoalProgress(updatedGoals),
    replayed:
      started.already_processed || outputStoredByAnotherRequest || finalized.already_finalized,
  });
}
