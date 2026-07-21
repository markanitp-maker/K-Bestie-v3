import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// 일반 Cloud Text-to-Speech Wavenet 보이스만 사용한다.
// Gemini 계열 TTS(토큰 과금, 매우 비쌈)는 절대 쓰지 않는다 — text:synthesize REST 고정.
// 목소리 테스트 완료 후 ko-KR-Wavenet-A로 확정(Tier1/2, STT+TTS 경로 전용).
const TTS_VOICE_NAME = "ko-KR-Wavenet-A";

// TTS로 보낼 때만 발음되면 안 되는 특수문자를 제거/치환한다.
// 화면 말풍선에 표시되는 원문 텍스트는 이 함수를 거치지 않는다(클라이언트가 별도로 보관).
function sanitizeForTts(raw: string): string {
  return raw
    .replace(/[~〜～]/g, "")                                          // 물결표류 — "물결표"로 읽히는 문제
    .replace(/\*/g, "")                                               // 별표
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]/gu, "") // 이모지/화살표/기타 심볼
    .replace(/[_^`]/g, "")                                            // 기타 발음되면 어색한 기호
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GCP_TTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 500 });
  }

  let body: { text?: string; voiceName?: string; sessionId?: string; turnId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const ttsText = sanitizeForTts(text);
  if (!ttsText) {
    return NextResponse.json({ error: "text empty after sanitize" }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id")
    .eq("id", body.sessionId)
    .maybeSingle();

  if (!session?.child_id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForSession(body.sessionId);
  if (consentBlocked) return consentBlocked;

  // 비용에 영향을 주는 child_id/tier/voice_mode는 클라이언트에서 직접 받지 않고
  // sessionId로만 서버가 해석한다(server-trust).
  const usageContext = await resolveUsageContext(body.sessionId);

  // voiceName을 안 넘기면 확정된 기본값(ko-KR-Wavenet-A) 사용.
  const voiceName = (typeof body.voiceName === "string" && body.voiceName.trim()) || TTS_VOICE_NAME;
  // languageCode: 테스트 후보가 전부 ko-KR 계열이라 고정.
  const languageCode = "ko-KR";

  try {
    if (body.sessionId && body.turnId) {
      const sId = body.sessionId;
      const tId = body.turnId;
      createServiceClient().from("turn_timing_events").insert({
        session_id: sId,
        turn_id: tId,
        event_name: "tts_request"
    }).then(({error}) => { if (error) console.error("[voice/tts] timing err", error.message); }, (e: unknown) => console.error("[voice/tts] timing exc", e));
    }

    const gcpRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: ttsText },
          voice: { languageCode, name: voiceName },
          audioConfig: { audioEncoding: "MP3", speakingRate: 1.02, pitch: 1.0 },
        }),
      }
    );

    if (!gcpRes.ok) {
      const errBody = await gcpRes.text().catch(() => "");
      console.error("[voice/tts] GCP TTS failed:", gcpRes.status, "voice:", voiceName, "body:", errBody);
      return NextResponse.json({ error: "TTS request failed", voice: voiceName }, { status: 500 });
    }

    const data = (await gcpRes.json()) as { audioContent?: string };
    if (!data.audioContent) {
      return NextResponse.json({ error: "TTS returned no audio" }, { status: 500 });
    }

    if (body.sessionId && body.turnId) {
      const sId = body.sessionId;
      const tId = body.turnId;
      createServiceClient().from("turn_timing_events").insert({
        session_id: sId,
        turn_id: tId,
        event_name: "tts_first_byte"
    }).then(({error}) => { if (error) console.error("[voice/tts] timing err", error.message); }, (e: unknown) => console.error("[voice/tts] timing exc", e));
    }

    if (usageContext) {
      const ctx = usageContext;
      const charCount = ttsText.length;
      const estCostKrw = estimateCost({ kind: "tts", charCount });
      after(async () => {
        try {
          const service = createServiceClient();
          await service.from("usage_events").insert({
            child_id: ctx.childId,
            tier: ctx.tier,
            voice_mode: ctx.voiceMode,
            kind: "tts",
            char_count: charCount,
            est_cost_krw: estCostKrw,
          });
        } catch (err) {
          console.error("[voice/tts] usage_events insert failed:", (err as Error).message);
        }
      });
    }

    return NextResponse.json({ audioContent: data.audioContent, mimeType: "audio/mp3" });
  } catch (err) {
    console.error("[voice/tts] error:", (err as Error).message);
    return NextResponse.json({ error: "TTS request failed" }, { status: 500 });
  }
}
