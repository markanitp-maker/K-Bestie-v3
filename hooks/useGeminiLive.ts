"use client";

import { useRef, useState, useCallback, useEffect } from "react";

import { logVoiceEvent, maskText } from "@/lib/voiceTimelineLog";
import { validateFinalTranscript, resolveFinalTranscript } from "@/lib/stt/scriptGuard";

const ENABLE_STT_FALLBACK = true;

// K 응답 강제 길이 제한 — 네이티브 오디오 Live 모델은 maxOutputTokens 등 서버 설정으로
// 응답 길이를 확실히 제한할 방법이 없음이 확인됨(공식 문서에 관련 파라미터 없음, SDK
// 이슈 트래커에도 "maxOutputTokens 늘려도 효과 없음" 보고 다수). systemInstruction만으로도
// 모델이 매번 지키진 않으므로, 클라이언트에서 재생 자체를 강제로 끊는 것이 유일하게
// 확실한 방법. SOFT는 문장부호에서 자연스럽게 끊는 기준, HARD는 문장부호가 안 나와도
// 무조건 끊는 최종 안전장치.
const K_TURN_SOFT_CUT_CHARS = 50;
const K_TURN_HARD_CUT_CHARS = 110;

export type SessionStatus = "idle" | "connecting" | "live" | "ending" | "ended" | "paused" | "error";
// id: 메시지 고유 식별자(React key 및 message_id로 사용) — appendTurn/seedTranscript/
// finalizeKTurnText가 없으면 자동 생성하고, 같은 버블에 텍스트를 이어붙이는 경우(스트리밍
// 청크 합치기)는 기존 id를 그대로 유지한다.
export interface Turn { role: "child" | "k"; text: string; id?: string; generationId?: string; sealed?: boolean; displaySequence?: number; }

// ── Vertex Live 릴레이(Cloud Run) 연결 지원 ──────────────────────
// Cloud Run 릴레이(services/vertex-live-relay)와의 순수 WebSocket을 RelaySession으로 감싸
// 공통 인터페이스(sendRealtimeInput/sendClientContent/close)로 다룬다.
interface LiveTransport {
  sendRealtimeInput(input: {
    audio?: { data: string; mimeType: string };
    activityStart?: {};
    activityEnd?: {};
  }): void;
  sendClientContent(input: { turns: { role: string; parts: { text: string }[] }[]; turnComplete: boolean }): void;
  close(): void;
}

// 릴레이가 보내는 payload 구조 (서버가 AI Studio LiveServerMessage와 동일한 shape으로 직렬화해 보냄).
interface NormalizedServerMessage {
  data?: string;
  serverContent?: {
    turnComplete?: boolean;
    // 아이가 K 발화 도중 끼어들면(barge-in) 서버가 현재 K 생성을 중단하고 이 플래그를 보낸다.
    // 이 신호를 받으면 진행 중인 K 턴을 즉시 확정하고 이후 잔여 오디오/텍스트를 폐기한다.
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  usageMetadata?: { promptTokenCount?: number; responseTokenCount?: number };
}

class RelaySession implements LiveTransport {
  constructor(private ws: WebSocket) {}
  sendRealtimeInput(input: {
    audio?: { data: string; mimeType: string };
    activityStart?: {};
    activityEnd?: {};
  }) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (input.audio) {
      this.ws.send(JSON.stringify({ type: "audio", data: input.audio.data }));
    } else if (input.activityStart) {
      this.ws.send(JSON.stringify({ type: "activityStart" }));
    } else if (input.activityEnd) {
      this.ws.send(JSON.stringify({ type: "activityEnd" }));
    }
  }
  sendClientContent(input: { turns: { role: string; parts: { text: string }[] }[]; turnComplete: boolean }) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const text = input.turns?.[0]?.parts?.[0]?.text ?? "";
    this.ws.send(JSON.stringify({ type: "text", text }));
  }
  close() {
    try { this.ws.close(); } catch { /* 이미 닫힌 경우 무시 */ }
  }
}

export interface UseGeminiLiveOptions {
  /** 한 턴이 완전히 끝날 때마다 호출.
   *  - child: 음성 인식 완료 or sendText 호출 직후
   *  - k: Gemini turnComplete 이벤트 수신 시 (스트리밍 전체 텍스트)
   */
  onTurnComplete?: (turn: Turn) => void;
  /** child 발화 전사 소스.
   *  - "gemini"(기본): Gemini Live 자체 전사 + 브라우저 웹킷 폴백 (자유대화)
   *  - "gcp": child 턴 오디오를 /api/mission/stt(GCP Speech-to-Text)로 전사 (미션 전용)
   */
  sttMode?: "gemini" | "gcp";
  /** Live API 음성(speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName). 기본값 "Aoede".
   *  연결 시점에 확정되므로 변경 시 세션을 재연결해야 반영된다(임시 목소리 테스트 드롭다운용). */
  voiceName?: string;
  /** 현재 chat_sessions.id를 반환. /api/usage/live start/end 호출 및 GCP STT 사용량 계측에 사용. */
  getSessionId?: () => string | null;
  /** 현재 child_profiles.id를 반환. /api/voice/token이 동의 철회 여부를 확인하는 데 사용. */
  getChildId?: () => string | null;
  /** Vertex/AI Studio Live의 serverContent.turnComplete 수신 시마다 호출(모든 턴 공통).
   *  미션 종료 플로우(lib/mission/missionCompletionFlow.ts)가 "종료 발화 턴이 실제로
   *  끝났는지" 판단하는 데 쓴다 — 매 턴 호출되므로 호출부가 자신이 관심 있는 시점에만
   *  반응하도록 상태를 직접 확인해야 한다. */
  onServerTurnComplete?: () => void;
  /** 브라우저 오디오 재생 큐가 완전히 비었을 때(스케줄된 소스 0개)마다 호출(모든 턴 공통). */
  onAudioQueueDrained?: () => void;
  /** speakClosingLine()으로 보낸 전용 종료 발화 턴에서 실제 오디오가 처음 스케줄되는 순간
   *  정확히 1회 호출. 미션 종료 플로우가 "종료 발화가 음성으로 실제 시작됐는지"를 판단해
   *  2.5초 TTS 폴백을 취소하는 데 쓴다. */
  onClosingAudioChunk?: () => void;
  /** gcp STT 전사가 (재시도 후에도) 외국 문자로 판정돼 채택할 수 없을 때 호출 — 미션 화면이
   *  아이에게 다시 말해달라고 재질문하도록. 이 발화는 미션 답변으로 취급되지 않는다. */
  onTranscriptRejected?: () => void;
  /** 오디오 레벨(RMS) 변경 시 호출되는 콜백 (실시간 visualizer 등에서 사용) */
  onAudioLevelChange?: (level: number) => void;
  /** K 턴의 첫 출력(텍스트 또는 오디오)이 화면/스피커에 도달하는 순간 정확히 1회 호출.
   *  미션 화면이 수동 모드에서 "생각 중"(speaking_k) 상태를 즉시 풀어 아이가
   *  곧바로 다시 말할 수 있게(barge-in 허용) 한다. */
  onKTurnFirstOutput?: () => void;
  /** K 턴의 첫 출력이 8초 동안 도착하지 않아 generation이 취소되었을 때 호출. */
  onKTurnTimeout?: () => void;
  /** AUTO 모드에서 마이크가 켜져 있고(K가 말하는 중이 아닌) 상태로 NO_AUDIO_INPUT_TIMEOUT_MS
   *  동안 실제 오디오 청크가 한 번도 relay로 전송되지 않았을 때 true로, 그 뒤 실제 전송이
   *  재개되면 false로 호출된다. WebSocket/Vertex 세션은 전혀 건드리지 않는 순수 UI 신호다. */
  onNoAudioInput?: (active: boolean) => void;
  onRecoveryNeeded?: () => void;
  displaySequenceCounterRef?: React.MutableRefObject<number>;
  /** A~E 대화방식 모드 — usage_events.conversation_mode 태깅용 */
  conversationMode?: string;
}

// RMS_THRESHOLD는 기기별 마이크 감도 차이(특히 실기기에서 소리를 잘 못 잡는 경우)에 대응할
// 수 있도록 NEXT_PUBLIC_VAD_RMS_THRESHOLD로 오버라이드 가능하게 한다 — 민감정보가 아니므로
// NEXT_PUBLIC_ 접두사 사용에 문제 없다. 값이 없거나 숫자로 파싱되지 않으면 기존 기본값(0.015)
// 으로 안전하게 폴백한다.
function resolveVadRmsThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_VAD_RMS_THRESHOLD;
  if (!raw) return 0.015;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.015;
}

// ── 클라이언트 VAD (자동 발화 감지) 설정 상수 ──────────────────
const VAD_CONFIG = {
  RMS_THRESHOLD: resolveVadRmsThreshold(),
  MIN_SPEECH_DURATION_MS: 150,     // 발화 확인 시간
  MAX_CANDIDATE_BUFFER_MS: 200,    // 후보 버퍼 최대 길이
  SILENCE_TIMEOUT_MS: 1200,        // 발화 종료 무음 시간
};

// 실장애 재현(2026-07-26, Cloud Run relay 로그 확인): Live 세션이 정상 오픈됐는데도 클라이언트가
// 오디오를 relay로 60초간 한 번도 안 보내(input_audio_chunk 0건) relay의 heartbeat_timeout으로
// 세션이 강제 종료된 사례 — VAD RMS_THRESHOLD를 못 넘겨(마이크 감도/권한/threshold 미스매치)
// 발생. 이 타임아웃보다 훨씬 짧게(7초) 클라이언트가 먼저 "마이크 입력 없음"을 감지해 사용자에게
// 알린다 — 세션 자체는 끊지 않는다(요구사항 4: 재발화 시 재연결 없이 자동 복구).
const NO_AUDIO_INPUT_TIMEOUT_MS = 7000;
// VAD 상태/게이트 디버그 로그(logVoiceEvent, NEXT_PUBLIC_DEBUG_VOICE_TIMELINE로 게이팅)를
// 매 오디오 프레임(~128ms)마다 남기면 너무 시끄러우므로 최소 이 간격(1초)마다만 남긴다.
// 단, VAD 상태 전환 시점은 이 스로틀과 무관하게 즉시 남긴다.
const VAD_SAMPLE_LOG_THROTTLE_MS = 1000;

// ── PCM 인코딩/디코딩 ────────────────────────────────────────
function encodePCM16(float32: Float32Array): string {
  const buf = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  let binary = "";
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 모델이 실제로 낸 K 발화(outputTranscription)에 프롬프트/지시문이 그대로 새어나온
// 흔적이 있는지 검사한다. speakAsK/speakClosingLine으로 이미 안전한 원문을 알고 있는
// 턴에서만 이 결과로 화면 표시를 원문으로 대체한다(오디오는 이미 재생되어 되돌릴 수 없음).
// speakAsK/speakClosingLine이 "다음 문장을 ... 그대로 말해줘" 형태로 지시하면, Vertex Live
// 모델이 이걸 그냥 실행하지 않고 그 지시 자체를 대화 소재로 삼아 메타 발언(예: "...라고 말하면
// 자연스러울 것 같아", "이 문장을 그대로 말하는 건 어렵지만", "죄송해요, 저는 입력된 문장을
// 그대로 말할 수는 없어요")을 하는 경우가 실측으로 다수 확인됐다. 예전 패턴은 몇 가지 정확한
// 문구만 하드코딩돼 있어 이런 변형을 대부분 놓쳤다 — 그래서 문구 몇 개를 추가하는 대신, 이
// 메타 발언들이 공통으로 쓰는 조각(그대로/따라 + 말하다 활용형, 역할·사용자님·입력된 문장 같은
// 자기지시 표현, "말할 수는 없다" 류의 거부 표현)을 넓게 잡는다.
const K_TEXT_LEAK_PATTERNS = [
  /\[[^\]]*\]/,
  /라고.{0,10}말하면/,
  /그대로\s*(말하면|말하는|말할|말해)/,
  /(따라)?\s*말(할|해)\s*(줄\s*)?수는?\s*없/,
  /소리내어\s*그대로/,
  /시스템\s*지시/,
  /다음\s*문장을?\s*(그대로|자연스럽게)/,
  /현재\s*물어봐야\s*할/,
  /친구\s*역할/,
  /사용자님의\s*(말씀|문장)/,
  /입력된\s*문장/,
  /이\s*문장을/,
  /자연스러울\s*것\s*같/,
];
function containsLeakPattern(text: string): boolean {
  return K_TEXT_LEAK_PATTERNS.some((re) => re.test(text));
}

function decodePCM16(base64: string, sampleRate: number): AudioBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  // 오프라인 컨텍스트로 디코딩 — 재생 컨텍스트 공유 없이 버퍼만 생성
  const offlineCtx = new OfflineAudioContext(1, int16.length, sampleRate);
  const buf = offlineCtx.createBuffer(1, int16.length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  return buf;
}

