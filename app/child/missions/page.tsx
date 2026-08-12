"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import { MissionConversationLayout } from "@/components/MissionConversationLayout";
import { useRouter, useSearchParams } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { useGeminiLive, type Turn } from "@/hooks/useGeminiLive";
import { SkeletonBox } from "@/components/Skeleton";
import { VoiceInputModeSwitch } from "@/components/VoiceInputModeSwitch";
import { TestModeERunner } from "@/components/TestModeERunner";
import { TestModeCDRunner } from "@/components/TestModeCDRunner";
import { TestModeABRunner } from "@/components/TestModeABRunner";
import { MissionCompletionController, type MissionCompletionState } from "@/lib/mission/missionCompletionFlow";
import {
  getMissionRewardPresentation,
  shouldShowMissionCompletionModal,
} from "@/lib/mission/missionRewardPresentation";
import { canStartRecording, shouldAcceptChildTurn } from "@/lib/mission/turnGuard";
import { fetchPersonalizedReaction } from "@/lib/mission/personalizedReaction";
import { pickTransitionConnector } from "@/lib/mission/eReactionPool";
import { ChildConversationContext } from "@/lib/mission/ChildConversationContext";
import { getKstHour, currentRound } from "@/lib/mission/missionTimeGate";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { logVoiceEvent } from "@/lib/voiceTimelineLog";
import { appendVocative } from "@/lib/utils/koreanParticle";
import { usePipelineConnectionQuality } from "@/hooks/usePipelineConnectionQuality";
import { ConnectionQualityIndicator } from "@/components/ConnectionQualityIndicator";
import { VoiceConversationStateBadge, type VoiceConversationState } from "@/components/VoiceConversationStateBadge";
import KChatbotWidget from "@/components/KChatbotWidget";
import { clearPendingMissionTurn, readPendingMissionTurn, savePendingMissionTurn } from "@/lib/mission/pendingTurnStore";
import { postMissionTurnWithRetry } from "@/lib/mission/turnRequest";

type RoundType = "round1_day" | "round2_night" | "common";
type VoiceMode = "stt_tts" | "live";

interface MissionQuestion {
  id: string;
  question_text: string;
  dashboard_area_tag: string;
  cycle_type: string;
  round_type: RoundType;
}

type QuestionState = "pending" | "answered" | "skipped" | "refused" | "clarification_required";

type MissionRequestContext = {
  generation: number;
  signal: AbortSignal;
  isActive: () => boolean;
  markSettled: () => void;
};

const MISSION_LOADING_WATCHDOG_MS = 8_000;

type MissionRuntimeTraceSnapshot = {
  isAuto: boolean;
  voiceInputModeHydrated: boolean;
  isRecording: boolean;
  mode: "voice" | "text";
  turnPhase: "idle" | "child_listening" | "child_finalizing" | "waiting_k" | "k_speaking" | "recovering";
};

type MissionTypedGuardTraceSnapshot = {
  missionState: MissionCompletionState;
  turnPhase: MissionRuntimeTraceSnapshot["turnPhase"];
  answerInFlight: boolean;
  voiceMode: VoiceMode | null;
  result: boolean;
};

type MissionRuntimeTrace = MissionRuntimeTraceSnapshot | MissionTypedGuardTraceSnapshot;

function emitMissionRuntimeTrace(event: "render" | "hydrate:start" | "hydrate:queued", snapshot: MissionRuntimeTraceSnapshot) {
  if (typeof window === "undefined") return;
  const traceWindow = window as typeof window & {
    __K_BESTIE_MISSION_RUNTIME_TRACE__?: (event: string, snapshot: MissionRuntimeTrace) => void;
  };
  traceWindow.__K_BESTIE_MISSION_RUNTIME_TRACE__?.(event, snapshot);
}

function emitMissionTypedGuardTrace(snapshot: MissionTypedGuardTraceSnapshot) {
  if (typeof window === "undefined") return;
  const traceWindow = window as typeof window & {
    __K_BESTIE_MISSION_RUNTIME_TRACE__?: (event: string, snapshot: MissionRuntimeTrace) => void;
  };
  traceWindow.__K_BESTIE_MISSION_RUNTIME_TRACE__?.("typed-guard", snapshot);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}



function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// 종료 문구 TTS 폴백 재생 — Live 세션 음성이 종료 발화를 못 낸 경우(2.5초 타임아웃/텍스트만)
// Tier1/2와 동일한 /api/voice/tts 경로로 종료 문구를 합성해 재생한다. useVoiceChat.speak()를
// 재사용하지 않는 이유: 그 훅의 AudioContext는 자체 startSession()에서만 초기화되는데 Live
// 모드에선 그게 실행되지 않아 "AudioContext not initialized" 폴백(텍스트만)으로 빠져 버그①을
// 다른 경로로 재현하기 때문. 여기서는 이 재생 전용의 새 AudioContext를 만들어 쓴다.
async function playClosingLineViaTts(text: string, sessionId: string | null): Promise<void> {
  let ctx: AudioContext | null = null;
  try {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sessionId }),
    });
    if (!res.ok) return;
    const data = await res.json();
        logVoiceEvent({ ts: Date.now(), eventType: "answer_response" });
    if (!data.audioContent) return;
    ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(data.audioContent));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      try { source.start(); } catch { resolve(); }
    });
  } catch {
    // 합성/재생 실패해도 자막은 이미 표시됐으므로 조용히 종료
  } finally {
    ctx?.close().catch(() => {});
  }
}

// 운영시간 게이트 on/off는 서버 환경변수 CHILD_TIME_RESTRICTIONS_ENABLED로 제어한다
// (/api/config/child-time-restrictions 참고) — 게이트 로직(getKstHour/currentRound) 자체는
// 그대로 유지하고, 적용 여부만 이 스위치로 결정한다.

