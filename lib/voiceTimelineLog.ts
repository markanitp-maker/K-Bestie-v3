const ENABLED = process.env.NEXT_PUBLIC_DEBUG_VOICE_TIMELINE === "true";

interface VoiceTimelineEvent {
  ts: number; // Date.now()
  sessionId?: string | null;
  mode?: "live" | "stt_tts" | "free";
  eventType: string;
  turnPhaseBefore?: string;
  turnPhaseAfter?: string;
  childTurnId?: string | null;
  kTurnId?: string | null;
  generationId?: string | null;
  displaySequence?: number | null;
  micEnabled?: boolean;
  audioQueueLength?: number;
  transcriptSummary?: Array<{ role: string; id?: string; displaySequence?: number }>;
  textPreview?: { length: number; preview: string }; // 원문 절대 전체 저장 금지
  extra?: Record<string, unknown>;
}

export function logVoiceEvent(e: VoiceTimelineEvent) {
  if (!ENABLED) return;
  try {
    console.log("[VOICE-TIMELINE]", JSON.stringify(e));
  } catch { /* 로깅 실패는 무시 */ }
}

export function maskText(text: string | undefined | null): { length: number; preview: string } {
  const t = text ?? "";
  return { length: t.length, preview: t.slice(0, 10) };
}
