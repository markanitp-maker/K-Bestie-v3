"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { logVoiceEvent, maskText } from "@/lib/voiceTimelineLog";

// Gemini Live 네이티브 오디오 API를 폐기하고 STT(근사 스트리밍) + 텍스트 LLM + TTS 분리 구조로 전환.
// 구성: 아이 음성 → GCP STT(/api/mission/stt, recognize REST 주기호출) → 텍스트
//      → (필요 시) Gemini 2.5 Flash 텍스트(/api/voice/respond) → 케이 응답 텍스트
//      → GCP TTS(/api/voice/tts, Wavenet) → 음성 재생
// 자막은 STT/LLM이 돌려주는 텍스트를 그대로 표시하므로 Live transcription 이벤트 문제가 없다.

export type SessionStatus = "idle" | "connecting" | "live" | "ended" | "error";
// id: 메시지 고유 식별자(React key 및 message_id로 사용) — appendTurn/seedTranscript가 없으면
// 자동 생성한다. 호출부(finalizeChildTurn/speak 등)는 { role, text }만 넘기면 된다.
export interface Turn { role: "child" | "k"; text: string; id?: string }

export interface UseVoiceChatOptions {
  /** 한 턴이 완전히 끝날 때마다 호출 (child: 발화 확정 시, k: 말하기 시작 시) */
  onTurnComplete?: (turn: Turn) => void;
  /** 현재 chat_sessions.id를 반환. respondText()가 안전 이벤트 저장을 위해 /api/voice/respond에 함께 전송한다. */
  getSessionId?: () => string | null;
  /** 빈 음성 감지 시 호출 (미션 전용) */
  onEmptyAudio?: () => void;
  /** STT 텍스트 변환 실패 시 호출 */
  onSttFailed?: (reason?: string) => void;
  /** 음성 발화 시작 시(무음->유음 전환 최초 1회) 호출 (E 저지연 타임스탬프 전용) */
  onSpeechBegin?: () => void;
  /** 음성 발화 종료 시(무음 감지로 확정되기 직전) 호출 (E 저지연 타임스탬프 전용) */
  onSpeechEnd?: () => void;
  /** A~E 테스트 모드 태깅용 conversation_mode(§23). 미지정 시 기존 동작 그대로(usage_events는 미분류). */
  conversationMode?: string;
}

const POLL_INTERVAL_MS = 1300;       // 중간 자막 갱신 주기
const SILENCE_MS_TO_FINALIZE = 900;  // 이만큼 조용하면 발화 종료로 판단
const RMS_SILENCE_THRESHOLD = 0.012; // 이 이하 진폭은 무음으로 간주
const CHUNK_MS = 128;                // processor 콜백 1회당 대략적 시간(16kHz, 2048 샘플)

