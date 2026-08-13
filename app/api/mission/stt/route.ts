import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CHILD_SPEECH_HINTS, CHILD_SPEECH_HINT_BOOST } from "@/lib/stt/childSpeechHints";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { normalizeConversationMode } from "@/lib/plan/conversationMode";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";

// LINEAR16/16kHz/mono 고정 인코딩 기준 — 1초 = 16000 샘플 * 2바이트
const PCM16_BYTES_PER_SEC = 16000 * 2;

export const runtime = "nodejs";

interface SpeechResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }>;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[mission/stt] Unauthorized", { user: null });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GCP_STT_API_KEY;
  if (!apiKey) {
    console.error("[mission/stt] STT not configured", { apiKey: null });
    return NextResponse.json({ error: "STT not configured" }, { status: 500 });
  }

  let body: { audioBase64?: string; sessionId?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch (err) {
    console.error("[mission/stt] Invalid JSON", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audioBase64 = body.audioBase64;
  if (!audioBase64 || typeof audioBase64 !== "string") {
    console.error("[mission/stt] audioBase64 required", { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return NextResponse.json({ error: "audioBase64 required" }, { status: 400 });
  }
  if (!body.sessionId) {
    console.error("[mission/stt] sessionId required", { childTurnId: body.childTurnId });
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  console.log("[mission/stt] start", { sessionId: body.sessionId, childTurnId: body.childTurnId, mode: "stt_tts" });

  const consentBlocked = await checkConsentForSession(body.sessionId);
  if (consentBlocked) {
    console.error("[mission/stt] consent blocked", { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return consentBlocked;
  }

  const approvalBlocked = await checkApprovalForSession(body.sessionId);
  if (approvalBlocked) {
    console.error("[mission/stt] approval blocked", { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return approvalBlocked;
  }

  const authService = createServiceClient();
  const { data: session } = await authService
    .from("chat_sessions")
    .select("child_id, session_type")
    .eq("id", body.sessionId)
    .single();
  if (!session) {
    console.error("[mission/stt] Session not found", { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authService, user.id, session.child_id);
  if (!authCheck.allowed) {
    console.error("[mission/stt] Forbidden", { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 이 엔드포인트는 미션 대화뿐 아니라 자유대화(session_type: "free_chat")의 STT도 함께
  // 처리한다(useVoiceChat 훅이 공용). 미션 전용 활성 상태 검사는 실제 미션 세션에만 적용한다
  // — 자유대화 세션에 적용하면 session_type 불일치로 매번 거부되어 자유대화 STT가 전면 막힌다.
  if (session.session_type === "mission") {
    const { data: progress } = await authService
      .from("mission_progress")
      .select("status, round_type, mission_policy_version")
      .eq("session_id", body.sessionId)
      .maybeSingle();

    const isV3Session =
      progress?.mission_policy_version === "v3_single_daily" ||
      progress?.round_type === "daily_single";

    if (isV3Session) {
      if (!progress) {
        return NextResponse.json(
          { error: "미션 진행 정보를 찾을 수 없습니다.", code: "MISSION_NOT_READY", status: "PROGRESS_NOT_FOUND", expired: false },
          { status: 423 }
        );
      }

      if (progress.status === "FORCE_ENDED") {
        return NextResponse.json(
          { error: "미션 시간이 끝났어요", code: "MISSION_EXPIRED", status: "FORCE_ENDED", expired: true },
          { status: 403 }
        );
      }

      if (progress.status === "COMPLETED" || progress.status === "SAFETY_PAUSED") {
        return NextResponse.json(
          { error: `Mission is ${progress.status}`, code: progress.status, status: progress.status, expired: false },
          { status: 423 }
        );
      }

      // v3 진행 중 세션 (COMPLETED/SAFETY_PAUSED/FORCE_ENDED가 아닌 상태):
      // 이미 시작된 세션은 시간창 밖이어도 resume/계속 진행 허용 (v3 계약).
      // force_end_mission_session RPC를 절대 호출하지 않는다.
    } else {
      const sessionCheck = await assertMissionSessionActive(authService, body.sessionId);
      if (!sessionCheck.allowed) {
        console.error("[mission/stt] Session not active or expired", { sessionId: body.sessionId, childTurnId: body.childTurnId });
        return NextResponse.json(
          { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired },
          { status: sessionCheck.expired ? 403 : 423 }
        );
      }
    }
  }

  if (body.sessionId && body.childTurnId) {
    const sId = body.sessionId;
    const tId = body.childTurnId;
    createServiceClient().from("turn_timing_events").insert({
      session_id: sId,
      turn_id: tId,
      event_name: "stt_request"
    }).then(({error}) => { if (error) console.error("[mission/stt] timing err", error.message); }, (e: unknown) => console.error("[mission/stt] timing exc", e));
  }

  // 비용에 영향을 주는 child_id/tier/voice_mode는 클라이언트에서 직접 받지 않고
  // sessionId로만 서버가 해석한다(server-trust).
  const usageContext = await resolveUsageContext(body.sessionId);

  try {
    const gcpRes = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: "ko-KR",
            model: "default",
            audioChannelCount: 1,
            enableAutomaticPunctuation: true,
            speechContexts: [{ phrases: CHILD_SPEECH_HINTS, boost: CHILD_SPEECH_HINT_BOOST }],
          },
          audio: { content: audioBase64 },
        }),
      }
    );

    if (!gcpRes.ok) {
      // 응답 바디에 API 키가 섞여있을 수 있으므로 그대로 노출하지 않음
      console.error("[mission/stt] gcp call failed", { status: gcpRes.status, sessionId: body.sessionId, childTurnId: body.childTurnId });
      return NextResponse.json({ error: "STT request failed" }, { status: 500 });
    }

    const data = (await gcpRes.json()) as SpeechResponse;
    const transcript = (data.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? "")
      .join("")
      .trim();

    if (body.sessionId && body.childTurnId) {
      const sId = body.sessionId;
      const tId = body.childTurnId;
      createServiceClient().from("turn_timing_events").insert({
        session_id: sId,
        turn_id: tId,
        event_name: "stt_final"
    }).then(({error}) => { if (error) console.error("[mission/stt] timing err", error.message); }, (e: unknown) => console.error("[mission/stt] timing exc", e));
    }

    let minConfidence = 1;
    let hasConfidence = false;
    for (const r of (data.results ?? [])) {
      const conf = r.alternatives?.[0]?.confidence;
      if (typeof conf === "number") {
        minConfidence = Math.min(minConfidence, conf);
        hasConfidence = true;
      }
    }
    const confidence = hasConfidence ? minConfidence : undefined;

    if (usageContext) {
      const ctx = usageContext;
      const durationSec = Buffer.from(audioBase64, "base64").length / PCM16_BYTES_PER_SEC;
      const estCostKrw = estimateCost({ kind: "stt", durationSec });
      after(async () => {
        try {
          const service = createServiceClient();
          await service.from("usage_events").insert({
            child_id: ctx.childId,
            tier: ctx.tier,
            voice_mode: ctx.voiceMode,
            kind: "stt",
            duration_sec: durationSec,
            est_cost_krw: estCostKrw,
            conversation_mode: normalizeConversationMode((body as { conversationMode?: unknown }).conversationMode),
          });
        } catch (err) {
          console.error("[mission/stt] usage_events insert failed:", (err as Error).message);
        }
      });
    }

    console.log("[mission/stt] done", { sessionId: body.sessionId, childTurnId: body.childTurnId, durationMs: Date.now() - startedAt, status: "success" });
    return NextResponse.json({ transcript, confidence });
  } catch (err) {
    console.error("[mission/stt] error:", (err as Error).message, { sessionId: body.sessionId, childTurnId: body.childTurnId });
    return NextResponse.json({ error: "STT request failed" }, { status: 500 });
  }
}
