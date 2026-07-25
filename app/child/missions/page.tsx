"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import { MissionConversationLayout } from "@/components/MissionConversationLayout";
import { useRouter, useSearchParams } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { useGeminiLive, type Turn } from "@/hooks/useGeminiLive";
import { SkeletonBox } from "@/components/Skeleton";
import { VoiceInputModeSwitch } from "@/components/VoiceInputModeSwitch";
import { TestModeERunner } from "@/components/TestModeERunner";
import { TestModeCDRunner } from "@/components/TestModeCDRunner";
import { TestModeABRunner } from "@/components/TestModeABRunner";
import { MissionCompletionController, type MissionCompletionState } from "@/lib/mission/missionCompletionFlow";
import { canStartRecording, shouldAcceptChildTurn } from "@/lib/mission/turnGuard";
import { fetchPersonalizedReaction } from "@/lib/mission/personalizedReaction";
import { ChildConversationContext } from "@/lib/mission/ChildConversationContext";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { logVoiceEvent } from "@/lib/voiceTimelineLog";
import { appendVocative } from "@/lib/utils/koreanParticle";
import { usePipelineConnectionQuality } from "@/hooks/usePipelineConnectionQuality";
import { ConnectionQualityIndicator } from "@/components/ConnectionQualityIndicator";
import { VoiceConversationStateBadge, type VoiceConversationState } from "@/components/VoiceConversationStateBadge";

type RoundType = "round1_day" | "round2_night" | "common";
type VoiceMode = "stt_tts" | "live";

interface MissionQuestion {
  id: string;
  question_text: string;
  dashboard_area_tag: string;
  cycle_type: string;
  round_type: RoundType;
}

type QuestionState = "pending" | "answered" | "skipped" | "refused";

// 미션 종료 시 케이가 정확히 말해야 하는 문구 — 5번째 유효 답변이 확정된 직후 Live 세션에
// 전용 종료 발화(live.speakClosingLine)로 이 문장을 보내 케이가 이것만 말하고 끝내게 한다.
const MISSION_CLOSING_LINE = "오늘의 미션을 모두 완료했어! 황금열쇠를 받았어. 내일 또 만나자!";

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

// 운영시간 게이트 (KST)
function getKstHour(): number {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600000).getHours();
}

function currentRound(hour: number): RoundType | null {
  if (hour >= 13 && hour < 17) return "round1_day";
  if (hour >= 19 && hour <= 23) return "round2_night";
  return null;
}

function MissionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { quality: connectionQuality, recordStageResult, recordNormalTurn } = usePipelineConnectionQuality();

  const [phase, setPhase] = useState<"loading" | "closed" | "ready" | "error">("loading");
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
  const [mode, setMode] = useState<"voice" | "text">("voice");
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
  const currentIndexRef = useRef(0);
  const questionStatesRef = useRef<Record<string, QuestionState>>({});
  const askedIndexRef = useRef<number>(-1);
  const missionStateRef = useRef<MissionCompletionState>("active");
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
    setShowRetryButton(!!showRetryButtonNow);
  }, [setTurnPhase]);

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

  const saveMessage = useCallback((role: "child" | "k", content: string, displaySequence?: number, turnId?: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !content.trim()) return;

    // 모드 전환(자동↔수동) 등 세션 재시작 시 대화 이력이 날아가는 것을 방지하기 위해,
    // 완료된 모든 턴을 공통 소스(pastMessagesRef)에 누적 저장한다.
    pastMessagesRef.current = [...pastMessagesRef.current, { role, text: content, id: turnId, displaySequence }];

    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role, content, voiceMode: voiceModeRef.current, displaySequence, turnId }),
    })
      .then(res => { if (!res.ok) console.error("[saveMessage] failed", { status: res.status, turnId, role }); })
      .catch(err => console.error("[saveMessage] network error", { turnId, role, message: err.message }));
  }, []);

  const pickNextIndex = useCallback((states: Record<string, QuestionState>): number => {
    const qs = questionsRef.current;
    const cur = currentIndexRef.current;
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
    saveMessage(enrichedTurn.role, enrichedTurn.text, enrichedTurn.displaySequence, enrichedTurn.id);

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

        if (!isGreetingTurn) {
          const res = await fetch("/api/mission/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, questionId: question.id, answerText: enrichedTurn.text, childTurnId }),
            signal: isLive ? manualAbortControllerRef.current?.signal : apiAbortControllerRef.current?.signal,
          });
          if (!res.ok) {
            if (currentEpoch !== answerEpochRef.current) return;
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
                if (!success) resetToIdle(true);
              } else {
                attemptSilentRecoveryOrShowRetry();
              }
            } else {
              attemptSilentRecoveryOrShowRetry();
            }
            return;
          }
          data = await res.json();
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

          // setCompleted는 발화 완료 후 상태 전이 시에 호출되도록 위임
          if (data.completed) {
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
            const success = liveRef.current?.speakClosingLine("오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!");
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
              await sttTts.speak("오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!");
            } else {
              sttTts.sayText("오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!");
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
        if (!isLive) {
          const reactionText = await reactionResultPromise!;
          if (currentEpoch !== answerEpochRef.current) return;
          lastReactionRef.current = reactionText;
          respondText = `${reactionText} ${nextQ.question_text}`;
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
        askQuestionRef.current?.(next, respondText);
      } catch {
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
  }, [saveMessage, pickNextIndex, nextTurnId, nextDisplaySequence, recordNormalTurn]);

  // 자동·수동 발화 상태 및 DOM 조작을 위한 Ref 선언
  const [isAuto, setIsAuto] = useState(true);
  isAutoRef.current = isAuto;
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef<number>(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const pingRef = useRef<HTMLDivElement | null>(null);

  const sttTts = useVoiceChat({ 
    onTurnComplete: handleTurnComplete, 
    getSessionId: () => sessionIdRef.current,
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
  sttCancelFinalizeRef.current = sttTts.cancelFinalize;
  const live = useGeminiLive({
    onTurnComplete: handleTurnComplete,
    voiceName: liveVoiceName,
    sttMode: "gcp",
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
        // --hb-warning (경고/오렌지색 계열) 디자인 토큰 활용
        buttonRef.current.style.boxShadow = level > 0.005 
          ? `0 0 ${shadowRadius}px var(--hb-warning)` 
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
        liveRef.current?.appendTurn({ role: "k", text: MISSION_CLOSING_LINE });
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
        const kId = nextTurnId();
        const fallbackSeq = nextDisplaySequence();
        liveRef.current?.appendTurn({ role: "k", text: MISSION_CLOSING_LINE, id: kId, displaySequence: fallbackSeq });
        saveMessage("k", MISSION_CLOSING_LINE, fallbackSeq, kId);
        await playClosingLineViaTts(MISSION_CLOSING_LINE, sessionIdRef.current);
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
        sendTypedText: live.sendText,
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
        sendTypedText: sttTts.sendTypedText,
        getTranscript: sttTts.getTranscript,
      };

  const [sessionActive, setSessionActive] = useState(false);

  // 미션 진행 상태에 따른 세션 활성화
  useEffect(() => {
    if (phase === "ready" && missionState !== "completed") {
      setSessionActive(true);
    } else if (missionState === "completed" || phase === "closed" || phase === "error") {
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

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleLeave();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", handleLeave);
    
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

  // 자동/수동 무관하게 첫 진입 시 무조건 세션 시작 (연결은 해 둬야 대화/history가 보임)
  useEffect(() => {
    if (
      phase === "ready" &&
      mode === "voice" &&
      voice.status !== "live" &&
      voice.status !== "connecting" &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      void voice.startSession();
    }
  }, [phase, mode, voice.status, voice]);

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
    if (isRecordingRef.current) {
      try {
        if (isLiveMode) {
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
      }
    }
    setMode("text");
    voice.setMicEnabled(false);
  }, [voice, live, isLiveMode, sttTts, setTurnPhase, resetToIdle]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    voice.setMicEnabled(true);
  }, [voice]);

  const handleSendText = useCallback(() => {
    if (answerInFlightRef.current) return; // 처리 중엔 새 제출을 아예 막는다
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    if (voiceModeRef.current !== "live") {
      activeChildTurnIdRef.current = nextTurnId();
      activeChildTurnSeqRef.current = nextDisplaySequence();
    }
    voice.sendTypedText(text);
  }, [textInput, voice, nextTurnId, nextDisplaySequence]);

  const handleClose = useCallback(() => {
    voice.stopSession();
    setSessionActive(false);
    router.replace("/child/home");
  }, [voice, router]);

  useEffect(() => {
    const qpChild = searchParams.get("childId");
    const stored = typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null;
    const cid = qpChild || stored;
    if (!cid) {
      router.replace("/");
      return;
    }
    setChildId(cid);
    const storedVoiceInputMode = localStorage.getItem(`k_voice_input_mode:${cid}`);
    if (storedVoiceInputMode === "manual") setIsAuto(false);

    let cancelled = false;
    (async () => {
      const hour = getKstHour();
      const qpRound = searchParams.get("roundType") as RoundType | null;

      // 운영시간 게이트 on/off — 서버 환경변수 MISSION_TIME_GATE_ENABLED(단일 플래그)로 제어.
      // 값이 "true"일 때만 기존 제한이 적용되고, 그 외에는 기본적으로 비활성화(시간 무관 진입
      // 가능)된다. 게이트 로직(getKstHour/currentRound) 자체는 그대로 유지 — 이 스위치는
      // 적용 여부만 바꾼다. 조회 실패 시에도 기본값(false, 제한 비활성화)으로 안전하게 진행한다.
      let timeRestrictionsEnabled = false;
      try {
        const cfgRes = await fetch("/api/config/child-time-restrictions");
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (typeof cfg.enabled === "boolean") timeRestrictionsEnabled = cfg.enabled;
        }
      } catch {
        // 조회 실패 — 기본값(false, 제한 비활성화)으로 안전하게 진행
      }
      if (cancelled) return;

      const round: RoundType | null =
        qpRound ?? currentRound(hour) ?? (!timeRestrictionsEnabled ? "common" : null);
      if (!round) {
        setPhase("closed");
        return;
      }
      setRoundType(round);

      try {
        const res = await fetch("/api/mission/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId: cid, roundType: round }),
        });
        const data = await res.json();
        logVoiceEvent({ ts: Date.now(), eventType: "answer_response" });
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(data.error ?? "미션을 시작하지 못했어요");
          setPhase("error");
          return;
        }
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;

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
             // 012: 인사 문구용 이름은 /api/child/me를 별도로 부르지 않고, 이미 await한
             // /api/mission/start 응답의 givenName(childProfile.given_name — 케이가 아이를
             // 부를 때 쓰는 필드, DB 마이그레이션 주석에 명시)을 그대로 재사용한다(claude-review
             // 지적: /api/child/me의 name은 성이 포함된 전체 표시 이름이라 "김서아야"처럼
             // 부자연스러워지고, 실패 시 null 가드도 없어 "안녕~ . 어제는..."처럼 문법이
             // 깨졌었다). 이름을 못 받은 경우엔 호격 문구 자체를 생략해 자연스러운 문장으로
             // 폴백한다.
             const isDay = round === "round1_day";
             const givenName = typeof data.givenName === "string" ? data.givenName : null;
             const greetingIntro = givenName ? `안녕~ ${appendVocative(givenName)}.` : "안녕~";
             const greetingText = isDay
               ? (Math.random() > 0.5
                  ? `${greetingIntro} 어제는 잘 잤니?`
                  : `${greetingIntro} 학교는 잘 다녀왔니?`)
               : `${greetingIntro} 오늘 하루 어땠니?`;

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

        // 스크롤백용 — 이 세션에 이미 저장된 과거 대화를 불러와 둔다(live 전환 시 채워짐).
        try {
          logVoiceEvent({ ts: Date.now(), eventType: "restore_fetch_start" });
          const msgRes = await fetch(`/api/chat/messages?sessionId=${data.sessionId}`);
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            logVoiceEvent({ ts: Date.now(), eventType: "restore_fetch_complete", extra: { messageCount: msgData.messages?.length ?? 0 } });
            const past: Turn[] = (msgData.messages ?? [])
              .filter((m: any) => m.content && m.content.trim() !== "" && (m.turn_status ? m.turn_status === "finalized" : true))
              .map(
                (m: any) => ({ role: m.role, text: m.content, displaySequence: m.display_sequence })
              );
            pastMessagesRef.current = past;
          }
        } catch {
          // 과거 대화 로드 실패해도 미션 진행 자체는 막지 않음
        }

        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg((e as Error).message);
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, router]);

  // Live 모드가 활성화될 때 interactionMode 설정 동기화 (STT/TTS는 setInputMode+setMicEnabled로 동일 개념 적용)
  useEffect(() => {
    if (voice.status !== "live") return;
    if (isLiveMode) {
      live.setInteractionMode(isAuto ? "auto" : "manual");
    } else {
      sttTts.setInputMode(isAuto ? "auto" : "manual");
      sttTts.setMicEnabled(isAuto);
    }
  }, [voice.status, isAuto, isLiveMode, live.setInteractionMode, sttTts.setInputMode, sttTts.setMicEnabled]);

  const handleModeChange = useCallback((newMode: "auto" | "manual") => {
    // 실제 탭 이벤트 안 — Android에서 케이 오디오 AudioContext가 아직 suspended라면 여기서
    // 재시도(자동 모드는 세션이 useEffect에서 제스처 없이 시작돼 특히 도움이 된다).
    if (isLiveMode) void live.unlockAudio();
    if (newMode === "auto") {
      // 수동 발화(녹음) 중이었다면 안전하게 먼저 종료 처리
      if (isRecordingRef.current) {
        try {
          if (isLiveMode) {
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
        }
      }
      if (isLiveMode) {
        live.setInteractionMode("auto");
      } else {
        sttTts.setInputMode("auto");
      }
      setIsAuto(true);
    } else {
      if (isLiveMode) {
        live.setInteractionMode("manual");
      } else {
        sttTts.setInputMode("manual");
        sttTts.setMicEnabled(false);
      }
      setIsAuto(false);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
    if (childIdRef.current) {
      localStorage.setItem(`k_voice_input_mode:${childIdRef.current}`, newMode);
    }
  }, [live, sttTts, isLiveMode, setTurnPhase, resetToIdle]);

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

  if (phase === "loading") {
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
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
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
        <p className="text-5xl">⏰</p>
        <p className="text-base font-bold text-gray-800">지금은 미션 시간이 아니에요</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          1차 미션은 오후 1시~5시,
          <br />
          2차 미션은 저녁 7시~밤 12시에 만나요!
        </p>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "#1a6b5a" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
        <p className="text-5xl text-red-500">⚠️</p>
        <p className="text-base font-bold text-red-500">미션을 시작하지 못했어요</p>
        <p className="text-xs text-gray-500">{errorMsg}</p>
        <button
          onClick={() => {
            setSessionActive(false);
            router.replace("/child/home");
          }}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "#1a6b5a" }}
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
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
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
          style={{ background: "#1a6b5a" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  const isConnecting = voice.status === "connecting";
  const isLive = voice.status === "live";
  // completing 단계부터 이미 100%/완료 취급(마이크·입력 비활성화) — completed와의 차이는
  // "종료 발화가 아직 재생 중인지"뿐이라 화면 표시상 구분할 필요가 없다.
  const isDone = missionState !== "active" || completed;

  let voiceState: VoiceConversationState = "idle";
  if (isConnecting) {
    voiceState = "connecting";
  } else if (isLiveMode) {
    if (turnPhaseUi === "child_listening" || turnPhaseUi === "child_finalizing") {
      voiceState = "listening";
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
    if (isRecording) {
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
  const isThinkingTurn = !isAuto && (isLiveMode ? turnPhaseUi !== "idle" : (isProcessingAnswer || sttTts.isSpeaking));
  // 회색 비활성 버튼의 문구를 "케이가 말하는 중"과 "케이가 생각하는 중"으로 구분(같은 회색
  // 비활성 모양, 문구만 다름) — 아이가 실제로 케이 목소리가 나오는 순간인지 구분할 수 있게 한다.
  const isKSpeakingNow = isLiveMode ? turnPhaseUi === "k_speaking" : sttTts.isSpeaking;
  // 버튼 클릭 가능 여부는 isThinkingTurn을 그대로 쓰면 안 된다 — Live 모드의 turnPhaseUi는
  // 녹음 시작 즉시 "child_listening"(≠idle)으로 바뀌어 isThinkingTurn이 true가 되므로,
  // isRecording으로 override하지 않으면 방금 녹음을 시작한 버튼이 그 순간 disabled로
  // 잠겨 "눌러서 녹음을 끝낼 수 있어야 함" 요구사항을 만족하지 못한다(QA 중 실제 재현·발견).
  // 녹음 중에는 항상 클릭 가능해야 한다 — 회색 비활성은 "K가 말하는 중/생각하는 중"에만.
  const isButtonBlocked = isThinkingTurn && !isRecording;
  // 012 "좌측에 현재 미션 라벨(예: 하교 후 미션)" — roundType 판정 로직 자체는 건드리지
  // 않고 그 결과값(round1_day/round2_night/common)만 라벨 텍스트로 매핑한다.
  const missionLabel =
    roundType === "round1_day" ? "하교 후 미션" : roundType === "round2_night" ? "취침 전 미션" : "미션";

  // 011 2차: "복구 불가능한 경우에만" 뜨는 재시도 UI — 케이 말풍선도, 상단 배너도 아니다.
  // 화면 중앙에 짧은 문구 + 다시 시도/미션 나가기 버튼만 보여준다(011 §"복구 불가능 오류 UI").
  const retryOverlay = showRetryButton && (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10 px-6">
      <div className="bg-white rounded-2xl shadow-lg p-5 flex flex-col items-center gap-3 max-w-xs">
        <p className="text-sm font-bold text-gray-700 text-center">다시 한번 해볼까?</p>
        <div className="flex gap-2 w-full">
          <button
            onClick={() => {
              recoveryAttemptedRef.current = false;
              setShowRetryButton(false);
              if (!isLiveMode && isAuto && missionStateRef.current === "active") {
                sttSetMicEnabledRef.current?.(true);
              }
            }}
            className="flex-1 py-2 rounded-xl text-sm font-bold text-white cursor-pointer"
            style={{ background: "#1a6b5a" }}
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

  if (!isLiveMode) {
    const visibleTurns = voice.transcript.filter((t) => t.role !== "child");
    const activeVisibleTurn = visibleTurns.length > 0 ? visibleTurns[visibleTurns.length - 1] : null;
    const historyTurns = visibleTurns.slice(0, -1);
    const missionDoneNow = missionStateRef.current !== "active" || completed;

    return (
      <div className="h-full relative overflow-hidden" style={{ background: "#fafaf8" }}>
        {wakeLockWarning && (
          <div className="absolute top-[80px] left-0 right-0 flex justify-center z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-gray-800/80 text-white text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
              기기 설정으로 화면이 꺼질 수 있어요
            </div>
          </div>
        )}

        {missionDoneNow && (
          <div className="absolute top-[64px] left-0 right-0 z-30 text-center px-4 pointer-events-none">
            <h1 className="text-base font-bold" style={{ color: "#1e1e2d" }}>
              오늘의 미션을 완료했어요!
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
              {missionState === "completed"
                ? MISSION_CLOSING_LINE
                : "황금열쇠를 받았어요. 내일 또 만나요! 🔑"}
            </p>
          </div>
        )}

        {retryOverlay}

        <MissionConversationLayout
          onBack={() => {
            voice.stopSession();
            setSessionActive(false);
            router.push("/child/home");
          }}
          progressCurrent={gauge}
          progressTotal={requiredCount}
          missionLabel={missionLabel}
          history={historyTurns.map((t, i) => ({
            id: t.id ?? `h-${i}`,
            role: t.role === "child" ? "child" : "k",
            text: t.text,
          }))}
          activeTurn={
            activeVisibleTurn
              ? {
                  id: activeVisibleTurn.id ?? "active",
                  role: activeVisibleTurn.role === "child" ? "child" : "k",
                  text: activeVisibleTurn.text,
                }
              : null
          }
          /* 012: 상태배지(좌) - 케이 캐릭터(중앙) - 자동/수동 토글(우) 한 줄. 이전엔 이 배지가
             마스코트 오른쪽에 절대위치로 붙어 있었고 토글/스피커는 상단 헤더에 있었다 —
             대표님이 "마스코트/배지/토글은 항상 표시" 방침을 확정해, activeTurn(케이가 실제
             말하는 순간) 여부와 무관하게 이 슬롯 전체가 항상 렌더되도록
             MissionConversationLayout.tsx도 함께 수정했다. */
          mascotSlot={
            <div className="flex items-center justify-center gap-3">
              <VoiceConversationStateBadge state={voiceState} />
              <div className="relative inline-flex items-center justify-center">
                <KBestieMascotAnimation
                  state={(isLiveMode ? turnPhaseUi === "k_speaking" : sttTts.isSpeaking) ? "talking" : "idle"}
                  size={72}
                />
                <button
                  onClick={toggleKVoice}
                  className="absolute bottom-0 left-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm text-xs cursor-pointer transition-transform active:scale-95"
                  style={{ background: kVoiceEnabled ? "#1a6b5a" : "#e5e7eb", color: kVoiceEnabled ? "#fff" : "#9ca3af" }}
                  aria-label={kVoiceEnabled ? "케이 음성 끄기" : "케이 음성 켜기"}
                >
                  {kVoiceEnabled ? "🔊" : "🔇"}
                </button>
              </div>
              {!missionDoneNow && (
                <VoiceInputModeSwitch isAuto={isAuto} onChange={handleModeChange} />
              )}
            </div>
          }
          isListening={isRecording}
          micLevel={isRecording ? 0.6 : 0}
          headerExtraSlot={
            <ConnectionQualityIndicator quality={connectionQuality} live={true} />
          }
        />

        {/* 실제 조작 가능한 하단 컨트롤(마이크 버튼 / 텍스트 입력) - 기존 로직·핸들러 그대로,
            MissionConversationLayout의 장식용 마이크 파형 존 위에 겹쳐서 표시한다.
            MissionConversationLayout.tsx 자체는 버튼을 모르므로 여기서 별도로 얹는다. */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          {mode === "voice" ? (
            <div className="flex items-center justify-center gap-8 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 bg-white border-t border-gray-50">
              <button
                onClick={switchToText}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
                aria-label="텍스트로 대화하기"
              >
                💬
              </button>

              {isConnecting && (
                <button disabled className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-100 shadow-sm cursor-not-allowed">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                </button>
              )}

              {isLive && !missionDoneNow && (
                isAuto ? (
                  <div className="w-16 h-16" />
                ) : (
                  <button
                    onClick={handleCentralButtonClick}
                    disabled={isButtonBlocked}
                    // 014 추가요청: "말하기 버튼"이 정지 버튼과 색상·형태가 비슷해 구분이
                    // 어렵다는 대표님 실기기 피드백 — 대기 상태는 원형(마이크), 녹음 중엔
                    // 버튼 자체 모양도 둥근 사각형(정지)으로 바꿔 아이콘뿐 아니라 컨테이너
                    // 형태까지 분리한다.
                    className={`w-16 h-16 flex items-center justify-center text-white shadow-md transition-all ${
                      isRecording ? "rounded-2xl" : "rounded-full"
                    } ${isButtonBlocked ? "cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
                    style={{ background: isRecording ? "#e05a3f" : isThinkingTurn ? "#9ca3af" : "var(--color-k-orange)" }}
                    aria-label={
                      isRecording
                        ? "녹음 종료"
                        : isThinkingTurn
                          ? (isKSpeakingNow ? "케이가 말하고 있어요" : "케이가 생각하고 있어요")
                          : "마이크 입력 시작"
                    }
                  >
                    {isRecording ? (
                      <div className="w-5 h-5 rounded-sm bg-white" />
                    ) : isThinkingTurn ? (
                      <div className="w-5 h-5 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="2" width="6" height="11" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                      </svg>
                    )}
                  </button>
                )
              )}

              {!isLive && !isConnecting && !missionDoneNow && autoStartFailed && (
                <button
                  onClick={() => {
                    setAutoStartFailed(false);
                    voice.startSession();
                  }}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer"
                  style={{ background: "#e8845a" }}
                  aria-label="미션 시작"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}

              {missionDoneNow && (
                <button
                  onClick={() => {
                    setSessionActive(false);
                    router.replace("/child/home");
                  }}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer"
                  style={{ background: "#1a6b5a" }}
                  aria-label="홈으로 이동"
                >
                  ✕
                </button>
              )}

              <button
                onClick={handleClose}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shrink-0 bg-white border-t border-gray-50">
              <button
                onClick={switchToVoice}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
                aria-label="음성으로 전환"
              >
                🎤
              </button>
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
                }}
                placeholder="케이에게 답해봐..."
                disabled={missionDoneNow || isProcessingAnswer}
                className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
                maxLength={200}
              />
              <button
                onClick={handleSendText}
                disabled={missionDoneNow || !textInput.trim() || isProcessingAnswer}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 cursor-pointer"
                style={{ background: "#e8845a" }}
                aria-label="전송"
              >
                ➤
              </button>
              <button
                onClick={handleClose}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
      {wakeLockWarning && (
        <div className="absolute top-[80px] left-0 right-0 flex justify-center z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="bg-gray-800/80 text-white text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
            기기 설정으로 화면이 꺼질 수 있어요
          </div>
        </div>
      )}
      {retryOverlay}
      {/* 상단 고정 영역: 헤더 + 진행률 게이지 + 마스코트 (스크롤되지 않음) */}
      <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
        <div className="relative flex items-center justify-center px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-1">
          {/* 좌상단 뒤로가기 버튼 */}
          <button
            aria-label="홈으로 돌아가기"
            onClick={() => {
              voice.stopSession();
              setSessionActive(false);
              router.push("/child/home");
            }}
            className="absolute left-2 top-[calc(50%+env(safe-area-inset-top)/2)] -translate-y-1/2 w-12 h-12 flex items-center justify-center cursor-pointer text-gray-600 z-20"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <Link href="/child/home" className="cursor-pointer shrink-0">
            <Image
              src="/Images/logo/Logo.png"
              alt="내친구 케이"
              width={84}
              height={24}
              className="object-contain"
              priority
            />
          </Link>
        </div>

        {isDone && (
          <div className="text-center pt-1.5 pb-2">
            <h1 className="text-lg font-bold" style={{ color: "#1e1e2d" }}>
              오늘의 미션을 완료했어요!
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
              {/* missionState==="completed"(종료 발화+700ms 대기까지 실제로 끝난 시점)일 때만
                  정확한 완료 안내 문구를 표시 — completing 중엔 기존 문구 그대로 유지. */}
              {missionState === "completed"
                ? MISSION_CLOSING_LINE
                : "황금열쇠를 받았어요. 내일 또 만나요! 🔑"}
            </p>
          </div>
        )}

        <div className="px-6 mt-1.5 mb-2">
          {/* 012 "0/10을 스텝 인디케이터로": 좌측 미션 라벨, 우측 n/10, 완료 시 축하 색상 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold" style={{ color: gauge >= requiredCount ? "#b8860b" : "#1a6b5a" }}>
              {missionLabel}
            </span>
            <div className="flex items-center gap-2">
              {gauge >= requiredCount && (
                <span className="text-[11px] font-extrabold text-white rounded-full px-2 py-0.5" style={{ background: "#f0a020" }}>
                  🎉 완료!
                </span>
              )}
              <span className="text-xs font-semibold" style={{ color: gauge >= requiredCount ? "#b8860b" : "#6b7280" }}>
                {gauge}/{requiredCount}
              </span>
            </div>
          </div>
          <div
            className="mt-1.5 flex gap-1 h-1.5 rounded-full"
            style={{
              padding: gauge >= requiredCount ? 3 : 0,
              background: gauge >= requiredCount ? "#fff3d6" : "transparent",
            }}
          >
            {Array.from({ length: requiredCount }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-full rounded-full transition-colors duration-300 ${!(gauge >= requiredCount) && i === gauge ? "animate-pulse" : ""}`}
                style={{
                  background: gauge >= requiredCount ? "#f0a020" : i < gauge ? "#1a6b5a" : "#eef2f1",
                }}
              />
            ))}
          </div>
        </div>

        {/* 012: 상태배지(좌) - 케이 캐릭터(중앙) - 자동/수동 토글(우), 항상 노출 */}
        <div className="flex justify-center items-center gap-3 mb-2 max-w-sm mx-auto">
          <VoiceConversationStateBadge state={voiceState} />
          <div className="relative inline-flex items-center justify-center">
            <KBestieMascotAnimation state="idle" size={96} />
            {/* 012 claude-review 지적: 이 블록은 이미 Live 전용 분기(if (!isLiveMode) 블록
                이후) 안에 있어 !isLiveMode는 여기서 항상 false다 — 예전부터 있던 죽은
                조건문이라 Live(Tier3)에서 스피커 아이콘이 실제로는 한 번도 렌더된 적이
                없었다. 항목(4) 요구사항을 Live 트리에서도 충족하도록 가드를 제거한다. */}
            <button
              onClick={toggleKVoice}
              className="absolute bottom-0 left-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm text-sm cursor-pointer transition-transform active:scale-95"
              style={{ background: kVoiceEnabled ? "#1a6b5a" : "#e5e7eb", color: kVoiceEnabled ? "#fff" : "#9ca3af" }}
              aria-label={kVoiceEnabled ? "케이 음성 끄기" : "케이 음성 켜기"}
            >
              {kVoiceEnabled ? "🔊" : "🔇"}
            </button>
          </div>
          {!isDone && (
            <VoiceInputModeSwitch isAuto={isAuto} onChange={handleModeChange} />
          )}
        </div>
      </div>

      {/* 대화 말풍선: 이 영역만 스크롤 */}
      <div
        ref={bubbleRef}
        className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4"
      >
        {voice.transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center p-4">
            <p className="text-xs leading-relaxed" style={{ color: "#9ca3af" }}>
              {isAuto
                ? "케이가 자동으로 들을 준비를 하고 있어요 🌿"
                : "세션 시작 뒤 말하기 버튼을 사용해 말해요 🌿"}
            </p>
          </div>
        ) : (
          voice.transcript
            .filter((turn) => isLiveMode || turn.role !== "child")
            .map((turn, i) => (
            <div
              key={turn.id ?? i}
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                turn.role === "k" ? "self-start" : "self-end"
              }`}
              style={{
                background: turn.role === "k" ? "#f3f4f6" : "#3b82f6",
                color: turn.role === "k" ? "#1e1e2d" : "#ffffff",
                borderRadius: turn.role === "k" ? "16px 16px 16px 2px" : "16px 16px 2px 16px",
              }}
            >
              {turn.text}
            </div>
          ))
        )}
        {/* 아이가 말하는 도중의 실시간 중간 자막 — 확정 전이라 옅게 표시 */}
        {isLiveMode && voice.interimChildText && (
          <div
            className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed self-end opacity-60"
            style={{
              background: "#3b82f6",
              color: "#ffffff",
              borderRadius: "16px 16px 2px 16px",
            }}
          >
            {voice.interimChildText}
          </div>
        )}
      </div>

      {/* Android 등 일부 브라우저는 사용자 제스처 밖에서 만들어진 AudioContext가 계속
          suspended로 남아 케이 목소리가 전혀 안 들릴 수 있다(자막은 정상 표시됨) — 자동 재시도가
          모두 실패했을 때만 뜨는 최후 수단. 탭 즉시 resume()을 시도하고 성공하면(audioLocked가
          false로 바뀌면) 스스로 사라진다. */}
      {isLiveMode && live.audioLocked && voice.status === "live" && (
        <div className="px-4 pb-2 shrink-0">
          <button
            onClick={() => void live.unlockAudio()}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer"
            style={{ background: "#e8845a" }}
          >
            🔊 케이 목소리 켜기
          </button>
        </div>
      )}

      {/* 하단 버튼 바 */}
      {mode === "voice" ? (
        <div className="flex items-center justify-center gap-8 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 bg-white border-t border-gray-50">
          <button
            onClick={switchToText}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="텍스트로 대화하기"
          >
            💬
          </button>

          {isConnecting && (
            <button disabled className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-100 shadow-sm cursor-not-allowed">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </button>
          )}

          {isLive && !isDone && (
            isAuto ? (
              // 자동 모드일 때는 중앙 버튼을 완전히 숨김
              <div className="w-16 h-16" />
            ) : (
              // 수동 모드일 때는 중앙 버튼 노출 및 레벨 비터 연결
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <>
                    <div className="absolute -top-8 text-[11px] font-extrabold text-orange-600 whitespace-nowrap bg-orange-50 px-2.5 py-0.5 rounded-full border border-orange-200 animate-bounce">
                      케이가 듣고 있어요
                    </div>
                    <div
                      ref={pingRef}
                      className="absolute w-16 h-16 rounded-full bg-orange-400/20 pointer-events-none transition-transform duration-75"
                    />
                  </>
                )}
                {/* 아이 답변 판정/다음 질문 생성 중(최대 10~32초)엔 canStartRecording 가드가
                    버튼 탭을 조용히 무시한다 — 이 표시가 없으면 버튼이 그대로 "말하기 시작"
                    모양이라 "눌러도 반응이 없다"로 보였다(진짜 원인: 시각 피드백 부재). */}
                {!isRecording && isThinkingTurn && (
                  <div className="absolute -top-8 text-[11px] font-extrabold text-gray-500 whitespace-nowrap bg-gray-100 px-2.5 py-0.5 rounded-full border border-gray-200">
                    {isKSpeakingNow ? "케이가 말하고 있어요" : "케이가 생각하고 있어요…"}
                  </div>
                )}
                <button
                  ref={buttonRef}
                  onClick={handleCentralButtonClick}
                  disabled={isButtonBlocked}
                  // 014 추가요청: 대기(원형, 마이크)와 녹음중(둥근 사각형, 정지) 컨테이너
                  // 형태를 분리해 아이콘뿐 아니라 버튼 모양으로도 구분되게 한다.
                  className={`relative w-16 h-16 flex items-center justify-center text-white shadow-md transition-all duration-75 ${
                    isRecording ? "rounded-2xl" : "rounded-full"
                  } ${
                    isButtonBlocked ? "cursor-not-allowed" : "active:scale-95 cursor-pointer"
                  } ${
                    isRecording
                      ? "bg-gradient-to-br from-orange-400 to-orange-500"
                      : isThinkingTurn
                        ? "bg-gray-300"
                        : "bg-[var(--color-k-orange)]"
                  }`}
                  aria-label={
                    isRecording
                      ? "녹음 종료"
                      : isThinkingTurn
                        ? (isKSpeakingNow ? "케이가 말하고 있어요" : "케이가 생각하고 있어요")
                        : "마이크 입력 시작"
                  }
                >
                  {isRecording ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : isThinkingTurn ? (
                    <div className="w-5 h-5 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span className="text-2xl">🎤</span>
                  )}
                </button>
              </div>
            )
          )}

          {!isLive && !isConnecting && !isDone && autoStartFailed && (
            <button
              onClick={() => {
                // 실제 탭 이벤트 안 — Android 자동재생 정책상 오디오 언락은 이 동기 호출
                // 스택 안에서 시도해야 효과가 있다(startSession 내부의 언락 시도는 이미
                // await를 여러 번 거친 뒤라 실패할 수 있음).
                if (isLiveMode) void live.unlockAudio();
                setAutoStartFailed(false);
                voice.startSession();
              }}
              className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer"
              style={{ background: "#e8845a" }}
              aria-label="미션 시작"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}

          {isDone && (
            <button
              onClick={() => {
                setSessionActive(false);
                router.replace("/child/home");
              }}
              className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer"
              style={{ background: "#1a6b5a" }}
              aria-label="홈으로 이동"
            >
              ✕
            </button>
          )}

          <button
            onClick={handleClose}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shrink-0 bg-white border-t border-gray-50">
          <button
            onClick={switchToVoice}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="음성으로 전환"
          >
            🎤
          </button>
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
            }}
            placeholder="케이에게 답해봐..."
            disabled={isDone || isProcessingAnswer}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
            maxLength={200}
          />
          <button
            onClick={handleSendText}
            disabled={isDone || !textInput.trim() || isProcessingAnswer}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 cursor-pointer"
            style={{ background: "#e8845a" }}
            aria-label="전송"
          >
            ➤
          </button>
          <button
            onClick={handleClose}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// 테스트 계정이 A~E 대화방식 테스트에서 E안을 선택한 경우, /child/missions 실제 실행 경로에서
// 기존 미션 대신 E안 러너를 렌더한다. 일반 계정(및 E 미선택)은 기존 MissionInner 그대로 —
// 게이트가 'e'로 결정되기 전엔 MissionInner를 마운트하지 않아 기존 흐름에 회귀가 없다.
function MissionRouteGate() {
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
      <div className="flex items-center justify-center" style={{ height: "100dvh", background: "#fafaf8" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
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
      <MissionInner />
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