export function useGeminiLive(options?: UseGeminiLiveOptions) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  // 브라우저 SpeechRecognition 폴백의 중간(interim) 전사 — 아이가 말하는 도중 실시간 자막용.
  // outputAudioTranscription(outTx) 이벤트와 무관하게, 브라우저 자체 인식 결과로만 갱신/확정된다.
  const [interimChildText, setInterimChildText] = useState("");
  // 겉으로는 "케이가 말은 안 하는데 자막만 뜬다"로 보인다 — iOS Safari는 sticky activation
  // 판정이 더 관대해 보통 통과하지만 Android/기기별로 훨씬 엄격하다). audioLocked가 true인
  // 동안 호출부(missions 페이지)가 "케이 목소리 켜기" 버튼을 노출해 명시적 재시도를 유도한다.
  const [audioLocked, setAudioLocked] = useState(false);

  // 미션 모드에서 아이의 답변을 듣는 중일 때 모델이 마이크 소리에 자체적으로 반응하여
  // 의도치 않은 발화를 생성하는 것을 막기 위한 가드.
  const kSpeechAllowedRef = useRef(true);
  const setKSpeechAllowed = useCallback((allowed: boolean) => {
    kSpeechAllowedRef.current = allowed;
    if (!allowed) {
      console.log("[K] 🔇 unprompted speech guard activated (kSpeechAllowed=false)");
    }
  }, []);

  const statusRef     = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<Turn[]>([]);
  const sessionRef    = useRef<LiveTransport | null>(null);
  const micStreamRef  = useRef<MediaStream | null>(null);

  // K generation tracking
  const kGenerationSeqRef = useRef(0);
  const currentKGenerationIdRef = useRef<string | null>(null);
  const kGenerationCompleteRef = useRef<boolean>(true);
  const kTurnCompleteRef = useRef<boolean>(true);
  const recoveryGateOpenRef = useRef<boolean>(false);
  const turnCompleteFallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const generationEpochRef = useRef<number>(0);
  const cancelledGenerationIdsRef = useRef<Set<string>>(new Set());
  const processedTurnGenerationsRef = useRef<Set<string>>(new Set());
  // GCP STT 모드에서 currentKGenerationIdRef를 null로 비워 K-A(Vertex의 원치 않는 자동 응답)를
  // 억제하는 동안, K-A 자신의 turnComplete가 실제로 도착할 때까지 다음 K 발화(K-B, speakAsK/
  // speakClosingLine)의 시작을 늦춘다. null 비교만으로는 speakAsK가 새 generation을 이미 발급한
  // "뒤에" 도착하는 지연된 K-A가 그 새 generation으로 오인돼 재생될 수 있어(단순 null-out만으로는
  // 막을 수 없는 잔여 경합) — K-A의 turnComplete를 실제로 확인(또는 안전 타임아웃)한 뒤에만 다음
  // K 발화를 시작하게 해 두 generation의 메시지 스트림이 절대 겹치지 않도록 한다.
  const awaitingNullGenerationSettleRef = useRef(false);
  const pendingPostSettleActionRef = useRef<(() => void) | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeKTurnIdRef = useRef<string | null>(null);
  const activeKTurnDisplaySequenceRef = useRef<number | null>(null);
  const activeChildTurnIdRef = useRef<string | null>(null);
  const activeChildTurnDisplaySequenceRef = useRef<number | null>(null);
  const processorRef  = useRef<ScriptProcessorNode | null>(null);
  const inputCtxRef   = useRef<AudioContext | null>(null);
  const outputCtxRef  = useRef<AudioContext | null>(null);
  const audioMutedRef = useRef(false);
  const micEnabledRef = useRef(true);
  // K 발화 재생 중 여부 — true인 동안 마이크 PCM 전송과 브라우저 STT 폴백을 모두 멈춰서
  // 스피커로 나온 K 목소리가 마이크로 다시 들어와 아이 발화로 오인되는 에코 루프를 막는다
  // (useVoiceChat.ts의 speakingRef와 동일한 목적, echoCancellation 브라우저 제약만으로는
  //  WebAudio API로 재생하는 오디오를 AEC 기준 신호로 못 잡는 경우가 있어 반드시 필요).
  const kSpeakingRef = useRef(false);

  // 실장애 재현 대응 — AUTO 모드에서 마이크가 켜져 있는데(K는 말하는 중 아님) 실제 오디오
  // 청크가 relay로 전송되지 않는 구간을 추적한다. silenceEligibleSinceRef는 "이 구간이
  // 시작된 시각"(마지막 실제 전송 또는 마지막으로 감지 대상 조건에 진입한 시각) — 대상
  // 조건을 벗어나면(K가 말하기 시작, 마이크 꺼짐, 수동 모드, 세션 미접속) null로 리셋해
  // 오검출을 막는다.
  const silenceEligibleSinceRef = useRef<number | null>(null);
  const noAudioInputRef = useRef(false);
  const [noAudioInput, setNoAudioInput] = useState(false);
  const lastVadSampleLogAtRef = useRef(0);

  // GCP STT 비동기 확정(finalizing) 상태 추적을 위한 Ref
  const manualFinalizingRef = useRef<boolean>(false);

  // 로컬 STT fallback 관리 변수
  const recognitionRef = useRef<any>(null);
  const speechHistoryRef = useRef<string>("");
  const hasLiveInputTxRef = useRef<boolean>(false);
  // 이번 아이 발화 턴이 이미 flush(말풍선 확정)됐는지 — 브라우저 STT 폴백(rec.onresult의
  // finalTranscript)과 Gemini 자체 inputTranscription 기반 flush(outTx 도착 시)가 같은 턴에
  // 대해 경쟁적으로 둘 다 flushChildTurn()을 호출해 말풍선이 중복 생성되던 문제 방지용.
  // sc.turnComplete 시 다음 아이 발화를 위해 false로 리셋.
  const childTurnFlushedRef = useRef(false);
  // K 턴이 강제로 끊겼는지 — true인 동안엔 서버가 계속 보내는 나머지 오디오/전사를 전부
  // 무시하고 진짜 turnComplete만 기다렸다가 다음 턴을 위해 리셋한다.
  const kTurnCutRef = useRef(false);
  // 강제컷된 K 턴이 "진짜로" 끝났는지 — 서버 turnComplete와 오디오 큐 drain이 모두 일어날
  // 때까지 childTurnFlushedRef를 초기화하지 않는다. 컷 시점에 곧바로 초기화하면, 아직 오디오가
  // 재생 중인 사이 지연 도착한 브라우저 STT onresult가 flushChildTurn을 한 번 더 태워
  // /api/mission/answer·respond가 중복 호출되는 경쟁조건이 있었다.
  const kTurnCutAwaitingUnlockRef = useRef(false);
  const kTurnCutServerDoneRef = useRef(false);
  // K 첫 출력 도착 여부
  const hasFiredFirstOutputRef = useRef(false);
  const generationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 세션 식별용 - 이전 연결 메시지 무시용
  const activeSessionIdRef = useRef<string | null>(null);
  const connectionIdRef = useRef<string>("none");
  const connectionGenerationRef = useRef<number>(0);
  const closeReconnectCountRef = useRef<number>(0);
  const lastCloseReconnectAtRef = useRef<number>(0);
  const closeReconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stabilityResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const qualityRecomputeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabHiddenAtRef = useRef<number | null>(null);

  // ── 연결 품질 계측(실측치 기반, 가짜 신호 막대 아님) ──────────────────────
  // speakAsK/sendText/speakClosingLine이 응답을 기다리기 시작한 시각(watchdog가 걸리는
  // 시점과 동일) — 첫 출력(오디오/텍스트)이 도착하면 이 시각과의 차이를 지연시간으로 기록한다.
  const requestSentAtRef = useRef<number | null>(null);
  // 최근 지연시간(ms) 최대 8개 — 평균으로 품질에 반영.
  const recentLatenciesRef = useRef<number[]>([]);
  // 최근 5분 내 watchdog(10초 무응답) 발동 시각들 — 응답 실패율 반영.
  const watchdogFireTimestampsRef = useRef<number[]>([]);
  const CONNECTION_QUALITY_WINDOW_MS = 5 * 60 * 1000;
  const [connectionQuality, setConnectionQuality] = useState<number>(5);

  function armLatencyClock() {
    requestSentAtRef.current = Date.now();
  }
  function recordFirstOutputLatency() {
    if (requestSentAtRef.current == null) return;
    const latency = Date.now() - requestSentAtRef.current;
    requestSentAtRef.current = null;
    const arr = recentLatenciesRef.current;
    arr.push(latency);
    if (arr.length > 8) arr.shift();
    recomputeConnectionQuality();
  }
  function recordWatchdogFire() {
    const now = Date.now();
    const arr = watchdogFireTimestampsRef.current;
    arr.push(now);
    const cutoff = now - CONNECTION_QUALITY_WINDOW_MS;
    while (arr.length && arr[0] < cutoff) arr.shift();
    recomputeConnectionQuality();
  }
  // 5단계(0~5, 5가 가장 좋음) — 실측 가능한 값만 사용한다: WebSocket 연결 상태, 최근
  // 재연결 횟수(closeReconnectCountRef, 기존 재연결 로직이 이미 추적), 최근 응답 지연시간
  // 평균(recentLatenciesRef), 최근 5분 내 watchdog(무응답) 발동 횟수. 임의의 신호 막대를
  // 그리지 않고 이 값들로부터 직접 계산한다.
  function recomputeConnectionQuality() {
    if (statusRef.current !== "live") {
      setConnectionQuality(statusRef.current === "connecting" ? 3 : 0);
      return;
    }
    let level = 5;
    if (closeReconnectCountRef.current >= 1) level -= Math.min(closeReconnectCountRef.current, 2);
    const now = Date.now();
    const cutoff = now - CONNECTION_QUALITY_WINDOW_MS;
    const recentWatchdogFires = watchdogFireTimestampsRef.current.filter((t) => t >= cutoff).length;
    level -= Math.min(recentWatchdogFires * 2, 4);
    const latencies = recentLatenciesRef.current;
    if (latencies.length > 0) {
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      if (avg > 6000) level -= 2;
      else if (avg > 3000) level -= 1;
    }
    if (requestSentAtRef.current != null) {
      const currentWait = now - requestSentAtRef.current;
      if (currentWait > 4000) level -= 2;
    }
    setConnectionQuality(Math.max(0, Math.min(5, level)));
  }

  // speakAsK/speakClosingLine으로 "이 문장을 그대로 말해줘"라고 지시했을 때 이미 검증된
  // 안전한 원문 — 모델이 실제로 낸 outputTranscription이 프롬프트 누출 패턴을 포함하면
  // 화면 말풍선·transcript에는 이 원문으로 대체한다(음성은 이미 재생되어 되돌릴 수 없음).
  const kTurnExpectedTextRef = useRef<string | null>(null);
  const kTurnLeakDetectedRef = useRef(false);
  const expectingInterruptRef = useRef(false);

  const internalSeqRef = useRef(0);
  const displaySequenceCounterRef = options?.displaySequenceCounterRef ?? internalSeqRef;
  const nextDisplaySequence = useCallback(() => {
    displaySequenceCounterRef.current += 1;
    return displaySequenceCounterRef.current;
  }, [displaySequenceCounterRef]);

  const getLogPrefix = useCallback(() => {
    return `[K][conn=${connectionIdRef.current}][kTurn=${activeKTurnIdRef.current}][cTurn=${activeChildTurnIdRef.current}][seq=${displaySequenceCounterRef.current}]`;
  }, [displaySequenceCounterRef]);

  // ── 스케줄 기반 오디오 재생 (갭 없는 gapless 재생) ─────────
  // 이전 큐/playNext 방식은 onended→start 사이 JS 이벤트 루프 갭으로 파직거림 발생.
  // AudioContext.currentTime 기반 startAt 스케줄링으로 버퍼 경계 클릭 제거.
  const scheduledSourcesRef = useRef<{ source: AudioBufferSourceNode; watchdogTimer: NodeJS.Timeout }[]>([]);
  const nextScheduleTimeRef = useRef(0);
  // 이번 K 턴 동안 scheduleAudio가 실제로 예약한 오디오 버퍼 길이 합(ms) — 길이 준수 진단
  // 로그(logKTurnLengthCompliance)가 턴 완료 시 읽고 다음 턴을 위해 리셋한다.
  const kTurnAudioMsRef = useRef(0);

  // K/아이 턴 스트리밍 누적 버퍼 — 이전엔 startSession 클로저의 지역 let이라 export된
  // sendActivityStart(수동 barge-in) 등 클로저 밖에서는 진행 중인 K 턴을 확정할 수 없었다.
  // 아이가 K 발화 도중 끼어드는 순간 "지금까지 표시된 텍스트"로 K 턴을 즉시 확정하려면
  // 훅 스코프에서 접근 가능해야 하므로 ref로 승격한다. startSession에서 세션마다 리셋한다.
  const pendingKTextRef = useRef("");
  const pendingChildTextRef = useRef("");

  // 콜백 ref — 렌더마다 최신 함수 유지
  const onTurnCompleteRef = useRef<((turn: Turn) => void) | undefined>(undefined);
  onTurnCompleteRef.current = options?.onTurnComplete;
  const onServerTurnCompleteRef = useRef<(() => void) | undefined>(undefined);
  onServerTurnCompleteRef.current = options?.onServerTurnComplete;
  const onAudioQueueDrainedRef = useRef<(() => void) | undefined>(undefined);
  onAudioQueueDrainedRef.current = options?.onAudioQueueDrained;
  const onClosingAudioChunkRef = useRef<(() => void) | undefined>(undefined);
  onClosingAudioChunkRef.current = options?.onClosingAudioChunk;
  const onTranscriptRejectedRef = useRef<(() => void) | undefined>(undefined);
  onTranscriptRejectedRef.current = options?.onTranscriptRejected;
  const onAudioLevelChangeRef = useRef<((level: number) => void) | undefined>(undefined);
  onAudioLevelChangeRef.current = options?.onAudioLevelChange;
  const onKTurnFirstOutputRef = useRef<(() => void) | undefined>(undefined);
  onKTurnFirstOutputRef.current = options?.onKTurnFirstOutput;
  const onKTurnTimeoutRef = useRef<(() => void) | undefined>(undefined);
  onKTurnTimeoutRef.current = options?.onKTurnTimeout;
  const onRecoveryNeededRef = useRef<(() => void) | undefined>(undefined);
  onRecoveryNeededRef.current = options?.onRecoveryNeeded;
  const onNoAudioInputRef = useRef<((active: boolean) => void) | undefined>(undefined);
  onNoAudioInputRef.current = options?.onNoAudioInput;
  const kTurnHasAudioRef = useRef(false);
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 현재 armed 된 no-response watchdog 이 "어느 K generation 의 완료를 기다리는지" 저장한다.
  // watchdog 은 전역 단일 타이머이고 서버 turnComplete 에는 generation id 가 실려오지 않으므로,
  // 이 소유 generation 을 함께 추적해야 (a)그 generation 의 완료/강제컷 turnComplete 일 때만,
  // 또는 (b)그 generation 이 seal(=barge-in 등으로 취소/대체)될 때만 정확히 해제할 수 있다.
  const watchdogOwnerGenRef = useRef<string | null>(null);

  function clearWatchdogTimer() {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    watchdogOwnerGenRef.current = null;
  }

  // 클라이언트 VAD 및 자동·수동 모드 상태 관리 Ref
  const interactionModeRef = useRef<"auto" | "manual">("auto");
  const vadStateRef = useRef<"idle" | "candidate" | "active">("idle");
  const candidateBufferRef = useRef<Float32Array>(new Float32Array(0));
  const isChildSpeakingRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechStartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRmsRef = useRef<number>(0);

  // 후보 버퍼 및 타이머 정리 유틸
  const appendToCandidateBuffer = useCallback((newSamples: Float32Array) => {
    const current = candidateBufferRef.current;
    const merged = new Float32Array(current.length + newSamples.length);
    merged.set(current);
    merged.set(newSamples, current.length);
    
    // 최대 200ms 분량만 남김 (16000Hz * 0.2s = 3200 samples)
    const maxSamples = Math.round(16000 * (VAD_CONFIG.MAX_CANDIDATE_BUFFER_MS / 1000));
    if (merged.length > maxSamples) {
      candidateBufferRef.current = merged.slice(merged.length - maxSamples);
    } else {
      candidateBufferRef.current = merged;
    }
  }, []);

  const clearVadTimersAndBuffers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (speechStartTimerRef.current) {
      clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
    }
    candidateBufferRef.current = new Float32Array(0);
    vadStateRef.current = "idle";
    isChildSpeakingRef.current = false;
  }, []);

  // 미션 종료 플로우 전용 하드 락 — 상태 전이:
  //  - "none"(평상시)
  //  - "locked": 미션 완료를 인지한 즉시(lockNow()) 진입 — 이후 모든 서버 메시지를 완전히 무시.
  //    5번째 답변을 처리하던 턴의 잔여 오디오/추가 질문이 화면·스피커에 새어나오는 것을 즉시 차단.
  //  - "closingActive": speakClosingLine()이 전용 종료 발화를 보내기 직전에 잠시 락을 푼 상태 —
  //    그 종료 턴의 메시지(오디오/전사)는 통과시키되, 그 턴의 turnComplete가 오면 다시 "locked"로
  //    영구 전환한다. locked 중에 도착한(종료 발화 이전의) 턴은 여전히 정상적으로 버려진다.
  // 예전의 "armed"(현재 턴은 끝까지 재생하고 그 turnComplete에서 locked로) 방식은, 종료 발화가
  // 5번째 답변 턴의 자연스러운 연속으로 이미 다 재생돼버린 뒤에야 락이 걸려 버그①(음성 없이
  // 텍스트만)을 유발했으므로 폐기했다.
  const postCompletionLockRef = useRef<"none" | "locked" | "closingActive">("none");
  // appendTurn/seedTranscript가 부여하는 message_id 생성용 순번 — startSession(preserveHistory
  // 아닐 때) 시 초기화. 배열 index 대신 이 id로 React key를 잡아야 렌더 중 재조정으로 인한
  // 말풍선 오표시를 막는다.
  const turnSeqRef = useRef(0);
  function nextTurnId(): string {
    turnSeqRef.current += 1;
    return `t${turnSeqRef.current}`;
  }
  // speakClosingLine()이 보낸 종료 턴에서 "실제 오디오가 처음 스케줄된 순간"을 정확히 1회만
  // onClosingAudioChunk로 통지하기 위한 가드 — speakClosingLine() 호출 시 false로 리셋.
  const closingAudioStartedFiredRef = useRef(false);

  // STT 모드 ref — startSession 클로저에서 최신값 참조
  const sttModeRef = useRef<"gemini" | "gcp">(options?.sttMode ?? "gemini");
  sttModeRef.current = options?.sttMode ?? "gemini";

  // Live 음성 ref — startSession 클로저(연결 시점)에서 최신값 참조
  const voiceNameRef = useRef<string>(options?.voiceName ?? "Aoede");
  voiceNameRef.current = options?.voiceName ?? "Aoede";

  // usage_events(live_audio) start/end 호출 및 GCP STT 계측용 세션 ID
  const getSessionIdRef = useRef<(() => string | null) | undefined>(undefined);
  getSessionIdRef.current = options?.getSessionId;
  const getChildIdRef = useRef<(() => string | null) | undefined>(undefined);
  getChildIdRef.current = options?.getChildId;
  const conversationModeRef = useRef<string | undefined>(options?.conversationMode);
  conversationModeRef.current = options?.conversationMode;
  // teardown()이 여러 지점(정상 종료/에러/언마운트)에서 중복 호출돼도 end 요청은 1회만 나가도록 가드
  const liveUsageStartedRef = useRef(false);
  // Gemini usageMetadata의 최신(세션 누적) 토큰 카운트 — end 시점에 /api/usage/live로 전달.
  const lastTokenInRef = useRef<number | null>(null);
  const lastTokenOutRef = useRef<number | null>(null);

  function notifyUsageLive(event: "start" | "end") {
    const sessionId = getSessionIdRef.current?.();
    if (!sessionId) return;
    if (event === "start") {
      liveUsageStartedRef.current = true;
      lastTokenInRef.current = null;
      lastTokenOutRef.current = null;
    }
    if (event === "end" && !liveUsageStartedRef.current) return;
    if (event === "end") liveUsageStartedRef.current = false;
    const tokenIn = lastTokenInRef.current;
    const tokenOut = lastTokenOutRef.current;
    const conversationMode = conversationModeRef.current;
    fetch("/api/usage/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        sessionId,
        ...(conversationMode ? { conversationMode } : {}),
        ...(event === "end" && tokenIn != null && tokenOut != null ? { tokenIn, tokenOut } : {}),
      }),
    }).catch(() => {});
  }

  // GCP STT용 child 턴 오디오 버퍼 (PCM16 raw bytes 청크) — 매 턴 flush 후 리셋
  const childAudioChunksRef = useRef<Uint8Array[]>([]);

  // 진단 카운터 — 첫 8개 서버 메시지의 serverContent 키를 콘솔에 출력
  const diagCountRef = useRef(0);
  const waitingForLiveReceiveRef = useRef(false);

  function updateStatus(s: SessionStatus) {
    statusRef.current = s;
    setStatus(s);
    // 연결 품질 표시가 상태 변화(연결됨/끊김/에러 등) 즉시 반영되도록 매 전이마다 재계산한다.
    recomputeConnectionQuality();
  }

  function logTelemetryEvent(eventName: string) {
    const sid = getSessionIdRef.current?.() || "unknown";
    const tid = activeKTurnIdRef.current || "unknown";
    const gid = currentKGenerationIdRef.current || "unknown";
    console.error(JSON.stringify({
      event: eventName,
      time: Date.now(),
      sessionId: sid,
      turnId: tid,
      generationId: gid
    }));
  }

  // "마이크 입력 없음" UI 신호 전환 — WebSocket/Vertex 세션은 전혀 건드리지 않는다(요구사항 4).
  function updateNoAudioInput(next: boolean) {
    if (noAudioInputRef.current === next) return;
    noAudioInputRef.current = next;
    setNoAudioInput(next);
    onNoAudioInputRef.current?.(next);
    logVoiceEvent({ ts: Date.now(), eventType: "noAudioInput", extra: { active: next } });
  }

  // VAD 게이트 동작(rms/threshold/micEnabled/kSpeaking/실제 전송 여부)을 debug timeline에 남긴다
  // — NEXT_PUBLIC_DEBUG_VOICE_TIMELINE이 꺼져 있으면 logVoiceEvent 자체가 no-op이라 프로덕션에는
  // 영향이 없다. force=true(상태 전환 시점)가 아니면 VAD_SAMPLE_LOG_THROTTLE_MS로 스로틀링한다.
  function logVadSample(params: { rms: number; chunkSent: boolean; force?: boolean }) {
    const now = Date.now();
    if (!params.force && now - lastVadSampleLogAtRef.current < VAD_SAMPLE_LOG_THROTTLE_MS) return;
    lastVadSampleLogAtRef.current = now;
    logVoiceEvent({
      ts: now,
      eventType: "vadSample",
      mode: "live",
      micEnabled: micEnabledRef.current,
      extra: {
        rms: params.rms,
        threshold: VAD_CONFIG.RMS_THRESHOLD,
        kSpeaking: kSpeakingRef.current,
        chunkSent: params.chunkSent,
        vadState: vadStateRef.current,
      },
    });
  }

  function clearGenerationTimeout() {
    if (generationTimeoutRef.current) {
      clearTimeout(generationTimeoutRef.current);
      generationTimeoutRef.current = null;
    }
  }

  function startGenerationTimeout() {
    clearGenerationTimeout();
    const epoch = generationEpochRef.current;
    generationTimeoutRef.current = setTimeout(() => {
      if (generationEpochRef.current !== epoch) return;
      if (!hasFiredFirstOutputRef.current) {
        logTelemetryEvent("generationTimeout");
        cancelCurrentGeneration();
        onKTurnTimeoutRef.current?.();
      }
    }, 8000);
  }

  // 강제컷된 K 턴에 대해서만 동작 — 서버 turnComplete(kTurnCutServerDoneRef)와 오디오 큐
  // drain(scheduledSourcesRef 비고 kSpeakingRef false)이 둘 다 확인된 시점에만 다음 아이
  // 턴을 위해 childTurnFlushedRef를 초기화한다.
  function maybeUnlockCutChildTurn() {
    if (!kTurnCutAwaitingUnlockRef.current) return;
    if ((kTurnCompleteRef.current || recoveryGateOpenRef.current) && scheduledSourcesRef.current.length === 0 && !kSpeakingRef.current) {
      kTurnCutAwaitingUnlockRef.current = false;
      childTurnFlushedRef.current = false;
    }
  }

  // speakAsK/speakClosingLine이 지시한 안전한 원문(kTurnExpectedTextRef)이 있는 턴에서,
  // 모델이 실제로 낸 텍스트가 프롬프트 누출 패턴을 포함했다면 그 원문으로 대체해 반환한다.
  // transcriptRef의 마지막 "k" 말풍선도 함께 교정한다(appendTurn이 이미 누출 조각을
  // 붙여놨을 수 있으므로).
  function finalizeKTurnText(rawText: string): string {
    if (!kTurnLeakDetectedRef.current || !kTurnExpectedTextRef.current) return rawText;
    const safeText = kTurnExpectedTextRef.current;
    const prev = transcriptRef.current;
    const existingIdx = prev.findIndex(t => t.id === activeKTurnIdRef.current);
    if (existingIdx !== -1 && !prev[existingIdx].sealed) {
      const newPrev = [...prev];
      newPrev[existingIdx] = { ...newPrev[existingIdx], text: safeText };
      transcriptRef.current = newPrev;
    } else {
      transcriptRef.current = [...prev, { role: "k", text: safeText, id: activeKTurnIdRef.current ?? nextTurnId(), generationId: currentKGenerationIdRef.current ?? undefined, displaySequence: activeKTurnDisplaySequenceRef.current ?? nextDisplaySequence() }];
    }
    setTranscript([...transcriptRef.current]);
    return safeText;
  }

  // K 턴 길이 준수 진단 로그 — 원문 없이 구조적 신호만(글자 수·물음표 개수·실제 재생
  // 시간ms). K_SYSTEM_PROMPT의 "40자 이내·5초 이내·질문 1개" 규칙을 이 턴에서 실제로
  // 지켰는지 배포 후에도 원문 없이 확인할 수 있게 한다. kTurnAudioMsRef는 scheduleAudio가
  // 이 K 턴 동안 누적한 재생 시간이며, 여기서 로그 후 다음 턴을 위해 리셋한다.
  function logKTurnLengthCompliance(finalText: string) {
    const questionMarkCount = (finalText.match(/\?/g) ?? []).length;
    const audioMs = Math.round(kTurnAudioMsRef.current);
    console.log("[K] length-compliance", {
      charCount: finalText.length,
      questionMarkCount,
      audioMs,
      withinCharLimit: finalText.length <= 40,
      withinQuestionLimit: questionMarkCount <= 1,
      within5s: audioMs <= 5000,
    });
    kTurnAudioMsRef.current = 0;
  }

  // 진행 중인 K 턴을 "지금까지 표시된 텍스트"로 즉시 확정한다(onTurnComplete 1회 발화 +
  // 길이 준수 로그 + pendingKText 리셋). 아이 barge-in(활동 시작)과 서버 interrupted 신호에서
  // 공통으로 쓴다 — pendingKTextRef가 비어 있으면 아무 것도 하지 않는 안전한 no-op이라
  // 중복 호출(클라이언트 VAD 컷 + 서버 interrupted 동시 도착)에도 K 턴이 두 번 저장되지 않는다.
  function finalizeActiveKTurn() {
    if (pendingKTextRef.current) {
      const finalText = finalizeKTurnText(pendingKTextRef.current);
      const kTurn = transcriptRef.current.find(t => t.id === activeKTurnIdRef.current);
      onTurnCompleteRef.current?.({ 
        role: "k", 
        text: finalText, 
        id: kTurn?.id ?? activeKTurnIdRef.current ?? undefined, 
        displaySequence: kTurn?.displaySequence ?? activeKTurnDisplaySequenceRef.current ?? undefined 
      });
      logKTurnLengthCompliance(finalText);
      pendingKTextRef.current = "";
    }
    kTurnExpectedTextRef.current = null;
    kTurnLeakDetectedRef.current = false;
  }

  // 아이가 K 발화 도중 말을 시작한 순간 호출 — 현재 K 턴을 확정하고, 서버가 계속 보내는
  // 이 K 턴의 잔여 오디오/텍스트/turnComplete를 전부 폐기하도록 컷 상태로 전환한다.
  // K가 실제로 말하는 중이 아니었으면(정상적인 아이 차례 시작) 컷 플래그는 세우지 않는다 —
  // 그러지 않으면 존재하지도 않는 K 턴을 컷 대기로 잠가 다음 흐름이 막힌다.
  // 새 generation을 시작하기 직전에 호출 — 지금까지의 currentKGenerationIdRef를
  // cancelledGenerationIdsRef에 봉인한다. 이걸 안 하면, Vertex가 이미 끝난 이전
  // generation에 대해 뒤늦게(수 초~수십 초 후) 보내는 자발적 추가 응답("모델이 스스로
  // 이어가려는 문장" — lockNow 주석에도 명시된 기존에 알려진 모델 동작)이, handleMessage가
  // incomingGenerationId를 항상 "그 시점의 현재" ref 값과 비교하는 탓에 이미 새로 바뀐
  // generation/턴 소속으로 오인되어 재생된다 — 아이 발화 1회에 케이가 2회 응답하는 P0 버그의
  // 근본 원인. cutActiveKTurnForBargeIn()이 barge-in 시나리오에서만 하던 봉인을, K가 새
  // 턴(자동/수동 activityEnd, speakClosingLine/sendText/speakAsK)을 시작하는 모든 지점으로
  // 확장한다.
  function sealCurrentGeneration() {
    if (currentKGenerationIdRef.current) {
      const set = cancelledGenerationIdsRef.current;
      set.add(currentKGenerationIdRef.current);
      if (set.size > 50) {
        const first = set.values().next().value;
        if (first) set.delete(first);
      }
      // 이 generation 이 현재 watchdog 의 소유자라면, 여기서 그 턴이 취소/대체되는 것이므로
      // (barge-in 으로 아이가 케이 발화 도중 끼어들어 새 턴으로 넘어가는 등) no-response
      // watchdog 을 해제한다 — 취소된 턴은 재연결로 복구할 필요가 없다. 안 그러면 그 턴의
      // turnComplete 가 isCancelledGeneration 조기 return 에 걸려 watchdog 이 orphan 되어
      // 10초 뒤 멀쩡한 세션을 teardown+재연결한다("질문 도중 끼어들기" 후 발생하던 원인).
      if (watchdogOwnerGenRef.current === currentKGenerationIdRef.current) {
        clearWatchdogTimer();
      }
    }
  }

  // GCP STT 모드에서 K-A 억제를 위해 currentKGenerationIdRef를 null로 비운 직후 호출한다.
  // K-A 자신의 turnComplete가 도착(settleNow) 또는 안전 타임아웃 전까지, speakAsK/
  // speakClosingLine이 다음 K 발화를 시작하지 않고 pendingPostSettleActionRef에 대기시킨다.
  function armSettleWait() {
    awaitingNullGenerationSettleRef.current = true;
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = setTimeout(() => {
      console.warn(`${getLogPrefix()} ⚠️ K-A(억제된 generation) turnComplete 대기 타임아웃 — 강제 settle`);
      settleTimeoutRef.current = null;
      settleNow();
    }, 4000);
  }

  function settleNow() {
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
    awaitingNullGenerationSettleRef.current = false;
    const action = pendingPostSettleActionRef.current;
    pendingPostSettleActionRef.current = null;
    action?.();
  }

  function cutActiveKTurnForBargeIn() {
    clearGenerationTimeout();
    hasFiredFirstOutputRef.current = false;
    const kWasActive =
      pendingKTextRef.current !== "" ||
      kSpeakingRef.current ||
      scheduledSourcesRef.current.length > 0;
    generationEpochRef.current += 1;
    finalizeActiveKTurn();
    sealCurrentGeneration();
    currentKGenerationIdRef.current = null; // 이전 generation의 이벤트 전부 폐기
    if (kWasActive) {
      kTurnCutRef.current = true;
      kTurnCutAwaitingUnlockRef.current = true;
      kTurnCutServerDoneRef.current = false;
    }
  }

  const cancelCurrentGeneration = useCallback(() => {
    clearWatchdogTimer();
    cutActiveKTurnForBargeIn();
    logTelemetryEvent("generationCancelled");
  }, []);

  // 실제 사용자 제스처(탭) 호출 스택 안에서 불러야 효과가 있다(Android Chrome 자동재생
  // 정책) — outputCtxRef가 "suspended"면 resume()을 시도하고 결과에 따라 audioLocked를
  // 갱신한다. 이미 running이면 즉시 true를 반환하는 사실상 no-op이라 어디서나 안전하게
  // 호출할 수 있다(중복 호출 다수 발생해도 문제 없음).
  async function ensureOutputAudioRunning(): Promise<boolean> {
    const ctx = outputCtxRef.current;
    if (!ctx) return false;
    if (ctx.state === "running") {
      setAudioLocked(false);
      return true;
    }
    try {
      await ctx.resume();
    } catch {
      // NotAllowedError 등 — 제스처 밖에서 호출된 경우 흔히 발생, 아래에서 상태로만 반영
    }
    const running = outputCtxRef.current?.state === "running";
    setAudioLocked(!running);
    return running;
  }

  function scheduleAudio(base64: string) {
    logVoiceEvent({ ts: Date.now(), eventType: "audioChunkReceived", audioQueueLength: scheduledSourcesRef.current.length, extra: { approxBytes: Math.floor(base64.length * 3 / 4) } });
    if (audioMutedRef.current) {
      return;
    }
    const ctx = outputCtxRef.current;
    if (!ctx) {
      return;
    }
    // suspended여도 아래 스케줄 자체는 그대로 진행한다(Web Audio는 컨텍스트 시간이 멈춘
    // 채로 미래 시각에 재생 예약만 큐잉해두고, resume되면 그 시각부터 순서대로 이어서
    // 재생한다 — 즉 여기서 청크를 버리지 않아도 이미 안전하다). resume 자체는 best-effort로
    // 병행 시도만 해둔다(제스처 밖 호출이라 실패해도 무해 — 실패 시 audioLocked만 갱신).
    if (ctx.state !== "running") {
      void ensureOutputAudioRunning();
    }
    try {
      const audioBuffer = decodePCM16(base64, ctx.sampleRate);
      // 20ms lookahead — 버퍼가 도착하기 전 컨텍스트 시간을 지나치지 않도록
      const startAt = Math.max(ctx.currentTime + 0.02, nextScheduleTimeRef.current);
      if (kTurnAudioMsRef.current === 0) {
        console.log(`${getLogPrefix()} 🔊 scheduleAudio 재생 시작`);
        console.error(`[Timing] (e) 케이 첫 오디오 재생 시작 - ${Date.now()}`);
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(startAt);
      nextScheduleTimeRef.current = startAt + audioBuffer.duration;
      const watchdogDelayMs = Math.max(0, (startAt + audioBuffer.duration - ctx.currentTime) * 1000) + 2000;
      const watchdogTimer = setTimeout(() => {
        console.warn(`${getLogPrefix()} ⚠️ 오디오 재생 종료(onended) 신호가 오지 않아 워치독이 강제로 재생 큐를 정리함`);
        handleSourceEnded(true);
      }, watchdogDelayMs);

      scheduledSourcesRef.current.push({ source, watchdogTimer });
      kTurnAudioMsRef.current += audioBuffer.duration * 1000;
      kTurnHasAudioRef.current = true;

      if (!kSpeakingRef.current) {
        kSpeakingRef.current = true; // 재생 시작 — 마이크 무음 유지
        // 브라우저 STT 엔진 자체를 정지시킨다 — onresult 콜백에서 결과를 걸러내는 것만으로는
        // 부족하다(isFinal 결과가 실제 발화보다 수백ms~1초 늦게 도착해, K가 말을 끝내고
        // kSpeakingRef가 false로 풀린 뒤에야 에코 인식 결과가 도착해 가드를 통과하는 경우가 있었음).
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* 이미 정지 상태 등 */ }
        }
        speechHistoryRef.current = "";
        setInterimChildText("");
      }

      const epoch = generationEpochRef.current;
      function handleSourceEnded(isWatchdog: boolean) {
        const arr = scheduledSourcesRef.current;
        const i = arr.findIndex(item => item.source === source);
        if (i === -1) return; // 이미 처리됨

        const item = arr[i];
        if (!isWatchdog) {
          clearTimeout(item.watchdogTimer);
        } else {
          // 워치독 발동 — 화면 복귀 등으로 AudioContext가 되살아났을 때 이 소스가 뒤늦게
          // 다시 재생되며 이미 재개된 마이크와 겹치는 일이 없도록 명시적으로 정지시킨다
          // (codex 지적: 벽시계 타이머만으로는 "정말 끝났는지"를 보장할 수 없다).
          try { source.stop(); } catch { /* 이미 정지/종료된 경우 무시 */ }
        }
        arr.splice(i, 1);

        // barge-in 컷 등으로 이미 다음 세대로 넘어간 낡은 엔트리라면, 큐에서 제거만 하고
        // "재생 종료" 후속 처리(마이크 재개 등)는 현재 세대 몫이 아니므로 실행하지 않는다
        // — 이 체크를 배열 정리보다 먼저 하면 낡은 엔트리가 영원히 배열에 남아, 그 뒤로는
        // arr.length가 다시는 0이 되지 않아 마이크가 영구적으로 막히는 문제가 있었다(codex 지적).
        if (generationEpochRef.current !== epoch) return;

        if (arr.length === 0) {
          console.log(`${getLogPrefix()} 🔇 scheduleAudio 재생 종료 (큐 비워짐)`);
          kSpeakingRef.current = false; // 마지막 버퍼 재생 종료 — 마이크 재개
          maybeUnlockCutChildTurn();
          logVoiceEvent({ ts: Date.now(), eventType: "audioQueueDrained" });
          onAudioQueueDrainedRef.current?.();
          // 스피커 잔향이 빠질 시간을 약간 두고 브라우저 STT 재시작
          if (ENABLE_STT_FALLBACK && sttModeRef.current !== "gcp") {
            setTimeout(() => {
              if (generationEpochRef.current !== epoch) return;
              if (!kSpeakingRef.current && statusRef.current === "live" && micEnabledRef.current) {
                childTurnFlushedRef.current = false;
                try { recognitionRef.current?.start(); } catch { /* 이미 실행 중인 경우 무시 */ }
              }
            }, 300);
          } else {
            childTurnFlushedRef.current = false;
          }
        }
      }

      source.onended = () => {
        handleSourceEnded(false);
      };
    } catch { /* 손상된 프레임 무시 */ }
  }

  function stopAllScheduledSources() {
    scheduledSourcesRef.current.forEach(item => {
      clearTimeout(item.watchdogTimer);
      try { item.source.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    nextScheduleTimeRef.current = 0;
    kSpeakingRef.current = false;
  }

  function appendTurn(turn: Turn) {
    const prev = transcriptRef.current;
    
    if (turn.role === "child") {
      const existingIdx = prev.findIndex(t => turn.id && t.id === turn.id);
      if (existingIdx !== -1) {
        const newPrev = [...prev];
        newPrev[existingIdx] = { ...newPrev[existingIdx], ...turn };
        for (let i = 0; i < existingIdx; i++) {
          if (newPrev[i].role === "k") newPrev[i].sealed = true;
        }
        transcriptRef.current = newPrev;
      } else {
        const sealedPrev = prev.map(t => t.role === "k" ? { ...t, sealed: true } : t);
        transcriptRef.current = [...sealedPrev, { ...turn, id: turn.id ?? nextTurnId(), displaySequence: turn.displaySequence ?? nextDisplaySequence() }];
      }
      setTranscript([...transcriptRef.current]);
      return;
    }

    if (turn.role === "k") {
      if (currentKGenerationIdRef.current === null) return;
      if (turn.generationId && turn.generationId !== currentKGenerationIdRef.current) return;
      const turnKey = `${turn.id ?? activeKTurnIdRef.current}:${turn.generationId}`;
      if (turn.generationId && processedTurnGenerationsRef.current.has(turnKey)) return;

      const existingIdx = prev.findIndex(t => turn.id && t.id === turn.id);
      if (existingIdx !== -1) {
        const newPrev = [...prev];
        const existing = newPrev[existingIdx];
        newPrev[existingIdx] = { 
          ...existing, 
          text: existing.text + turn.text, 
          generationId: turn.generationId ?? existing.generationId 
        };
        transcriptRef.current = newPrev;
        setTranscript([...transcriptRef.current]);
        return;
      }

      const last = prev[prev.length - 1];
      if (last?.role === "k" && last.generationId === turn.generationId && !last.sealed) {
        transcriptRef.current = [...prev.slice(0, -1), { ...last, text: last.text + turn.text }];
      } else {
        transcriptRef.current = [...prev, { ...turn, id: turn.id ?? activeKTurnIdRef.current ?? nextTurnId(), displaySequence: turn.displaySequence ?? nextDisplaySequence() }];
      }
      setTranscript([...transcriptRef.current]);
      return;
    }
  }

  function concatChunksToBase64(chunks: Uint8Array[]): string {
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    let binary = "";
    for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]);
    return btoa(binary);
  }

  // 누적 오디오를 /api/mission/stt(GCP Speech-to-Text, ko-KR 고정)로 1회 전사. 성공+비어있지
  // 않으면 전사 문자열을, 실패/빈 응답이면 null을 반환한다(호출부가 fallbackText로 대체).
  async function postMissionStt(audioBase64: string, sessionId: string | null): Promise<string | null> {
    try {
      const res = await fetch("/api/mission/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, sessionId }),
      });
      if (!res.ok) return null;
      const { transcript } = await res.json();
      if (typeof transcript === "string" && transcript.trim()) return transcript.trim();
      return null;
    } catch {
      return null;
    }
  }

  // child 턴 flush — gemini 모드는 즉시 동기 처리(기존 동작 유지),
  // gcp 모드는 누적 오디오를 /api/mission/stt로 전사(fire-and-forget)해 최종 텍스트로 콜백.
  function flushChildTurn(fallbackText: string) {
    logVoiceEvent({ ts: Date.now(), eventType: "flushChildTurn_start", childTurnId: activeChildTurnIdRef.current ?? undefined, textPreview: maskText(fallbackText) });
    // 이번 아이 발화 턴은 이미 flush됨 — 브라우저 STT 폴백/Gemini 전사 중 먼저 도착한
    // 한쪽만 반영하고 나머지는 무시(말풍선 중복 생성 방지)
    if (childTurnFlushedRef.current) {
      logVoiceEvent({ ts: Date.now(), eventType: "flushChildTurn_complete", childTurnId: activeChildTurnIdRef.current ?? undefined, textPreview: maskText(fallbackText) });
      return;
    }
    childTurnFlushedRef.current = true;
    logTelemetryEvent("transcriptFinal");

    if (sttModeRef.current !== "gcp") {
      const cid = activeChildTurnIdRef.current ?? nextTurnId();
      const seq = activeChildTurnDisplaySequenceRef.current ?? nextDisplaySequence();
      appendTurn({ role: "child", text: fallbackText, id: cid, displaySequence: seq });
      onTurnCompleteRef.current?.({ role: "child", text: fallbackText, id: cid, displaySequence: seq });
      logVoiceEvent({ ts: Date.now(), eventType: "flushChildTurn_complete", childTurnId: activeChildTurnIdRef.current ?? undefined, textPreview: maskText(fallbackText) });
      return;
    }

    const chunks = childAudioChunksRef.current;
    childAudioChunksRef.current = [];
    const cid = activeChildTurnIdRef.current ?? nextTurnId();
    const seq = activeChildTurnDisplaySequenceRef.current ?? nextDisplaySequence();

    void (async () => {
      try {
        let finalText: string | null;
        if (chunks.length > 0) {
          // base64는 1회만 계산해두고 최대 2회까지 POST(resolveFinalTranscript의 재시도용).
          const audioBase64 = concatChunksToBase64(chunks);
          const sessionId = getSessionIdRef.current?.() ?? null;
          finalText = await resolveFinalTranscript(() => postMissionStt(audioBase64, sessionId), fallbackText);
        } else {
          finalText = validateFinalTranscript(fallbackText); // 오디오가 아예 없던 경우도 동일 검증 경로를 거친다
        }

        if (finalText) {
          setInterimChildText("");
          appendTurn({ role: "child", text: finalText, id: cid, displaySequence: seq });
          onTurnCompleteRef.current?.({ role: "child", text: finalText, id: cid, displaySequence: seq });
        } else {
          // 어떤 후보도 검증을 통과 못함 — 반영하지 않고, 다음 발화를 다시 받을 수 있게
          // flush 플래그를 풀고 재질문 요청.
          setInterimChildText("");
          childTurnFlushedRef.current = false;
          onTranscriptRejectedRef.current?.();
        }
      } catch (err) {
        console.error("[GCP STT] Error in flushChildTurn:", err);
        setInterimChildText("");
        childTurnFlushedRef.current = false;
        onTranscriptRejectedRef.current?.();
      } finally {
        manualFinalizingRef.current = false;
      }
    })();
    logVoiceEvent({ ts: Date.now(), eventType: "flushChildTurn_complete", childTurnId: activeChildTurnIdRef.current ?? undefined, textPreview: maskText(fallbackText) });
  }

  function teardown(reason: string = "unknown") {
    console.log(getLogPrefix(), "🧹 teardown called, reason:", reason);
    clearVadTimersAndBuffers();
    // 세션이 끊기는 시점에 "마이크 입력 없음" 표시가 다음 세션까지 이어지지 않도록 정리한다.
    silenceEligibleSinceRef.current = null;
    if (noAudioInputRef.current) updateNoAudioInput(false);
    clearGenerationTimeout();
    clearWatchdogTimer();
    if (turnCompleteFallbackTimerRef.current) {
      clearTimeout(turnCompleteFallbackTimerRef.current);
      turnCompleteFallbackTimerRef.current = null;
    }
    if (closeReconnectTimerRef.current) {
      clearTimeout(closeReconnectTimerRef.current);
      closeReconnectTimerRef.current = null;
    }
    if (stabilityResetTimerRef.current) {
      clearTimeout(stabilityResetTimerRef.current);
      stabilityResetTimerRef.current = null;
    }
    if (qualityRecomputeIntervalRef.current) {
      clearInterval(qualityRecomputeIntervalRef.current);
      qualityRecomputeIntervalRef.current = null;
    }
    // settle-wait 대기 상태를 여기서 반드시 정리한다 — 안 하면, 세션이 끊기고 4초 안에
    // 재연결돼 새 세션이 live가 될 경우, 이전(끊긴) 세션에서 대기하던 pendingPostSettleAction
    // (예: speakAsK)이 새 세션에서 뒤늦게 실행되어 엉뚱한 K 발화를 유발할 수 있다.
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
    awaitingNullGenerationSettleRef.current = false;
    pendingPostSettleActionRef.current = null;

    notifyUsageLive("end");
    stopAllScheduledSources();
    processorRef.current?.disconnect();
    processorRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    outputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current = null;
    const sess = sessionRef.current;
    sessionRef.current = null;
    try { sess?.close(); } catch { /* 이미 닫힌 경우 무시 */ }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    childAudioChunksRef.current = [];
    setInterimChildText("");
    manualFinalizingRef.current = false;
  }

  const initSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "ko-KR";

    rec.onresult = (event: any) => {
      // K가 발화 재생 중이면 스피커 소리가 마이크로 들어온 에코일 뿐이므로 완전히 무시(에코 루프 방지)
      if (kSpeakingRef.current) return;
      // Gemini 자체 inputTranscription이 이 턴에 대해 이미 도착했다면 폴백은 관여하지 않음(중복 방지)
      if (hasLiveInputTxRef.current) return;

      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = finalTranscript || interimTranscript;
      if (text.trim()) {
        speechHistoryRef.current = text.trim();
        console.log("[STT Fallback] interim text:", speechHistoryRef.current);
      }

      // 실시간 중간 자막 — outTx(케이 응답) 이벤트를 기다리지 않고 화면에 바로 반영
      if (interimTranscript.trim() || finalTranscript.trim()) {
        setInterimChildText((finalTranscript || interimTranscript).trim());
      }

      // 브라우저 자체 무음/구간 감지로 이 발화가 끝났다고 판단되면 즉시 확정 flush
      // (Gemini의 outputTranscription/turnComplete를 기다리지 않음 — 그게 안 와서 자막이 안 뜨던 문제의 핵심 수정)
      if (finalTranscript.trim()) {
        const finalText = finalTranscript.trim();
        speechHistoryRef.current = "";
        setInterimChildText("");
        flushChildTurn(finalText);
      }
    };

    rec.onerror = (e: any) => {
      console.warn("[STT Fallback] error:", e.error);
    };

    rec.onend = () => {
      // K 발화 재생 중엔 재시작하지 않는다 — 재시작은 scheduleAudio()의 재생 종료 콜백이 담당
      // (여기서 무조건 재시작하면 stop()으로 끊어놓은 의미가 없어져 에코가 계속 들어옴).
      if (kSpeakingRef.current) return;
      if (statusRef.current === "live" && micEnabledRef.current && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
  }, []);

  const startSession = useCallback(async (opts?: { preserveHistory?: boolean }) => {
    if (statusRef.current === "live" || statusRef.current === "connecting") return;
    setError(null);
    updateStatus("connecting");
    if (!opts?.preserveHistory) {
      transcriptRef.current = [];
      setTranscript([]);
      turnSeqRef.current = 0;
      if (!options?.displaySequenceCounterRef) internalSeqRef.current = 0;
    }
    diagCountRef.current = 0;
    childTurnFlushedRef.current = false;
    kTurnCutRef.current = false;
    kTurnCutAwaitingUnlockRef.current = false;
    kTurnCutServerDoneRef.current = false;
    kTurnExpectedTextRef.current = null;
    kTurnLeakDetectedRef.current = false;
    hasFiredFirstOutputRef.current = false;
    postCompletionLockRef.current = "none";
    manualFinalizingRef.current = false;
    cancelledGenerationIdsRef.current.clear();
    processedTurnGenerationsRef.current.clear();
    generationEpochRef.current = 0;
    clearGenerationTimeout();
    recoveryGateOpenRef.current = false;

    connectionGenerationRef.current += 1;
    const myGeneration = connectionGenerationRef.current;
    
    // connectionId 생성 및 할당
    connectionIdRef.current = crypto.randomUUID().slice(0, 8);
    const connectionId = connectionIdRef.current;
    activeSessionIdRef.current = connectionId;

    try {
      const childId = getChildIdRef.current?.() ?? null;
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Token fetch failed: ${res.status}`);
      }
      const tokenData: { mode?: string; token?: string; wsUrl?: string; model: string } = await res.json();
      console.log("[K] 🔑 token received, mode:", tokenData.mode, "model:", tokenData.model);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("마이크를 사용하려면 HTTPS로 접속하세요.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
      console.log("[K] 🎙️ mic:", stream.getAudioTracks()[0]?.label);

      // 출력 AudioContext: Gemini는 24kHz PCM16을 보냄
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      outputCtx.onstatechange = () => {
        console.log(`${getLogPrefix()} 🔈 outputCtx state change:`, outputCtx.state, Date.now());
      };
      outputCtxRef.current = outputCtx;
      nextScheduleTimeRef.current = 0;
      // 여기 도달하기 전 이미 await(토큰 fetch, getUserMedia 권한 프롬프트)를 거쳐 원래
      // 제스처의 user-activation이 소진됐을 수 있다 — 되든 안 되든 즉시 한 번 resume을
      // 시도해둔다(대부분의 Android Chrome은 탭 내 어떤 이전 상호작용만 있어도 통과하지만,
      // 실패하면 audioLocked=true로 남아 아래 gesture 핸들러들의 재시도·수동 버튼으로 이어진다).
      await ensureOutputAudioRunning();

      // K 턴/아이 발화 스트리밍 누적 버퍼는 훅 스코프 ref(pendingKTextRef/pendingChildTextRef)로
      // 관리한다 — 이 세션 시작 시점에 리셋한다.
      pendingKTextRef.current = "";
      pendingChildTextRef.current = "";

      // camelCase config — SDK가 직렬화, v1alpha에서 transcription 활성화
      // responseModalities는 AUDIO만 (TEXT 추가 시 native-audio 모델에서 에러 1011/1007로 끊김)
      // speechConfig.voiceName: 설정 메뉴에서 아이가 고른 목소리(child_profiles.live_voice_name)
      // speechConfig.languageCode: 한국어 고정 — 이게 없으면 모델이 발화 언어를 자동판별하다가
      // 일본어/중국어 등으로 잘못 인식하는 경우가 있어 명시적으로 고정한다.
      const liveConfig = {
        responseModalities: ["AUDIO"],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceNameRef.current } },
          languageCode: "ko-KR",
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true,
          },
        },
      };
      console.log("[K] 🔊 Live voiceName:", voiceNameRef.current);

      // ── 공용 핸들러 — AI Studio(SDK 직결)/Vertex(Cloud Run 릴레이) 두 경로가 공유 ──
      function handleOpen() {
        if (myGeneration !== connectionGenerationRef.current) {
          // 이 연결 시도가 더 최신 generation에 의해 이미 대체됨 — 이 시도를 기다리던
          // connectionReadyPromise가 있다면 영원히 대기하지 않도록 실패 처리한다.
          settleConnectionReadyFail("superseded by newer connection generation");
          return;
        }
        console.log(`${getLogPrefix()} ✅ Live session open`);
        updateStatus("live");
        notifyUsageLive("start");
        // relay의 ready(=setupComplete) 수신 시점 — status가 실제로 "live"로 확정된 지금에서야
        // startSession()의 대기 중인 Promise를 resolve한다(P0: setupComplete 이전에 speakAsK(Q1)
        // 이 먼저 실행돼 조용히 버려지는 문제의 근본 수정).
        settleConnectionReadyOk();
        // 연결이 열리자마자 바로 리셋하면 "열리자마자 다시 닫히는" 반복 실패 시나리오에서
        // 매번 1회차로 되돌아가 버려 재연결 제한이 무력화된다(codex 지적) — 일정 시간
        // 안정적으로 열려 있었을 때만 반복-실패 카운터를 리셋한다.
        const STABLE_CONNECTION_MS = 5000;
        clearTimeout(stabilityResetTimerRef.current ?? undefined);
        stabilityResetTimerRef.current = setTimeout(() => {
          closeReconnectCountRef.current = 0;
          stabilityResetTimerRef.current = null;
          // 재연결 카운트가 회복됐으니 연결 품질 표시도 즉시 반영한다(codex 지적 — 안 하면
          // 실제로는 안정화됐는데도 막대가 계속 감점된 채로 남는다).
          recomputeConnectionQuality();
        }, STABLE_CONNECTION_MS);

        // watchdog 발동 기록은 5분이 지나면 더 이상 감점에 반영되지 않아야 하는데,
        // recomputeConnectionQuality()는 호출될 때만 그 창을 다시 계산한다 — 그 사이 아무
        // 이벤트(응답 도착·재연결 등)도 없으면 오래된 감점이 그대로 남는다(codex 지적).
        // 연결이 열려있는 동안 1초마다 재계산해 무응답 지연시간(4~5초) 등이 즉시 반영되게 한다.
        if (qualityRecomputeIntervalRef.current) clearInterval(qualityRecomputeIntervalRef.current);
        qualityRecomputeIntervalRef.current = setInterval(() => {
          recomputeConnectionQuality();
        }, 1000);

        // 로컬 STT 폴백 시작 — gcp 모드에서는 브라우저 폴백을 켜지 않음(초기화도 안 함)
        if (ENABLE_STT_FALLBACK && sttModeRef.current !== "gcp") {
          initSpeechRecognition();
          try {
            recognitionRef.current?.start();
            console.log("[STT Fallback] webkitSpeechRecognition started");
          } catch (err) {
            console.warn("[STT Fallback] failed to start SpeechRecognition:", err);
          }
          speechHistoryRef.current = "";
          hasLiveInputTxRef.current = false;
        }
      }

      

      function handleMessage(msg: NormalizedServerMessage) {
        if (myGeneration !== connectionGenerationRef.current) return;
        if (activeSessionIdRef.current !== connectionId) return;

const incomingGenerationId = currentKGenerationIdRef.current;
        const isCancelledGeneration = incomingGenerationId === null || cancelledGenerationIdsRef.current.has(incomingGenerationId);
        const currentTurnKey = activeKTurnIdRef.current && incomingGenerationId ? `${activeKTurnIdRef.current}:${incomingGenerationId}` : null;
        const isAlreadyProcessed = currentTurnKey ? processedTurnGenerationsRef.current.has(currentTurnKey) : false;

        // K-A(억제된/null 처리된 generation)가 실제로 끝났다는 신호 — armSettleWait()로 대기
        // 중이던 다음 K 발화(K-B)를 지금 시작한다. 이 메시지 자체의 콘텐츠는 isCancelledGeneration
        // 으로 뒤에서 어차피 폐기되지만, settle 판정만은 그 어떤 조기 반환(waitingForLiveReceive/
        // postCompletionLock/usageMetadata/audio data 등)보다도 먼저 확인해야 한다 — 안 그러면
        // turnComplete와 함께 usageMetadata 등이 딸려온 흔한 경우 이 판정이 조용히 스킵되어
        // 매번 4초 안전 타임아웃까지 기다리게 된다.
        if (msg.serverContent?.turnComplete && incomingGenerationId === null && awaitingNullGenerationSettleRef.current) {
          settleNow();
        }

        if (waitingForLiveReceiveRef.current && (msg.serverContent?.outputTranscription || msg.data)) {
          if (isCancelledGeneration) return;
          if (isAlreadyProcessed) return;
          waitingForLiveReceiveRef.current = false;
          logTelemetryEvent("responseStart");
        }

        // 미션 완료 후 하드 락 — 종료 발화 턴의 turnComplete까지 처리한 뒤로는 어떤 서버
        // 메시지(추가 질문·추가 오디오 프레임)도 화면/스피커에 반영하지 않는다.
        if (postCompletionLockRef.current === "locked") return;

        // usageMetadata는 serverContent의 형제 필드이며, 세션 누적치(총합)로 매번 갱신되어 온다.
        // 세션 종료 시 usage_events 비용 계산에 쓸 수 있도록 최신값만 ref에 보관해둔다.
        if (msg.usageMetadata) {
          if (isCancelledGeneration) return;
          if (isAlreadyProcessed) return;
          if (typeof msg.usageMetadata.promptTokenCount === "number") {
            lastTokenInRef.current = msg.usageMetadata.promptTokenCount;
          }
          if (typeof msg.usageMetadata.responseTokenCount === "number") {
            lastTokenOutRef.current = msg.usageMetadata.responseTokenCount;
          }
        }



        // ── 오디오 재생 ──────────────────────────────────────
        // 이번 턴이 강제로 끊긴 상태(kTurnCutRef)면 서버가 계속 보내는 나머지
        // 오디오는 재생하지 않고 버린다(길게 말하는 것을 실제로 막는 부분).
        if (msg.data && !kTurnCutRef.current) {
          if (isCancelledGeneration) return;
          if (isAlreadyProcessed) return;
          // 이 턴에서 프롬프트 누출(메타 발언)이 이미 감지됐다면, 텍스트뿐 아니라 그 뒤에 오는
          // 오디오 청크도 더 이상 재생하지 않는다 — 이미 재생된 앞부분은 되돌릴 수 없지만,
          // 누출이 확정된 시점 이후로는 최대한 짧게 끊는다(볼륨을 임의로 죽이는 게 아니라, 감지된
          // "메타 발언 턴"의 나머지를 재생하지 않는 것).
          if (kSpeechAllowedRef.current && !kTurnLeakDetectedRef.current) {
            if (!hasFiredFirstOutputRef.current) {
              hasFiredFirstOutputRef.current = true;
              clearGenerationTimeout();
              recordFirstOutputLatency();
              logTelemetryEvent("firstAudioChunk");
              onKTurnFirstOutputRef.current?.();
            }
            scheduleAudio(msg.data);
            // 전용 종료 발화 턴에서 실제 오디오가 처음 스케줄된 순간 1회만 통지 —
            // 미션 종료 플로우가 2.5초 TTS 폴백을 취소하는 신호.
            if (postCompletionLockRef.current === "closingActive" && !closingAudioStartedFiredRef.current) {
              closingAudioStartedFiredRef.current = true;
              onClosingAudioChunkRef.current?.();
            }
          }
        }

        const sc = msg.serverContent;
        if (!sc) return;

        // ── 서버 barge-in 신호 ────────────────────────────────
        if (sc.interrupted) {
          logVoiceEvent({ ts: Date.now(), eventType: "interrupted" });
          const turnIdAtInterrupt = activeKTurnIdRef.current;

          if (expectingInterruptRef.current) {
            expectingInterruptRef.current = false;
            return; // 낡은 interrupted 무시
          }
          
          console.log(`${getLogPrefix()} 🖐️ server interrupted — finalize & discard remaining K turn`);
          stopAllScheduledSources();
          if (!kTurnCutRef.current) {
            cutActiveKTurnForBargeIn();
          }

          kGenerationCompleteRef.current = true;
          logVoiceEvent({ ts: Date.now(), eventType: "generationComplete" });

          // 진짜 turnComplete가 오지 않을 경우를 대비한 복구 타임아웃 (5초)
          if (turnCompleteFallbackTimerRef.current) {
            clearTimeout(turnCompleteFallbackTimerRef.current);
            turnCompleteFallbackTimerRef.current = null;
          }
          turnCompleteFallbackTimerRef.current = setTimeout(() => {
            if (activeKTurnIdRef.current !== turnIdAtInterrupt) return;
            console.log("[K] ⚠️ turnComplete fallback timeout triggered after interrupted");
            recoveryGateOpenRef.current = true;
            kTurnCutRef.current = false;
            hasLiveInputTxRef.current = false;
            speechHistoryRef.current = "";
            maybeUnlockCutChildTurn();
          }, 5000);

          return;
        }

        // 강제컷된 상태일 때 다른 서버 메시지는 무시
        if (kTurnCutRef.current) {
          if (sc.turnComplete) {
            if (turnCompleteFallbackTimerRef.current) {
              clearTimeout(turnCompleteFallbackTimerRef.current);
              turnCompleteFallbackTimerRef.current = null;
            }
            // 강제컷(길이제한)된 K 턴의 turnComplete 도 "이 턴이 실제로 끝났다"는 신호이므로,
            // 이 경로가 정상 turnComplete 분기(하단 clearWatchdogTimer)에 도달하지 못하고 여기서
            // return 하기 때문에 여기서 watchdog 을 해제한다 — 안 하면 케이가 응답을 다 하고도
            // watchdog 이 orphan 되어 10초 뒤 재연결한다(자유대화 등 긴 응답에서 발생하던 원인).
            // owner 일치 시에만 해제한다: 컷 이후 다음 턴이 이미 새 watchdog 을 arm(owner 교체)한
            // 상태에서 이전 컷 턴의 지연 turnComplete 가 들어와 새 watchdog 을 오인 해제하는 것을
            // 최대한 막는다(turnComplete 에 generation id 가 없어 완전 차단은 불가 — 정상 분기도
            // 동일한 한계. 아래 소유권 가드는 그 창을 좁히는 최선의 방어).
            if (watchdogOwnerGenRef.current === currentKGenerationIdRef.current) {
              clearWatchdogTimer();
            }
            kGenerationCompleteRef.current = true;
          logVoiceEvent({ ts: Date.now(), eventType: "generationComplete" });
            kTurnCompleteRef.current = true;
          logVoiceEvent({ ts: Date.now(), eventType: "turnComplete", kTurnId: activeKTurnIdRef.current ?? undefined });
            kTurnCutRef.current = false;
            hasLiveInputTxRef.current = false;
            speechHistoryRef.current = "";
            kTurnCutServerDoneRef.current = true;
            maybeUnlockCutChildTurn();
          }
          return;
        }

        // ── 진단 로그 (첫 8개 serverContent 수신 시) ───────────
        if (diagCountRef.current < 8) {
          diagCountRef.current++;
          console.log(`[K] 📨 sc#${diagCountRef.current}:`, sc);
        }

        // ── 턴 완료 ───────────────────────────────────────────
        if (sc.turnComplete) {
          if (isCancelledGeneration) return;
          if (isAlreadyProcessed) return;
          console.log(`${getLogPrefix()} 🏁 server turnComplete`);
          logTelemetryEvent("turnComplete");
          
          kGenerationCompleteRef.current = true;
          logVoiceEvent({ ts: Date.now(), eventType: "generationComplete" });
          kTurnCompleteRef.current = true;
          logVoiceEvent({ ts: Date.now(), eventType: "turnComplete", kTurnId: activeKTurnIdRef.current ?? undefined });
          if (turnCompleteFallbackTimerRef.current) {
            clearTimeout(turnCompleteFallbackTimerRef.current);
            turnCompleteFallbackTimerRef.current = null;
          }
          clearWatchdogTimer();

          if (activeKTurnIdRef.current && incomingGenerationId) {
            const set = processedTurnGenerationsRef.current;
            set.add(`${activeKTurnIdRef.current}:${incomingGenerationId}`);
            if (set.size > 50) {
              const first = set.values().next().value;
              if (first) set.delete(first);
            }
          }
          finalizeActiveKTurn();
          hasLiveInputTxRef.current = false;
          speechHistoryRef.current = "";
          if (!manualFinalizingRef.current) {
            setInterimChildText("");
            if (scheduledSourcesRef.current.length === 0) {
              childTurnFlushedRef.current = false; // 다음 아이 발화 턴을 위해 리셋
            }
          }

          onServerTurnCompleteRef.current?.();
          if (!kTurnHasAudioRef.current) {
            logVoiceEvent({ ts: Date.now(), eventType: "audioQueueDrained" });
          onAudioQueueDrainedRef.current?.();
          }
          // speakClosingLine()이 보낸 전용 종료 발화 턴이 지금 막 끝났다 — 이 턴까지는
          // 통과시켰으니, 이후 들어오는 모든 서버 메시지는 다시 완전히 잠근다.
          if (postCompletionLockRef.current === "closingActive") {
            postCompletionLockRef.current = "locked";
          }
          return;
        }

        // ── 아이 발화 → 버퍼 누적, 첫 outputTranscription 시 flush (#1429) ──
        const inTx = sc.inputTranscription?.text;
        if (inTx) {
          console.log("[K] 📝 child (buf):", inTx);
          pendingChildTextRef.current += inTx;
          logVoiceEvent({ ts: Date.now(), eventType: "inputTranscription", textPreview: maskText(pendingChildTextRef.current) });
          setInterimChildText(pendingChildTextRef.current);

          // 라이브 전사 성공 시 로컬 STT는 무력화
          hasLiveInputTxRef.current = true;
          speechHistoryRef.current = "";
        }

        // ── 케이 응답 트랜스크립션 ────────────────────────────
        const outTx = sc.outputTranscription?.text;
        if (outTx) {
          logVoiceEvent({ ts: Date.now(), eventType: "outputTranscription", kTurnId: activeKTurnIdRef.current ?? undefined, generationId: (sc as any).modelTurn?.parts?.[0]?.generationId ?? undefined, textPreview: maskText(outTx) });
          if (isCancelledGeneration) return;
          if (isAlreadyProcessed) return;

          // K가 대답을 시작하기 전에 폴백 적용 확인
          if (ENABLE_STT_FALLBACK && !hasLiveInputTxRef.current && speechHistoryRef.current) {
            console.log("[STT Fallback] Gemini 전사 누락 감지. 로컬 STT 주입:", speechHistoryRef.current);
            pendingChildTextRef.current = speechHistoryRef.current;
            speechHistoryRef.current = "";
          }

          // K가 말을 시작하는 순간 아이 버퍼 flush
          if ((pendingChildTextRef.current || (sttModeRef.current === "gcp" && childAudioChunksRef.current.length > 0)) && !isChildSpeakingRef.current) {
            console.log("[K] 📝 child (flush):", pendingChildTextRef.current);
            flushChildTurn(pendingChildTextRef.current);
            pendingChildTextRef.current = "";
          }
          // 이 K 턴의 "첫 텍스트 청크"인지(=지금까지 pendingKText가 비어 있었는지) 판정한 뒤 누적한다.
          const isFirstKTextChunk = pendingKTextRef.current === "";
          if (isFirstKTextChunk) {
            if (!hasFiredFirstOutputRef.current) {
              hasFiredFirstOutputRef.current = true;
              clearGenerationTimeout();
              recordFirstOutputLatency();
              logTelemetryEvent("firstTextDelta");
              onKTurnFirstOutputRef.current?.();
            } else {
              logTelemetryEvent("firstTextDelta");
            }
          }
          pendingKTextRef.current += outTx;

          // 프롬프트 누출 감지 — speakAsK/speakClosingLine이 안전한 원문을 지정해둔 턴에서
          // 모델이 대괄호·"라고 말하면 돼요"·"시스템 지시" 같은 메타 텍스트를 실제로 말하면,
          // 이후 청크는 화면 말풍선에 더 이상 반영하지 않는다(이미 재생된 음성은 되돌릴 수
          // 없지만 자막·저장은 막는다). turnComplete 시 finalizeKTurnText가 원문으로 교정한다.
          if (kTurnExpectedTextRef.current && !kTurnLeakDetectedRef.current && containsLeakPattern(pendingKTextRef.current)) {
            kTurnLeakDetectedRef.current = true;
            console.warn("[K] ⚠️ prompt leak pattern detected in K speech — suppressing display for this turn");
          }
          if (kSpeechAllowedRef.current && !kTurnLeakDetectedRef.current) {
            console.log("[K] 💬 k:", outTx);
            appendTurn({ role: "k", text: outTx, id: activeKTurnIdRef.current ?? undefined, generationId: currentKGenerationIdRef.current ?? undefined, displaySequence: activeKTurnDisplaySequenceRef.current ?? undefined });
          }

          // 다음 턴을 위해 전사 감지 플래그 초기화
          hasLiveInputTxRef.current = false;

          // ── K 응답 강제 길이 제한 ────────────────────────────
          // SOFT 이상 누적됐고 방금 청크가 문장부호로 끝나면 자연스러운 지점에서 끊고,
          // 문장부호가 안 나와도 HARD를 넘기면 무조건 끊는다(무한정 길어지는 것 방지).
          const endsAtSentenceBoundary = /[.!?~]\s*$/.test(outTx);
          if (
            pendingKTextRef.current.length >= K_TURN_HARD_CUT_CHARS ||
            (pendingKTextRef.current.length >= K_TURN_SOFT_CUT_CHARS && endsAtSentenceBoundary)
          ) {
            console.log("[K] ✂️ 응답이 길어져 강제로 턴 종료 (", pendingKTextRef.current.length, "자)");
            kTurnCutRef.current = true;
            kTurnCutAwaitingUnlockRef.current = true;
            kTurnCutServerDoneRef.current = false;
            // 이미 스케줄된 오디오는 강제로 끊지 않는다 — 텍스트 토큰이 컷 임계를 넘긴 시점에도
            // 그 문장의 오디오가 아직 도착/스케줄되지 않았을 수 있어(텍스트·오디오가 완벽히
            // interleave되지 않음), 여기서 stopAllScheduledSources()를 부르면 정상 오디오의
            // 꼬리가 잘려 마지막 음절이 씹히는 소리가 났다. kTurnCutRef가 이후 오디오/텍스트를
            // 계속 막으므로(길이 제한은 유지) 이미 스케줄된 소스는 자연스러운 onended까지 재생시킨다.
            finalizeActiveKTurn();
            if (!manualFinalizingRef.current) {
              setInterimChildText("");
            }
            // childTurnFlushedRef는 여기서 초기화하지 않는다 — 이 K 턴은 오디오 재생이 아직
            // 끝나지 않았고 서버 turnComplete도 아직 안 왔다. maybeUnlockCutChildTurn()이 두
            // 조건을 모두 확인한 뒤에만 다음 아이 턴 flush를 허용한다.
          }
        }


      }

      function handleError(message: string) {
        if (myGeneration !== connectionGenerationRef.current) return;
        console.error(`${getLogPrefix()} ❌ error:`, message);
        setError(message);
        updateStatus("error");
        teardown("handleError:" + message);
      }

      function handleClose(code: number, reason: string) {
        if (myGeneration !== connectionGenerationRef.current) return;
        console.log(`${getLogPrefix()} 🔌 closed — code:`, code, reason || "");
        
        fetch("/api/voice/relay-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            childId: getChildIdRef.current?.() ?? null,
            code,
            reason: reason || null,
            phase: "mid-session",
          }),
          keepalive: true,
        }).catch(() => {});

        // 세션 종료 전 미완료 아이/K 턴 flush
        if (pendingChildTextRef.current || (sttModeRef.current === "gcp" && childAudioChunksRef.current.length > 0)) {
          flushChildTurn(pendingChildTextRef.current);
          pendingChildTextRef.current = "";
        }
        finalizeActiveKTurn();
        // stopSession()/pauseSession()이 이미 "ending"/"paused"로 세팅해둔 의도된 종료인지를
        // updateStatus("ended")로 덮어쓰기 전에 먼저 판단해둔다 — 실측 결과, 지금까지는 이
        // 값과 무관하게 handleClose가 teardown()만 하고 끝나서, watchdog이 우연히 같은
        // 타이밍에 겹치지 않는 한(예: Vertex 쪽에서 먼저 연결을 끊는 경우) 재연결 시도 자체가
        // 전혀 일어나지 않았다 — 아이 화면이 아무 알림도 없이 그냥 멈춘 채로 남는 원인이었다.
        const wasIntentionalStop =
          statusRef.current === "ending" || statusRef.current === "paused";
        if (
          statusRef.current !== "ending" &&
          statusRef.current !== "ended" &&
          statusRef.current !== "paused"   // pauseSession()이 먼저 세팅한 경우 덮어쓰지 않음
        ) {
          updateStatus("ended");
        }
        teardown("handleClose:code=" + code);
        // 의도된 종료(stopSession/pauseSession)가 아니면 watchdog 발동 여부와 무관하게 항상
        // 복구를 시도한다 — watchdog과 동일하게 알림 표시 + preserveHistory 재연결.
        // 단, Vertex/네트워크가 연결 직후 반복적으로 끊어버리는 상황에서 무한/고빈도 재연결
        // 루프가 되지 않도록 짧은 시간창 내 재시도 횟수를 세어 지수 백오프를 적용하고,
        // 한도를 넘으면 자동 재연결을 포기한다(codex 검증에서 지적된 위험 보완).
        if (!wasIntentionalStop) {
          const RAPID_RECONNECT_WINDOW_MS = 30000;
          const MAX_RAPID_RECONNECTS = 4;
          const now = Date.now();
          if (now - lastCloseReconnectAtRef.current < RAPID_RECONNECT_WINDOW_MS) {
            closeReconnectCountRef.current += 1;
          } else {
            closeReconnectCountRef.current = 1;
          }
          lastCloseReconnectAtRef.current = now;

          onRecoveryNeededRef.current?.();

          if (closeReconnectCountRef.current > MAX_RAPID_RECONNECTS) {
            console.warn(
              `${getLogPrefix()} ⛔ 자동 재연결 중단 — ${RAPID_RECONNECT_WINDOW_MS}ms 내 ${closeReconnectCountRef.current}회 반복 실패`
            );
            updateStatus("ended");
          } else {
            const backoffMs = Math.min(1000 * 2 ** (closeReconnectCountRef.current - 1), 8000);
            const reconnectGeneration = myGeneration;
            // teardown()이 stopSession/pauseSession/reset/unmount에서 이 타이머를 취소하므로,
            // 백오프 대기 중 사용자가 의도적으로 세션을 끝내면 재연결이 실행되지 않는다.
            closeReconnectTimerRef.current = setTimeout(() => {
              closeReconnectTimerRef.current = null;
              // 대기하는 동안 다른 경로(watchdog/수동 재시작 등)가 이미 새 세대를 시작했다면
              // 중복 재연결을 하지 않는다.
              if (reconnectGeneration !== connectionGenerationRef.current) return;
              startSession({ preserveHistory: true }).catch(() => {});
            }, backoffMs);
          }
        }
      }

      if (tokenData.mode !== "relay") {
        throw new Error("지금은 케이와 대화를 시작하기 어려워요.\n잠시 후 다시 만나자.");
      }

      // ── Vertex Live — Cloud Run 릴레이(services/vertex-live-relay) 경유 ──
      // 릴레이 실패 시 AI Studio로 자동 폴백하지 않는다(Plan7 §2) — 아이에게는
      // 기술 오류 대신 정해진 안내 문구만 노출한다.
      // voiceName은 더 이상 쿼리파라미터로 보내지 않는다 — /api/voice/token이 DB(child_profiles.
      // live_voice_name)에서 조회해 서명 티켓에 이미 포함시켰다(server-trust, 브라우저 조작 불가).
      if (!tokenData.wsUrl || !tokenData.wsUrl.startsWith("wss://")) {
        throw new Error("지금은 케이와 대화를 시작하기 어려워요.\n잠시 후 다시 만나자.");
      }
      // connectionReadyPromise: WebSocket 객체 생성 시점이 아니라, relay가 실제로 "ready"
      // (=Vertex 세션 setupComplete)를 보내 handleOpen()이 실행되고 status가 "live"로 확정된
      // 시점에만 resolve된다. startSession()이 이 Promise를 기다린 뒤에야 반환되므로, 호출부
      // (예: loadSession의 speakAsK(질문1))가 setupComplete 이전에 첫 발화를 요청해 조용히
      // 버려지는 경합을 없앤다(P0 수정 — 미션 초기화/VAD/오디오/중복응답 로직은 건드리지 않음).
      // 한 번 settle되면 이후 호출은 전부 no-op(중복 settle 방지). ready 이전에 WebSocket
      // 에러·닫힘·(재연결 등으로) 이 연결 시도 자체가 폐기되면 reject하고, 8초 안에 ready가
      // 오지 않으면 timeout으로 reject해 무한 대기하지 않는다 — 두 경우 모두 등록해둔
      // 타이머를 반드시 정리한다.
      let connectionReadySettled = false;
      let resolveConnectionReady: (() => void) | null = null;
      let rejectConnectionReady: ((err: Error) => void) | null = null;
      const connectionReadyPromise = new Promise<void>((resolve, reject) => {
        resolveConnectionReady = resolve;
        rejectConnectionReady = reject;
      });
      let connectionReadyTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        settleConnectionReadyFail("connection ready timeout(8s) — relay ready 신호 없음");
      }, 8000);
      function settleConnectionReadyOk() {
        if (connectionReadySettled) return;
        connectionReadySettled = true;
        if (connectionReadyTimeoutId) { clearTimeout(connectionReadyTimeoutId); connectionReadyTimeoutId = null; }
        resolveConnectionReady?.();
      }
      function settleConnectionReadyFail(reason: string) {
        if (connectionReadySettled) return;
        connectionReadySettled = true;
        if (connectionReadyTimeoutId) { clearTimeout(connectionReadyTimeoutId); connectionReadyTimeoutId = null; }
        rejectConnectionReady?.(new Error(reason));
      }

      const ws = new WebSocket(tokenData.wsUrl);

      const handleRelayError = (reason?: string, code?: number) => {
        if (myGeneration !== connectionGenerationRef.current) return;
        // 이 시점(handleRelayError 호출 시점)은 항상 ready 도달 이전이므로(ws.onclose의
        // "connecting"일 때만/ws.onmessage의 "error" 타입만 여기로 옴), 대기 중인
        // connectionReadyPromise가 있다면 무한 대기하지 않도록 실패 처리한다.
        settleConnectionReadyFail(reason || "relay error");
        console.error(`${getLogPrefix()} ❌ Vertex relay error:`, reason, "code:", code);
        // 아이 화면 문구는 그대로 두되(Plan7 §2), 브라우저에서만 보이던 실제 실패 사유를
        // 서버 로그로도 남겨 원인 진단이 가능하게 한다(음성/transcript 등은 보내지 않음).
        fetch("/api/voice/relay-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId: getChildIdRef.current?.() ?? null, code: code ?? null, reason: reason ?? null }),
          keepalive: true,
        }).catch(() => {});
        handleError("지금은 케이와 대화를 시작하기 어려워요.\n잠시 후 다시 만나자.");
      };

      ws.onmessage = (ev) => {
        let parsed: { type?: string; payload?: NormalizedServerMessage; message?: string } | undefined;
        try { parsed = JSON.parse(ev.data as string); } catch { return; }
        if (!parsed?.type) return;
        switch (parsed.type) {
          case "ready":
            handleOpen();
            break;
          case "message":
            if (parsed.payload) handleMessage(parsed.payload);
            break;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          case "error":
            handleRelayError(parsed.message);
            break;
        }
      };
      ws.onerror = () => {
        if (myGeneration !== connectionGenerationRef.current) return;
        console.error(`${getLogPrefix()} ❌ relay WebSocket-level error`);
        // ready 이전 WebSocket 레벨 에러 — 대기 중인 connectionReadyPromise를 실패 처리한다
        // (ready 이후라면 이미 settle되어 있으므로 no-op).
        settleConnectionReadyFail("websocket-level error");
      };
      ws.onclose = (e) => {
        if (myGeneration !== connectionGenerationRef.current) return;
        // "ready"(=Vertex 세션 실제 오픈) 도달 전에 끊기면 연결 실패로 간주
        if (statusRef.current === "connecting") {
          handleRelayError(e.reason || "relay closed before ready", e.code);
          return;
        }
        handleClose(e.code, e.reason);
      };

      sessionRef.current = new RelaySession(ws);

      // ── PCM 캡처 → Gemini 전송 ───────────────────────────────
      // AudioContext sampleRate를 16000으로 강제 → 브라우저가 리샘플링 처리
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtx.onstatechange = () => {
        console.log(`${getLogPrefix()} 🎤 inputCtx state change:`, inputCtx.state, Date.now());
      };
      inputCtxRef.current = inputCtx;
      if (inputCtx.state !== "running") {
        inputCtx.resume().catch(() => {});
      }
      const source = inputCtx.createMediaStreamSource(stream);
      // bufferSize 2048: 16kHz에서 128ms — 지연 줄이면서 안정적인 청크 크기
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      let chunkCount = 0;
      processor.onaudioprocess = (ev) => {
        const float32 = ev.inputBuffer.getChannelData(0);

        // 1. RMS (음량) 계산
        let sum = 0;
        for (let i = 0; i < float32.length; i++) {
          sum += float32[i] * float32[i];
        }
        const rms = Math.sqrt(sum / float32.length);
        lastRmsRef.current = rms;

        // K가 말하는 중이거나 마이크가 비활성화 상태이면 레벨을 0으로 통지
        const isLiveActive = sessionRef.current && statusRef.current === "live" && micEnabledRef.current && !kSpeakingRef.current;
        if (onAudioLevelChangeRef.current) {
          onAudioLevelChangeRef.current(isLiveActive ? rms : 0);
        }

        // "마이크 입력 없음" 감지 — AUTO 모드에서만 적용한다(수동 모드는 아이가 버튼을 눌러야
        // 녹음이 시작되므로 이 문제 자체가 발생하지 않는다). 대상 조건(라이브 접속 + 마이크 켜짐
        // + K가 말하는 중 아님 + 자동 모드)을 벗어나면 즉시 타이머를 리셋해 오검출을 막는다
        // (요구사항 1의 "세션 연결 중이거나 K가 말하는 중이면 타이머를 멈추거나 리셋" 그대로).
        const isNoAudioInputEligible = isLiveActive && interactionModeRef.current !== "manual";
        if (!isNoAudioInputEligible) {
          silenceEligibleSinceRef.current = null;
          if (noAudioInputRef.current) updateNoAudioInput(false);
        } else {
          if (silenceEligibleSinceRef.current === null) {
            silenceEligibleSinceRef.current = Date.now();
          } else if (
            !noAudioInputRef.current &&
            Date.now() - silenceEligibleSinceRef.current >= NO_AUDIO_INPUT_TIMEOUT_MS
          ) {
            updateNoAudioInput(true);
          }
        }
        // 이 프레임에서 실제로 sendRealtimeInput({ audio }) 호출이 일어났는지 — 아래 각 분기의
        // 실제 전송 지점에서 true로 세팅하고, 핸들러 마지막에 한 번만 로그로 남긴다(요구사항 2).
        let chunkSentThisFrame = false;

        if (isLiveActive) {
          // A. 수동 모드인 경우 (기존 동작 고수 - 후보 버퍼 배제)
          if (interactionModeRef.current === "manual") {
            if (isChildSpeakingRef.current) {
              const pcm = encodePCM16(float32);
              sessionRef.current?.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
              chunkSentThisFrame = true;

              if (sttModeRef.current === "gcp") {
                const buf = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                  buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
                }
                childAudioChunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));
              }
            }
          }
          // B. 자동 모드인 경우 (3단계 VAD 상태머신 + 200ms 후보 버퍼)
          else {
            const isAboveThreshold = rms >= VAD_CONFIG.RMS_THRESHOLD;

            if (vadStateRef.current === "idle") {
              if (isAboveThreshold) {
                // idle -> candidate 상태 전환
                vadStateRef.current = "candidate";
                appendToCandidateBuffer(float32);

                // 발화 확인 타이머 기동 (150ms)
                speechStartTimerRef.current = setTimeout(() => {
                  if (statusRef.current === "live" && sessionRef.current && vadStateRef.current === "candidate") {
                    // 케이가 말하는 중이면 오디오 재생 즉시 중단
                    stopAllScheduledSources();
                    // 아이가 끼어든 순간 진행 중인 K 턴을 "지금까지 표시된 텍스트"로 즉시 확정하고,
                    // 서버가 계속 보내는 이 K 턴의 잔여 오디오/텍스트/turnComplete를 전부 폐기한다
                    // (K1 말풍선 사후 수정·늦은 K 텍스트 이어붙기·중복 말풍선의 직접 원인 차단).
                    cutActiveKTurnForBargeIn();

                    // 1. activityStart 전송 (정확히 1회)
                    console.log(`${getLogPrefix()} [VAD] Auto Speech Start -> send activityStart`);
                    isChildSpeakingRef.current = true;
                    // sendActivityStart(수동 모드)와 동일하게, 새 아이 발화 턴이 시작되는 시점에
                    // 곧바로 초기화한다 — 이전엔 K-A(억제 전)의 turnComplete가 이 리셋을 대신
                    // 해줬지만, gcp 모드에서 K-A를 null로 억제한 뒤로는 그 turnComplete 자체가
                    // 처리되지 않아(isCancelledGeneration) 이 리셋이 영원히 일어나지 않고
                    // childTurnFlushedRef가 true로 고정돼 두 번째 발화부터 flushChildTurn이
                    // 전부 조용히 무시되는 회귀가 생겼다 — 실제 fake-audio 검증 중 발견.
                    childTurnFlushedRef.current = false;

                    activeChildTurnIdRef.current = nextTurnId();
                    activeChildTurnDisplaySequenceRef.current = nextDisplaySequence();

                    sessionRef.current?.sendRealtimeInput({ activityStart: {} });
                    logVoiceEvent({ ts: Date.now(), eventType: "activityStart", mode: "live", childTurnId: activeChildTurnIdRef.current, micEnabled: !!micEnabledRef.current });

                    // 2. 후보 버퍼 PCM 전송 (시간순)
                    const buffered = candidateBufferRef.current;
                    if (buffered.length > 0) {
                      const pcm = encodePCM16(buffered);
                      sessionRef.current?.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
                      // setTimeout 콜백이라 onaudioprocess 프레임 로컬 변수(chunkSentThisFrame)와
                      // 별도로, 이 실제 전송 시점에 직접 무입력 타이머를 리셋하고 즉시 로그를 남긴다.
                      silenceEligibleSinceRef.current = Date.now();
                      if (noAudioInputRef.current) updateNoAudioInput(false);
                      logVadSample({ rms: lastRmsRef.current, chunkSent: true, force: true });

                      if (sttModeRef.current === "gcp") {
                        const buf = new Int16Array(buffered.length);
                        for (let i = 0; i < buffered.length; i++) {
                          buf[i] = Math.max(-32768, Math.min(32767, buffered[i] * 32768));
                        }
                        childAudioChunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));
                      }
                    }

                    // 3. 후보 버퍼 비우기 및 active 상태 전환
                    candidateBufferRef.current = new Float32Array(0);
                    vadStateRef.current = "active";
                  }
                  speechStartTimerRef.current = null;
                }, VAD_CONFIG.MIN_SPEECH_DURATION_MS);
              }
            }
            else if (vadStateRef.current === "candidate") {
              if (isAboveThreshold) {
                // 발화 조건 유지 시 후보 버퍼 누적
                appendToCandidateBuffer(float32);
              } else {
                // 150ms 도달 전 해제: 소음 판정 -> 후보 폐기 및 idle 복귀
                console.log("[VAD] Noise detected -> discard candidate buffer");
                clearVadTimersAndBuffers();
              }
            }
            else if (vadStateRef.current === "active") {
              // active 상태: 들어오는 PCM 실시간 전송
              const pcm = encodePCM16(float32);
              sessionRef.current?.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
              chunkSentThisFrame = true;
              silenceEligibleSinceRef.current = Date.now();
              if (noAudioInputRef.current) updateNoAudioInput(false);

              if (sttModeRef.current === "gcp") {
                const buf = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                  buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
                }
                childAudioChunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));
              }

              if (isAboveThreshold) {
                // 발화 중이면 무음 감지 종료 타이머 연장(취소)
                if (silenceTimerRef.current) {
                  clearTimeout(silenceTimerRef.current);
                  silenceTimerRef.current = null;
                }
              } else {
                // 임계값 이하로 내려가면 무음 판정 타이머 시작
                if (!silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    if (statusRef.current === "live" && sessionRef.current && vadStateRef.current === "active") {
                      console.log(`${getLogPrefix()} [VAD] Auto Speech End -> send activityEnd`);
                      logTelemetryEvent("sendActivityEnd");
                      armLatencyClock();
                      generationEpochRef.current += 1;
                      sealCurrentGeneration();

                      // sendActivityEnd(수동 모드)와 반드시 동일하게 분기해야 한다 — 이 분기가
                      // 없던 게 P0 버그("아이 발화 1회에 케이 응답 2회")의 실제 원인이었다: GCP
                      // STT 모드에서는 Gemini 자체 응답(K-A, 원본 오디오에 대한 Vertex의 자동
                      // 반응)을 재생하지 않고 /api/mission/answer 처리 후 나오는 K-B(speakAsK)만
                      // 재생해야 하는데, 이 분기 없이 매번 새 generation id를 발급해버리면 K-A가
                      // 정식 generation으로 추적돼 그대로 재생된 뒤 곧이어 speakAsK가 K-B도
                      // 재생해 실제로 두 응답이 모두 나갔다(자동 모드에서만 재현 — 수동 모드는
                      // 원래부터 이 분기가 있어 영향 없었다).
                      if (sttModeRef.current === "gcp") {
                        currentKGenerationIdRef.current = null;
                      } else {
                        kGenerationSeqRef.current += 1;
                        currentKGenerationIdRef.current = `gen_${kGenerationSeqRef.current}`;
                        activeKTurnIdRef.current = nextTurnId();
                        activeKTurnDisplaySequenceRef.current = nextDisplaySequence();
                        kGenerationCompleteRef.current = false;
                        kTurnCompleteRef.current = false;
                        recoveryGateOpenRef.current = false;
                        startGenerationTimeout();
                      }
                      hasFiredFirstOutputRef.current = false;
                      sessionRef.current?.sendRealtimeInput({ activityEnd: {} });
                      logVoiceEvent({ ts: Date.now(), eventType: "activityEnd", mode: "live" });
                      if (sttModeRef.current === "gcp") {
                        // sendActivityEnd(수동 모드)와 동일하게: activityEnd만 보내면 Live 서버가
                        // turnComplete로 인식하지 않고 계속 기다리며(지연/자발적 계속 생성 유발)
                        // K-A를 이어갈 수 있어, 명시적으로 turnComplete도 함께 전송해 이번(폐기
                        // 대상) 턴을 확정적으로 종료시킨다. gcp 분기에서만 보낸다 — 비-gcp(네이티브
                        // 전사) 자동 모드는 원래 이 신호를 보내지 않았고, 그 프로토콜에 영향을 주지
                        // 않기 위해 기존 동작을 그대로 유지한다.
                        sessionRef.current?.sendClientContent({ turns: [], turnComplete: true });
                        // K-A(방금 null 처리한 generation) 자신의 turnComplete가 실제로 도착할
                        // 때까지 다음 K 발화(K-B, speakAsK)의 시작을 늦춘다(안전 타임아웃 포함) —
                        // null 비교만으로는 speakAsK가 새 generation을 이미 발급한 뒤에 도착하는
                        // 지연된 K-A를 걸러내지 못한다(핸들메시지는 항상 "현재" ref 값 기준으로
                        // 판별하므로).
                        armSettleWait();
                        // sendActivityEnd(수동 모드)와 동일하게: K-A의 outputTranscription에
                        // 얹혀 flush되길 기다리지 않고, 여기서 곧바로 flushChildTurn을 호출해
                        // GCP STT 인식을 시작한다 — K-A를 null로 비운 이상 그 이벤트에 기대는
                        // flush 트리거는 더 이상 오지 않기 때문에 반드시 필요하다(안 하면 자동
                        // 모드 아이 발화가 인식조차 되지 않는다).
                        console.error(`[Timing] (b) 마이크 중지(activityEnd) 및 STT 전송 시작 - ${Date.now()}, chunk개수: ${childAudioChunksRef.current.length}`);
                        manualFinalizingRef.current = true;
                        setInterimChildText("음성을 인식하고 있어요…");
                        flushChildTurn("");
                      }
                      clearVadTimersAndBuffers(); // idle 복귀 및 리셋
                    }
                    silenceTimerRef.current = null;
                  }, VAD_CONFIG.SILENCE_TIMEOUT_MS);
                }
              }
            }
          }

          if (++chunkCount % 40 === 1) {
            console.log(`[K] 📡 PCM #${chunkCount} (State: ${vadStateRef.current}, RMS: ${rms.toFixed(4)})`);
          }
          logVadSample({ rms, chunkSent: chunkSentThisFrame });
        } else {
          // 비활성 세션 시 임시 버퍼 및 VAD 타이머 리셋
          clearVadTimersAndBuffers();
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

      // startSession()은 이제 WebSocket 객체 생성 시점이 아니라, relay의 ready(=setupComplete)
      // 신호를 실제로 받아 status가 "live"로 확정된 뒤에만 반환된다 — 실패/타임아웃 시 아래
      // catch가 기존과 동일하게 처리한다(에러 노출 + teardown).
      await connectionReadyPromise;
    } catch (err) {
      console.error("[K] 🚨 startSession error (voiceName:", voiceNameRef.current, "):", err);
      setError((err as Error).message);
      updateStatus("error");
      teardown("startSession:catch:" + (err as Error).message);
    }
  }, []);

  const stopSession = useCallback(() => {
    updateStatus("ending");
    teardown("stopSession");
    updateStatus("ended");
  }, []);

  const pauseSession = useCallback(() => {
    // WebSocket·오디오만 끊음 — transcript/sessionId는 유지
    teardown("pauseSession");
    updateStatus("paused");
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);

  /** DB에서 불러온 과거 대화(chat_messages)를 초기 자막으로 채워넣는다 — 스크롤을 올리면
   *  이전 대화를 볼 수 있게 하기 위함. 세션 연결 이후(status가 "live"가 된 뒤) 1회 호출할 것
   *  — startSession()이 자체적으로 transcript를 비우므로 그보다 먼저 호출하면 덮어써진다. */
  const seedTranscript = useCallback((turns: Turn[]) => {
    const withIds = turns.map((t) => (t.id ? t : { ...t, id: nextTurnId() }));
    transcriptRef.current = withIds;
    setTranscript([...withIds]);
    let maxSeq = displaySequenceCounterRef.current;
    for (const t of withIds) {
      if (t.displaySequence && t.displaySequence > maxSeq) maxSeq = t.displaySequence;
    }
    displaySequenceCounterRef.current = maxSeq;
  }, []);

  const reset = useCallback(() => {
    teardown("reset");
    interactionModeRef.current = "auto";
    transcriptRef.current = [];
    setTranscript([]);
    setError(null);
    updateStatus("idle");
  }, []);

  /** 텍스트 모드 전환 시 오디오 자동재생 ON/OFF — mute 시 재생 중인 소스 즉시 중단 */
  const setAudioMuted = useCallback((muted: boolean) => {
    audioMutedRef.current = muted;
    if (muted) stopAllScheduledSources();
  }, []);

  /** 텍스트 모드 전환 시 PCM 전송 ON/OFF */
  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
  }, []);

  /** 미션 완료를 인지한 즉시 호출 — 그 순간부터 모든 서버 메시지(5번째 답변 턴의 잔여
   *  오디오, 모델이 자발적으로 이어가려는 추가 질문 등)를 완전히 잠근다. 이후 speakClosingLine()
   *  만이 전용 종료 발화를 위해 락을 일시적으로 푼다. */
  const lockNow = useCallback(() => {
    postCompletionLockRef.current = "locked";
    stopAllScheduledSources();
  }, []);

  /** 미션 종료 발화 전용 — speakAsK()와 동일하게 지정 문장을 그대로 소리내어 말하게 하되,
   *  전송 직전에 락을 "closingActive"로 풀어 이 턴의 메시지만 통과시킨다(락 이전에 도착한
   *  잔여 턴은 계속 버려짐). 이 턴의 turnComplete가 오면 handleMessage가 다시 "locked"로
   *  영구 전환한다. lockNow() 이후에 호출할 것. */
  const speakClosingLine = useCallback((text: string): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") return false;
    const run = () => {
      if (!sessionRef.current || statusRef.current !== "live") return;
      console.log(`${getLogPrefix()} 📣 speakClosingLine 호출 — text길이:${text.length}, kGenSeq:${kGenerationSeqRef.current}, childTurnId:${activeChildTurnIdRef.current}`);
      audioMutedRef.current = false;
      if (outputCtxRef.current && outputCtxRef.current.state !== "running") {
        void ensureOutputAudioRunning();
      }
      closingAudioStartedFiredRef.current = false;
      postCompletionLockRef.current = "closingActive";
      stopAllScheduledSources();
      expectingInterruptRef.current = true;
      // 새 K 턴을 시작하므로 직전 컷 상태가 남아 있으면 해제한다 — barge-in 직후 서버가
      // interrupted/turnComplete를 못 보낸 드문 경우에도 이 K 턴이 컷에 막혀 사라지지 않도록.
      kTurnCutRef.current = false;
      kTurnCutAwaitingUnlockRef.current = false;
      kTurnCutServerDoneRef.current = false;
      pendingKTextRef.current = "";
      kTurnExpectedTextRef.current = text;
      kTurnLeakDetectedRef.current = false;
      hasFiredFirstOutputRef.current = false;
      generationEpochRef.current += 1;
      sealCurrentGeneration();
      kGenerationSeqRef.current += 1;
      currentKGenerationIdRef.current = `gen_${kGenerationSeqRef.current}`;
      activeKTurnIdRef.current = nextTurnId();
      activeKTurnDisplaySequenceRef.current = nextDisplaySequence();
      kGenerationCompleteRef.current = false;
      kTurnCompleteRef.current = false;
      recoveryGateOpenRef.current = false;
      kTurnHasAudioRef.current = false;
      clearWatchdogTimer();
      armLatencyClock();
      watchdogTimerRef.current = setTimeout(() => {
        console.warn(`${getLogPrefix()} 🐕 Watchdog timer fired. Attempting recovery...`);
        recordWatchdogFire();
        onRecoveryNeededRef.current?.();
        updateStatus("ended");
        teardown("watchdog:speakClosingLine");
        startSession({ preserveHistory: true }).catch(() => {});
      }, 10000);
      watchdogOwnerGenRef.current = currentKGenerationIdRef.current;
      startGenerationTimeout();
      sessionRef.current.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `다음 문장만 그대로 자연스럽게 소리 내어 말해줘. 설명하거나 되묻거나 다른 말을 덧붙이지 말고 이 문장만 말해: "${text}"` }] }],
        turnComplete: true,
      });
    };
    // K-A(억제된 generation)가 아직 settle 대기 중이면, 그게 끝난 뒤(또는 안전 타임아웃 뒤)
    // 실행되도록 미룬다 — 두 generation의 메시지 스트림이 겹치지 않게 하기 위함(P0 근본 원인 수정).
    if (awaitingNullGenerationSettleRef.current) {
      pendingPostSettleActionRef.current = run;
    } else {
      run();
    }
    return true;
  }, []);

  /** 텍스트 메시지 전송 — child 턴으로 즉시 추가 후 onTurnComplete 호출 */
  const sendText = useCallback((text: string): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") return false;
    console.log(`${getLogPrefix()} 📣 sendText 호출 — text길이:${text.length}, kGenSeq:${kGenerationSeqRef.current}, childTurnId:${activeChildTurnIdRef.current}`);
    const cid = nextTurnId();
    const cSeq = nextDisplaySequence();
    appendTurn({ role: "child", text, id: cid, displaySequence: cSeq });
    onTurnCompleteRef.current?.({ role: "child", text, id: cid, displaySequence: cSeq });
    sessionRef.current.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });

    sealCurrentGeneration();
    kGenerationSeqRef.current += 1;
    currentKGenerationIdRef.current = `gen_${kGenerationSeqRef.current}`;
    activeKTurnIdRef.current = nextTurnId();
    activeKTurnDisplaySequenceRef.current = nextDisplaySequence();
    kGenerationCompleteRef.current = false;
    kTurnCompleteRef.current = false;
                      recoveryGateOpenRef.current = false;
    kTurnHasAudioRef.current = false;
    clearWatchdogTimer();
    armLatencyClock();
    watchdogTimerRef.current = setTimeout(() => {
      console.warn(`${getLogPrefix()} 🐕 Watchdog timer fired. Attempting recovery...`);
      recordWatchdogFire();
      onRecoveryNeededRef.current?.();
      updateStatus("ended");
      teardown("watchdog:sendText");
      startSession({ preserveHistory: true }).catch(() => {});
    }, 10000);
    watchdogOwnerGenRef.current = currentKGenerationIdRef.current;

    return true;
  }, []);

  /** 케이가 특정 문장을 그대로 소리내어 말하게 함(미션 질문 등). sendText와 달리
   *  아이 발화로 취급하지 않는다 — 화면에는 케이(K) 말풍선으로 표시되고, onTurnComplete도
   *  role:"k"로 호출되어(child 판정/미션 답변 로직을 타지 않음) 대화 로그에는 남되 오답 처리되지 않는다. */
  const speakAsK = useCallback((text: string): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") {
      // status 미준비 상태(대개 "connecting")로 speakAsK가 조용히 사라지던 게 P0
      // 원인이었다(startSession()이 ready 이전에 반환되던 문제는 이제 수정됨) — 그래도 다른
      // 경로로 재진입/타이밍 문제가 생기면 즉시 눈에 띄도록 진단 로그만 남기고, 여기서
      // 자동 재시도는 하지 않는다(호출부가 필요하면 스스로 재시도 정책을 가져야 함).
      console.warn(`${getLogPrefix()} ⚠️ speakAsK 호출 실패 — status 미준비(status:${statusRef.current}, session:${!!sessionRef.current}), text길이:${text.length}`);
      return false;
    }
    const run = () => {
      if (!sessionRef.current || statusRef.current !== "live") return;
      console.log(`${getLogPrefix()} 📣 speakAsK 호출 — text길이:${text.length}, kGenSeq:${kGenerationSeqRef.current}, childTurnId:${activeChildTurnIdRef.current}`);
      audioMutedRef.current = false;
      if (outputCtxRef.current && outputCtxRef.current.state !== "running") {
        void ensureOutputAudioRunning();
      }
      stopAllScheduledSources();
      expectingInterruptRef.current = true;
      // 여기서 말풍선을 낙관적으로 먼저 찍지 않는다 — 모델이 실제로 발화하며 오는
      // outputTranscription(outTx)이 onmessage에서 자동으로 말풍선을 채운다.
      // 예전엔 여기서도 appendTurn+onTurnComplete를 즉시 호출해서, 뒤이어 도착하는 outTx가
      // 같은 "k" 턴으로 병합되며 같은 문장이 말풍선 안에 두 번 붙는 문제가 있었음
      // (예: "...뭐니?안녕~ 난 케이야...").
      // 새 K 턴을 시작하므로 직전 barge-in 컷 상태가 남아 있으면 해제한다(이 K 턴이 컷에
      // 막혀 말풍선/음성이 안 나오는 것을 방지 — 컷 해제는 원래 서버 turnComplete에 의존).
      kTurnCutRef.current = false;
      kTurnCutAwaitingUnlockRef.current = false;
      kTurnCutServerDoneRef.current = false;
      pendingKTextRef.current = "";
      kTurnExpectedTextRef.current = text;
      kTurnLeakDetectedRef.current = false;
      hasFiredFirstOutputRef.current = false;
      generationEpochRef.current += 1;
      sealCurrentGeneration();
      kGenerationSeqRef.current += 1;
      currentKGenerationIdRef.current = `gen_${kGenerationSeqRef.current}`;
      activeKTurnIdRef.current = nextTurnId();
      activeKTurnDisplaySequenceRef.current = nextDisplaySequence();
      kGenerationCompleteRef.current = false;
      kTurnCompleteRef.current = false;
      recoveryGateOpenRef.current = false;
      kTurnHasAudioRef.current = false;
      clearWatchdogTimer();
      armLatencyClock();
      watchdogTimerRef.current = setTimeout(() => {
        console.warn(`${getLogPrefix()} 🐕 Watchdog timer fired. Attempting recovery...`);
        recordWatchdogFire();
        onRecoveryNeededRef.current?.();
        updateStatus("ended");
        teardown("watchdog:speakAsK");
        startSession({ preserveHistory: true }).catch(() => {});
      }, 10000);
      watchdogOwnerGenRef.current = currentKGenerationIdRef.current;
      startGenerationTimeout();
      waitingForLiveReceiveRef.current = true;
      sessionRef.current.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `다음 문장만 그대로 자연스럽게 소리 내어 말해줘. 설명하거나 되묻거나 다른 말을 덧붙이지 말고 이 문장만 말해: "${text}"` }] }],
        turnComplete: true,
      });
    };
    // K-A(억제된 generation)가 아직 settle 대기 중이면, 그게 끝난 뒤(또는 안전 타임아웃 뒤)
    // 실행되도록 미룬다 — 두 generation의 메시지 스트림이 겹치지 않게 하기 위함(P0 근본 원인 수정).
    if (awaitingNullGenerationSettleRef.current) {
      pendingPostSettleActionRef.current = run;
    } else {
      run();
    }
    return true;
  }, []);

  const setInteractionMode = useCallback((mode: "auto" | "manual") => {
    if (isChildSpeakingRef.current || vadStateRef.current === "active") {
      console.log("[VAD] Mode transition during active speech -> send activityEnd");
      if (sessionRef.current && statusRef.current === "live") {
        try {
          sessionRef.current.sendRealtimeInput({ activityEnd: {} });
          logVoiceEvent({ ts: Date.now(), eventType: "activityEnd", mode: "live" });
        } catch (e) {
          console.error("[VAD] Failed to send activityEnd during transition:", e);
        }
      }
    }
    interactionModeRef.current = mode;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (speechStartTimerRef.current) {
      clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
    }
    candidateBufferRef.current = new Float32Array(0);
    vadStateRef.current = "idle";
    isChildSpeakingRef.current = false;
  }, [status]);

  const sendActivityStart = useCallback((): boolean => {
    // 실제 탭 이벤트 핸들러 안에서 동기적으로 호출되는 지점 — resume() 자체를 여기서
    // (await 없이) 바로 걸어야 브라우저가 "제스처 안에서 호출됨"으로 인정한다. 결과 반영은
    // ensureOutputAudioRunning 내부에서 비동기로 이어진다.
    if (outputCtxRef.current && outputCtxRef.current.state !== "running") {
      void ensureOutputAudioRunning();
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== "running") {
      inputCtxRef.current.resume().catch(() => {});
    }
    if (manualFinalizingRef.current) {
      console.log("[K] Blocked sendActivityStart because finalizing GCP STT");
      return false;
    }
    if (!sessionRef.current || statusRef.current !== "live") return false;
    console.error(`[Timing] (a) 마이크 활성화(activityStart) - ${Date.now()}`);
    console.log(`${getLogPrefix()} 📡 sendActivityStart (Manual)`);
    stopAllScheduledSources();
    // 수동 모드 barge-in — K가 말하는 도중 아이가 버튼을 눌러 끼어든 경우, 진행 중인 K 턴을
    // "지금까지 표시된 텍스트"로 즉시 확정하고 이후 잔여 오디오/텍스트/turnComplete를 폐기한다.
    // K가 말하는 중이 아니었으면(정상적인 아이 차례) no-op이라 안전하다.
    cutActiveKTurnForBargeIn();
    childAudioChunksRef.current = [];
    childTurnFlushedRef.current = false;
    isChildSpeakingRef.current = true;
    activeChildTurnIdRef.current = nextTurnId();
    activeChildTurnDisplaySequenceRef.current = nextDisplaySequence();
    sessionRef.current.sendRealtimeInput({ activityStart: {} });
    logVoiceEvent({ ts: Date.now(), eventType: "activityStart", mode: "live", childTurnId: activeChildTurnIdRef.current, micEnabled: !!micEnabledRef.current });
    return true;
  }, []);

  const sendActivityEnd = useCallback((): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") return false;
    console.log(`${getLogPrefix()} 📡 sendActivityEnd (Manual)`);
    isChildSpeakingRef.current = false;
    
    // 수동 모드 지연 원인 수정: activityEnd만 보내면 Live 서버가 turnComplete로 인식하지 않고 
    // 마냥 기다리는(2~3분 지연) 문제가 발생하므로 명시적으로 turnComplete를 전송한다.
    logTelemetryEvent("sendActivityEnd");
    armLatencyClock();
    generationEpochRef.current += 1;
    sealCurrentGeneration();

    if (sttModeRef.current === "gcp") {
      // GCP STT 모드: Gemini 자체응답(K-A)을 무시하고, 이후 /api/mission/answer API
      // 처리 후 나오는 K-B만 재생하도록 현재 생성 ID를 null로 비운다.
      currentKGenerationIdRef.current = null;
      // K-A 자신의 turnComplete가 실제로 도착할 때까지 다음 K 발화(K-B, speakAsK)의 시작을
      // 늦춘다(안전 타임아웃 포함) — null 비교만으로는 speakAsK가 새 generation을 이미 발급한
      // 뒤에 도착하는 지연된 K-A를 걸러내지 못한다.
      armSettleWait();
    } else {
      kGenerationSeqRef.current += 1;
      currentKGenerationIdRef.current = `gen_${kGenerationSeqRef.current}`;
      activeKTurnIdRef.current = nextTurnId();
      activeKTurnDisplaySequenceRef.current = nextDisplaySequence();
      kGenerationCompleteRef.current = false;
      kTurnCompleteRef.current = false;
                      recoveryGateOpenRef.current = false;
      startGenerationTimeout();
      waitingForLiveReceiveRef.current = true;
    }
    hasFiredFirstOutputRef.current = false;
    
    sessionRef.current.sendRealtimeInput({ activityEnd: {} });
          logVoiceEvent({ ts: Date.now(), eventType: "activityEnd", mode: "live" });
    sessionRef.current.sendClientContent({
      turns: [],
      turnComplete: true
    });

    if (sttModeRef.current === "gcp") {
      console.error(`[Timing] (b) 마이크 중지(activityEnd) 및 STT 전송 시작 - ${Date.now()}, chunk개수: ${childAudioChunksRef.current.length}`);
      manualFinalizingRef.current = true;
      setInterimChildText("음성을 인식하고 있어요…");
      flushChildTurn("");
    }
    return true;
  }, []);

  // 화면이 잠겼다가 돌아오거나(screen lock) 탭이 백그라운드→포그라운드로 전환될 때
  // Android/모바일 브라우저가 AudioContext를 suspended로 되돌리는 경우가 있다 — 세션이
  // 아직 살아있는 동안엔 포그라운드 복귀 시점에 자동으로 resume을 재시도한다. 이 시점은
  // 진짜 사용자 제스처가 아니라 정책상 거부될 수도 있으므로(그러면 audioLocked=true 유지),
  // 실패해도 무해하게 "케이 목소리 켜기" 버튼으로 자연스럽게 이어진다.
  useEffect(() => {
    function handleVisibilityChange() {
      console.log(`${getLogPrefix()} 👁 visibility change:`, document.visibilityState, Date.now());
      if (document.visibilityState === "hidden") {
        tabHiddenAtRef.current = Date.now();
        return;
      }
      const hiddenForMs = tabHiddenAtRef.current ? Date.now() - tabHiddenAtRef.current : 0;
      tabHiddenAtRef.current = null;
      if (document.visibilityState === "visible" && statusRef.current === "live") {
        void ensureOutputAudioRunning();
        if (inputCtxRef.current && inputCtxRef.current.state !== "running") {
          inputCtxRef.current.resume().catch(() => {});
        }
        // 백그라운드 동안 AudioContext가 완전히 멈춰 있었다면 재생 종료(onended)/워치독
        // 타이머가 전혀 발동하지 못해 kSpeakingRef가 true로 고착되고, 그 결과 VAD 마이크
        // 게이트(isLiveActive = ... && !kSpeakingRef.current)가 영원히 닫힌 채로 남아
        // 아이 발화를 전혀 감지하지 못하는 문제가 있다 — 일정 시간 이상 숨겨졌다가
        // 돌아왔을 때만 강제로 재생 큐/발화 상태를 정리해 복구한다. 짧은 탭 전환까지
        // 케이 음성을 끊으면 안 되므로 5초 미만이면 아무것도 하지 않는다.
        if (hiddenForMs > 5000 && (kSpeakingRef.current || scheduledSourcesRef.current.length > 0)) {
          console.warn(`${getLogPrefix()} ⚠️ 장시간 백그라운드(${hiddenForMs}ms) 복귀 — 고착된 재생 큐/발화 상태 강제 정리`);
          stopAllScheduledSources();
          maybeUnlockCutChildTurn();
          vadStateRef.current = "idle";
          isChildSpeakingRef.current = false;
          candidateBufferRef.current = new Float32Array(0);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          if (speechStartTimerRef.current) {
            clearTimeout(speechStartTimerRef.current);
            speechStartTimerRef.current = null;
          }
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // 호출부(missions 페이지)의 실제 탭 핸들러(미션 시작/모드 전환/마이크 버튼)에서 명시적으로
  // 불러주는 수동 언락 경로 — "케이 목소리 켜기" 버튼 전용으로도 쓰인다.
  const unlockAudio = useCallback(async (): Promise<boolean> => {
    return ensureOutputAudioRunning();
  }, []);

  useEffect(() => {
    return () => {
      teardown("unmount-cleanup");
    };
  }, []);

  return {
    status, error, transcript, interimChildText, audioLocked,
    // AUTO 모드에서 마이크가 켜져 있는데 실제 오디오가 relay로 전송되지 않는 상태(요구사항 1) —
    // onNoAudioInput 콜백과 별개로 폴링 없이 직접 상태를 읽고 싶은 호출부를 위해 함께 노출한다.
    noAudioInput,
    startSession, stopSession, pauseSession, getTranscript, reset,
    sendText, speakAsK, setAudioMuted, setMicEnabled, appendTurn, seedTranscript, setKSpeechAllowed,
    lockNow, speakClosingLine, unlockAudio,
    setInteractionMode, sendActivityStart, sendActivityEnd,
    cancelCurrentGeneration, logTelemetryEvent,
    // 실측 기반 연결 품질(0~5, 5가 가장 좋음) — WebSocket 상태·최근 재연결 횟수·최근 watchdog
    // (10초 무응답) 발동 횟수·최근 응답 지연시간 평균으로 계산. 가짜 신호 막대 아님.
    connectionQuality,
  };
}
