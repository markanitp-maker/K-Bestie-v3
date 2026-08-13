import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { POST as processMissionAnswer } from "@/app/api/mission/answer/route";
import {
  classifyServerTurnSnapshot,
  extractMissionTurnRecoveryState,
  type MissionMessageRecord,
  type MissionProgressRecord,
  type MissionTurnRecord,
} from "@/lib/mission/serverTurnReconciliation";

export const runtime = "nodejs";

type StartBody = {
  action: "start";
  sessionId: string;
  clientTurnId: string;
  questionId: string;
  answerText: string;
  voiceMode: "live" | "stt_tts";
  displaySequence: number;
};

type FinalizeBody = {
  action: "finalize";
  sessionId: string;
  clientTurnId: string;
  kTurnId: string;
  kContent: string;
  kDisplaySequence: number;
  isClarification?: boolean;
};

type TurnBody = StartBody | FinalizeBody;

function telemetry(eventType: string, fields: Record<string, unknown>): void {
  console.log("[mission/turn]", { eventType, timestamp: new Date().toISOString(), ...fields });
}

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function pendingCompletionResult(result: Record<string, unknown>) {
  return {
    ...result,
    completionCandidate: result.completed === true,
    completed: false,
    newlyCompleted: false,
    rewardStatus: "pending_finalization",
  };
}

async function authorize(req: NextRequest, sessionId: string) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const service = createServiceClient();
  const { data: session, error } = await service
    .from("chat_sessions")
    .select("id, child_id, session_type")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session || session.session_type !== "mission") {
    return { response: NextResponse.json({ error: "Mission session not found" }, { status: 404 }) };
  }

  const access = await requireChildAccess(service, user.id, session.child_id);
  if (!access.allowed || access.role !== "child") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { service, childId: session.child_id };
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  const clientTurnId = req.nextUrl.searchParams.get("clientTurnId")?.trim() ?? "";
  const questionId = req.nextUrl.searchParams.get("questionId")?.trim() ?? "";
  if (!sessionId || !clientTurnId || !questionId || clientTurnId.length > 200) {
    return NextResponse.json({ error: "sessionId, clientTurnId, questionId required" }, { status: 400 });
  }

  const auth = await authorize(req, sessionId);
  if ("response" in auth) return auth.response;
  const { service, childId } = auth;

  const results = await Promise.allSettled([
    service
      .from("mission_turns")
      .select("status, question_id, child_message_id, k_message_id, answer_result")
      .eq("session_id", sessionId)
      .eq("client_turn_id", clientTurnId)
      .maybeSingle(),
    service
      .from("mission_progress")
      .select("question_states")
      .eq("session_id", sessionId)
      .maybeSingle(),
    service
      .from("chat_messages")
      .select("id, turn_id, role")
      .eq("session_id", sessionId)
      .in("turn_id", [clientTurnId, `${clientTurnId}:k`]),
  ]);

  if (results.some((result) => result.status === "rejected")) {
    telemetry("TURN_RECONCILIATION_FAILED", {
      sessionId,
      clientTurnId,
      maskedChildId: childId.slice(0, 8),
      status: "query_rejected",
    });
    return NextResponse.json({ status: "unknown" }, { status: 503 });
  }

  const turnResult = results[0].status === "fulfilled" ? results[0].value : null;
  const progressResult = results[1].status === "fulfilled" ? results[1].value : null;
  const messagesResult = results[2].status === "fulfilled" ? results[2].value : null;
  if (!turnResult || !progressResult || !messagesResult || turnResult.error || progressResult.error || messagesResult.error) {
    telemetry("TURN_RECONCILIATION_FAILED", {
      sessionId,
      clientTurnId,
      maskedChildId: childId.slice(0, 8),
      status: "query_failed",
    });
    return NextResponse.json({ status: "unknown" }, { status: 503 });
  }

  const turn = turnResult.data as MissionTurnRecord | null;
  const progress = progressResult.data as MissionProgressRecord | null;
  const messages = (messagesResult.data ?? []) as MissionMessageRecord[];
  const reconciliation = classifyServerTurnSnapshot({
    clientTurnId,
    questionId,
    turn,
    progress,
    messages,
  });

  telemetry("TURN_RECONCILED", {
    sessionId,
    clientTurnId,
    maskedChildId: childId.slice(0, 8),
    ...reconciliation,
  });

  return NextResponse.json({
    status: reconciliation.status,
    recoveryState: reconciliation.status === "committed"
      ? extractMissionTurnRecoveryState(turn?.answer_result ?? null)
      : null,
  });
}