function MissionInner({ onTextModeChange }: { onTextModeChange?: (isTextMode: boolean) => void }) {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const { quality: connectionQuality, recordStageResult, recordNormalTurn } = usePipelineConnectionQuality();

  // confirm_restart_after_completion(022): 오늘 이미 완료한 라운드에 재진입 시 "다시 할까요?"
  // 확인 없이 조용히 새 세션이 만들어지던 문제 수정 — 서버가 requiresConfirmation을 반환하면
  // 이 phase로 멈추고 확인 UI를 보여준다(진행 중/미완료 세션에는 영향 없음).
  const [phase, setPhase] = useState<"loading" | "closed" | "ready" | "error" | "turn_retry" | "confirm_restart_after_completion" | "locked_completed">("loading");
  // 031: MISSION_SCHEDULE_ENFORCED(Production 전용) 여부 — 서버(/api/config/child-time-restrictions)가
  // 계산해 내려준 값을 그대로 저장해 "closed"/완료잠금 화면의 문구 분기에만 쓴다.
  const [scheduleEnforced, setScheduleEnforced] = useState(false);
  const [entryStatus, setEntryStatus] = useState<"checking" | "ready_to_start" | "ready_to_resume" | "starting" | "resuming" | "active" | "error">("checking");
  const missionRequestGenerationRef = useRef(0);
  const activeMissionRequestAbortRef = useRef<AbortController | null>(null);
  // 073-P0 리뷰 지적: 마운트 effect의 요청은 그 effect의 cleanup(abortController.abort())으로
  // 정리되지만, 버튼(시작/이어하기) 트리거 요청은 외부 signal 없이 runMissionRequest를 호출해
  // 컴포넌트가 언마운트돼도 진행 중이던 요청과 watchdog이 정리되지 않았다 — unmount 시
  // 마지막으로 활성화된 요청을 직접 abort해 8초 뒤 언마운트된 컴포넌트에 setState하는
  // 상황과 watchdog 타이머 누수를 막는다.
  useEffect(() => {
    return () => {
      activeMissionRequestAbortRef.current?.abort();
    };
  }, []);
  // 한 번만 소비되는 플래그(ref) — URL 쿼리에 남기면 이후 재진입 때도 계속 true로
  // 남아 두 번째부터는 확인 없이 넘어가 버리므로, 컴포넌트 상태로만 들고 있다가
  // 이 effect 시작 시 즉시 리셋한다. restartTrigger는 같은 effect를 다시 실행시키기
  // 위한 카운터일 뿐 값 자체는 쓰지 않는다.
  const confirmRestartRef = useRef(false);
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MissionQuestion[]>([]);
  const [gauge, setGauge] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [requiredCount, setRequiredCount] = useState(5);
  const [completed, setCompleted] = useState(false);
  const [engineVersion, setEngineVersion] = useState("v1");
  // 012 "좌측에 현재 미션 라벨(하교 후 미션/취침 전 미션) 표시" — round는 미션 시작
  // useEffect 내부 지역변수라 렌더(JSX)에서 못 읽으므로 state로도 보관한다(판정 로직은
  // currentRound()/getKstHour() 그대로, 여기선 결과값만 저장).
  const [roundType, setRoundType] = useState<RoundType | null>(null);
  // 011 2차(2026-07-25): "케이가 잘 못 들었어" 등 오류/끊김 계열 문구를 케이 말풍선이나
  // 상단 배너로 노출하던 것 전부 제거 — 일시적 인식 실패/timeout/fallback은 조용히 1회
  // 재시도하고, 그래도 안 되면 이 재시도 버튼만 표시한다(문구 없음, 배너 아님, 말풍선 아님).
  const [showRetryButton, setShowRetryButton] = useState(false);
  // active → completing → completed (자세한 전이 규칙은 lib/mission/missionCompletionFlow.ts 참고).
  // completing부터 이미 100% 취급(마이크·입력 비활성화) — completed와의 차이는 "종료 발화가
  // 아직 재생 중인지"뿐이다.
  const [missionState, setMissionState] = useState<MissionCompletionState>("active");
  const [rewardStatus, setRewardStatus] = useState<string>("none");
  const [isRewardModalOpen, setIsRewardModalOpen] = useState(false);
  const [hasClosedRewardModal, setHasClosedRewardModal] = useState(false);
  const rewardCloseXBtnRef = useRef<HTMLButtonElement | null>(null);
  const rewardCloseBottomBtnRef = useRef<HTMLButtonElement | null>(null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  useEffect(() => {
    onTextModeChange?.(mode === "text");
  }, [mode, onTextModeChange]);
  const [textInput, setTextInput] = useState("");
  // 요금제(tier)별 음성 방식 — /api/mission/start 응답으로 확정됨. 확정 전까지 null(로딩).
  const [voiceMode, setVoiceMode] = useState<VoiceMode | null>(null);
  // Tier3(Live) 전용 — 설정 메뉴에서 아이가 미리 골라둔 케이 목소리(child_profiles.live_voice_name).
  // /api/mission/start 응답으로 확정됨.
  const [liveVoiceName, setLiveVoiceName] = useState<string>("Achernar");

  const sessionIdRef = useRef<string | null>(null);
  const childIdRef = useRef<string | null>(null);
  childIdRef.current = childId;
  const voiceModeRef = useRef<VoiceMode | null>(null);
  voiceModeRef.current = voiceMode;
  const questionsRef = useRef<MissionQuestion[]>([]);
  const lastReactionRef = useRef<string | null>(null);
  const lastConnectorRef = useRef<string | null>(null);
  const currentIndexRef = useRef(0);
  const questionStatesRef = useRef<Record<string, QuestionState>>({});
  const askedIndexRef = useRef<number>(-1);
  const missionStateRef = useRef<MissionCompletionState>("active");
  const missionClosingLineRef = useRef<string>("오늘 미션을 모두 완료했어! 이야기해 줘서 고마워. 다음에 또 보자!");
  // Live 모드 전용 미션 턴 상태머신 — awaiting_child(아이 답변 대기) → processing_answer(답변
  // 판정/다음 질문 생성 중) → speaking_k(케이가 말하는 중) → awaiting_child. handleTurnComplete의
  // 재진입 가드와 onAudioQueueDrained의 복귀 신호가 이 상태를 관리한다(STT/TTS 모드는 기존
  // 동작을 그대로 유지하며 이 상태를 사용하지 않음).
  const turnPhaseRef = useRef<"idle" | "child_listening" | "child_finalizing" | "waiting_k" | "k_speaking" | "recovering">("idle");
  // turnPhaseRef를 화면에 반영하기 위한 미러 state — ref만으로는 canStartRecording이 답변
  // 판정 중(processing_answer)이라 탭을 막고 있어도 버튼이 계속 "말하기 시작"(🎤)로 보여
  // 아이 입장에선 "버튼 눌러도 반응 없음"으로 느껴졌다(버튼은 정상적으로 탭을 무시하는
  // 중이었을 뿐, 시각 피드백이 전혀 없었던 게 진짜 원인). 판정 로직은 여전히 turnPhaseRef만
  // 읽고(동기·ref 기반 그대로 유지), 이 state는 오직 렌더링(생각 중 표시)에만 쓴다.
  const [turnPhaseUi, setTurnPhaseUi] = useState<"idle" | "child_listening" | "child_finalizing" | "waiting_k" | "k_speaking" | "recovering">("idle");
  const setTurnPhase = useCallback((next: "idle" | "child_listening" | "child_finalizing" | "waiting_k" | "k_speaking" | "recovering") => {
    logVoiceEvent({ ts: Date.now(), eventType:"setTurnPhase", turnPhaseBefore: turnPhaseRef.current, turnPhaseAfter: next, sessionId: sessionIdRef.current, mode: voiceModeRef.current ?? undefined });
    if (turnPhaseRef.current !== "idle" && turnPhaseRef.current !== "child_listening" && turnPhaseRef.current !== "child_finalizing" && turnPhaseRef.current !== "recovering" && next === "idle") {
      liveRef.current?.logTelemetryEvent("thinkingFalse");
      liveRef.current?.logTelemetryEvent("micEnabled");
    }
    turnPhaseRef.current = next;
    setTurnPhaseUi(next);
  }, []);
  // handleTurnComplete의 비동기 처리(답변 제출→다음 질문 계산→askQuestion)가 끝나기 전 재진입
  // 방지 가드. Live 모드는 turnPhaseRef 상태머신으로 이미 막히지만, STT/TTS(Tier1/2) 모드는
  // 케이 발화 재생 완료를 알리는 별도 콜백이 없어 이 플래그가 유일한 재진입 방지 장치다 —
  // 이게 없으면 이전 턴이 currentIndexRef.current를 아직 갱신하기 전에 새 턴(특히 텍스트
  // 입력을 빠르게 연속 전송하는 경우)이 들어와 매번 같은 질문이 중복 제출된다.
  const answerInFlightRef = useRef(false);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  // 유효한 아이 답변 턴마다 1씩 증가 — /api/mission/answer, /api/mission/respond에 함께
  // 실어 보내 서버가 같은 턴에 대한 중복 요청을 식별할 수 있게 하는 idempotency key 재료.
  const childTurnSeqRef = useRef(0);
  const answerEpochRef = useRef(0);
  
  const childContextRef = useRef<ChildConversationContext | null>(null);
  
  // 8초 타임아웃 타이머는 useGeminiLive 내부 generationTimeout으로 이관됨
  // 종료 문구 TTS 폴백이 중복 실행되지 않도록 하는 가드(컨트롤러의 closingFinished 위에 얹는
  // 이중 방어) — onClosingAudioTimeout이 어떤 이유로든 두 번 불려도 재생/저장은 1회만.
  const closingFallbackFiredRef = useRef(false);
  const closingTurnAppendedRef = useRef(false);
  const missionControllerRef = useRef<MissionCompletionController | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // askQuestion은 훅 생성 이후에만 얻을 수 있어 ref로 우회
  // (handleTurnComplete는 훅 생성 전에 정의되어야 하므로 직접 참조 불가)
  const askQuestionRef = useRef<((idx: number, customText?: string) => void) | undefined>(undefined);
  const getTranscriptRef = useRef<(() => Turn[]) | undefined>(undefined);
  // handleTurnComplete가 useGeminiLive(live) 생성보다 먼저 정의돼야 해서(훅에 콜백으로 넘김),
  // live.lockNow()/speakClosingLine()을 직접 참조할 수 없다 — ref로 우회.
  const liveRef = useRef<ReturnType<typeof useGeminiLive> | null>(null);
  // 같은 이유로 useVoiceChat(sttTts)의 setMicEnabled도 ref로 우회 — 답변 처리 중(classifyAnswer
  // 대기 등, 최대 10~32초)에는 자동 모드라도 마이크를 잠가 RMS 자동확정이 또 다른 child 턴을
  // 만들어내지 못하게 한다(버그①②③의 자동 모드측 원인 — 수동 모드는 handleCentralButtonClick의
  // canStartRecording 가드가 동일 역할을 한다).
  const sttSetMicEnabledRef = useRef<((enabled: boolean) => void) | undefined>(undefined);
  const sttSetInputModeRef = useRef<((mode: "auto" | "manual") => void) | undefined>(undefined);
  const sttCancelFinalizeRef = useRef<(() => void) | undefined>(undefined);
  // isAuto state는 handleTurnComplete보다 뒤에서 선언되므로(훅 규칙상 useRef 자체는 미리 선언
  // 가능) 같은 이유로 ref 우회 — 답변 처리가 끝난 뒤 마이크를 다시 켜도 되는지(자동 모드일
  // 때만) 판단하는 데 쓴다.
  const isLiveModeRef = useRef(voiceMode === "live");
  isLiveModeRef.current = voiceMode === "live";
  const manualTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const manualAbortControllerRef = useRef<AbortController | null>(null);
  const sttTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sttAbortControllerRef = useRef<AbortController | null>(null);
  const apiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const apiAbortControllerRef = useRef<AbortController | null>(null);
  const reactionAbortControllerRef = useRef<AbortController | null>(null);
  const kSpeakingSafetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownTurnIdRef = useRef<string | null>(null);
  // STT가 빈 텍스트를 반환한 연속 횟수 - 배경소음/짧은 헛기침 등으로 인한 1회성 인식 실패를
  // "대화가 끊겼다"는 오해성 경고로 즉시 처리하지 않기 위한 허용 카운터. 첫 실패는 조용히
  // 마이크만 다시 연다(재도전 1회 허용과 동일한 원칙); 같은 턴에서 연속 2회째 실패해야만
  // 사용자에게 안내하고 상태를 정리한다. 실제 답변이 성공하면(onSttResult success) 0으로
  // 리셋된다.
  const emptySttStreakRef = useRef(0);
  // 011 2차: timeout/API 실패/응답 오류 등 "케이가 잘 못 들었어" 계열 상황 전반에 쓰는
  // 공용 1회 재시도 플래그. 새 턴이 시작되거나(답변 제출 시작) 실제로 성공(STT 성공 등)하면
  // false로 리셋된다 — 매 턴/시도마다 "조용한 재시도 1회"를 새로 허용한다.
  const recoveryAttemptedRef = useRef(false);
  // 012 "인사 응답이 5초 이상 없거나 무음이면 케이가 한 번 더 재호출한 뒤 자동으로 미션
  // 질문으로 진행한다" — 재시도 횟수 가드가 없으면 아이가 계속 침묵할 때 재호출을 무한
  // 반복해 첫 미션 질문으로 영원히 못 넘어간다(claude-review 지적). 세션당 1회만 재호출을
  // 허용하고, 그 이후엔 무음이어도 인사 턴을 종료 처리하고 진행한다.
  const greetingRetriedRef = useRef(false);

  const resetToIdle = useCallback((showRetryButtonNow?: boolean) => {
    answerEpochRef.current += 1;
    if (manualTimeoutRef.current) { clearTimeout(manualTimeoutRef.current); manualTimeoutRef.current = null; }
    if (manualAbortControllerRef.current) { manualAbortControllerRef.current.abort(); manualAbortControllerRef.current = null; }
    if (sttTimeoutRef.current) { clearTimeout(sttTimeoutRef.current); sttTimeoutRef.current = null; }
    if (sttAbortControllerRef.current) { sttAbortControllerRef.current.abort(); sttAbortControllerRef.current = null; }
    if (apiTimeoutRef.current) { clearTimeout(apiTimeoutRef.current); apiTimeoutRef.current = null; }
    if (apiAbortControllerRef.current) { apiAbortControllerRef.current.abort(); apiAbortControllerRef.current = null; }
    if (kSpeakingSafetyTimeoutRef.current) {
      clearTimeout(kSpeakingSafetyTimeoutRef.current);
      kSpeakingSafetyTimeoutRef.current = null;
    }
    if (!isLiveModeRef.current) {
      sttCancelFinalizeRef.current?.();
    }
    answerInFlightRef.current = false;
    setIsProcessingAnswer(false);
    setIsAutoListening(false);
    setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    
    if (buttonRef.current) {
      buttonRef.current.style.transform = "scale(1)";
      buttonRef.current.style.boxShadow = "none";
    }
    if (pingRef.current) {
      pingRef.current.style.transform = "scale(1)";
      pingRef.current.style.opacity = "0.2";
    }

    if (!isLiveModeRef.current && isAutoRef.current && missionStateRef.current === "active") {
      sttSetMicEnabledRef.current?.(true);
    }

    // 011 2차: 문구를 케이 말풍선(askQuestion 경유 speakAsK)이나 배너로 노출하지 않는다.
    // 복구 불가능한 경우에만 재시도 버튼을 띄운다 — 텍스트도, 채팅 기록 저장도 없다.
    // 텍스트 overlay는 연결 상태와 무관한 presentation state이므로, 실제 연결 장애는
    // overlay가 열려 있어도 기존 retry UX로 그대로 노출한다.
    setShowRetryButton(!!showRetryButtonNow);
  }, [setTurnPhase]);

  const roundTypeRef = useRef<RoundType | null>(null);
  roundTypeRef.current = roundType;
  const sttTtsStopSpeakingRef = useRef<(() => void) | undefined>(undefined);

  const forcedExpiryHandledRef = useRef(false);
  const handleForcedExpiry = useCallback(async (isRequestActive: () => boolean = () => true) => {
    if (forcedExpiryHandledRef.current) return "already_handled" as const;
    if (!isRequestActive()) return "stale" as const;

    // 1. Stop live mic & STT
    try {
      sttSetMicEnabledRef.current?.(false);
      sttCancelFinalizeRef.current?.();
    } catch {}

    // Delay liveRef.current?.lockNow() until server confirmation

    // 2. Stop non-live WebAudio TTS via stopSpeaking API
    try {
      sttTtsStopSpeakingRef.current?.();
    } catch {}

    // 3. Stop DOM audio & speechSynthesis
    try {
      window.speechSynthesis?.cancel();
      if (typeof window !== "undefined") {
        const audioElements = document.querySelectorAll("audio");
        audioElements.forEach((a) => {
          a.pause();
          a.currentTime = 0;
        });
      }
    } catch {}

    if (!isRequestActive()) return "stale" as const;
    resetToIdle(false);

    // 4. Call server endpoint to invoke atomic force-end RPC with bounded retry/keepalive strategy
    let isTerminal = false;
    let isNotExpired = false;

    if (sessionIdRef.current) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch("/api/mission/force-end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sessionIdRef.current }),
            keepalive: true,
          });
          if (!isRequestActive()) return "stale" as const;
          const data = await res.json().catch(() => ({}));
          if (!isRequestActive()) return "stale" as const;
          
          if (data.status === "NOT_EXPIRED") {
            isNotExpired = true;
            break;
          }
          if (data.status === "FORCE_ENDED" || data.status === "ALREADY_ENDED") {
            isTerminal = true;
            break;
          }
        } catch (err) {
          console.error(`[handleForcedExpiry] force-end attempt ${attempt + 1} failed:`, err);
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          if (!isRequestActive()) return "stale" as const;
        }
      }
    } else {
      isTerminal = false;
    }

    if (!isRequestActive()) return "stale" as const;

    if (isNotExpired) {
      // Server returned NOT_EXPIRED: resume session
      try { liveRef.current?.unlockAudio?.(); } catch {}
      if (isAutoRef.current && missionStateRef.current === "active") {
        sttSetMicEnabledRef.current?.(true);
      }
      setErrorMsg("");
      setShowRetryButton(false);
      return "not_expired" as const;
    }

    if (!isTerminal) {
      // All attempts failed: set retryable error state instead of permanent lock
      try { liveRef.current?.unlockAudio?.(); } catch {}
      setErrorMsg("연결 문제로 미션 종료 확인에 실패했어요. 다시 시도해 주세요.");
      setShowRetryButton(true);
      return "retry" as const;
    }

    // 5. Durable forced expiry confirmed by server
    try { liveRef.current?.lockNow(); } catch {}
    forcedExpiryHandledRef.current = true;
    setErrorMsg("미션 시간이 끝났어요");
    setPhase("closed");
    setEntryStatus("error");
    return "closed" as const;
  }, [resetToIdle]);

  useEffect(() => {
    let timerId: NodeJS.Timeout | null = null;

    const checkAndScheduleExpiry = () => {
      if (forcedExpiryHandledRef.current) return;
      // scheduleEnforced=false(Dev)에서는 시간 Gate 자체가 비활성이므로 강제 만료
      // 계산·타이머 생성을 하지 않는다 — Production(scheduleEnforced=true) 로직은 그대로.
      if (!scheduleEnforced) return;

      const nowUtc = Date.now();
      const kstNow = new Date(nowUtc + 9 * 3600000);
      const rType = roundTypeRef.current || (currentRound(kstNow.getUTCHours()) === "round2_night" ? "round2_night" : "round1_day");

      let boundaryMs = 0;
      if (rType === "round2_night") {
        // Mission II / Night round: expires at 00:00 KST next day
        const bDate = new Date(Date.UTC(
          kstNow.getUTCFullYear(),
          kstNow.getUTCMonth(),
          kstNow.getUTCDate() + 1,
          0 - 9, // 00:00 KST next day = 15:00 UTC today
          0, 0, 0
        ));
        boundaryMs = bDate.getTime();
      } else {
        // Mission I / Day round (default): expires at 17:50 KST today
        const bDate = new Date(Date.UTC(
          kstNow.getUTCFullYear(),
          kstNow.getUTCMonth(),
          kstNow.getUTCDate(),
          17 - 9, // 17:50 KST = 08:50 UTC today
          50, 0, 0
        ));
        boundaryMs = bDate.getTime();
      }

      if (nowUtc >= boundaryMs) {
        void handleForcedExpiry();
        return;
      }

      const delay = Math.max(100, boundaryMs - nowUtc);
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        void handleForcedExpiry();
      }, delay);
    };

    checkAndScheduleExpiry();

    const handleRecheck = () => {
      if (document.visibilityState === "visible" || document.hasFocus()) {
        checkAndScheduleExpiry();
      }
    };

    document.addEventListener("visibilitychange", handleRecheck);
    window.addEventListener("focus", handleRecheck);

    return () => {
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleRecheck);
      window.removeEventListener("focus", handleRecheck);
    };
  }, [handleForcedExpiry, scheduleEnforced]);

  // 011 2차: 일시적 인식 실패/timeout/fallback 공용 처리 — 이 턴에서 아직 조용한 재시도를
  // 안 써봤으면(recoveryAttemptedRef=false) 문구·배너 없이 한 번 더 기회를 준다(마이크를
  // 다시 열고 조용히 대기). 이미 한 번 써봤는데 또 실패했으면 그때만 재시도 버튼을 띄운다.
  const attemptSilentRecoveryOrShowRetry = useCallback(() => {
    if (!recoveryAttemptedRef.current) {
      recoveryAttemptedRef.current = true;
      resetToIdle(false);
    } else {
      resetToIdle(true);
    }
  }, [resetToIdle]);

  const showTurnPersistenceRetry = useCallback(() => {
    recoveryAttemptedRef.current = true;
    if (activeChildTurnIdRef.current) {
      sessionStorage.setItem("mission-turn-recovery-paused", activeChildTurnIdRef.current);
    }
    answerInFlightRef.current = false;
    setIsProcessingAnswer(false);
    setIsAutoListening(false);
    setTurnPhase("child_listening");
    setIsRecording(false);
    isRecordingRef.current = false;
    sttSetMicEnabledRef.current?.(false);
    setErrorMsg("대화를 저장하는 중 문제가 생겼어요. 연결을 확인하고 다시 시도해 주세요.");
    setShowRetryButton(true);
    setPhase("turn_retry");
  }, [setTurnPhase]);

  const isAutoRef = useRef(true);
  // 스크롤백용 — DB(chat_messages)에서 불러온 과거 대화. 세션이 live가 된 직후 1회만
  // transcript에 채워넣는다(그 전에 넣으면 startSession()이 비워버림).
  const pastMessagesRef = useRef<Turn[]>([]);

  const displaySequenceCounterRef = useRef(0);
  const nextDisplaySequence = useCallback(() => {
    displaySequenceCounterRef.current += 1;
    return displaySequenceCounterRef.current;
  }, []);

  const nextTurnId = useCallback(() => {
    return crypto.randomUUID();
  }, []);

  const activeChildTurnIdRef = useRef<string | null>(null);
  const activeChildTurnSeqRef = useRef<number | null>(null);
  const kClarificationTurnRef = useRef<boolean>(false);
  const serverPersistedKTextsRef = useRef<string[]>([]);

  const saveMessage = useCallback((role: "child" | "k", content: string, displaySequence?: number, turnId?: string, isClarification?: boolean) => {
    const sid = sessionIdRef.current;
    if (!sid || !content.trim()) return;

    // 모드 전환(자동↔수동) 등 세션 재시작 시 대화 이력이 날아가는 것을 방지하기 위해,
    // 완료된 모든 턴을 공통 소스(pastMessagesRef)에 누적 저장한다.
    pastMessagesRef.current = [...pastMessagesRef.current, { role, text: content, id: turnId, displaySequence }];

    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role, content, voiceMode: voiceModeRef.current, displaySequence, turnId, isClarification }),
    })
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 403 || data.code === "MISSION_EXPIRED" || data.expired || data.status === "FORCE_ENDED") {
            handleForcedExpiry();
          } else {
            console.error("[saveMessage] failed", { status: res.status, turnId, role });
          }
        }
      })
      .catch(err => console.error("[saveMessage] network error", { turnId, role, message: err.message }));
  }, [handleForcedExpiry]);

  const pickNextIndex = useCallback((states: Record<string, QuestionState>): number => {
    const qs = questionsRef.current;
    const cur = currentIndexRef.current;
    if (qs[cur] && states[qs[cur].id] === "clarification_required") return cur;
    for (let i = cur + 1; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "pending") return i;
    }
    for (let i = 0; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "skipped") return i;
    }
    return -1;
  }, []);

  // 세션 이어하기 시 "지금 답해야 할 질문"의 인덱스를 처음부터 찾는다(pickNextIndex는
  // currentIndexRef 이후만 훑으므로 재개 시점엔 맞지 않음).
  function findResumeIndex(qs: MissionQuestion[], states: Record<string, QuestionState>): number {
    for (let i = 0; i < qs.length; i++) {
      if (states[qs[i].id] === "clarification_required") return i;
    }
    for (let i = 0; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "pending") return i;
    }
    for (let i = 0; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "skipped") return i;
    }
    return 0;
  }

  const handleTurnComplete = useCallback((turn: Turn) => {
    logVoiceEvent({ ts: Date.now(), eventType: "handleTurnComplete_start", extra: { role: turn.role }, transcriptSummary: (getTranscriptRef.current?.() ?? []).map(t => ({ role: t.role, id: t.id, displaySequence: t.displaySequence })) });
    // 케이("k") 턴이 끝까지 완료됐다는 건 이번 턴의 파이프라인(Live: 생성+재생 / 비Live:
    // STT→LLM→TTS→재생)이 실제로 성공했다는 신호다 - 연결 품질의 "마지막 정상 턴" 시각을
    // 여기서 갱신해야 90초 무갱신 강제 저하가 실제 성공 이벤트와 무관하게 발동하지 않는다
    // (Live/비Live 공통 콜백이라 두 모드 모두 이 시점에서 회복된다).
    if (turn.role === "k") {
      recordNormalTurn();
      if (turn.text === missionClosingLineRef.current) {
        closingTurnAppendedRef.current = true;
      }
    }
    const isLive = voiceModeRef.current === "live";

    let finalTurnId = turn.id;
    let finalDisplaySequence = turn.displaySequence;

    if (!isLive) {
      if (turn.role === "child") {
        finalTurnId = finalTurnId ?? activeChildTurnIdRef.current ?? nextTurnId();
        finalDisplaySequence = finalDisplaySequence ?? activeChildTurnSeqRef.current ?? nextDisplaySequence();
        activeChildTurnIdRef.current = null;
        activeChildTurnSeqRef.current = null;
      } else if (turn.role === "k") {
        finalTurnId = finalTurnId ?? nextTurnId();
        finalDisplaySequence = finalDisplaySequence ?? nextDisplaySequence();
      }
    }

    const enrichedTurn = { ...turn, id: finalTurnId, displaySequence: finalDisplaySequence };

    if (enrichedTurn.role === "child") {
      lastKnownTurnIdRef.current = enrichedTurn.id ?? null;
    }

    // missionState !== "active"면(completing/completed) 그 이후의 아이 발화는 전부 무시한다
    // — 100% 이후 들어오는 사용자 입력을 미션 판정 로직에 태우지 않기 위함. 이 경우와 'k' 턴은
    // 아래 재진입 가드와 무관하게 항상 저장한다(기존 동작 유지).
    const isChildTurnDuringActiveMission = enrichedTurn.role === "child" && missionStateRef.current === "active";
    if (enrichedTurn.role === "child") {
      if (sttTimeoutRef.current) {
        clearTimeout(sttTimeoutRef.current);
        sttTimeoutRef.current = null;
      }
    }

    // 이전 턴이 아직 처리 중인데 도착한 child 턴은 저장조차 하지 않고 완전히 폐기한다 —
    // handleCentralButtonClick/live.sendActivityStart 호출 전 canStartRecording 가드가 정상
    // 사용자 흐름에선 이 상황 자체를 막아주지만(케이가 말하는 중/답변 처리 중엔 새 녹음을 시작할
    // 수 없음), 자동 모드 RMS 자동확정처럼 그 가드를 통과한 뒤 지연 도착하는 경쟁 상황에 대한
    // 2차 방어선이다. saveMessage보다 먼저 판정해야 폐기된 턴이 화면/DB에 남지 않는다
    // (버그①게이지 오증가·②말풍선 중복 쌓임의 직접 원인이었음 — 예전엔 저장부터 하고 나중에
    // 판정 로직만 건너뛰었음).
    if (isChildTurnDuringActiveMission) {
      if (isLive) {
        // Live 모드 전용 재진입 가드 — 케이가 아직 말하는 중(speaking_k)이거나 직전 답변을
        // 아직 처리 중(processing_answer)이면, 강제컷 직후 지연 도착한 STT 결과 등으로 인한
        // 동일/추가 child 턴을 무시한다(중복 /api/mission/answer·respond 호출 방지).
        if (turnPhaseRef.current !== "child_listening") {
          return;
        }
        setTurnPhase("waiting_k");
        // 위에서 processing_answer로 전이했더라도, 직전 턴의 비동기 체인이 아직 answerInFlightRef를
        // 정리하지 못한 극히 좁은 경합 구간이면 역시 폐기한다(원래 로직 그대로 유지).
        if (answerInFlightRef.current) {
          setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
          return;
        }
      } else if (!shouldAcceptChildTurn({
        isLiveMode: false,
        answerInFlight: answerInFlightRef.current,
        turnPhase: turnPhaseRef.current,
        missionActive: true,
      })) {
        return;
      }
    }

    logVoiceEvent({ ts: Date.now(), eventType: "saveMessage_call", childTurnId: enrichedTurn.id, displaySequence: enrichedTurn.displaySequence });
    
    let isClarification = false;
    if (enrichedTurn.role === "k" && kClarificationTurnRef.current) {
      isClarification = true;
      kClarificationTurnRef.current = false;
    }
    
    const wasServerPersistedK = enrichedTurn.role === "k"
      && serverPersistedKTextsRef.current[0] === enrichedTurn.text;
    if (wasServerPersistedK) {
      serverPersistedKTextsRef.current.shift();
      pastMessagesRef.current = [
        ...pastMessagesRef.current,
        { role: enrichedTurn.role, text: enrichedTurn.text, id: enrichedTurn.id, displaySequence: enrichedTurn.displaySequence },
      ];
    } else if (isChildTurnDuringActiveMission) {
      // 활성 child 턴은 아래 Turn API가 서버 저장을 책임진다. 다만 모드 전환 시
      // 화면 대화가 사라지지 않도록 로컬 스크롤백에는 즉시 한 번만 누적한다.
      pastMessagesRef.current = [
        ...pastMessagesRef.current,
        { role: enrichedTurn.role, text: enrichedTurn.text, id: enrichedTurn.id, displaySequence: enrichedTurn.displaySequence },
      ];
    } else {
      saveMessage(enrichedTurn.role, enrichedTurn.text, enrichedTurn.displaySequence, enrichedTurn.id, isClarification);
    }

    if (!isChildTurnDuringActiveMission) {
      if (!isLive && manualTimeoutRef.current) {
        clearTimeout(manualTimeoutRef.current);
        manualTimeoutRef.current = null;
      }
      if (!isLive && turnPhaseRef.current === "child_finalizing") {
        setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
        if (isAutoRef.current && missionStateRef.current === "active") {
          sttSetMicEnabledRef.current?.(true);
        }
      }
      return;
    }

    const qs = questionsRef.current;
    const idx = currentIndexRef.current;
    const question = qs[idx];
    const sid = sessionIdRef.current;
    if (!question || !sid) {
      if (isLive) {
        setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
      }
      return;
    }

    // 5초 무음 재호출 (인사 턴) — 세션당 1회만. 이미 1회 재호출했는데도 또 무음이면
    // 여기서 return하지 않고 아래 정상 답변 처리 흐름으로 그대로 내려가 인사 턴을 종료
    // 처리하고 진행한다(무한 재호출 방지, claude-review 지적).
    if (question.id === "greeting_turn_0" && !enrichedTurn.text.trim() && !greetingRetriedRef.current) {
      greetingRetriedRef.current = true;
      if (isLive) {
        liveRef.current?.speakAsK("내 말 잘 안 들리니? 다시 한 번 말해줄래?");
        setTurnPhase("child_listening");
      } else {
        sttSetMicEnabledRef.current?.(false);
        setTurnPhase("k_speaking");
        void (async () => {
          if (kVoiceEnabledRef.current) {
            await sttTts.speak("내 말 잘 안 들리니? 다시 한 번 말해줄래?");
          } else {
            sttTts.sayText("내 말 잘 안 들리니? 다시 한 번 말해줄래?");
          }
          resetToIdle(false);
        })();
      }
      return;
    }

    // 이번 아이 답변 턴의 idempotency key 재료 — 서버가 같은 턴에 대한 중복 요청을
    // 식별할 수 있도록 /api/mission/answer, /api/mission/respond에 함께 실어 보낸다.
    const childTurnId = `${sid}:${question.id}:${++childTurnSeqRef.current}`;
    if (answerInFlightRef.current) {
      // 이미 처리 중인데 여기까지 온 경우(위 UI 잠금을 어떤 경로로든 우회한 경우) -
      // 안전하게 폐기한다. 새 턴을 또 만들지 않는다.
      return;
    }

    answerInFlightRef.current = true;
    setIsProcessingAnswer(true);
    // onSpeechEnd가 항상 깔끔하게 먼저 오지 않을 수 있으므로(예: 텍스트 입력 제출,
    // 무음 판정 없이 답변이 접수되는 경로) 답변 처리가 시작되는 이 시점에 확정적으로
    // isAutoListening을 꺼서, 남아있는 "듣는 중" 상태가 이어지는 생각하는 중/말하는 중
    // 단계를 가리지 않도록 한다.
    setIsAutoListening(false);
    // 011 2차: 새 턴을 시작하니 이전 턴에서 이미 조용한 재시도를 썼더라도 이번 턴은
    // 다시 1회 재시도를 허용한다(문제가 매번 새로 판단되도록).
    recoveryAttemptedRef.current = false;
    console.error(`[Timing] (b) 서버 전송 (answer API 호출) - ${Date.now()}`);
    // 답변 처리 시작 — STT/TTS 자동 모드는 마이크가 계속 켜져 있으므로(케이 TTS 재생 중에만
    // speakingRef가 막아줌), classifyAnswer 대기 중(최대 10~32초) 아이가 다시 말하면 RMS
    // 자동확정이 또 다른 child 턴을 만들어낼 수 있었다 — 처리가 끝날 때까지 마이크를 잠근다.
    const currentEpoch = ++answerEpochRef.current;
    if (!isLive) {
      sttSetMicEnabledRef.current?.(false);
      apiAbortControllerRef.current = new AbortController();
      const capturedTurnId = childTurnId; // from above: const childTurnId = `${sid}:${question.id}:${++childTurnSeqRef.current}`;
      apiTimeoutRef.current = setTimeout(() => {
        if (answerEpochRef.current !== currentEpoch) return;
        attemptSilentRecoveryOrShowRetry();
      }, 15000);
    } else {
      manualAbortControllerRef.current = new AbortController();
      if (manualTimeoutRef.current) clearTimeout(manualTimeoutRef.current);
      manualTimeoutRef.current = setTimeout(() => {
        if (answerEpochRef.current !== currentEpoch) return;
        answerEpochRef.current += 1;
        if (manualAbortControllerRef.current) {
          manualAbortControllerRef.current.abort();
          manualAbortControllerRef.current = null;
        }
        setTurnPhase("waiting_k");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
        if (liveRef.current?.status === "live") {
          if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
          if (!success) {
            resetToIdle(true);
          }
        } else {
          // 011 "끊김 안내 문구 제거": 이 else 분기는 liveRef.current?.status !== "live"이면
          // 전부 타는데, 실제 Dev 환경은 STT/TTS(비Live) 구조라 이 조건이 항상 참이다 —
          // 즉 진짜 연결 장애 여부와 무관하게 "서버 연결이 끊겼어요" 문구가 매번 나오고
          // 있었다(원인을 네트워크로 단정하는 문구이기도 함). 네트워크를 단정하지 않는
          // 중립적 문구로 교체한다(아래 6곳 전부 동일).
          attemptSilentRecoveryOrShowRetry();
        }
      }, 8000);
    }
    void (async () => {
      try {
        logVoiceEvent({ ts: Date.now(), eventType: "answer_request" });

        let reactionResultPromise: Promise<string> | null = null;
        if (!isLive) {
          const llmStartedAt = Date.now();
          // 답변 저장 fetch(apiAbortControllerRef)와는 별도의 AbortController를 쓴다 -
          // fetchPersonalizedReaction은 2200ms 내부 타임아웃 시 이 컨트롤러를 스스로
          // abort()하는데, 컨트롤러를 공유하면 그 abort가 답변 저장 fetch까지 취소시켜
          // 아이 답변이 저장되지 않는 사고로 이어진다(D안 TestModeCDRunner도 전용
          // reactionAbortController를 별도로 만들어 쓴다 - 동일 패턴 유지).
          reactionAbortControllerRef.current = new AbortController();
          reactionResultPromise = fetchPersonalizedReaction({
            questionText: question.question_text,
            answerText: enrichedTurn.text,
            sessionId: sid,
            childTurnId,
            lastReaction: lastReactionRef.current,
            childContext: childContextRef.current ?? undefined,
            isStale: () => currentEpoch !== answerEpochRef.current,
            abortController: reactionAbortControllerRef.current,
          }).then((text) => {
            recordStageResult("llm", true, Date.now() - llmStartedAt);
            return text;
          });
        }

        const isGreetingTurn = question.id === "greeting_turn_0";
        // 인사 턴(greeting_turn_0)은 /api/mission/answer를 호출하지 않으므로 data가 없다 —
        // 아래 진행률 갱신/완료판정은 data가 있을 때만(실제 질문 답변일 때만) 실행하고,
        // 다음 질문 선택(pickNextIndex 이후)은 인사 턴이든 실제 답변이든 공통으로 실행된다.
        let data: any = null;

        const finalizeServerTurn = async (kText: string, isClarification: boolean = false) => {
          const kTurnId = `${childTurnId}:k`;
          const kDisplaySequence = nextDisplaySequence();
          const finalizeRes = await postMissionTurnWithRetry({
            body: {
              action: "finalize",
              sessionId: sid,
              clientTurnId: childTurnId,
              kTurnId,
              kContent: kText,
              kDisplaySequence,
              isClarification,
            },
            signal: isLive ? manualAbortControllerRef.current?.signal : apiAbortControllerRef.current?.signal,
          });
          if (!finalizeRes.ok) {
            const finalizeError = await finalizeRes.json().catch(() => ({}));
            if (finalizeRes.status === 403 || finalizeError.code === "MISSION_EXPIRED") {
              handleForcedExpiry();
            }
            const error = new Error(typeof finalizeError.error === "string" ? finalizeError.error : "TURN_FINALIZE_FAILED");
            error.name = "TurnPersistenceError";
            throw error;
          }
          const finalized = await finalizeRes.json();
          serverPersistedKTextsRef.current.push(kText);
          await clearPendingMissionTurn(childTurnId);
          return finalized;
        };

        if (!isGreetingTurn) {
          await savePendingMissionTurn({
            sessionId: sid,
            clientTurnId: childTurnId,
            questionId: question.id,
            answerText: enrichedTurn.text,
            voiceMode: voiceModeRef.current ?? "stt_tts",
            displaySequence: enrichedTurn.displaySequence ?? 0,
            createdAt: Date.now(),
          });
          sessionStorage.setItem("mission-turn-recovery-paused", childTurnId);
          const res = await postMissionTurnWithRetry({
            body: {
              action: "start",
              sessionId: sid,
              clientTurnId: childTurnId,
              questionId: question.id,
              answerText: enrichedTurn.text,
              voiceMode: voiceModeRef.current,
              displaySequence: enrichedTurn.displaySequence ?? 0,
            },
            signal: isLive ? manualAbortControllerRef.current?.signal : apiAbortControllerRef.current?.signal,
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            if (res.status === 403 || errData.code === "MISSION_EXPIRED" || errData.expired || errData.status === "FORCE_ENDED" || errData.scheduleClosed) {
              handleForcedExpiry();
              return;
            }
            if (res.status === 423) {
              if (manualTimeoutRef.current) {
                clearTimeout(manualTimeoutRef.current);
                manualTimeoutRef.current = null;
              }
              if (manualAbortControllerRef.current) {
                manualAbortControllerRef.current.abort();
                manualAbortControllerRef.current = null;
              }
              missionStateRef.current = "completed";
              setMissionState("completed");
              if (isLive) liveRef.current?.lockNow();
              return;
            }
            showTurnPersistenceRetry();
            return;
          }
          data = await res.json();
          sessionStorage.removeItem("mission-turn-recovery-paused");
          logVoiceEvent({ ts: Date.now(), eventType: "answer_response" });
          if (currentEpoch !== answerEpochRef.current) return;
          
          if (data.reason === "safety_signal" || data.status === "SAFETY_PAUSED") {
            if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            if (manualAbortControllerRef.current) {
              manualAbortControllerRef.current.abort();
              manualAbortControllerRef.current = null;
            }
            missionStateRef.current = "completed";
            setMissionState("completed");
            if (isLive) liveRef.current?.lockNow();
            return;
          }

          questionStatesRef.current = data.questionStates ?? questionStatesRef.current;
          if (data.questions) {
            questionsRef.current = data.questions;
            const newIndex = data.questions.findIndex((q: any) => q.id === question.id);
            if (newIndex !== -1) {
              currentIndexRef.current = newIndex;
            }
          }
        } else {
          // 인사 턴 완료 처리 (서버 전송 없이 로컬에서만 상태 업데이트)
          questionStatesRef.current["greeting_turn_0"] = "answered";
        }
        
        if (data) {
          setGauge(data.validAnswerCount ?? 0);
          setProgressPercent(data.progressPercent ?? 0);
          setRequiredCount(data.requiredCount ?? 5);
          setEngineVersion(data.engine_version ?? "v1");

          if (data.completionCandidate) {
            const closingText = "오늘 미션을 모두 완료했어! 이야기해 줘서 고마워. 다음에 또 보자!";
            const finalized = await finalizeServerTurn(closingText);
            if (!finalized.completed) throw new Error("MISSION_COMPLETION_NOT_CONFIRMED");
            const rwStatus = finalized.rewardStatus ?? "none";
            setRewardStatus(rwStatus);
            // DB에 먼저 확정한 K 문구와 실제 재생/폴백 문구를 동일하게 유지한다.
            // 황금열쇠 지급 여부는 서버 응답 기반 보상 모달에서 별도로 안내한다.
            missionClosingLineRef.current = closingText;
            missionStateRef.current = "completing";
            setMissionState("completing");
            if (voiceModeRef.current === "live") {
              if (manualTimeoutRef.current) clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
              setTurnPhase("k_speaking");
              liveRef.current?.lockNow();
              const success = liveRef.current?.speakClosingLine(closingText);
              missionControllerRef.current?.start({ immediateTtsFallback: !success });
            } else {
              setTurnPhase("k_speaking");
              sttSetMicEnabledRef.current?.(false);
              if (kVoiceEnabledRef.current) await sttTts.speak(closingText);
              else sttTts.sayText(closingText);
              missionStateRef.current = "completed";
              setMissionState("completed");
              setCompleted(true);
            }
            return;
          }

          // setCompleted는 발화 완료 후 상태 전이 시에 호출되도록 위임
          if (data.completed) {
            // 035 codex 리뷰 지적: V2 질문엔진에서만 서버가 rewardStatus 필드를 내려준다 -
            // V1(레거시) 세션은 이 필드 자체가 응답에 없어 항상 "none"으로 떨어져 보상
            // 모달이 절대 뜨지 않았다. V1 완료 경로는 서버 지급 로직을 이번 범위에서
            // 건드리지 않고(035 §20 기존 로직 미변경), 완료=지급 성공으로 간주하는
            // 클라이언트 판정만 보강한다(V1은 애초에 완료·지급이 원자적으로 처리되던 구조).
            const isLegacyV1 = (data.engine_version ?? "v1") !== "v2";
            const rwStatus = data.rewardStatus ?? (isLegacyV1 ? "awarded" : "none");
            setRewardStatus(rwStatus);
            if (rwStatus === "awarded" || rwStatus === "already_earned" || rwStatus === "granted") {
              missionClosingLineRef.current = "오늘 미션을 모두 완료했어! 황금열쇠를 받았어. 다음에 또 보자!";
            } else {
              missionClosingLineRef.current = "오늘 미션을 모두 완료했어! 이야기해 줘서 고마워. 다음에 또 보자!";
            }
            missionStateRef.current = "completing";
            setMissionState("completing");
          // 5번째 유효 답변 확정 — 여기서 곧바로 세션을 끊지 않는다(케이가 아직 종료 발화를
          // 하는/할 중일 수 있음). Live 모드는 별도 종료 플로우(missionCompletionFlow)가
          // "종료 발화의 turnComplete + 오디오 재생 완료 + 700ms" 이후에만 세션을 닫는다.
          // 일반 후속 질문 큐(pickNextIndex/askQuestion)는 절대 실행하지 않는다.
          if (voiceModeRef.current === "live") {
            // 8초 수동 타임아웃(manualTimeoutRef)이 여기서 정리되지 않으면, 미션이 이미
            // 완료되고 케이가 종료 인사를 마친 뒤에도 그 타이머가 뒤늦게 발화해 불필요한
            // speakAsK("시간이 좀 걸리네...") 재시도를 추가로 트리거한다(다른 모든 분기는
            // manualTimeoutRef/manualAbortControllerRef를 정리하는데, 이 분기만 빠져있었음).
            if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            if (manualAbortControllerRef.current) {
              manualAbortControllerRef.current.abort();
              manualAbortControllerRef.current = null;
            }
            setTurnPhase("k_speaking");
            liveRef.current?.lockNow();
            const success = liveRef.current?.speakClosingLine(missionClosingLineRef.current);
            missionControllerRef.current?.start({ immediateTtsFallback: !success });
          } else {
            // STT/TTS(Tier1/2) 경로는 연속 스트리밍 세션이 아니라 매 발화가 개별 TTS
            // 호출로 끝나므로 기존의 단순 즉시 종료 방식을 그대로 유지한다.
            if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            if (manualAbortControllerRef.current) {
              manualAbortControllerRef.current.abort();
              manualAbortControllerRef.current = null;
            }
            setTurnPhase("k_speaking");
            sttSetMicEnabledRef.current?.(false);
            if (kVoiceEnabledRef.current) {
              await sttTts.speak(missionClosingLineRef.current);
            } else {
              sttTts.sayText(missionClosingLineRef.current);
            }
            missionStateRef.current = "completed";
            setMissionState("completed");
            setCompleted(true);
          }
          return;
          }
        }

        const next = pickNextIndex(questionStatesRef.current);
        if (next === -1) {
          if (data?.questionPoolExhausted) {
            console.error("MISSION_QUESTION_POOL_EXHAUSTED", { sessionId: sid });
            if (isLive) {
              if (manualTimeoutRef.current) {
                clearTimeout(manualTimeoutRef.current);
                manualTimeoutRef.current = null;
              }
              setTurnPhase("waiting_k");
              if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
              if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
              if (liveRef.current?.status === "live") {
                if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
                const success = liveRef.current.speakAsK("다음 질문을 준비하지 못했어요. 나중에 다시 해보자.");
                if (!success) {
                  resetToIdle(true);
                }
              } else {
                resetToIdle(true);
              }
            } else {
              resetToIdle(true);
            }
            return;
          }

          if (isLive) {
            if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            setTurnPhase("waiting_k");
            if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
            if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
            if (liveRef.current?.status === "live") {
              if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
              if (!success) {
                resetToIdle(true);
              }
            } else {
              attemptSilentRecoveryOrShowRetry();
            }
          } else {
            resetToIdle(true);
          }
          return;
        }

        currentIndexRef.current = next;

        if (!isLive) {
          if (apiTimeoutRef.current) {
            clearTimeout(apiTimeoutRef.current);
          }
          apiAbortControllerRef.current = new AbortController();
          apiTimeoutRef.current = setTimeout(() => {
            if (answerEpochRef.current !== currentEpoch) return;
            attemptSilentRecoveryOrShowRetry();
          }, 15000);
        }

        // 다음 질문 유도 멘트 동적 생성 및 폴백 — askQuestionRef는 정확히 1회만 호출한다.
        const nextQ = questionsRef.current[next];
        if (!nextQ) {
          if (isLive) {
          if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            setTurnPhase("waiting_k");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
            if (liveRef.current?.status === "live") {
              if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
              if (!success) {
                resetToIdle(true);
              }
            } else {
              attemptSilentRecoveryOrShowRetry();
            }
          } else {
            attemptSilentRecoveryOrShowRetry();
          }
          return;
        }

        let respondText: string | undefined;
        if (data?.clarificationText) {
          respondText = data.clarificationText;
          kClarificationTurnRef.current = true;
        } else if (!isLive) {
          const reactionText = await reactionResultPromise!;
          if (currentEpoch !== answerEpochRef.current) return;
          lastReactionRef.current = reactionText;
          let parentQuestionText: string | null = null;
          try {
            const parentQuestionRes = await fetch("/api/mission/respond", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                history: getTranscriptRef.current?.() ?? [],
                nextQuestionText: nextQ.question_text,
                childTurnId,
                childContext: childContextRef.current ?? undefined,
                parentQuestionOnly: true,
              }),
              signal: apiAbortControllerRef.current?.signal,
            });
            if (parentQuestionRes.ok) {
              const parentQuestionData = await parentQuestionRes.json();
              parentQuestionText =
                typeof parentQuestionData.text === "string"
                  ? parentQuestionData.text
                  : null;
            } else {
              const errData = await parentQuestionRes.json().catch(() => ({}));
              if (parentQuestionRes.status === 403 || errData.code === "MISSION_EXPIRED" || errData.code === "PERSISTENCE_FAILURE" || errData.expired || errData.status === "FORCE_ENDED" || errData.status === "PERSISTENCE_FAILURE") {
                handleForcedExpiry();
                return;
              }
            }
          } catch (error) {
            if ((error as Error)?.name === "AbortError") throw error;
            console.error("[mission] parent question lookup failed", error);
          }
          const connector = pickTransitionConnector(lastConnectorRef.current);
          lastConnectorRef.current = connector;
          respondText = `${reactionText} ${connector} ${parentQuestionText ?? nextQ.question_text}`;
        } else {
          try {
            logVoiceEvent({ ts: Date.now(), eventType: "respond_request" });
            const respondRes = await fetch("/api/mission/respond", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                history: getTranscriptRef.current?.() ?? [],
                nextQuestionText: nextQ.question_text,
                childTurnId,
                childContext: childContextRef.current ?? undefined,
              }),
              signal: manualAbortControllerRef.current?.signal,
            });
            if (respondRes.ok) {
              const respondData = await respondRes.json();
            logVoiceEvent({ ts: Date.now(), eventType: "respond_response" });
              if (respondData.text) respondText = respondData.text;
            } else {
              if (currentEpoch !== answerEpochRef.current) return;
              const errData = await respondRes.json().catch(() => ({}));
              if (respondRes.status === 403 || errData.code === "MISSION_EXPIRED" || errData.expired || errData.status === "FORCE_ENDED") {
                handleForcedExpiry();
                return;
              }
              if (manualTimeoutRef.current) {
                clearTimeout(manualTimeoutRef.current);
                manualTimeoutRef.current = null;
              }
              setTurnPhase("waiting_k");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
              if (liveRef.current?.status === "live") {
                if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
                if (!success) {
                  resetToIdle(true);
                }
              } else {
                attemptSilentRecoveryOrShowRetry();
              }
              return;
            }
          } catch {
            // 예외 발생 시에도 오류 복구 경로로 이동
            if (currentEpoch !== answerEpochRef.current) return;
            if (manualTimeoutRef.current) {
              clearTimeout(manualTimeoutRef.current);
              manualTimeoutRef.current = null;
            }
            setTurnPhase("waiting_k");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
            if (liveRef.current?.status === "live") {
              if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
              if (!success) {
                resetToIdle(true);
              }
            } else {
              attemptSilentRecoveryOrShowRetry();
            }
            return;
          }
        }
        if (currentEpoch !== answerEpochRef.current) return;
        if (manualTimeoutRef.current) {
          clearTimeout(manualTimeoutRef.current);
          manualTimeoutRef.current = null;
        }
        if (isLive) {
          setTurnPhase("k_speaking");
        }
        if (!isGreetingTurn) {
          const finalized = await finalizeServerTurn(respondText ?? nextQ.question_text, data?.clarificationText != null);
          if (finalized.completed) {
            throw new Error("UNEXPECTED_COMPLETION_DURING_NEXT_QUESTION");
          }
        }
        askQuestionRef.current?.(next, respondText);
      } catch (error) {
        if (error instanceof Error && (error.name === "TurnPersistenceError" || error.name === "MissionTurnRequestError")) {
          showTurnPersistenceRetry();
          return;
        }
        if (currentEpoch !== answerEpochRef.current) return;
        if (isLive) {
          if (manualTimeoutRef.current) {
            clearTimeout(manualTimeoutRef.current);
            manualTimeoutRef.current = null;
          }
          setTurnPhase("waiting_k");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
          if (liveRef.current?.status === "live") {
            if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(true);
              const success = liveRef.current.speakAsK("음... 잠깐만 기다려줄래?");
            if (!success) {
              resetToIdle(true);
            }
          } else {
            attemptSilentRecoveryOrShowRetry();
          }
        } else {
          resetToIdle(false);
          setErrorMsg("대화를 저장하는 중 문제가 생겼어요. 연결을 확인하고 다시 시도해 주세요.");
          setShowRetryButton(true);
        }
      } finally {
        if (currentEpoch === answerEpochRef.current) {
          answerInFlightRef.current = false;
          setIsProcessingAnswer(false);
          if (apiTimeoutRef.current) {
            clearTimeout(apiTimeoutRef.current);
            apiTimeoutRef.current = null;
          }
          // 자동 모드에서만 마이크를 되살린다 — 수동 모드는 다음 명시적 버튼 탭 전까지 계속
          // 꺼져 있어야 한다(handleCentralButtonClick이 그때 다시 켠다).
          if (!isLive && isAutoRef.current && missionStateRef.current === "active") {
            sttSetMicEnabledRef.current?.(true);
          }
          // Live 방어선 — 어떤 경로로든 processing_answer에 머문 채 이 비동기 체인이 끝나면
          // (예상 밖 예외 등) 마이크가 영구히 잠긴다. 미션이 진행 중이면 awaiting_child로
          // 되돌린다. speaking_k(K가 정상적으로 답변 중)와 completing/completed는 건드리지 않는다.
          if (isLive && missionStateRef.current === "active" && turnPhaseRef.current === "waiting_k") {
            setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
          }
        }
      }
    })();
  }, [saveMessage, pickNextIndex, nextTurnId, nextDisplaySequence, recordNormalTurn, showTurnPersistenceRetry]);

  // 자동·수동 발화 상태 및 DOM 조작을 위한 Ref 선언
  const [isAuto, setIsAuto] = useState(true);
  const [voiceInputModeHydrated, setVoiceInputModeHydrated] = useState(false);
  const didHydrateRef = useRef(false);
  isAutoRef.current = isAuto;
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef<number>(0);
  // STT/TTS 재현 테스트(2026-07-27): AUTO 모드는 isRecording을 전혀 쓰지 않아(수동 녹음
  // 버튼 전용 상태) voiceState의 "listening" 판정이 AUTO 모드에서는 코드상 도달 불가능했다
  // (Playwright 실측 - 인사 발화 종료 후 아이 답변을 기다리는 13초 이상 동안 배지가 계속
  // idle이었고 "듣는 중"은 한 번도 뜨지 않음). useVoiceChat이 이미 갖고 있던
  // onSpeechBegin/onSpeechEnd(실제 RMS 음성 감지 이벤트, 지금까지 아무도 연결 안 함)를
  // AUTO 모드 전용으로 연결해 실제 음성 입력이 감지되는 구간만 "듣는 중"으로 표시한다.
  // 수동 모드의 isRecording/canStartRecording 등 기존 로직은 전혀 건드리지 않는다.
  const [isAutoListening, setIsAutoListening] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const pingRef = useRef<HTMLDivElement | null>(null);

  emitMissionRuntimeTrace("render", {
    isAuto,
    voiceInputModeHydrated,
    isRecording,
    mode,
    turnPhase: turnPhaseRef.current,
  });

  // 음성·텍스트가 같은 child 턴 수락 조건을 공유한다. 연결 및 Live 내부 VAD/STT 확정
  // 상태는 각 훅이 검사하고, 페이지는 미션 턴 상태와 API 처리 중 여부를 검사한다.
  const canAcceptTypedInput = useCallback(() => {
    const turnReady = voiceModeRef.current === "live"
      ? turnPhaseRef.current === "child_listening"
      : true;
    const result = missionStateRef.current === "active"
      && turnReady
      && !answerInFlightRef.current;
    emitMissionTypedGuardTrace({
      missionState: missionStateRef.current,
      turnPhase: turnPhaseRef.current,
      answerInFlight: answerInFlightRef.current,
      voiceMode: voiceModeRef.current,
      result,
    });
    return result;
  }, []);

  const sttTts = useVoiceChat({
    onTurnComplete: handleTurnComplete,
    getSessionId: () => sessionIdRef.current,
    // STT/TTS 재현 테스트(2026-07-27) 수정 — AUTO 모드 전용 "듣는 중" 신호. 실제 RMS
    // 음성 감지 시점(onSpeechBegin)~무음 확정으로 finalize가 트리거되는 시점(onSpeechEnd)
    // 사이만 true로 유지한다. 수동 모드는 isAutoRef.current가 false라 전혀 영향받지 않는다.
    onSpeechBegin: () => {
      if (isLiveModeRef.current || !isAutoRef.current) return;
      setIsAutoListening(true);
    },
    onSpeechEnd: () => {
      if (isLiveModeRef.current) return;
      setIsAutoListening(false);
    },
    onEmptyAudio: () => {
      if (isLiveModeRef.current) return;
      emptySttStreakRef.current += 1;
      if (emptySttStreakRef.current < 2) {
        // 배경소음/짧은 헛기침 등 1회성 인식 실패 - 대화를 끊지 않고 조용히 마이크만 다시 연다.
        // 수동 모드에서 답변 제출 시 걸어둔 10초 STT 워치독(sttTimeoutRef)이 이 조용한
        // 재시도로는 자연히 해제되지 않으므로(resetToIdle/onTurnComplete 어느 쪽도 타지
        // 않음) 여기서 명시적으로 정리한다 - 안 그러면 10초 뒤 엉뚱하게 "서버 연결이
        // 불안정해요" 워치독 메시지가 뒤늦게 튀어나온다(claude-review 지적, 실제 회귀).
        if (sttTimeoutRef.current) { clearTimeout(sttTimeoutRef.current); sttTimeoutRef.current = null; }
        if (isAutoRef.current && missionStateRef.current === "active") {
          sttSetMicEnabledRef.current?.(true);
        }
        return;
      }
      resetToIdle(true);
    },
    onSttFailed: (reason) => {
      if (isLiveModeRef.current) return;
      emptySttStreakRef.current += 1;
      if (emptySttStreakRef.current < 2) {
        // 위 onEmptyAudio와 동일한 이유로 수동 모드 워치독을 여기서도 정리한다.
        if (sttTimeoutRef.current) { clearTimeout(sttTimeoutRef.current); sttTimeoutRef.current = null; }
        if (isAutoRef.current && missionStateRef.current === "active") {
          sttSetMicEnabledRef.current?.(true);
        }
        return;
      }
      resetToIdle(true);
    },
    onSttResult: (success, latencyMs) => {
      if (success) emptySttStreakRef.current = 0;
      if (!isLiveModeRef.current) recordStageResult("stt", success, latencyMs);
    },
    onTtsResult: (success, latencyMs) => {
      if (!isLiveModeRef.current) recordStageResult("tts", success, latencyMs);
    },
    onPlayResult: (success) => {
      if (!isLiveModeRef.current) recordStageResult("play", success, 0);
    }
  });
  sttSetMicEnabledRef.current = sttTts.setMicEnabled;
  sttSetInputModeRef.current = sttTts.setInputMode;
  sttCancelFinalizeRef.current = sttTts.cancelFinalize;
  sttTtsStopSpeakingRef.current = sttTts.stopSpeaking;
  const live = useGeminiLive({
    onTurnComplete: handleTurnComplete,
    canAcceptTypedInput,
    voiceName: liveVoiceName,
    sttMode: "gcp",
    // Care Premium 미션 화면에만 무입력 감지(+RMS threshold 오버라이드)를 켠다 — 자유대화의
    // Live 경로나 TestModeABRunner는 이 옵션을 넘기지 않으므로 기존 그대로 유지된다.
    enableNoAudioInputDetection: true,
    getSessionId: () => sessionIdRef.current,
    getChildId: () => childIdRef.current,
    onRecoveryNeeded: () => {
      setTurnPhase("recovering");
      if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
      if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
      // 011 2차: "재연결 성공 시 사용자 메시지 없이 대화 계속" — 텍스트 배너를 아예 없앤다.
      // 내부적으로만 재연결을 시도하고, 실패가 반복되면(handleTurnComplete/onKTurnTimeout
      // 등 다른 경로에서) attemptSilentRecoveryOrShowRetry가 재시도 버튼을 띄운다.
    },
    displaySequenceCounterRef,
    onServerTurnComplete: () => {
      if (missionControllerRef.current?.getState() === "completing") {
        missionControllerRef.current.notifyTurnComplete();
      }
      // K 턴이 서버에서 완전히 끝난 시점 — 오디오 큐 drain(onAudioQueueDrained)이 유실돼도
      // 여기서 speaking_k를 확실히 awaiting_child로 되돌린다(마이크 영구 잠김 방지, 이중 방어).
      if (missionStateRef.current === "active" && turnPhaseRef.current === "k_speaking") {
        if (kSpeakingSafetyTimeoutRef.current) {
          clearTimeout(kSpeakingSafetyTimeoutRef.current);
        }
        kSpeakingSafetyTimeoutRef.current = setTimeout(() => {
          if (missionStateRef.current === "active" && (turnPhaseRef.current === "k_speaking" || turnPhaseRef.current === "recovering")) {
        setTurnPhase("child_listening");
            if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
            if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
          }
        }, 5000);
      }
    },
    // K 발화의 "첫 출력(텍스트/오디오)"이 화면/스피커에 도달하는 순간마다 mic를 unlock한다.
    onKTurnFirstOutput: () => {
      // idle 전환 로직 제거
    },
    // K 턴의 첫 출력이 8초 동안 없어서 generation이 취소되었을 때 호출
    onKTurnTimeout: () => {
      if (missionStateRef.current === "active" && turnPhaseRef.current !== "idle") {
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
        // 011 2차: "통신이 고르지 않아요"를 케이 말풍선(appendTurn)이나 배너로 남기던 것을
        // 완전히 제거 — 공용 1회 조용한 재시도 후에도 반복되면 그때만 재시도 버튼을 띄운다.
        attemptSilentRecoveryOrShowRetry();
      }
    },
    onAudioQueueDrained: () => {
      if (missionControllerRef.current?.getState() === "completing") {
        missionControllerRef.current.notifyAudioDrained();
      }
      if (kSpeakingSafetyTimeoutRef.current) {
        clearTimeout(kSpeakingSafetyTimeoutRef.current);
        kSpeakingSafetyTimeoutRef.current = null;
      }
      // 케이가 실제로 말을 완전히 마친 시점(오디오 큐 비움) — speaking_k였다면 다음 아이
      // 발화를 받을 수 있는 awaiting_child로 되돌린다.
      if (missionStateRef.current === "active" && (turnPhaseRef.current === "k_speaking" || turnPhaseRef.current === "recovering")) {
        setTurnPhase("child_listening");
        if (liveRef.current?.setKSpeechAllowed) liveRef.current.setKSpeechAllowed(false);
        if (typeof live !== 'undefined' && live.setKSpeechAllowed) live.setKSpeechAllowed(false);
      }
    },
    onClosingAudioChunk: () => {
      if (missionControllerRef.current?.getState() === "completing") {
        missionControllerRef.current.notifyClosingAudioStarted();
      }
    },
    // gcp STT 전사가 외국 문자로 판정돼 채택 불가한 경우 — Live 모델에게 재질문 생성을
    // 요청하지 않고, 클라이언트가 정해진 고정 문구를 speakAsK(기존 발화 경로)로 정확히
    // 1회만 재생한다. askedIndex/currentIndex를 건드리지 않으므로 같은 질문에 대한
    // awaiting_child 상태로 복귀한다(onAudioQueueDrained가 재생 종료 시 되돌림).
    onTranscriptRejected: () => {
      if (turnPhaseRef.current === "k_speaking") return; // 이미 처리 중 — 중복 방지
      // 011 2차: "케이가 잘 못 들었어" 등 문구를 케이 말풍선(speakAsK, 채팅 기록에 영구
      // 저장됨)으로 노출하던 것을 완전히 제거한다. 이 콜백의 실제 원인은 연결 장애가
      // 아니라 STT 전사가 외국 문자로 판정돼 채택 불가한 경우다 — 첫 실패는 아무 말 없이
      // 조용히 다시 듣기 상태로 돌아가 아이가 자연스럽게 다시 말할 기회를 준다. 같은
      // 턴에서 반복되면(공용 재시도 플래그) 그때만 재시도 버튼을 띄운다.
      if (!recoveryAttemptedRef.current) {
        recoveryAttemptedRef.current = true;
        setTurnPhase("child_listening");
        if (live.setKSpeechAllowed) live.setKSpeechAllowed(false);
      } else {
        setTurnPhase("child_listening");
        if (live.setKSpeechAllowed) live.setKSpeechAllowed(false);
        setShowRetryButton(true);
      }
    },
    onAudioLevelChange: (level) => {
      if (!buttonRef.current) return;
      // 수동 녹음 중인 상태에서만 레벨 미터 반응
      if (isRecordingRef.current) {
        const scale = 1 + Math.min(level * 2.0, 0.45); // 최대 1.45배 확장
        const shadowRadius = Math.min(level * 50, 40); // 최대 40px glow
        
        buttonRef.current.style.transform = `scale(${scale})`;
        // --color-k-warning (경고/오렌지색 계열) 디자인 토큰 활용
        buttonRef.current.style.boxShadow = level > 0.005 
          ? `0 0 ${shadowRadius}px var(--color-k-warning)` 
          : "none";

        if (pingRef.current) {
          pingRef.current.style.transform = `scale(${1 + level * 2.5})`;
          pingRef.current.style.opacity = `${Math.min(0.2 + level * 1.5, 0.9)}`;
        }
      } else {
        // 비녹음 시 즉시 리셋
        buttonRef.current.style.transform = "scale(1)";
        buttonRef.current.style.boxShadow = "none";
        if (pingRef.current) {
          pingRef.current.style.transform = "scale(1)";
          pingRef.current.style.opacity = "0.2";
        }
      }
    }
  });
  liveRef.current = live;

  // 미션 종료 플로우 컨트롤러 — Live 모드 전용, 최초 1회만 생성(이후 렌더에서는 그대로 재사용).
  if (!missionControllerRef.current) {
    missionControllerRef.current = new MissionCompletionController({
      onStateChange: (s) => {
        missionStateRef.current = s;
        setMissionState(s);
        // completing 진입 즉시 마이크·추가 입력 차단(방어적 이중 조치 — UI도 isDone 기준으로
        // 버튼을 감춘다). 종료 발화는 이미 진행 중인 세션을 통해 계속 재생된다.
        if (s === "completing") liveRef.current?.setMicEnabled(false);
        if (s === "completed") setCompleted(true);
      },
      // fallback/외부 종료 경로 전용 — 정상 경로는 케이 본인의 발화가 이미 화면에 떠 있다.
      onShowCompletionText: () => {
        liveRef.current?.appendTurn({ role: "k", text: missionClosingLineRef.current });
      },
      onCloseSession: () => {
        liveRef.current?.stopSession();
      },
      // 실제 황금열쇠 지급/미션 완료 저장은 /api/mission/answer가 서버에서 이미 멱등하게
      // 처리했다(valid_answer_count 최초 5 달성 시점에만 적립) — 여기서는 클라이언트
      // 오케스트레이션이 정확히 1회만 이 경로를 타는지 로깅만 한다.
      onGrantReward: () => {
        console.log("[MissionFlow] reward already granted server-side (idempotent) — client ack");
      },
      // Live 종료 발화 음성이 2.5초 안에 시작되지 않았거나 텍스트만으로 끝난 경우 —
      // 종료 문구를 별도 TTS(/api/voice/tts)로 합성·재생하고 자막/DB에도 정확히 1회 반영한다.
      onClosingAudioTimeout: async () => {
        if (closingFallbackFiredRef.current) return;
        closingFallbackFiredRef.current = true;
        const text = missionClosingLineRef.current;
        if (!closingTurnAppendedRef.current) {
          closingTurnAppendedRef.current = true;
          const kId = nextTurnId();
          const fallbackSeq = nextDisplaySequence();
          liveRef.current?.appendTurn({ role: "k", text, id: kId, displaySequence: fallbackSeq });
          saveMessage("k", text, fallbackSeq, kId);
        }
        await playClosingLineViaTts(text, sessionIdRef.current);
      },
      onLog: (event, fields) => console.log(`[MissionFlow] ${event}`, fields ?? {}),
    });
  }

  const isLiveMode = voiceMode === "live";

  const [kVoiceEnabled, setKVoiceEnabled] = useState(true);
  const kVoiceEnabledRef = useRef(true);
  kVoiceEnabledRef.current = kVoiceEnabled;

  const toggleKVoice = useCallback(() => {
    setKVoiceEnabled((prev) => {
      const next = !prev;
      if (!next) {
        // 끄는 순간 재생 중이던 케이 음성을 즉시 중단 — 다음 응답부터 무음 텍스트로 진행.
        sttTts.stopSpeaking();
      }
      return next;
    });
  }, [sttTts]);

  const voice = isLiveMode
    ? {
        status: live.status as string,
        error: live.error,
        transcript: live.transcript,
        interimChildText: live.interimChildText,
        startSession: live.startSession,
        stopSession: live.stopSession,
        setMicEnabled: live.setMicEnabled,
        canSendTypedText: live.canSendTypedText,
        sendTypedText: live.sendTypedText,
        getTranscript: live.getTranscript,
        seedTranscript: live.seedTranscript,
      }
    : {
        status: sttTts.status as string,
        error: sttTts.error,
        transcript: sttTts.transcript,
        interimChildText: sttTts.interimChildText,
        startSession: sttTts.startSession,
        stopSession: sttTts.stopSession,
        setMicEnabled: sttTts.setMicEnabled,
        seedTranscript: sttTts.seedTranscript,
        canSendTypedText: () => sttTts.status === "live" && canAcceptTypedInput(),
        sendTypedText: (text: string) => {
          if (sttTts.status !== "live" || !canAcceptTypedInput()) return false;
          sttTts.sendTypedText(text);
          return true;
        },
        getTranscript: sttTts.getTranscript,
      };

  const [sessionActive, setSessionActive] = useState(false);

  // 미션 진행 상태에 따른 세션 활성화
  useEffect(() => {
    if (phase === "ready" && missionState !== "completed") {
      setSessionActive(true);
    } else if (missionState === "completed" || phase === "closed" || phase === "error" || phase === "confirm_restart_after_completion") {
      // codex 지적: confirm_restart_after_completion 진입 시에도 이전 세션이 활성 상태로
      // 남아있으면(예: restartTrigger 재실행 경합) 마이크/음성 세션이 꺼지지 않을 수 있다.
      setSessionActive(false);
    }
  }, [phase, missionState]);

  useEffect(() => {
    if (voice.status === "live" && turnPhaseRef.current === "recovering") {
      setTurnPhase("child_listening");
    }
  }, [voice.status, setTurnPhase]);

  // 화면 이탈 시 미완료 턴 취소 처리(신규)
  useEffect(() => {
    const handleLeave = () => {
      // (c) turnPhase가 "idle"이 아닌 경우 미완료 턴 취소 처리
      if (turnPhaseRef.current !== "idle") {
        const sid = sessionIdRef.current;
        const currentTurnId = activeChildTurnIdRef.current;
        if (sid && currentTurnId) {
          fetch("/api/chat/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({ sessionId: sid, turnId: currentTurnId, turnStatus: "cancelled" }),
          }).catch(() => {});
        }
      }
      // (b) 진행 중인 fetch 중단
      if (manualAbortControllerRef.current) {
        manualAbortControllerRef.current.abort();
      }
      if (sttTimeoutRef.current) { clearTimeout(sttTimeoutRef.current); sttTimeoutRef.current = null; }
      if (sttAbortControllerRef.current) { sttAbortControllerRef.current.abort(); sttAbortControllerRef.current = null; }
      if (apiTimeoutRef.current) { clearTimeout(apiTimeoutRef.current); apiTimeoutRef.current = null; }
      if (apiAbortControllerRef.current) { apiAbortControllerRef.current.abort(); apiAbortControllerRef.current = null; }
      // (a) WS 연결 종료
      if (liveRef.current) {
        liveRef.current.stopSession();
      } else if (sttCancelFinalizeRef.current) {
        // stt fallback
      }
    };

    window.addEventListener("pagehide", handleLeave);

    return () => {
      window.removeEventListener("pagehide", handleLeave);
      handleLeave();
    };
  }, []);

  // 페이지 이탈(언마운트) 시 false 처리 및 타이머 정리
  useEffect(() => {
    return () => {
      setSessionActive(false);
      if (kSpeakingSafetyTimeoutRef.current) {
        clearTimeout(kSpeakingSafetyTimeoutRef.current);
      }
    };
  }, []);



  // 화면 wake lock — Rules of Hooks 위반 방지를 위해 아래쪽의 phase==="loading"/"closed"/
  // "error" 조기 return들보다 반드시 먼저 호출해야 한다(모든 렌더에서 동일한 순서로 호출
  //돼야 함 — early return 뒤로 옮기면 phase에 따라 훅 호출 개수가 달라져 React #310으로
  // 페이지 전체가 크래시한다. 실제로 한 번 이 문제로 크래시를 냈던 적이 있어 이 주석을
  // 남긴다). 세션이 실제로 연결돼 있고(voice.status live) "completed"(종료 발화까지 다
  // 끝난 시점)가 되기 전까지는 유지한다 — completing 단계(5번째 답변 확정~종료 발화 재생
  // 중)에도 화면이 꺼지면 안 되므로 isDone이 아니라 missionState==="completed" 여부로 판정.
  const wakeLockWarning = useScreenWakeLock(sessionActive);

  getTranscriptRef.current = voice.getTranscript;

  const [autoStartFailed, setAutoStartFailed] = useState(false);
  const hasAutoStartedRef = useRef(false);

  // 037: 자동/수동 무관하게 세션 연결은 반드시 시작하기/이어하기 버튼 클릭(active 진입) 이후에만 수행한다
  useEffect(() => {
    if (
      phase === "ready" &&
      entryStatus === "active" &&
      voiceInputModeHydrated &&
      mode === "voice" &&
      voice.status !== "live" &&
      voice.status !== "connecting" &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      void voice.startSession();
    }
  }, [phase, entryStatus, voiceInputModeHydrated, mode, voice.status, voice]);

  // 세션 상태 감시 및 자동 시작 실패 감지
  useEffect(() => {
    if (voice.status === "live" || voice.status === "connecting") {
      setAutoStartFailed(false);
    } else if (hasAutoStartedRef.current && voice.status === "error") {
      setAutoStartFailed(true);
    }
  }, [voice.status]);

  const askQuestion = useCallback((idx: number, customText?: string) => {
    const q = questionsRef.current[idx];
    if (!q) return;
    askedIndexRef.current = idx;
    const textToSpeak = customText || q.question_text;
    // 마지막(5번째) 질문에도 종료 지시를 텍스트에 심지 않는다 — 종료 발화는 답변 확정 후
    // 별도의 speakClosingLine() 전용 턴으로 처리한다(handleTurnComplete의 completed 분기).
    if (isLiveMode) {
      if (live.setKSpeechAllowed) live.setKSpeechAllowed(true);
      live.speakAsK(textToSpeak);
    } else if (kVoiceEnabledRef.current) {
      const childTurnId = lastKnownTurnIdRef.current ?? undefined;
      void sttTts.speak(textToSpeak, undefined, childTurnId); // voiceName 생략 — 서버 기본값(ko-KR-Wavenet-A) 사용
    } else {
      sttTts.sayText(textToSpeak);
    }
  }, [isLiveMode, live, sttTts]);
  askQuestionRef.current = askQuestion;

  const switchToText = useCallback(() => {
    if (missionStateRef.current !== "active") return;
    // 수동 녹음 중에는 이미 activityStart와 PCM이 전송되고 있다. 이 턴을 아이 답변으로
    // 확정하지 않은 채 overlay로 전환할 수 없으므로, 먼저 마이크 버튼으로 녹음을 끝내게 한다.
    if (isRecordingRef.current || (isLiveMode && live.hasPendingAutoSpeech())) return;

    // 텍스트 채팅은 기존 미션/Live 세션 위에 뜨는 presentation overlay다. 입력 UI를 여는
    // 것만으로 activityEnd(아이 턴 확정), interaction mode 변경, 세션 종료를 발생시키지 않는다.
    // STT 확정/답변 처리 watchdog도 해당 비동기 작업이 끝날 때까지 그대로 유지한다.
    setShowRetryButton(false);

    // WebSocket/Live context는 유지하고 오디오 캡처만 멈춘다. useGeminiLive의 PCM 게이트는
    // 다음 audio frame에서 VAD 임시 상태도 정리하므로 별도 activityEnd가 필요하지 않다.
    if (isLiveMode) {
      live.setMicEnabled(false);
    } else {
      sttTts.setMicEnabled(false);
    }

    setMode("text");
  }, [live, isLiveMode, sttTts]);

  const switchToVoice = useCallback(() => {
    if (missionStateRef.current !== "active") return;
    setMode("voice");
    // overlay를 닫아도 새 세션/reconnect는 만들지 않는다. AUTO만 PCM gate를 다시 열고,
    // 수동 모드는 다음 마이크 탭(sendActivityStart)이 gate를 여는 시점까지 비활성으로 둔다.
    if (isLiveMode) {
      live.setMicEnabled(isAutoRef.current);
    } else if (isAutoRef.current) {
      sttTts.setMicEnabled(true);
    }
  }, [isLiveMode, live, sttTts]);

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    if (!voice.canSendTypedText()) {
      // 상태 경쟁으로 거절된 답변은 입력과 transcript 양쪽 모두 그대로 보존한다.
      // 실제 연결 단절만 기존 이어하기 UI로 연결하고, 정상적인 턴 잠금은 조용히 재시도 가능하게 둔다.
      if (voice.status !== "live") setAutoStartFailed(true);
      return;
    }
    if (voiceModeRef.current !== "live") {
      activeChildTurnIdRef.current = nextTurnId();
      activeChildTurnSeqRef.current = nextDisplaySequence();
    }
    const sent = voice.sendTypedText(text);
    if (!sent) return;
    setTextInput("");
  }, [textInput, voice, nextTurnId, nextDisplaySequence]);

  const handleClose = useCallback(() => {
    voice.stopSession();
    setSessionActive(false);
    router.replace("/child/home");
  }, [voice, router]);

  // 035 codex 리뷰 지적: React state(hasClosedRewardModal)만으로는 재렌더 전에 발생하는
  // X/닫기 동시·연속 클릭을 막지 못한다(같은 렌더 사이클 내 두 클릭 모두 state를 아직
  // "false"로 봄) - 즉시 갱신되는 ref로 동기 잠금한다.
  const rewardCloseLockRef = useRef(false);
  const rewardPresentation = getMissionRewardPresentation(rewardStatus);

  const handleCloseRewardCompletion = useCallback(() => {
    if (rewardCloseLockRef.current || hasClosedRewardModal) return;
    rewardCloseLockRef.current = true;
    setHasClosedRewardModal(true);
    setIsRewardModalOpen(false);

    // 035 codex 리뷰 지적: hasClosedRewardModal이 컴포넌트 메모리 상태뿐이라 새로고침·
    // 재마운트 시 초기화돼 같은 세션에 재진입하면 보상 모달이 다시 뜰 수 있었다.
    // 세션ID 기준으로 sessionStorage에 "이미 닫음"을 남겨 재진입 시에도 유지한다.
    const sid = sessionIdRef.current;
    if (sid) {
      try { sessionStorage.setItem(`k_reward_modal_closed:${sid}`, "1"); } catch {}
    }

    // 완료 세션 종료 처리 및 입력 방어 정리
    voice.stopSession();
    setSessionActive(false);
    if (liveRef.current) liveRef.current.lockNow();

    // 아이 홈 이동 후 최신 갱신
    router.replace("/child/home");
    router.refresh();
  }, [hasClosedRewardModal, voice, router]);

  useEffect(() => {
    if (
      shouldShowMissionCompletionModal({
        missionState,
        completed,
        hasClosed: hasClosedRewardModal,
      })
    ) {
      const sid = sessionIdRef.current;
      let alreadyClosed = false;
      if (sid) {
        try { alreadyClosed = sessionStorage.getItem(`k_reward_modal_closed:${sid}`) === "1"; } catch {}
      }
      if (alreadyClosed) {
        rewardCloseLockRef.current = true;
        setHasClosedRewardModal(true);
        return;
      }
      setIsRewardModalOpen(true);
    }
  }, [missionState, completed, rewardStatus, hasClosedRewardModal]);

  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;

    emitMissionRuntimeTrace("hydrate:start", {
      isAuto,
      voiceInputModeHydrated,
      isRecording,
      mode,
      turnPhase: turnPhaseRef.current,
    });

    const qpChild = searchParams.get("childId");
    const stored = typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null;
    const cid = qpChild || stored;
    if (!cid) {
      router.replace("/");
      return;
    }
    setChildId(cid);
    const storedVoiceInputMode = localStorage.getItem(`k_voice_input_mode:${cid}`);
    const hydratedMode = storedVoiceInputMode === "manual" ? "manual" : "auto";
    const hydratedIsAuto = hydratedMode === "auto";

    // localStorage preference가 확정되기 전에는 훅 내부 기본값(auto/mic=true)으로 세션이
    // 시작되지 않게, 페이지 state/ref와 두 음성 파이프라인의 입력 gate를 한 번에 맞춘다.
    // 신규/이어하기 모두 이 effect를 먼저 거치고, 실제 세션 시작 effect는 hydrated 이후에만 돈다.
    isAutoRef.current = hydratedIsAuto;
    setIsAuto(hydratedIsAuto);
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsAutoListening(false);
    setTurnPhase("idle");
    liveRef.current?.setInteractionMode(hydratedMode);
    liveRef.current?.setMicEnabled(hydratedIsAuto);
    sttSetInputModeRef.current?.(hydratedMode);
    sttSetMicEnabledRef.current?.(hydratedIsAuto);
    setVoiceInputModeHydrated(true);

    emitMissionRuntimeTrace("hydrate:queued", {
      isAuto: hydratedIsAuto,
      voiceInputModeHydrated: true,
      isRecording: false,
      mode,
      turnPhase: turnPhaseRef.current,
    });

  }, [searchParams, router, setTurnPhase, isAuto, voiceInputModeHydrated, isRecording, mode]);
  const runMissionRequest = useCallback(async (
    operation: (request: MissionRequestContext) => Promise<void>,
    externalSignal?: AbortSignal,
  ) => {
    activeMissionRequestAbortRef.current?.abort();

    const generation = missionRequestGenerationRef.current + 1;
    missionRequestGenerationRef.current = generation;
    const controller = new AbortController();
    activeMissionRequestAbortRef.current = controller;

    const abortFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
    }

    const isActive = () => (
      missionRequestGenerationRef.current === generation && !controller.signal.aborted
    );
    let settled = false;
    const markSettled = () => {
      settled = true;
    };
    const watchdogId = window.setTimeout(() => {
      if (!isActive()) return;
      setErrorMsg("미션을 불러오는 데 시간이 오래 걸리고 있어요. 다시 시도해 주세요.");
      setPhase("error");
      setEntryStatus("error");
      controller.abort();
    }, MISSION_LOADING_WATCHDOG_MS);

    try {
      if (!isActive()) return;
      await operation({ generation, signal: controller.signal, isActive, markSettled });
      if (isActive() && !settled) {
        setErrorMsg("미션 초기화가 완료되지 않았어요. 다시 시도해 주세요.");
        setPhase("error");
        setEntryStatus("error");
      }
    } catch (error: unknown) {
      if (isAbortError(error) || !isActive()) return;
      setErrorMsg(error instanceof Error ? error.message : "미션을 불러오지 못했어요");
      setPhase("error");
      setEntryStatus("error");
    } finally {
      window.clearTimeout(watchdogId);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
      if (activeMissionRequestAbortRef.current === controller) {
        activeMissionRequestAbortRef.current = null;
      }
    }
  }, []);

  const fetchSessionData = useCallback(async (
    cid: string,
    round: RoundType,
    confirmRestart: boolean,
    isCheckOnly: boolean,
    request: MissionRequestContext,
  ) => {
      if (!request.isActive()) return;
      const res = await fetch("/api/mission/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: cid, roundType: round, confirmRestart, checkOnly: isCheckOnly }),
        signal: request.signal,
      });
      if (!request.isActive()) return;
      const data = await res.json();
      if (!request.isActive()) return;
      logVoiceEvent({ ts: Date.now(), eventType: "answer_response" });

      if (!res.ok) {
        if (res.status === 403 || data.code === "MISSION_EXPIRED" || data.scheduleClosed || data.expired || data.status === "FORCE_ENDED") {
          const expiryResult = await handleForcedExpiry(request.isActive);
          if (!request.isActive()) return;
          if (expiryResult !== "closed" && expiryResult !== "already_handled") {
            setErrorMsg("미션 종료 상태를 확인하지 못했어요. 다시 시도해 주세요.");
            setPhase("error");
            setEntryStatus("error");
          }
          request.markSettled();
          return;
        }
        if (!request.isActive()) return;
        setErrorMsg(data.error ?? "미션을 시작하지 못했어요");
        setPhase("error");
        setEntryStatus("error");
        request.markSettled();
        return;
      }

      if (data.locked) {
        setPhase("locked_completed");
        request.markSettled();
        return;
      }

      if (data.requiresConfirmation) {
        setPhase("confirm_restart_after_completion");
        request.markSettled();
        return;
      }

      if (isCheckOnly && !data.resumed) {
        setVoiceMode((data.voiceMode as VoiceMode) ?? "stt_tts");
        if (typeof data.liveVoiceName === "string" && data.liveVoiceName) {
          setLiveVoiceName(data.liveVoiceName);
        }
        setPhase("ready");
        setEntryStatus("ready_to_start");
        request.markSettled();
        return;
      }

      setSessionId(data.sessionId);
      sessionIdRef.current = data.sessionId;

      // PWA/탭 종료 뒤 남은 단일 미확정 턴을 같은 clientTurnId로 복구한다. 서버의
      // answer_result가 이미 있으면 start는 재판정 없이 replay하고, 없으면 lease 만료 후
      // 동일 턴 처리를 재개한다. 복구 K 문구에는 원문을 다시 싣지 않는다.
      if (!request.isActive()) return;
      const pendingTurn = await readPendingMissionTurn().catch((error: unknown) => {
        console.error("[Mission] IndexedDB pending turn 복원 실패. 서버 세션으로 계속 진행합니다:", error);
        return null;
      });
      if (!request.isActive()) return;
      if (pendingTurn && pendingTurn.sessionId === data.sessionId) {
        const pending = pendingTurn;
        if (sessionStorage.getItem("mission-turn-recovery-paused") === pending.clientTurnId) {
          if (!request.isActive()) return;
          // 073-P0 리뷰 지적: 여기를 일반 error phase로 바꾸면 handleRetryAfterError가
          // pause 키를 지우지 않고 같은 시도를 반복해 이 분기로 영구 재진입한다.
          // turn_retry 전용 화면(자체 재시도 버튼이 pause 키를 지우고 reload)으로 되돌린다.
          setErrorMsg("대화를 저장하는 중 문제가 생겼어요. 연결을 확인하고 다시 시도해 주세요.");
          setShowRetryButton(true);
          setPhase("turn_retry");
          request.markSettled();
          return;
        }
        if (!request.isActive()) return;
        const replayResponse = await postMissionTurnWithRetry({
          body: { action: "start", ...pending },
          signal: request.signal,
        });
        if (!request.isActive()) return;
        if (replayResponse.ok) {
          const replay = await replayResponse.json();
          if (!request.isActive()) return;
          const recoveryText = replay.completionCandidate
            ? "오늘 미션을 모두 완료했어! 이야기해 줘서 고마워. 다음에 또 보자!"
            : "이야기해 줘서 고마워! 다음 이야기도 들려줄래?";
          if (!request.isActive()) return;
          const finalizeResponse = await postMissionTurnWithRetry({
            body: {
              action: "finalize",
              sessionId: pending.sessionId,
              clientTurnId: pending.clientTurnId,
              kTurnId: `${pending.clientTurnId}:k`,
              kContent: recoveryText,
              kDisplaySequence: pending.displaySequence + 1,
            },
            signal: request.signal,
          });
          if (!request.isActive()) return;
          if (finalizeResponse.ok) {
            sessionStorage.removeItem("mission-turn-recovery-paused");
            await clearPendingMissionTurn(pending.clientTurnId);
            if (!request.isActive()) return;
            request.markSettled();
            window.location.reload();
            return;
          }
        }
        if (!request.isActive()) return;
        setShowRetryButton(true);
        setErrorMsg("대화를 저장하는 중 문제가 생겼어요. 연결을 확인하고 다시 시도해 주세요.");
        setPhase("error");
        setEntryStatus("error");
        request.markSettled();
        return;
      }

      if (navigator.serviceWorker?.controller) {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          fetch("/api/client-version", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: data.sessionId,
              childId: cid,
              clientSha: process.env.NEXT_PUBLIC_DEPLOYMENT_SHA,
              swVersion: e.data?.swVersion ?? "unknown",
            }),
          }).catch(() => {});
        };
        navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } else {
        fetch("/api/client-version", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: data.sessionId,
            childId: cid,
            clientSha: process.env.NEXT_PUBLIC_DEPLOYMENT_SHA,
            swVersion: "no-sw-controller",
          }),
        }).catch(() => {});
      }
      
      const qs: MissionQuestion[] = data.questions ?? [];
      childContextRef.current = data.childContext ?? null;

      if (data.resumed) {
        const resumedStates: Record<string, QuestionState> = data.questionStates ?? {};
        questionStatesRef.current = resumedStates;
        currentIndexRef.current = findResumeIndex(qs, resumedStates);
        setGauge(data.validAnswerCount ?? 0);
        setProgressPercent(data.progressPercent ?? 0);
        setRequiredCount(data.requiredCount ?? 5);
        setCompleted(data.completed ?? false);
        setEngineVersion(data.engine_version ?? "v1");
      } else {
        if (qs.length > 0) {
           const isDay = round === "round1_day";
           const givenName = typeof data.givenName === "string" ? data.givenName : null;
           const greetingIntro = givenName ? `안녕~ ${appendVocative(givenName)}.` : "안녕~";
           const memoryGreeting =
             typeof data.memoryGreeting === "string" && data.memoryGreeting.trim()
               ? data.memoryGreeting.trim()
               : null;
           const greetingText =
             memoryGreeting ??
             (isDay
               ? (Math.random() > 0.5
                  ? `${greetingIntro} 어제는 잘 잤니?`
                  : `${greetingIntro} 학교는 잘 다녀왔니?`)
               : `${greetingIntro} 오늘 하루 어땠니?`);

           qs.unshift({
             id: "greeting_turn_0",
             question_text: greetingText,
             dashboard_area_tag: "greeting",
             cycle_type: "greeting",
             round_type: round
           });
        }
        const initStates: Record<string, QuestionState> = {};
        for (const q of qs) initStates[q.id] = "pending";
        questionStatesRef.current = initStates;
        currentIndexRef.current = 0;
        setProgressPercent(0);
        setRequiredCount(data.requiredCount ?? 5);
        setCompleted(false);
        setEngineVersion(data.engine_version ?? "v1");
      }

      setQuestions(qs);
      questionsRef.current = qs;
      setVoiceMode((data.voiceMode as VoiceMode) ?? "stt_tts");
      if (typeof data.liveVoiceName === "string" && data.liveVoiceName) {
        setLiveVoiceName(data.liveVoiceName);
      }

      try {
        if (!request.isActive()) return;
        logVoiceEvent({ ts: Date.now(), eventType: "restore_fetch_start" });
        const msgRes = await fetch(`/api/chat/messages?sessionId=${data.sessionId}`, { signal: request.signal });
        if (!request.isActive()) return;
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          if (!request.isActive()) return;
          logVoiceEvent({ ts: Date.now(), eventType: "restore_fetch_complete", extra: { messageCount: msgData.messages?.length ?? 0 } });
          const past: Turn[] = (msgData.messages ?? [])
            .filter((m: any) => m.content && m.content.trim() !== "" && (m.turn_status ? m.turn_status === "finalized" : true))
            .map((m: any) => ({ role: m.role, text: m.content, displaySequence: m.display_sequence }));
          pastMessagesRef.current = past;
        }
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        console.error("[Mission] 대화 history 복원 실패. 핵심 세션으로 계속 진행합니다:", error);
        pastMessagesRef.current = [];
      }
      if (!request.isActive()) return;

      // 037 §18/codex 지적: 조회된 기존 세션이 status="COMPLETED"로 명시 갱신되진 않았지만
      // (레거시 V1 등) valid_answer_count로는 이미 완료 조건을 만족하는 경우, "이어하기" 게이트를
      // 보여주면 안 된다 - 이미 검증된 "다시 할래요/미션 나가기" 확인 게이트로 동일하게 처리한다.
      if (isCheckOnly && data.resumed && data.completed) {
        setPhase("confirm_restart_after_completion");
        request.markSettled();
        return;
      }

      setPhase("ready");
      if (isCheckOnly && data.resumed) {
        setEntryStatus("ready_to_resume");
      } else {
        setEntryStatus("active");
      }
      request.markSettled();
  }, [handleForcedExpiry]);

  // 037 §21/§22: 조회·시작·이어하기 실패 후 "다시 시도"가 정확히 직전에 하려던
  // 동작(확인/시작/이어하기)을 그대로 재시도하도록, 실행 직전에 그 재시도 함수 자체를 담아둔다.
  // 초기값은 마운트 시점의 "확인" 단계 재시도용 - restartTrigger를 증가시켜 마운트 effect를 다시 돈다.
  const lastAttemptFnRef = useRef<() => void>(() => setRestartTrigger((t) => t + 1));
  // codex 037 리뷰 지적: 실패 시 entryStatus 자체가 "error"로 덮어써져서, 실패 화면에서
  // entryStatus를 보고 "시작 실패였는지/이어하기 실패였는지" 구분할 수 없었다 - 별도 ref로 보존한다.
  const attemptKindRef = useRef<"checking" | "starting" | "resuming">("checking");

  // 073-P0 리뷰 지적: 예전에는 여기서 isStartingRef 불리언 락으로 중복 클릭을 막았는데,
  // 그 락은 runMissionRequest의 내부 await가 (IndexedDB 읽기, signal 없는 force-end
  // fetch 등) 끝까지 settle돼야만 finally에서 풀렸다. 그 작업이 진짜로 멈춰버리면
  // watchdog이 8초 뒤 에러 화면으로 보내도 락은 계속 true로 남아, "다시 시도"를 눌러도
  // handleStartMission/handleResumeMission이 즉시 return해 무한 스켈레톤이 재발했다.
  // runMissionRequest 자체가 이미 이전 컨트롤러를 abort하고 generation을 올려 동시
  // 요청을 안전하게 처리하므로, 이 수동 락은 더 필요 없고 오히려 위 회귀의 원인이었다.
  const handleStartMission = () => {
    if (!childIdRef.current || !roundType) return;
    setEntryStatus("starting");
    attemptKindRef.current = "starting";
    lastAttemptFnRef.current = handleStartMission;
    void runMissionRequest((request) => (
      fetchSessionData(childIdRef.current!, roundType, confirmRestartRef.current, false, request)
    ));
  };

  const handleResumeMission = () => {
    if (!childIdRef.current || !roundType) return;
    setEntryStatus("resuming");
    attemptKindRef.current = "resuming";
    lastAttemptFnRef.current = handleResumeMission;
    void runMissionRequest((request) => (
      fetchSessionData(childIdRef.current!, roundType, confirmRestartRef.current, false, request)
    ));
  };

  const handleRetryAfterError = () => {
    setPhase("loading");
    setEntryStatus("checking");
    lastAttemptFnRef.current();
  };

  useEffect(() => {
    const abortController = new AbortController();
    void runMissionRequest(async (request) => {
      // 037 QA 실측 확인(agy-qa-037 + 메인 Claude 재현): 이 effect가 childIdRef.current에만
      // 의존하면, 최초 마운트 시 childId를 설정하는 위 effect(line ~1471)의 setChildId(cid)가
      // 아직 커밋되지 않은 상태에서(ref는 렌더 시점에만 갱신됨) 이 effect가 같은 커밋에서
      // 함께 실행돼 childIdRef.current가 여전히 null인 채로 읽혀 "childId is missing" 오류로
      // 빠지는 실제 회귀가 있었다(쿼리파라미터 없이 홈에서 진입하는 정상 플로우에서 매번 발생).
      // ref/state 왕복에 의존하지 않도록 위 effect와 동일하게 쿼리파라미터/localStorage에서
      // 직접 재계산한다.
      let cid = childIdRef.current
        ?? searchParams?.get("childId")
        ?? (typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null);
      if (!cid) {
        if (!request.isActive()) return;
        setPhase("error");
        setEntryStatus("error");
        setErrorMsg("childId is missing");
        request.markSettled();
        return;
      }
      if (cid !== childIdRef.current) {
        setChildId(cid);
        childIdRef.current = cid;
      }

      const hour = getKstHour();
      const qpRound = searchParams?.get("roundType") as RoundType | null;

      let timeRestrictionsEnabled = false;
      let cfgActiveRound: RoundType | null = null;
      let cfgScheduleEnforced = false;
      try {
        if (!request.isActive()) return;
        const cfgRes = await fetch("/api/config/child-time-restrictions", { signal: request.signal });
        if (!request.isActive()) return;
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (!request.isActive()) return;
          if (typeof cfg.enabled === "boolean") timeRestrictionsEnabled = cfg.enabled;
          if (cfg.activeRound === "round1_day" || cfg.activeRound === "round2_night") cfgActiveRound = cfg.activeRound;
          if (typeof cfg.scheduleEnforced === "boolean") cfgScheduleEnforced = cfg.scheduleEnforced;
        }
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
      }
      if (!request.isActive()) return;
      setScheduleEnforced(cfgScheduleEnforced);

      // 031: MISSION_SCHEDULE_ENFORCED가 켜져 있으면(Production) 경계값이 다르므로 클라이언트가
      // 직접 계산한 currentRound(hour)를 쓰지 않고 서버가 내려준 activeRound를 그대로 쓴다
      // (process.env.MISSION_SCHEDULE_ENFORCED는 이 클라이언트 번들에서는 항상 undefined로
      // 치환되어 currentRound(hour) 호출만으로는 Production 실제 경계를 재현할 수 없다).
      const round: RoundType | null = cfgScheduleEnforced
        ? (qpRound ?? cfgActiveRound)
        : (qpRound ?? currentRound(hour) ?? (!timeRestrictionsEnabled ? "common" : null));
      if (!round) {
        if (!request.isActive()) return;
        setPhase("closed");
        request.markSettled();
        return;
      }
      setRoundType(round);

      const confirmRestart = confirmRestartRef.current;
      // We only consume confirmRestartRef when we actually start the mission (checkOnly = false),
      // BUT if we are coming back from confirm_restart_after_completion, we want to START it directly.
      if (confirmRestart) {
        confirmRestartRef.current = false;
        setEntryStatus("starting");
        await fetchSessionData(cid, round, true, false, request);
      } else {
        await fetchSessionData(cid, round, false, true, request);
      }
    }, abortController.signal);
    return () => abortController.abort();
  }, [searchParams, router, restartTrigger, fetchSessionData, runMissionRequest]);

  // Live 모드가 활성화될 때 interactionMode 설정 동기화 (STT/TTS는 setInputMode+setMicEnabled로 동일 개념 적용)
  useEffect(() => {
    if (!voiceInputModeHydrated || voice.status !== "live") return;
    if (isLiveMode) {
      live.setInteractionMode(isAuto ? "auto" : "manual");
      if (!isAuto) live.setMicEnabled(false);
      if (!isAuto) {
        live.setAudioMuted(false);
        setIsRecording(false);
        isRecordingRef.current = false;
      }
    } else {
      sttTts.setInputMode(isAuto ? "auto" : "manual");
      if (!isAuto) sttTts.setMicEnabled(false);
      if (!isAuto) {
        setIsRecording(false);
        isRecordingRef.current = false;
      }
    }
  }, [voice.status, voiceInputModeHydrated, isAuto, isLiveMode, live.setInteractionMode, live.setMicEnabled, live.setAudioMuted, sttTts.setInputMode, sttTts.setMicEnabled]);

  const handleModeChange = useCallback((newMode: "auto" | "manual") => {
    if (missionStateRef.current !== "active") return; // 완료 시 모드 변경 차단
    // 실제 탭 이벤트 안 — Android에서 케이 오디오 AudioContext가 아직 suspended라면 여기서
    // 재시도(자동 모드는 세션이 useEffect에서 제스처 없이 시작돼 특히 도움이 된다).
    if (isLiveMode) void live.unlockAudio();
    if (newMode === "auto") {
      // 수동 발화(녹음) 중이었다면 안전하게 먼저 종료 처리
      if (isRecordingRef.current || isRecording) {
        try {
          if (isRecordingRef.current && isLiveMode) {
            live.sendActivityEnd();
            live.setAudioMuted(false);
            // child_listening 유지 (turnComplete에서 대기)
          } else if (isRecordingRef.current) {
            sttAbortControllerRef.current = new AbortController();
            const capturedId = activeChildTurnIdRef.current;
            sttTimeoutRef.current = setTimeout(() => {
              if (activeChildTurnIdRef.current !== capturedId) return;
              attemptSilentRecoveryOrShowRetry();
            }, 10000);
            // child_listening 유지 (turnComplete에서 대기)
            sttTts.manualFinalize(sttAbortControllerRef.current.signal);
            sttTts.setMicEnabled(false);
          }
        } finally {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      }
      if (isLiveMode) {
        live.setInteractionMode("auto");
      } else {
        sttTts.setInputMode("auto");
      }
      isAutoRef.current = true;
      setIsAuto(true);
    } else {
      if (isLiveMode) {
        live.setInteractionMode("manual");
        live.setMicEnabled(false);
        live.setAudioMuted(false);
      } else {
        sttTts.setInputMode("manual");
        sttTts.setMicEnabled(false);
      }
      isAutoRef.current = false;
      setIsAuto(false);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
    if (childIdRef.current) {
      localStorage.setItem(`k_voice_input_mode:${childIdRef.current}`, newMode);
    }
  }, [live, sttTts, isLiveMode, isRecording, setTurnPhase, resetToIdle]);

  const handleCentralButtonClick = useCallback(() => {
    if (answerInFlightRef.current && !isRecording) return; // 이전 답변 처리 중엔 새 녹음 시작 차단(단, 이미 녹음 중이던 걸 끝내는 동작은 막지 않음)
    if (!isRecordingRef.current) {
      // 케이가 아직 말하는 중이거나(TTS 재생/Live 발화) 직전 답변이 아직 서버에서 처리
      // 중이면(classifyAnswer 등, 최대 10~32초) 새 녹음을 시작할 수 없다 — 이 가드가 없으면
      // 아이가 녹음 버튼을 다시 눌러 케이 발화를 끊거나(Live: sendActivityStart가 재생 중인
      // 오디오를 강제 정지시킴), 아직 처리되지 않은 답변과 겹치는 새 child 턴을 만들어냈다
      // (버그①게이지 오증가·②말풍선 중복 쌓임·③케이가 답을 기다리지 않는 것처럼 보이는 문제의
      // 직접 원인).
      const canStart = canStartRecording({
        isLiveMode,
        answerInFlight: answerInFlightRef.current,
        kaySpeaking: sttTts.isSpeaking,
        turnPhase: turnPhaseRef.current,
      });
      if (!canStart) {
        return;
      }
      // 첫 클릭: Live는 K 발화 즉시 중단 후 activityStart, STT/TTS는 마이크만 켠다
      if (isLiveMode) {
        live.setAudioMuted(true);
        const success = live.sendActivityStart();
        if (!success) {
          live.setAudioMuted(false);
          return;
        }
        setTurnPhase("child_listening");
      } else {
        activeChildTurnIdRef.current = nextTurnId();
        activeChildTurnSeqRef.current = nextDisplaySequence();
        sttTts.setMicEnabled(true);
        setTurnPhase("child_listening");
      }
      logVoiceEvent({ ts: Date.now(), eventType: "recording_started_manual" });
      setIsRecording(true);
      isRecordingRef.current = true;
      recordingStartedAtRef.current = Date.now();
    } else {
      // 두 번째 클릭: 최소 500ms 종료 경계 보호
      if (Date.now() - recordingStartedAtRef.current < 500) {
        console.log("[CentralButton] Click within 500ms limit - ignored.");
        return;
      }
      try {
        if (isLiveMode) {
          live.logTelemetryEvent("stopRecording");
          live.sendActivityEnd();
          live.setAudioMuted(false);
          // child_listening 유지 (turnComplete에서 대기)
        } else {
          sttAbortControllerRef.current = new AbortController();
          const capturedId = activeChildTurnIdRef.current;
          sttTimeoutRef.current = setTimeout(() => {
            if (activeChildTurnIdRef.current !== capturedId) return;
            attemptSilentRecoveryOrShowRetry();
          }, 10000);
          // child_listening 유지 (turnComplete에서 대기)
          sttTts.manualFinalize(sttAbortControllerRef.current.signal);
          sttTts.setMicEnabled(false);
        }
      } finally {
        setIsRecording(false);
        isRecordingRef.current = false;
        
        // 레벨 시각 피드백 수동 리셋
        if (buttonRef.current) {
          buttonRef.current.style.transform = "scale(1)";
          buttonRef.current.style.boxShadow = "none";
        }
        if (pingRef.current) {
          pingRef.current.style.transform = "scale(1)";
          pingRef.current.style.opacity = "0.2";
        }
      }
    }
  }, [live, sttTts, isLiveMode, setTurnPhase, resetToIdle]);



  // 과거 대화(chat_messages) 및 현재 세션 누적 대화 스크롤백 채워넣기
  // 자동/수동 UI가 동일한 메시지 배열을 공유하도록, 훅 내부 세션이 재시작되어 transcript가
  // 비워질 때마다 공통 소스(pastMessagesRef)에서 전체 이력을 다시 복원(seed)한다.
  useEffect(() => {
    if (voice.status === "live" && voice.transcript.length === 0 && pastMessagesRef.current.length > 0) {
      logVoiceEvent({ ts: Date.now(), eventType: "seed_before", transcriptSummary: voice.transcript.map(t => ({ role: t.role, id: t.id, displaySequence: (t as any).displaySequence })), extra: { transcriptLengthBeforeSeed: voice.transcript.length } });
      voice.seedTranscript(pastMessagesRef.current);
      logVoiceEvent({ ts: Date.now(), eventType: "seed_after", transcriptSummary: voice.transcript.map(t => ({ role: t.role, id: t.id, displaySequence: (t as any).displaySequence })) });
    }
  }, [voice.status, voice.transcript.length, voice.seedTranscript]);

  // 세션 시작 후 최초 1회만 첫 질문을 묻는다. 이후 질문은 handleTurnComplete에서
  // 답변 처리 완료 시점에 askQuestionRef를 통해 직접 트리거된다(ref 변화는 effect를
  // 재실행시키지 않으므로, "다음 질문"을 이 effect가 알아채길 기다리면 안 됨).
  useEffect(() => {
    if (voice.status !== "live" || missionState !== "active") return;
    if (askedIndexRef.current !== -1) return;

    const currentQ = questionsRef.current[currentIndexRef.current];
    const past = pastMessagesRef.current;
    const lastK = [...past].reverse().find((m) => m.role === "k");

    if (currentQ && lastK && lastK.text && lastK.text.includes(currentQ.question_text)) {
      // 재접속 전에 이미 물어본 질문 — 다시 발화하지 않고 아이 답변을 기다린다.
      askedIndexRef.current = currentIndexRef.current;
      setTurnPhase("child_listening");
      return;
    }

    // Live 모드에서 handleTurnComplete의 재진입 가드(turnPhase==='child_listening')가
    // 아이 답변을 받아들이려면, 케이가 말하는 동안 turnPhase가 반드시 "k_speaking"을
    // 거쳐야 onAudioQueueDrained가 "child_listening"으로 전환해준다(handleTurnComplete
    // 내부의 후속 질문 호출부, 약 820번째 줄과 동일한 패턴). 이 effect는 세션당 최초
    // 1회(첫 질문/인사) 질문을 발화하는 유일한 지점인데 이 설정이 빠져 있어서, turnPhase가
    // 기본값 "idle"에 계속 머무르고 — 케이가 자연스럽게 대화를 이어가는 것처럼 보여도
    // 첫 질문에 대한 아이의 답변이 재진입 가드에서 조용히 폐기돼(saveMessage/
    // /api/mission/answer 호출 전에 return) 진행률이 전혀 오르지 않는 버그였다
    // (2026-07-25 Dev 실환경 진단 로그로 재현·확정). 후속 질문 경로와 동일하게 여기서도
    // 미리 k_speaking으로 전환한다.
    if (isLiveModeRef.current) {
      setTurnPhase("k_speaking");
    }
    askQuestion(currentIndexRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.status, missionState, askQuestion]);

  // STT/TTS(Tier1/2) 경로 전용 — Live 모드는 missionCompletionFlow 컨트롤러(onCloseSession)가
  // 종료 발화 재생까지 기다린 뒤에만 stopSession()을 호출하므로 여기서 다루지 않는다.
  useEffect(() => {
    if (!isLiveMode && missionState === "completed") voice.stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionState, isLiveMode]);

  // WebSocket 조기 종료 감지 — completing(종료 발화 대기 중)인데 세션이 스스로 끊긴 경우
  // (서버 오류/네트워크 단절 등), 8초 fallback을 다 기다리지 않고 즉시 완료 처리한다.
  useEffect(() => {
    if (!isLiveMode || missionState !== "completing") return;
    if (live.status === "ended" || live.status === "error") {
      missionControllerRef.current?.notifySessionClosedExternally();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status, missionState, isLiveMode]);

  useEffect(() => {
    bubbleRef.current?.scrollTo({ top: bubbleRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.transcript, voice.interimChildText]);

  const isConnecting = voice.status === "connecting";
  const isLive = voice.status === "live";
  // completing 단계부터 이미 100%/완료 취급(마이크·입력 비활성화) — completed와의 차이는
  // "종료 발화가 아직 재생 중인지"뿐이라 화면 표시상 구분할 필요가 없다.
  const isDone = missionState !== "active" || completed;

  let voiceState: VoiceConversationState = "idle";
  if (isConnecting) {
    voiceState = "connecting";
  } else if (isLiveMode) {
    // 실장애 재현(2026-07-26): Live 세션이 정상 오픈된 채로 클라이언트가 AUTO 모드에서
    // 실제 오디오를 relay로 한 번도 못 보내는 구간이 있었다(VAD RMS_THRESHOLD 미도달 등) —
    // 실측 결과 이 구간에서 turnPhaseUi는 "child_listening"으로 전환되지 않고 세션 시작
    // 시점의 "idle" 그대로 남아있는 경우가 있었다(새 세션의 첫 턴 등) — turnPhaseUi 값에
    // 의존하지 않고 live.noAudioInput 하나만으로 최우선 판정한다. hooks/useGeminiLive.ts가
    // 마이크 활성+K 비발화 상태에서만 이 신호를 켜므로(K가 말하는 중이면 절대 true가 될 수
    // 없음), turnPhaseUi가 무엇이든 이 값이 true면 항상 "no_input"을 보여줘도 안전하다.
    // 세션/WebSocket은 전혀 건드리지 않으며, 다시 소리가 감지되면 자동으로 꺼진다.
    if (live.noAudioInput) {
      voiceState = "no_input";
    } else if (turnPhaseUi === "child_listening") {
      voiceState = isAuto || isRecording ? "listening" : (isProcessingAnswer ? "thinking" : "idle");
    } else if (turnPhaseUi === "waiting_k") {
      voiceState = "thinking";
    } else if (turnPhaseUi === "k_speaking") {
      voiceState = "speaking";
    } else if (turnPhaseUi === "recovering") {
      voiceState = "idle";
    }
  } else {
    // 011 "문제 A": turnPhaseUi(child_listening/waiting_k/k_speaking)는 Live 파이프라인
    // 전용 상태값이라(handleTurnComplete 내부에서 isLive일 때만 setTurnPhase를 호출) 실제
    // Dev 환경의 STT→LLM→TTS 경로에서는 이 값이 절대 갱신되지 않았다 — isThinkingTurn도
    // `isLiveMode && ...`로 게이팅돼 있어 "생각하는 중" 표시 자체가 코드상 도달 불가능한
    // 상태였다(2026-07-25 코드 대조 확인). 대신 STT/TTS 경로에서 이미 실시간으로 갱신되고
    // 있는 실제 신호를 그대로 쓴다: isRecording(마이크 입력 중) → isProcessingAnswer(발화
    // 종료 후 답변 판정+다음 질문 생성 중, STT~TTS 요청 구간) → sttTts.isSpeaking(TTS
    // 요청~실제 오디오 재생 종료까지, useVoiceChat.speak()가 그대로 관리).
    if (isRecording || isAutoListening) {
      // 2026-07-27 재현 테스트 수정: isRecording은 수동 녹음 버튼 전용 상태라 AUTO 모드
      // (기본값)에서는 절대 true가 안 돼 "듣는 중"이 코드상 도달 불가능했다(Playwright
      // 실측 확인). isAutoListening(위 onSpeechBegin/onSpeechEnd)이 AUTO 모드의 실제
      // 음성 감지 구간을 보강한다.
      voiceState = "listening";
    } else if (isProcessingAnswer) {
      voiceState = "thinking";
    } else if (sttTts.isSpeaking) {
      voiceState = "speaking";
    }
  }
  if (isDone) {
    voiceState = "idle";
  }
  const missionPercent = progressPercent;
  // 수동 버튼 전용 — 답변 판정/다음 질문 생성 중이거나 케이가 말하는 중엔 canStartRecording
  // 가드가 탭을 무시하므로, 버튼을 회색 비활성 모양으로 바꿔 침묵 무시와 진짜 먹통을 아이가
  // 구분할 수 있게 한다(대표님 추가 요구 — 하단 메인 버튼 3단계: 대기/녹음중/K말하는중).
  // Live 모드는 turnPhaseUi로 판단(child_finalizing/waiting_k/k_speaking 전부 포함).
  // STT/TTS 모드는 isProcessingAnswer(판정+다음 질문 생성 중) OR sttTts.isSpeaking(TTS 재생
  // 중)로 판단한다 — 이 값이 예전엔 Live 전용으로만 게이팅돼 있어 실제 Dev 환경(STT/TTS)에서는
  // 항상 false였고(011 "문제 A"), isProcessingAnswer만 봤을 때도 TTS 재생 구간(케이가 실제로
  // 말하는 중)이 빠져 있어 그 사이엔 버튼이 다시 "대기" 모양으로 되돌아가는 문제가 있었다.
  // 권장 상태 파생 구조에 따라 단일 Source of Truth 관리
  const isMissionCompleted = missionState !== "active" || completed;
  const canAcceptVoiceInput =
    !isMissionCompleted &&
    mode !== "text" &&
    voice.status === "live" &&
    (isLiveMode
      ? (turnPhaseUi === "idle" || turnPhaseUi === "child_listening")
      : (!isProcessingAnswer && !sttTts.isSpeaking));

  const isButtonBlocked = !canAcceptVoiceInput;

  // 마이크 활성 상태 동기화
  // Rules of Hooks: 이 useEffect는 아래 phase==="loading"/"closed"/"error" 조기 return들보다
  // 반드시 먼저 호출돼야 한다(033 QA 실측 크래시 확인 — "Rendered more hooks than during the
  // previous render"/React #310). 원래 이 아래(현재 return 직전)에 있었는데, phase가 loading/
  // closed/error일 때는 이 useEffect 호출 자체가 건너뛰어져 렌더마다 훅 호출 개수가 달라져
  // 화면 전체가 크래시했다 — 위쪽 wakeLockWarning 훅과 동일한 이유로 조기 return보다 앞에 둔다.
  useEffect(() => {
    if (!voiceInputModeHydrated) {
      if (isRecordingRef.current || isRecording) {
        setIsRecording(false);
        isRecordingRef.current = false;
      }
      if (isLiveMode) {
        live.setMicEnabled(false);
      } else {
        sttSetMicEnabledRef.current?.(false);
      }
      return;
    }

    if (!canAcceptVoiceInput) {
      if (isRecordingRef.current || isRecording) {
         if (isRecordingRef.current) {
           if (isLiveMode) {
             live.sendActivityEnd();
             live.setAudioMuted(false);
           } else {
             sttCancelFinalizeRef.current?.();
             sttSetMicEnabledRef.current?.(false);
           }
         }
         setIsRecording(false);
         isRecordingRef.current = false;
      }
      if (isLiveMode) {
           live.setMicEnabled(false);
         } else {
           sttSetMicEnabledRef.current?.(false);
         }
    } else {
      if (isAuto) {
         if (isLiveMode) {
           live.setMicEnabled(true);
         } else {
           sttSetMicEnabledRef.current?.(true);
         }
      }
    }
  }, [
    canAcceptVoiceInput,
    voiceInputModeHydrated,
    isRecording,
    isAuto,
    isLiveMode,
    live.sendActivityEnd,
    live.setAudioMuted,
    live.setMicEnabled,
  ]);

  if (phase === "loading") {
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
        <div className="shrink-0 sticky top-0 z-10" style={{ background: "var(--color-k-surface)" }}>
          <div className="flex items-center justify-center px-4 pt-4 pb-2">
            <SkeletonBox className="w-20 h-6" />
          </div>
          <div className="text-center pt-2 pb-4 flex flex-col items-center gap-2">
            <SkeletonBox className="w-40 h-5" />
            <div className="px-6 mt-1 w-full">
              <SkeletonBox className="h-2.5 rounded-full" />
            </div>
          </div>
          <div className="flex justify-center mb-4">
            <SkeletonBox className="w-24 h-24 rounded-full" />
          </div>
        </div>
        <div className="flex-1 min-h-0 px-4 flex flex-col gap-3">
          <SkeletonBox className="h-14 self-start w-2/3" />
        </div>
        <div className="h-24 shrink-0 border-t border-gray-50" />
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl">⏰</p>
        <p className="text-base font-bold text-gray-800">{errorMsg || "미션 시간이 끝났어요"}</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          1차 미션은 오전 10시~오후 5시 50분,
          <br />
          2차 미션은 오후 6시~밤 12시에 만나요!
        </p>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  if (phase === "confirm_restart_after_completion") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl">🎉</p>
        <p className="text-base font-bold text-gray-800">오늘 미션은 이미 완료했어요!</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          한 번 더 하고 싶으면 새로 시작할 수 있어요.
        </p>
        <div className="flex gap-2 w-full max-w-xs">
          <button
            onClick={() => {
              confirmRestartRef.current = true;
              setPhase("loading");
              setRestartTrigger((n) => n + 1);
            }}
            className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
            style={{ background: "var(--color-k-orange)" }}
          >
            다시 할래요
          </button>
          <button
            onClick={() => {
              setSessionActive(false);
              router.replace("/child/home");
            }}
            className="flex-1 py-3.5 rounded-2xl font-bold text-gray-600 bg-gray-100 text-sm active:scale-[0.98] transition-transform cursor-pointer"
          >
            미션 나가기
          </button>
        </div>
      </div>
    );
  }

  if (phase === "locked_completed") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl">🔒</p>
        <p className="text-base font-bold text-gray-800">미션을 이미 완료하였습니다. 다음 미션을 기다리세요.</p>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  if (phase === "turn_retry") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl">🔄</p>
        <p className="text-base font-bold text-gray-800">대화를 저장하는 중 문제가 생겼어요.</p>
        <p className="text-xs text-gray-500">연결을 확인하고 현재 대화만 다시 시도해 주세요.</p>
        <button
          onClick={() => {
            sessionStorage.removeItem("mission-turn-recovery-paused");
            window.location.reload();
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          다시 시도
        </button>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3 rounded-2xl font-bold text-gray-500 text-sm active:scale-[0.98] transition-transform cursor-pointer"
        >
          미션 나가기
        </button>
      </div>
    );
  }

  if (phase === "error") {
    // 037 §21/§22: 실패 유형별 문구 - 저장된 세션을 삭제/초기화하지 않고 같은 동작을 재시도할 수 있게 한다.
    const errorTitle =
      attemptKindRef.current === "starting" ? "미션을 시작하지 못했어요"
      : attemptKindRef.current === "resuming" ? "진행 중인 미션을 불러오지 못했어요"
      : "미션 상태를 확인하지 못했어요";
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl text-red-500">⚠️</p>
        <p className="text-base font-bold text-red-500">{errorTitle}</p>
        <p className="text-xs text-gray-500">잠시 후 다시 시도해 주세요.</p>
        {errorMsg && <p className="text-[10px] text-gray-400">{errorMsg}</p>}
        <button
          onClick={handleRetryAfterError}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          다시 시도
        </button>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3 rounded-2xl font-bold text-gray-500 text-sm active:scale-[0.98] transition-transform cursor-pointer"
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 음성 세션 자체가 끊긴 경우(예: Vertex Live 연결 실패) — 기술 오류 문구 대신
  // voice.error에 담긴 아이용 안내 문구만 보여준다(Plan7 §2, fallback 없음).
  if (voice.status === "error" && !autoStartFailed) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "var(--color-k-surface)" }}>
        <p className="text-5xl">🌙</p>
        <p className="text-sm font-bold text-gray-700 whitespace-pre-line leading-relaxed">
          {voice.error || "지금은 케이와 대화를 시작하기 어려워요.\n잠시 후 다시 만나자."}
        </p>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 회색 비활성 버튼의 문구를 "케이가 말하는 중"과 "케이가 생각하는 중"으로 구분
  const isKSpeakingNow = isLiveMode ? turnPhaseUi === "k_speaking" : sttTts.isSpeaking;
  
  // 012 "좌측에 현재 미션 라벨(예: 하교 후 미션)" — roundType 판정 로직 자체는 건드리지
  // 않고 그 결과값(round1_day/round2_night/common)만 라벨 텍스트로 매핑한다.
  const missionLabel =
    roundType === "round1_day" ? "하교 후 미션" : roundType === "round2_night" ? "취침 전 미션" : "미션";

  // 011 2차: "복구 불가능한 경우에만" 뜨는 재시도 UI — 케이 말풍선도, 상단 배너도 아니다.
  // 화면 중앙에 짧은 문구 + 다시 시도/미션 나가기 버튼만 보여준다(011 §"복구 불가능 오류 UI").
  // 2026-07-27: 문구를 "다시 한번 해볼까?"에서 "케이랑 접속이 끊겼네?"로 변경 — 이 팝업은
  // 진행률과 무관하게 STT 실패/음성 연결 문제 시에만 뜨는데, 기존 문구가 "미션 재시작"
  // 의미로 오해될 수 있어(022 요청서 참고) 목적을 명확히 하는 문구로 교체했다. 버튼
  // 동작(세션·진행상태 유지 + 재연결 / 미션 나가기)은 변경 없음.
  const retryOverlay = showRetryButton && (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10 px-6">
      <div className="bg-white rounded-2xl shadow-lg p-5 flex flex-col items-center gap-3 max-w-xs">
        <p className="text-sm font-bold text-gray-700 text-center">
          {errorMsg.startsWith("대화를 저장하는 중")
            ? "대화를 저장하는 중 문제가 생겼어요. 연결을 확인하고 다시 시도해 주세요."
            : "케이랑 접속이 끊겼네?"}
        </p>
        <div className="flex gap-2 w-full">
          <button
            onClick={async () => {
              if (errorMsg === "연결 문제로 미션 종료 확인에 실패했어요. 다시 시도해 주세요.") {
                handleForcedExpiry();
                return;
              }
              const pending = await readPendingMissionTurn().catch(() => null);
              if (pending) {
                window.location.reload();
                return;
              }
              recoveryAttemptedRef.current = false;
              setShowRetryButton(false);
              if (isLiveMode) {
                void live.startSession({ preserveHistory: true });
              } else if (isAuto && missionStateRef.current === "active") {
                sttSetMicEnabledRef.current?.(true);
              }
            }}
            className="flex-1 py-2 rounded-xl text-sm font-bold text-white cursor-pointer"
            style={{ background: "var(--color-k-orange)" }}
          >
            다시 시도
          </button>
          <button
            onClick={() => {
              voice.stopSession();
              setSessionActive(false);
              router.push("/child/home");
            }}
            className="flex-1 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 cursor-pointer"
          >
            미션 나가기
          </button>
        </div>
      </div>
    </div>
  );


  const allTurns = voice.transcript.map(t => ({
    id: t.id ?? Math.random().toString(),
    role: t.role === "child" ? "child" : "k",
    text: t.text
  }));

  return (
    <>
      {wakeLockWarning && (
        <div className="fixed top-[80px] left-0 right-0 flex justify-center z-[100] pointer-events-none animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="bg-gray-800/80 text-white text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
            기기 설정으로 화면이 꺼질 수 있어요
          </div>
        </div>
      )}
      
      {retryOverlay}



      {/* 조기 종료 감지/오디오 언락 UI (absolute/fixed로 띄움) */}
      {isLiveMode && live.audioLocked && voice.status === "live" && (
        <div className="fixed top-[120px] left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-[320px]">
          <button
            onClick={() => void live.unlockAudio()}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white cursor-pointer shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--color-k-orange)" }}
          >
            🔊 케이 목소리 켜기
          </button>
        </div>
      )}
      
      {!isConnecting && !isDone && autoStartFailed && (
        <div className="fixed top-[120px] left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-[320px]">
          <button
            onClick={() => {
              if (isLiveMode) void live.unlockAudio();
              setAutoStartFailed(false);
              if (isLiveMode) {
                void live.startSession({ preserveHistory: true });
              } else {
                voice.startSession();
              }
            }}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white cursor-pointer shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--color-k-orange)" }}
          >
            ▶️ 미션 이어하기
          </button>
        </div>
      )}

      <MissionConversationLayout
        onClose={handleClose}
        isClosing={isDone || isRewardModalOpen}
        progressCurrent={gauge}
        progressTotal={requiredCount}
        history={allTurns as any}
        activeTurn={null}
        interimChildText={isLiveMode ? voice.interimChildText : undefined}
        voiceState={voiceState}
        isMuted={!kVoiceEnabled}
        onToggleMute={toggleKVoice}
        isAuto={isAuto}
        onChangeMode={handleModeChange}
        isRecording={isRecording}
        isMicDisabled={isButtonBlocked || isRewardModalOpen}
        onMicClick={handleCentralButtonClick}
        textInput={textInput}
        onChangeTextInput={setTextInput}
        onSendText={handleSendText}
        isTextMode={mode === "text"}
        onToggleTextMode={() => (mode === "text" ? switchToVoice() : switchToText())}
        entryStatus={entryStatus}
        onStartMission={handleStartMission}
        onResumeMission={handleResumeMission}
        onExitBeforeStart={handleClose}
      />

      {/* 황금열쇠 보상 모달 */}
      {isRewardModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reward-modal-title"
          aria-describedby="reward-modal-desc"
          onKeyDown={(e) => {
            // 035 codex 리뷰 지적: Focus Trap 부재 - X버튼(먼저)↔하단 닫기버튼(나중) 두
            // 개만 포커스 가능한 요소이므로 Tab/Shift+Tab을 여기서 직접 순환시킨다.
            // claude-review 재지적: shiftKey만으로 타겟을 고정하면 이미 타겟 위에 포커스가
            // 있을 때 자기 자신으로 재포커스되어 순환이 멈춘다 - 현재 포커스를 확인해 반대
            // 버튼으로 토글해야 실제로 두 버튼 사이를 순환한다.
            if (e.key !== "Tab") return;
            e.preventDefault();
            const onX = document.activeElement === rewardCloseXBtnRef.current;
            const target = onX ? rewardCloseBottomBtnRef.current : rewardCloseXBtnRef.current;
            target?.focus();
          }}
        >
          <div className="w-[90%] max-w-[340px] bg-white rounded-[24px] shadow-lg p-6 flex flex-col items-center relative overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <button
              ref={rewardCloseXBtnRef}
              onClick={handleCloseRewardCompletion}
              aria-label="보상 화면 닫기"
              className="absolute top-4 right-4 w-[44px] h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 active:scale-95 text-gray-500 cursor-pointer"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* 이 프로젝트에 공식 황금열쇠 PNG/SVG 자산이 없다(전수 확인 - public/ 검색 0건).
                app/child/play·home 등 앱 전체가 황금열쇠를 이미 🔑 이모지로 일관 표시하므로
                (035 codex 리뷰가 지적한) 임의 커스텀 SVG 대신 그 기존 관례를 그대로 따른다. */}
            <div className="w-[90px] h-[90px] mt-2 mb-4 bg-yellow-50 rounded-full flex items-center justify-center text-[48px]" style={{ animation: "rewardScaleIn 0.35s ease-out forwards" }} aria-hidden="true">
              🔑
            </div>

            <h2 id="reward-modal-title" className="text-[24px] font-extrabold text-[var(--color-k-navy)] mb-1 text-center" style={{ animation: "rewardSlideUp 0.35s ease-out forwards" }}>
              {rewardPresentation.title}
              {rewardPresentation.awarded && (
                <>
                  <span className="sr-only"> 황금열쇠 1개 획득.</span>
                  <span
                    aria-hidden="true"
                    className="ml-1"
                    style={{ color: "var(--color-k-orange)" }}
                  >
                    +1
                  </span>
                </>
              )}
            </h2>

            <p id="reward-modal-desc" className="text-gray-500 font-medium text-[15px] mb-8 text-center" style={{ animation: "rewardSlideUp 0.4s ease-out forwards" }}>
              {rewardPresentation.description}
            </p>

            <button
              ref={rewardCloseBottomBtnRef}
              autoFocus
              onClick={handleCloseRewardCompletion}
              className="w-full max-w-[140px] h-[48px] rounded-full text-white font-bold text-[16px] shadow-sm active:scale-95 transition-transform cursor-pointer"
              style={{ backgroundColor: "var(--color-k-navy)" }}
            >
              닫기
            </button>
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes rewardScaleIn {
              from { transform: scale(0.85); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            @keyframes rewardSlideUp {
              from { transform: translateY(10px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              .w-[90px], h2, p { animation: none !important; }
            }
          `}} />
        </div>
      )}
    </>
  );
}

function MissionRouteGate() {
  const [isTextMode, setIsTextMode] = useState(false);
  const [decision, setDecision] = useState<"loading" | "ab" | "ef" | "cd" | "normal">("loading");
  const [selectedMode, setSelectedMode] = useState<"A" | "B" | "C" | "D" | "E" | "F">("C");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/child/test-mode")
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((d) => { 
        if (!cancelled) {
          if (d?.selectedMode === "E" || d?.selectedMode === "F") {
            setSelectedMode(d.selectedMode);
            setDecision("ef");
          } else if (d?.selectedMode === "C" || d?.selectedMode === "D") {
            setSelectedMode(d.selectedMode);
            setDecision("cd");
          } else if (d?.selectedMode === "A" || d?.selectedMode === "B") {
            setSelectedMode(d.selectedMode);
            setDecision("ab");
          } else {
            setDecision("normal");
          }
        }
      })
      .catch(() => { if (!cancelled) setDecision("normal"); });
    return () => { cancelled = true; };
  }, []);

  if (decision === "loading") {
    return (
      <div className="flex items-center justify-center" style={{ height: "100dvh", background: "var(--color-k-surface)" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-orange) var(--color-k-orange) transparent transparent" }} />
      </div>
    );
  }
  // E/F안 테스트 화면은 디바이스 프레임(DemoFrame) 없이 전체 화면으로 렌더 — 프레임/토글·중첩 스크롤 제거.
  if (decision === "ef") {
    return <TestModeERunner selectedMode={selectedMode as "E" | "F"} />;
  }
  if (decision === "cd") {
    return <TestModeCDRunner selectedMode={selectedMode as "C" | "D"} />;
  }
  if (decision === "ab") {
    return <TestModeABRunner selectedMode={selectedMode as "A" | "B"} />;
  }
  // 일반 계정 미션은 기존 그대로(DemoFrame) — 회귀 없음.
  return (
    <DemoFrame>
      <div className="mission-frame-wrapper relative w-full h-full">
        <style dangerouslySetInnerHTML={{ __html: `
          .mission-frame-wrapper [class*="h-[100dvh]"],
          .mission-frame-wrapper [class*="min-h-[100dvh]"] {
            height: 100% !important;
            min-height: 100% !important;
          }
        `}} />
        <MissionInner onTextModeChange={setIsTextMode} />
        {!isTextMode && (
          <div className="absolute top-0 right-0">
            <KChatbotWidget appSurface="child" topOffsetPx={104} containerMaxWidthPx={480} />
          </div>
        )}
      </div>
    </DemoFrame>
  );
}

export default function ChildMissionsPage() {
  return (
    <Suspense fallback={null}>
      <MissionRouteGate />
    </Suspense>
  );
}