function encodePCM16Base64(chunks: Uint8Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  let binary = "";
  for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function useVoiceChat(options?: UseVoiceChatOptions) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [interimChildText, setInterimChildText] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const statusRef = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<Turn[]>([]);
  const lastAsrConfidenceRef = useRef<number | undefined>(undefined);
  const onTurnCompleteRef = useRef<((turn: Turn) => void) | undefined>(undefined);
  onTurnCompleteRef.current = options?.onTurnComplete;
  const onEmptyAudioRef = useRef<(() => void) | undefined>(undefined);
  onEmptyAudioRef.current = options?.onEmptyAudio;
  const onSttFailedRef = useRef<((reason?: string) => void) | undefined>(undefined);
  onSttFailedRef.current = options?.onSttFailed;
  const onSpeechBeginRef = useRef<(() => void) | undefined>(undefined);
  onSpeechBeginRef.current = options?.onSpeechBegin;
  const onSpeechEndRef = useRef<(() => void) | undefined>(undefined);
  onSpeechEndRef.current = options?.onSpeechEnd;

  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micEnabledRef = useRef(true);
  const inputModeRef = useRef<"auto" | "manual">("auto");
  const speakingRef = useRef(false);
  // 케이 발화(TTS) 재생 전용 AudioContext — 세션 시작(마이크 켜기, 사용자 인터랙션) 시점에
  // 1회 생성/resume해두고 이후 모든 턴이 이 컨텍스트에서 디코딩·재생한다(useGeminiLive.ts와
  // 동일 패턴). 매 턴 new Audio().play()로 새로 재생을 시도하면 사용자 제스처와 무관한
  // 시점의 호출이라 두 번째 턴부터 브라우저 Autoplay 정책에 막혀 조용히 실패했었음.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const chunksRef = useRef<Uint8Array[]>([]);
  const hasSpeechRef = useRef(false);
  const silenceMsRef = useRef(0);
  const sttBusyRef = useRef(false);
  // 자유대화 respondText() 진행 중(케이 반응 생성 중) 플래그 — 이 동안은 새 녹음을 시작하거나
  // 무음감지로 자동 finalize가 발생하지 않도록 막는다(speakingRef와 동일한 가드 패턴 재사용).
  const respondingRef = useRef(false);
  const [isResponding, setIsResponding] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 발화(utterance) 세대 카운터 — finalize 시점마다 증가.
  // 이미 확정(final)된 뒤에 뒤늦게 도착하는 중간(interim) 응답이 확정 말풍선과
  // 동일 내용으로 다시 표시되는 중복 버그 방지용(경합 시 이전 세대 응답은 폐기).
  const utteranceEpochRef = useRef(0);
  // speak() 세대 카운터 — 케이 발화(TTS) 호출마다 증가.
  // 새 speak() 호출은 이전 재생 중인 오디오를 즉시 중단시키고, 이전 호출의 응답/재생은
  // 전부 폐기한다(single-audio 보장, 말풍선·음성 중복 표시 방지).
  const speakEpochRef = useRef(0);
  // appendTurn/seedTranscript가 부여하는 message_id 생성용 순번 — startSession/reset 시 초기화.
  // 배열 index 대신 이 id로 React key를 잡아야 렌더 중 재조정으로 인한 말풍선 오표시를 막는다.
  const turnSeqRef = useRef(0);
  const sttAbortControllerRef = useRef<AbortController | null>(null);
  function nextTurnId(): string {
    turnSeqRef.current += 1;
    return `t${turnSeqRef.current}`;
  }

  function updateStatus(s: SessionStatus) {
    statusRef.current = s;
    setStatus(s);
  }

  function appendTurn(turn: Turn) {
    const withId: Turn = turn.id ? turn : { ...turn, id: nextTurnId() };
    transcriptRef.current = [...transcriptRef.current, withId];
    setTranscript([...transcriptRef.current]);
  }

  async function callStt(audioBase64: string, customSignal?: AbortSignal, childTurnId?: string): Promise<{ text: string; confidence?: number; failureReason?: "network" | "http_error" | "timeout" | "aborted" }> {
    try {
      sttAbortControllerRef.current = new AbortController();
      const signal = customSignal ?? sttAbortControllerRef.current.signal;

      const sessionId = options?.getSessionId?.() ?? null;
      const res = await fetch("/api/mission/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, sessionId, childTurnId, conversationMode: options?.conversationMode }),
        signal,
      });
      if (signal.aborted) return { text: "", failureReason: "aborted" };
      if (!res.ok) {
        console.error("[STT] http error", res.status);
        return { text: "", failureReason: "http_error" };
      }
      const data = await res.json();
      return { 
        text: typeof data.transcript === "string" ? data.transcript.trim() : "",
        confidence: typeof data.confidence === "number" ? data.confidence : undefined
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { text: "", failureReason: "aborted" };
      }
      return { text: "", failureReason: "network" };
    }
  }

  const finalizeChildTurn = useCallback(async (signal?: AbortSignal) => {
    logVoiceEvent({ ts: Date.now(), eventType: "finalizeChildTurn_start" });
    const epoch = ++utteranceEpochRef.current; // 새 세대로 전환 — 이전 세대의 낡은 interim 응답은 이후 전부 무시됨
    const chunks = chunksRef.current;
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    setInterimChildText("");
    if (chunks.length === 0) {
      if (onEmptyAudioRef.current) onEmptyAudioRef.current();
      return;
    }

    const audioBase64 = encodePCM16Base64(chunks);
    const predictedTurnId = `t${turnSeqRef.current + 1}`;

    fetch("/api/mission/timing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: options?.getSessionId?.(), turnId: predictedTurnId, eventName: "speech_end" })
    }).catch(() => {});

    console.log("[STT] calling", { turnId: predictedTurnId });
    logVoiceEvent({ ts: Date.now(), eventType: "stt_request", childTurnId: predictedTurnId });
    const { text, confidence, failureReason } = await callStt(audioBase64, signal, predictedTurnId);
    logVoiceEvent({ ts: Date.now(), eventType: "stt_response", childTurnId: predictedTurnId, textPreview: maskText(text), extra: { failureReason } });
    console.log("[STT] result", { turnId: predictedTurnId, hasText: !!text, failureReason });
    if (epoch !== utteranceEpochRef.current) return; // 그 사이 다음 발화가 이미 시작/확정됐으면 폐기
    if (!text) {
      onSttFailedRef.current?.(failureReason);
      return;
    }

    lastAsrConfidenceRef.current = confidence;
    logVoiceEvent({ ts: Date.now(), eventType: "appendTurn_voicechat", extra: { role: "child" } });
    appendTurn({ role: "child", text });
    onTurnCompleteRef.current?.({ role: "child", text });
  }, []);

  const startSession = useCallback(async () => {
    if (statusRef.current === "live" || statusRef.current === "connecting") return;
    setError(null);
    updateStatus("connecting");
    transcriptRef.current = [];
    logVoiceEvent({ ts: Date.now(), eventType: "transcript_reset" });
    setTranscript([]);
    turnSeqRef.current = 0;
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    setInterimChildText("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("마이크를 사용하려면 HTTPS로 접속하세요.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      // 마이크 켜기(사용자 제스처로 시작된 세션)와 같은 시점에 재생용 AudioContext를
      // 만들어두어야 브라우저 Autoplay 정책상 이후 턴들의 speak() 재생도 허용된다.
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => {});
      }

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (statusRef.current !== "live" || !micEnabledRef.current || speakingRef.current || respondingRef.current) return;
        const float32 = ev.inputBuffer.getChannelData(0);

        // RMS 기반 무음 감지
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
        const rms = Math.sqrt(sumSq / float32.length);

        const buf = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        chunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));

        if (rms >= RMS_SILENCE_THRESHOLD) {
          if (!hasSpeechRef.current) {
            onSpeechBeginRef.current?.();
          }
          hasSpeechRef.current = true;
          silenceMsRef.current = 0;
        } else {
          silenceMsRef.current += CHUNK_MS;
          if (hasSpeechRef.current && silenceMsRef.current >= SILENCE_MS_TO_FINALIZE && inputModeRef.current !== "manual") {
            onSpeechEndRef.current?.();
            logVoiceEvent({ ts: Date.now(), eventType: "silence_detected" });
            void finalizeChildTurn();
          }
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

      // 중간 자막 갱신 — 말하는 도중 누적된 오디오를 주기적으로 재인식(반투명 임시 표시 전용,
      // transcript에는 절대 append하지 않음 — 확정 저장은 finalizeChildTurn에서만 1회 수행)
      pollTimerRef.current = setInterval(() => {
        if (sttBusyRef.current) return;
        if (!hasSpeechRef.current || chunksRef.current.length === 0) return;
        sttBusyRef.current = true;
        const epoch = utteranceEpochRef.current;
        const audioBase64 = encodePCM16Base64(chunksRef.current);
        const predictedTurnId = `t${turnSeqRef.current + 1}`;
        void callStt(audioBase64, undefined, predictedTurnId).then(({ text }) => {
          sttBusyRef.current = false;
          // 이미 finalize되어 다음 세대로 넘어간 뒤 도착한 낡은 응답이면 폐기(중복 표시 방지)
          if (epoch !== utteranceEpochRef.current) return;
          if (text) setInterimChildText(text);
        });
      }, POLL_INTERVAL_MS);

      updateStatus("live");
    } catch (err) {
      console.error("[VoiceChat] startSession error:", err);
      setError((err as Error).message);
      updateStatus("error");
    }
  }, [finalizeChildTurn]);

  function teardown() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* 이미 정지된 경우 무시 */ }
      currentSourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    speakingRef.current = false;
    setIsSpeaking(false);
    respondingRef.current = false;
    setIsResponding(false);
    setInterimChildText("");
    lastAsrConfidenceRef.current = undefined;
  }

  const stopSession = useCallback(() => {
    teardown();
    updateStatus("ended");
  }, []);

  const reset = useCallback(() => {
    teardown();
    transcriptRef.current = [];
    setTranscript([]);
    turnSeqRef.current = 0;
    setError(null);
    updateStatus("idle");
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);
  const getLastAsrConfidence = useCallback(() => lastAsrConfidenceRef.current, []);

  /** DB에서 불러온 과거 대화(chat_messages)를 초기 자막으로 채워넣는다 — 스크롤을 올리면
   *  이전 대화를 볼 수 있게 하기 위함. 세션 연결 이후(status가 "live"가 된 뒤) 1회 호출할 것
   *  — startSession()이 자체적으로 transcript를 비우므로 그보다 먼저 호출하면 덮어써진다. */
  const seedTranscript = useCallback((turns: Turn[]) => {
    const withIds = turns.map((t) => (t.id ? t : { ...t, id: nextTurnId() }));
    transcriptRef.current = withIds;
    setTranscript([...withIds]);
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
  }, []);

  const setInputMode = useCallback((mode: "auto" | "manual") => {
    inputModeRef.current = mode;
  }, []);

  const manualFinalize = useCallback((signal?: AbortSignal) => {
    void finalizeChildTurn(signal);
  }, [finalizeChildTurn]);

  const cancelFinalize = useCallback(() => {
    sttAbortControllerRef.current?.abort();
    sttAbortControllerRef.current = null;
    utteranceEpochRef.current++;
  }, []);

  /** 케이 발화 재생 — TTS 합성 후 오디오 재생. 재생 중엔 마이크 캡처를 잠시 멈춘다(에코 방지).
   *  새 호출 시 이전 재생 중인 오디오를 즉시 중단하고, 이전 호출의 응답/재생은 전부 폐기해서
   *  절대 두 음성이 동시에 겹치거나 말풍선이 중복 표시되지 않도록 보장한다(single-audio). */
  // ⚠️ voiceName은 임시 목소리 비교 테스트용 파라미터(미확정, 나중에 제거 예정).
  // 넘기지 않으면 /api/voice/tts의 기본 보이스가 그대로 적용됨(기존 동작 불변).
  // 반환값(boolean)은 TTS 합성이 실제로 성공했는지 여부 — 임시 목소리 테스트 UI가
  // 실패한 보이스를 감지해 안내하는 용도로만 쓰인다(기존 호출부는 반환값 무시해도 무방).
  const speak = useCallback(async (text: string, voiceName?: string, turnId?: string): Promise<boolean> => {
    const trimmed = text.trim();
    console.log("[MISSION-DEBUG] speak() invoked, text:", trimmed, "voiceName:", voiceName);
    if (!trimmed) return false;

    // 새 발화 세대로 전환 — 이전 세대의 진행 중이던 응답/재생은 이후 전부 무시됨
    const epoch = ++speakEpochRef.current;

    // 이전에 재생 중이던 오디오가 있으면 즉시 중단(겹침 방지)
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* 이미 정지된 경우 무시 */ }
      currentSourceRef.current = null;
    }

    speakingRef.current = true;
    setIsSpeaking(true);
    let spoken = false;
    let ttsOk = false; // TTS 합성 자체가 성공했는지(목소리 테스트 성공/실패 판정용)

    try {
      const sessionId = options?.getSessionId?.() ?? null;
      logVoiceEvent({ ts: Date.now(), eventType: "tts_request", extra: { turnId } });
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceName ? { text: trimmed, voiceName, sessionId, turnId } : { text: trimmed, sessionId, turnId }),
      });
      console.log("[MISSION-DEBUG] /api/voice/tts status:", res.status);
      logVoiceEvent({ ts: Date.now(), eventType: "tts_response" });
      if (epoch !== speakEpochRef.current) { console.log("[MISSION-DEBUG] speak() epoch superseded, discarding tts response"); return false; }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[MISSION-DEBUG] tts !res.ok, voice:", voiceName, "body:", errBody);
        throw new Error("TTS response not ok");
      }
      const data = await res.json();
      if (epoch !== speakEpochRef.current) return false;
      if (!data.audioContent) {
        console.error("[MISSION-DEBUG] tts response missing audioContent:", data);
        throw new Error("TTS audioContent missing");
      }
      ttsOk = true;

      const audioCtx = audioCtxRef.current;
      if (!audioCtx) throw new Error("AudioContext not initialized — startSession()이 선행되어야 함");
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }

      const arrayBuffer = base64ToArrayBuffer(data.audioContent);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      if (epoch !== speakEpochRef.current) return false; // 디코딩 사이에 또 새 speak()가 호출된 경우 대비

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      currentSourceRef.current = source;

      // 음성 재생 개시 시점에 맞추어 자막 출력
      appendTurn({ role: "k", text: trimmed });
      onTurnCompleteRef.current?.({ role: "k", text: trimmed });
      spoken = true;

      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        try {
          source.start();
          logVoiceEvent({ ts: Date.now(), eventType: "tts_playback_start" });
          if (turnId) {
            fetch("/api/mission/timing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: options?.getSessionId?.(), turnId, eventName: "playback_start" })
            }).catch(() => {});
          }
        } catch (e) {
          console.error("[MISSION-DEBUG] source.start() threw:", e);
          resolve();
        }
      });
    } catch (err) {
      console.error("[MISSION-DEBUG] speak() caught exception:", err, "voice:", voiceName);
      // TTS가 실패하더라도 자막은 반드시 출력(단, 이 호출이 여전히 최신 세대일 때만)
      if (!spoken && epoch === speakEpochRef.current) {
        appendTurn({ role: "k", text: trimmed });
        onTurnCompleteRef.current?.({ role: "k", text: trimmed });
      }
    } finally {
      if (epoch === speakEpochRef.current) {
        speakingRef.current = false;
        setIsSpeaking(false);
        currentSourceRef.current = null;
      }
    }
    return ttsOk;
  }, []);



  /** 자유대화용 — 현재까지의 대화 기록으로 Gemini 텍스트 응답을 생성해 말풍선에만 표시.
   *  케이는 자유대화에서 음성으로 말하지 않는다 — TTS 호출 없음(텍스트 전용). */
  const respondText = useCallback(async () => {
    respondingRef.current = true;
    setIsResponding(true);
    try {
      const res = await fetch("/api/voice/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: transcriptRef.current,
          sessionId: options?.getSessionId?.() ?? null,
          asrConfidence: lastAsrConfidenceRef.current,
          appMode: inputModeRef.current,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) return;
      appendTurn({ role: "k", text });
      onTurnCompleteRef.current?.({ role: "k", text });
    } catch {
      // 무응답 시 침묵 — 재시도는 다음 아이 발화에서
    } finally {
      respondingRef.current = false;
      setIsResponding(false);
    }
  }, []);

  /** 텍스트 입력(💬 모드) — 아이 발화로 즉시 처리 */
  const sendTypedText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    appendTurn({ role: "child", text: trimmed });
    onTurnCompleteRef.current?.({ role: "child", text: trimmed });
  }, []);

  /** 케이가 정해진 문구를 텍스트로만 표시(TTS 없음) — 자유대화 하드리밋 안내 등에 사용 */
  const sayText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    appendTurn({ role: "k", text: trimmed });
    onTurnCompleteRef.current?.({ role: "k", text: trimmed });
  }, []);

  /** 재생 중인 케이 음성을 즉시 중단한다(음성 끄기 토글 등에서 사용). 진행 중이던
   *  speak() 호출의 후속 콜백은 epoch 불일치로 자동 무시된다. */
  const stopSpeaking = useCallback(() => {
    speakEpochRef.current += 1;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* 이미 정지된 경우 무시 */ }
      currentSourceRef.current = null;
    }
    speakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => teardown();
  }, []);

  return {
    status, error, transcript, interimChildText, isSpeaking, isResponding,
    startSession, stopSession, reset, getTranscript, getLastAsrConfidence, seedTranscript,
    speak, respondText, sendTypedText, sayText, stopSpeaking, setMicEnabled, setInputMode, manualFinalize, cancelFinalize,
  };
}