export async function POST(req: NextRequest) {
  let body: TurnBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.sessionId || !body?.clientTurnId || !body?.action) {
    return NextResponse.json({ error: "sessionId, clientTurnId, action required" }, { status: 400 });
  }

  const auth = await authorize(req, body.sessionId);
  if ("response" in auth) return auth.response;
  const { service, childId } = auth;
  const maskedChildId = childId.slice(0, 8);
  const attemptCount = Math.max(1, Number.parseInt(req.headers.get("x-mission-turn-attempt") ?? "1", 10) || 1);
  if (attemptCount > 1) {
    telemetry("TURN_RETRY", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: "retrying",
      attemptCount,
    });
  }

  if (body.action === "start") {
    if (!body.questionId || typeof body.answerText !== "string" || body.answerText.length > 500 ||
        !["live", "stt_tts"].includes(body.voiceMode)) {
      return NextResponse.json({ error: "Invalid turn payload" }, { status: 400 });
    }
    if (!Number.isSafeInteger(body.displaySequence) || body.displaySequence < 0) {
      return NextResponse.json({ error: "Invalid displaySequence" }, { status: 400 });
    }

    const active = await assertMissionSessionActive(service, body.sessionId);
    if (!active.allowed) {
      return NextResponse.json(active, { status: active.expired ? 403 : 423 });
    }

    telemetry("TURN_RECEIVED", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: "received",
    });

    // A stale/re-entered client can submit a new transcript with an already committed
    // clientTurnId. Reconcile the durable turn before invoking the strict RPC, whose
    // payload-conflict guard correctly rejects that mismatch with SQLSTATE 22023.
    const { data: existingTurn, error: existingTurnError } = await service
      .from("mission_turns")
      .select("status, question_id, answer_result")
      .eq("session_id", body.sessionId)
      .eq("client_turn_id", body.clientTurnId)
      .maybeSingle();
    if (!existingTurnError && existingTurn?.question_id === body.questionId && existingTurn.answer_result) {
      telemetry("TURN_REPLAY_RECONCILED", {
        sessionId: body.sessionId,
        clientTurnId: body.clientTurnId,
        maskedChildId,
        status: existingTurn.status,
      });
      return NextResponse.json({
        ok: true,
        replayed: true,
        serverReconciled: true,
        ...pendingCompletionResult(existingTurn.answer_result as Record<string, unknown>),
      });
    }

    const { data: startData, error: startError } = await service.rpc("start_mission_turn_v1", {
      p_session_id: body.sessionId,
      p_client_turn_id: body.clientTurnId,
      p_question_id: body.questionId,
      p_answer_text: body.answerText,
      p_voice_mode: body.voiceMode,
      p_display_sequence: body.displaySequence,
    });

    if (startError) {
      telemetry("TURN_FAILED", {
        sessionId: body.sessionId,
        clientTurnId: body.clientTurnId,
        maskedChildId,
        status: "failed",
        errorCode: startError.code ?? "CHILD_PERSIST_FAILED",
      });
      return NextResponse.json({ error: "대화를 저장하지 못했어요.", code: "TURN_START_FAILED" }, { status: 503 });
    }

    const started = firstRow(startData as Array<{
      turn_status: string;
      answer_result: Record<string, unknown> | null;
      already_processed: boolean;
    }> | null);

    telemetry("CHILD_MESSAGE_PERSISTED", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: started?.turn_status ?? "CHILD_PERSISTED",
    });
    telemetry("TURN_PROCESSING", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: "processing",
      attemptCount,
    });

    if (started?.answer_result) {
      return NextResponse.json({ ok: true, replayed: true, ...pendingCompletionResult(started.answer_result) });
    }
    if (started?.already_processed) {
      return NextResponse.json({ error: "Turn is processing", code: "TURN_IN_PROGRESS" }, { status: 409 });
    }

    const answerHeaders = new Headers(req.headers);
    answerHeaders.set("content-type", "application/json");
    answerHeaders.set("x-mission-turn-api", "1");
    const answerRequest = new NextRequest(new URL("/api/mission/answer", req.url), {
      method: "POST",
      headers: answerHeaders,
      body: JSON.stringify({
        sessionId: body.sessionId,
        questionId: body.questionId,
        answerText: body.answerText,
        childTurnId: body.clientTurnId,
      }),
    });
    const answerResponse = await processMissionAnswer(answerRequest);
    const answerResult = await answerResponse.json().catch(() => ({ error: "Invalid answer response" }));

    if (!answerResponse.ok) {
      telemetry("TURN_FAILED", {
        sessionId: body.sessionId,
        clientTurnId: body.clientTurnId,
        maskedChildId,
        status: "failed",
        errorCode: typeof answerResult?.code === "string" ? answerResult.code : "ANSWER_FAILED",
      });
      return NextResponse.json(answerResult, { status: answerResponse.status });
    }

    const { error: markError } = await service.rpc("mark_mission_turn_answered_v1", {
      p_session_id: body.sessionId,
      p_client_turn_id: body.clientTurnId,
      p_answer_result: answerResult,
    });
    if (markError) {
      telemetry("TURN_FAILED", {
        sessionId: body.sessionId,
        clientTurnId: body.clientTurnId,
        maskedChildId,
        status: "failed",
        errorCode: markError.code ?? "ANSWER_RESULT_PERSIST_FAILED",
      });
      return NextResponse.json({ error: "처리 결과를 저장하지 못했어요.", code: "ANSWER_RESULT_PERSIST_FAILED" }, { status: 503 });
    }

    telemetry("MISSION_PROGRESS_UPDATED", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: "ANSWER_PROCESSED",
    });
    return NextResponse.json({ ok: true, replayed: false, ...pendingCompletionResult(answerResult) });
  }

  if (!body.kTurnId || !body.kContent?.trim() || !Number.isSafeInteger(body.kDisplaySequence)) {
    return NextResponse.json({ error: "Invalid finalization payload" }, { status: 400 });
  }

  const { data: finalizeData, error: finalizeError } = await service.rpc("finalize_mission_turn_v1", {
    p_session_id: body.sessionId,
    p_client_turn_id: body.clientTurnId,
    p_k_content: body.kContent.trim(),
    p_k_turn_id: body.kTurnId,
    p_k_display_sequence: body.kDisplaySequence,
    p_is_clarification: body.isClarification ?? false,
  });
  if (finalizeError) {
    telemetry("TURN_FAILED", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: "failed",
      errorCode: finalizeError.code ?? "TURN_FINALIZE_FAILED",
    });
    return NextResponse.json({ error: "대화를 마무리하지 못했어요.", code: "TURN_FINALIZE_FAILED" }, { status: 503 });
  }

  const finalized = firstRow(finalizeData as Array<{
    completed: boolean;
    reward_status: string;
    already_finalized: boolean;
  }> | null);

  telemetry("TURN_FINALIZED", {
    sessionId: body.sessionId,
    clientTurnId: body.clientTurnId,
    maskedChildId,
    status: "FINALIZED",
  });
  telemetry("K_MESSAGE_PERSISTED", {
    sessionId: body.sessionId,
    clientTurnId: body.clientTurnId,
    maskedChildId,
    status: "persisted",
  });
  if (finalized?.completed) {
    telemetry("MISSION_COMPLETED", {
      sessionId: body.sessionId,
      clientTurnId: body.clientTurnId,
      maskedChildId,
      status: finalized.reward_status,
    });
    if (finalized.reward_status === "awarded" || finalized.reward_status === "already_earned") {
      telemetry("REWARD_GRANTED", {
        sessionId: body.sessionId,
        clientTurnId: body.clientTurnId,
        maskedChildId,
        status: finalized.reward_status,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    completed: finalized?.completed ?? false,
    rewardStatus: finalized?.reward_status ?? "none",
    replayed: finalized?.already_finalized ?? false,
  });
}
