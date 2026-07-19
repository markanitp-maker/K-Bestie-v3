"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { useVoiceChat, type Turn } from "@/hooks/useVoiceChat";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { SkeletonBox } from "@/components/Skeleton";
import { MissionCompletionController, type MissionCompletionState } from "@/lib/mission/missionCompletionFlow";

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
  const currentIndexRef = useRef(0);
  const questionStatesRef = useRef<Record<string, QuestionState>>({});
  const askedIndexRef = useRef<number>(-1);
  const missionStateRef = useRef<MissionCompletionState>("active");
  // Live 모드 전용 미션 턴 상태머신 — awaiting_child(아이 답변 대기) → processing_answer(답변
  // 판정/다음 질문 생성 중) → speaking_k(케이가 말하는 중) → awaiting_child. handleTurnComplete의
  // 재진입 가드와 onAudioQueueDrained의 복귀 신호가 이 상태를 관리한다(STT/TTS 모드는 기존
  // 동작을 그대로 유지하며 이 상태를 사용하지 않음).
  const turnPhaseRef = useRef<"awaiting_child" | "processing_answer" | "speaking_k">("awaiting_child");
  // 유효한 아이 답변 턴마다 1씩 증가 — /api/mission/answer, /api/mission/respond에 함께
  // 실어 보내 서버가 같은 턴에 대한 중복 요청을 식별할 수 있게 하는 idempotency key 재료.
  const childTurnSeqRef = useRef(0);
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
  // 스크롤백용 — DB(chat_messages)에서 불러온 과거 대화. 세션이 live가 된 직후 1회만
  // transcript에 채워넣는다(그 전에 넣으면 startSession()이 비워버림).
  const pastMessagesRef = useRef<Turn[]>([]);
  const pastMessagesSeededRef = useRef(false);

  const saveMessage = useCallback((role: "child" | "k", content: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !content.trim()) return;
    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role, content, voiceMode: voiceModeRef.current }),
    }).catch(() => {});
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
    saveMessage(turn.role, turn.text);

    // missionState !== "active"면(completing/completed) 그 이후의 아이 발화는 전부 무시한다
    // — 100% 이후 들어오는 사용자 입력을 미션 판정 로직에 태우지 않기 위함.
    if (turn.role !== "child" || missionStateRef.current !== "active") return;

    // Live 모드 전용 재진입 가드 — 케이가 아직 말하는 중(speaking_k)이거나 직전 답변을
    // 아직 처리 중(processing_answer)이면, 강제컷 직후 지연 도착한 STT 결과 등으로 인한
    // 동일/추가 child 턴을 무시한다(중복 /api/mission/answer·respond 호출 방지).
    const isLive = voiceModeRef.current === "live";
    if (isLive) {
      if (turnPhaseRef.current !== "awaiting_child") return;
      turnPhaseRef.current = "processing_answer";
    }

    const qs = questionsRef.current;
    const idx = currentIndexRef.current;
    const question = qs[idx];
    const sid = sessionIdRef.current;
    if (!question || !sid) {
      if (isLive) turnPhaseRef.current = "awaiting_child";
      return;
    }

    // 이번 아이 답변 턴의 idempotency key 재료 — 서버가 같은 턴에 대한 중복 요청을
    // 식별할 수 있도록 /api/mission/answer, /api/mission/respond에 함께 실어 보낸다.
    const childTurnId = `${sid}:${question.id}:${++childTurnSeqRef.current}`;

    void (async () => {
      try {
        const res = await fetch("/api/mission/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, questionId: question.id, answerText: turn.text, childTurnId }),
        });
        if (!res.ok) {
          if (res.status === 423) {
            // 이미 완료되었거나 안전 중단된 경우 대화 차단
            missionStateRef.current = "completed";
            setMissionState("completed");
            if (isLive) {
              liveRef.current?.lockNow();
            }
            return;
          }
          if (isLive) turnPhaseRef.current = "awaiting_child";
          return;
        }
        const data = await res.json();
        
        if (data.reason === "safety_signal" || data.status === "SAFETY_PAUSED") {
          // 안전 중단 처리: 다음 질문으로 넘어가지 않고 멈춤
          missionStateRef.current = "completed"; // UI 비활성화를 위해 completed 처리
          setMissionState("completed");
          if (isLive) {
            liveRef.current?.lockNow();
          }
          return;
        }

        questionStatesRef.current = data.questionStates ?? questionStatesRef.current;
        setGauge(data.validAnswerCount ?? 0);
        setProgressPercent(data.progressPercent ?? 0);
        setRequiredCount(data.requiredCount ?? 5);
        setCompleted(data.completed ?? false);
        setEngineVersion(data.engine_version ?? "v1");

        if (data.completed) {
          // 5번째 유효 답변 확정 — 여기서 곧바로 세션을 끊지 않는다(케이가 아직 종료 발화를
          // 하는/할 중일 수 있음). Live 모드는 별도 종료 플로우(missionCompletionFlow)가
          // "종료 발화의 turnComplete + 오디오 재생 완료 + 700ms" 이후에만 세션을 닫는다.
          // 일반 후속 질문 큐(pickNextIndex/askQuestion)는 절대 실행하지 않는다.
          if (voiceModeRef.current === "live") {
            turnPhaseRef.current = "speaking_k";
            liveRef.current?.lockNow();
            missionControllerRef.current?.start({ immediateTtsFallback: true });
          } else {
            // STT/TTS(Tier1/2) 경로는 연속 스트리밍 세션이 아니라 매 발화가 개별 TTS
            // 호출로 끝나므로 기존의 단순 즉시 종료 방식을 그대로 유지한다.
            missionStateRef.current = "completed";
            setMissionState("completed");
          }
          return;
        }

        const next = pickNextIndex(questionStatesRef.current);
        if (next === -1) {
          if (isLive) turnPhaseRef.current = "awaiting_child";
          return;
        }

        currentIndexRef.current = next;

        // 다음 질문 유도 멘트 동적 생성 및 폴백 — askQuestionRef는 정확히 1회만 호출한다.
        const nextQ = questionsRef.current[next];
        if (!nextQ) {
          if (isLive) turnPhaseRef.current = "awaiting_child";
          return;
        }

        let respondText: string | undefined;
        try {
          const respondRes = await fetch("/api/mission/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              history: getTranscriptRef.current?.() ?? [],
              nextQuestionText: nextQ.question_text,
              childTurnId,
            }),
          });
          if (respondRes.ok) {
            const respondData = await respondRes.json();
            if (respondData.text) respondText = respondData.text;
          }
        } catch {
          // 실패 시 아래 askQuestionRef가 순정 질문 텍스트(customText 없음)로 폴백
        }
        if (isLive) turnPhaseRef.current = "speaking_k";
        askQuestionRef.current?.(next, respondText);
      } catch {
        if (isLive) turnPhaseRef.current = "awaiting_child";
      }
    })();
  }, [saveMessage, pickNextIndex]);

  // 자동·수동 발화 상태 및 DOM 조작을 위한 Ref 선언
  const [isAuto, setIsAuto] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef<number>(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const pingRef = useRef<HTMLDivElement | null>(null);

  const sttTts = useVoiceChat({ onTurnComplete: handleTurnComplete, getSessionId: () => sessionIdRef.current });
  const live = useGeminiLive({
    onTurnComplete: handleTurnComplete,
    voiceName: liveVoiceName,
    sttMode: "gcp",
    getSessionId: () => sessionIdRef.current,
    getChildId: () => childIdRef.current,
    onServerTurnComplete: () => {
      if (missionControllerRef.current?.getState() === "completing") {
        missionControllerRef.current.notifyTurnComplete();
      }
    },
    onAudioQueueDrained: () => {
      if (missionControllerRef.current?.getState() === "completing") {
        missionControllerRef.current.notifyAudioDrained();
      }
      // 케이가 실제로 말을 완전히 마친 시점(오디오 큐 비움) — speaking_k였다면 다음 아이
      // 발화를 받을 수 있는 awaiting_child로 되돌린다.
      if (missionStateRef.current === "active" && turnPhaseRef.current === "speaking_k") {
        turnPhaseRef.current = "awaiting_child";
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
      if (turnPhaseRef.current === "speaking_k") return; // 이미 재질문 재생 중 — 중복 방지
      turnPhaseRef.current = "speaking_k";
      live.speakAsK("잘 못 들었어. 다시 한번 말해줄래?");
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
        liveRef.current?.appendTurn({ role: "k", text: MISSION_CLOSING_LINE });
        saveMessage("k", MISSION_CLOSING_LINE);
        await playClosingLineViaTts(MISSION_CLOSING_LINE, sessionIdRef.current);
      },
      onLog: (event, fields) => console.log(`[MissionFlow] ${event}`, fields ?? {}),
    });
  }

  const isLiveMode = voiceMode === "live";

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

  getTranscriptRef.current = voice.getTranscript;

  const [autoStartFailed, setAutoStartFailed] = useState(false);
  const hasAutoStartedRef = useRef(false);

  // 자동 모드일 때 첫 진입 시 자동으로 Live 음성 세션 시작
  useEffect(() => {
    if (
      isLiveMode &&
      phase === "ready" &&
      mode === "voice" &&
      isAuto &&
      voice.status !== "live" &&
      voice.status !== "connecting" &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      void voice.startSession();
    }
  }, [isLiveMode, phase, mode, isAuto, voice.status, voice]);

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
      live.speakAsK(textToSpeak);
    } else {
      void sttTts.speak(textToSpeak); // voiceName 생략 — 서버 기본값(ko-KR-Wavenet-A) 사용
    }
  }, [isLiveMode, live, sttTts]);
  askQuestionRef.current = askQuestion;

  const switchToText = useCallback(() => {
    if (isRecordingRef.current) {
      live.sendActivityEnd();
      live.setAudioMuted(false);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
    setMode("text");
    voice.setMicEnabled(false);
  }, [voice, live]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    voice.setMicEnabled(true);
  }, [voice]);

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    voice.sendTypedText(text);
  }, [textInput, voice]);

  const handleClose = useCallback(() => {
    voice.stopSession();
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

    let cancelled = false;
    (async () => {
      const hour = getKstHour();
      const qpRound = searchParams.get("roundType") as RoundType | null;

      // 운영시간 게이트 on/off — 서버 환경변수 CHILD_TIME_RESTRICTIONS_ENABLED로 제어(기본 true=
      // 기존 제한 정상 적용). false면 게이트 결과가 null이어도 "common" 라운드로 대체해 언제든
      // 미션을 시작할 수 있게 한다. 게이트 로직(getKstHour/currentRound) 자체는 그대로 유지 —
      // 이 스위치는 "적용 여부"만 바꾼다. 조회 실패 시 안전하게 기존 제한(true)을 유지한다.
      let timeRestrictionsEnabled = true;
      try {
        const cfgRes = await fetch("/api/config/child-time-restrictions");
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (typeof cfg.enabled === "boolean") timeRestrictionsEnabled = cfg.enabled;
        }
      } catch {
        // 조회 실패 — 기본값(true, 기존 제한 유지)으로 안전하게 진행
      }
      if (cancelled) return;

      const round: RoundType | null =
        qpRound ?? currentRound(hour) ?? (!timeRestrictionsEnabled ? "common" : null);
      if (!round) {
        setPhase("closed");
        return;
      }

      try {
        const res = await fetch("/api/mission/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId: cid, roundType: round }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(data.error ?? "미션을 시작하지 못했어요");
          setPhase("error");
          return;
        }
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        const qs: MissionQuestion[] = data.questions ?? [];

        if (data.resumed) {
          // 이어하기 — 오프닝 인사말을 다시 덮어쓰지 않고(이미 지나간 질문일 수 있음),
          // 서버가 갖고 있던 진행상태·게이지를 그대로 복원한다.
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
            qs[0].question_text = "안녕~ 난 케이야. 넌 이름이 뭐니?";
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
          const msgRes = await fetch(`/api/chat/messages?sessionId=${data.sessionId}`);
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            const past: Turn[] = (msgData.messages ?? []).map(
              (m: { role: "child" | "k"; content: string }) => ({ role: m.role, text: m.content })
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

  // Live 모드가 활성화될 때 interactionMode 설정 동기화
  useEffect(() => {
    if (voice.status === "live") {
      live.setInteractionMode(isAuto ? "auto" : "manual");
    }
  }, [voice.status, isAuto, live.setInteractionMode]);

  const handleModeChange = useCallback((newMode: "auto" | "manual") => {
    if (newMode === "auto") {
      // 수동 발화(녹음) 중이었다면 안전하게 activityEnd 선전송
      if (isRecordingRef.current) {
        live.sendActivityEnd();
        live.setAudioMuted(false);
        setIsRecording(false);
        isRecordingRef.current = false;
      }
      live.setInteractionMode("auto");
      setIsAuto(true);
    } else {
      live.setInteractionMode("manual");
      setIsAuto(false);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, [live]);

  const handleCentralButtonClick = useCallback(() => {
    if (!isRecordingRef.current) {
      // 첫 클릭: K가 말하는 중이면 오디오 재생 즉시 중단 후 activityStart
      live.setAudioMuted(true);
      const success = live.sendActivityStart();
      if (!success) {
        live.setAudioMuted(false);
        return;
      }
      setIsRecording(true);
      isRecordingRef.current = true;
      recordingStartedAtRef.current = Date.now();
    } else {
      // 두 번째 클릭: 최소 500ms 종료 경계 보호
      if (Date.now() - recordingStartedAtRef.current < 500) {
        console.log("[CentralButton] Click within 500ms limit - ignored.");
        return;
      }
      live.sendActivityEnd();
      live.setAudioMuted(false);
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
  }, [live]);



  // 과거 대화(chat_messages) 스크롤백 채워넣기 — 세션이 live가 된 직후 1회만 실행.
  // startSession()이 자체적으로 transcript를 비우므로 그 이전에 넣으면 소용없다.
  useEffect(() => {
    if (voice.status === "live" && !pastMessagesSeededRef.current) {
      pastMessagesSeededRef.current = true;
      if (pastMessagesRef.current.length > 0) {
        voice.seedTranscript(pastMessagesRef.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.status]);

  // 세션 시작 후 최초 1회만 첫 질문을 묻는다. 이후 질문은 handleTurnComplete에서
  // 답변 처리 완료 시점에 askQuestionRef를 통해 직접 트리거된다(ref 변화는 effect를
  // 재실행시키지 않으므로, "다음 질문"을 이 effect가 알아채길 기다리면 안 됨).
  useEffect(() => {
    if (voice.status !== "live" || missionState !== "active") return;
    if (askedIndexRef.current !== -1) return;
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
          onClick={() => router.replace("/child/home")}
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
          onClick={() => router.replace("/child/home")}
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
          onClick={() => router.replace("/child/home")}
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
  const missionPercent = progressPercent;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
      {/* 상단 고정 영역: 헤더 + 진행률 게이지 + 마스코트 (스크롤되지 않음) */}
      <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
        <div className="flex items-center justify-center px-4 pt-3 pb-1">
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
          <p className="text-xs font-bold text-center" style={{ color: "#1a6b5a" }}>
            미션 진행 {missionPercent}% ({gauge}/{requiredCount})
          </p>
          <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${missionPercent}%`,
                background: "linear-gradient(90deg, #1a6b5a 0%, #2a8a72 100%)",
              }}
            />
          </div>
        </div>

        <div className="relative flex justify-center items-center mb-2">
          <Image
            src="/Images/mascot/mascot-standing.png"
            alt="케이 마스코트"
            width={96}
            height={96}
            className="object-contain"
            priority
          />
          {isLiveMode && !isDone && (
            <div className="absolute left-[calc(50%+52px)] top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-full border border-gray-200 shadow-inner shrink-0 z-10">
              <button
                onClick={() => handleModeChange("auto")}
                aria-pressed={isAuto}
                aria-label="자동으로 말하기"
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all duration-300 ease-out cursor-pointer ${
                  isAuto
                    ? "bg-[#1a6b5a] text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                자동
              </button>
              <button
                onClick={() => handleModeChange("manual")}
                aria-pressed={!isAuto}
                aria-label="버튼 눌러 말하기"
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all duration-300 ease-out cursor-pointer ${
                  !isAuto
                    ? "bg-[#1a6b5a] text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                수동
              </button>
            </div>
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
          voice.transcript.map((turn, i) => (
            <div
              key={i}
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
        {voice.interimChildText && (
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

      {/* 하단 버튼 바 */}
      {mode === "voice" ? (
        <div className="flex items-center justify-center gap-8 py-5 shrink-0 bg-white border-t border-gray-50">
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
                <button
                  ref={buttonRef}
                  onClick={handleCentralButtonClick}
                  className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md active:scale-95 cursor-pointer transition-all duration-75 ${
                    isRecording
                      ? "bg-gradient-to-br from-orange-400 to-orange-500"
                      : "bg-[#e8845a]"
                  }`}
                  aria-label={isRecording ? "말하기 완료" : "말하기 시작"}
                >
                  {isRecording ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    <span className="text-2xl">🎤</span>
                  )}
                </button>
              </div>
            )
          )}

          {!isLive && !isConnecting && !isDone && (!isAuto || autoStartFailed) && (
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

          {isDone && (
            <button
              onClick={() => router.replace("/child/home")}
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
        <div className="flex items-center gap-2 py-3 px-3 shrink-0 bg-white border-t border-gray-50">
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
            disabled={isDone}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
            maxLength={200}
          />
          <button
            onClick={handleSendText}
            disabled={isDone || !textInput.trim()}
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

      <RealChildNav active="미션" />
    </div>
  );
}

export default function ChildMissionsPage() {
  return (
    <Suspense fallback={null}>
      <DemoFrame>
        <MissionInner />
      </DemoFrame>
    </Suspense>
  );
}
