"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import {
  MissionConversationLayout,
  type MissionTranscriptTurn,
} from "@/components/MissionConversationLayout";
import { useGeminiLive, type Turn as GeminiLiveTurn } from "@/hooks/useGeminiLive";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { useVoiceChat, type Turn as VoiceChatTurn } from "@/hooks/useVoiceChat";

type VoiceMode = "live" | "stt_tts";
type ScreenPhase = "loading" | "active" | "blocked" | "error" | "terminal";
type TerminalReason = "completed" | "safety_paused" | "early_ended";
type EntryStatus = "ready_to_start" | "ready_to_resume" | "starting" | "resuming" | "active";

interface StartResponse {
  resumed: boolean;
  sessionId: string;
  voiceMode: VoiceMode;
  liveVoiceName: string;
  givenName: string | null;
}

interface TurnResponse {
  kMessage: string;
  completed: boolean;
  safetyPaused: boolean;
  earlyEnded: boolean;
  rewardStatus: string;
}

interface PendingTurn {
  sessionId: string;
  clientTurnId: string;
  answerText: string;
  voiceMode: VoiceMode;
  displaySequence: number;
}

interface MissionV3ConversationProps {
  childId: string;
  onTextModeChange?: (isTextMode: boolean) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const getResponseMessage = (value: unknown, fallback: string): string => {
  if (!isRecord(value) || typeof value.error !== "string" || !value.error.trim()) return fallback;
  return value.error.trim();
};

const getBlockedMessage = (value: unknown): string => {
  if (!isRecord(value)) return "지금은 미션을 시작할 수 없어요.";
  switch (value.reason) {
    case "before_open":
      return "아직 오늘의 미션 시간이 아니야. 조금 뒤에 다시 만나자!";
    case "closed":
      return "오늘의 미션 시간은 끝났어. 내일 다시 이야기하자!";
    case "daily_limit_reached":
      return "오늘 미션은 이미 잘 마쳤어. 내일 또 만나자!";
    default:
      return getResponseMessage(value, "지금은 미션을 시작할 수 없어요.");
  }
};

const readStartResponse = (value: unknown): StartResponse | null => {
  if (!isRecord(value)
    || typeof value.sessionId !== "string"
    || (value.voiceMode !== "live" && value.voiceMode !== "stt_tts")) {
    return null;
  }
  return {
    resumed: value.resumed === true,
    sessionId: value.sessionId,
    voiceMode: value.voiceMode,
    liveVoiceName: typeof value.liveVoiceName === "string" && value.liveVoiceName.trim()
      ? value.liveVoiceName
      : "Achernar",
    givenName: typeof value.givenName === "string" ? value.givenName : null,
  };
};

const readTurnResponse = (value: unknown): TurnResponse | null => {
  if (!isRecord(value) || typeof value.kMessage !== "string" || !value.kMessage.trim()) return null;
  return {
    kMessage: value.kMessage.trim(),
    completed: value.completed === true,
    safetyPaused: value.safetyPaused === true,
    earlyEnded: value.earlyEnded === true,
    rewardStatus: typeof value.rewardStatus === "string" ? value.rewardStatus : "none",
  };
};

const readRestoredTurns = (value: unknown): MissionTranscriptTurn[] => {
  if (!isRecord(value) || !Array.isArray(value.messages)) return [];
  return value.messages.flatMap((message, index) => {
    if (!isRecord(message)
      || (message.role !== "child" && message.role !== "k")
      || typeof message.content !== "string"
      || !message.content.trim()
      || (typeof message.turn_status === "string" && message.turn_status !== "finalized")) {
      return [];
    }
    const id = typeof message.turn_id === "string" && message.turn_id
      ? message.turn_id
      : `restored-${index}`;
    return [{ id, role: message.role, text: message.content.trim() }];
  });
};

const readNextDisplaySequence = (value: unknown): number => {
  if (!isRecord(value) || !Array.isArray(value.messages)) return 0;
  const sequences = value.messages.flatMap((message) => {
    if (!isRecord(message) || typeof message.display_sequence !== "number") {
      return [];
    }
    return [message.display_sequence];
  });
  return sequences.length > 0 ? Math.max(...sequences) + 1 : 0;
};

const getTerminalReason = (value: unknown): TerminalReason => {
  if (isRecord(value) && value.status === "COMPLETED") return "completed";
  if (isRecord(value) && value.status === "SAFETY_PAUSED") return "safety_paused";
  return "early_ended";
};

const getTerminalMessage = (reason: TerminalReason): string => {
  if (reason === "completed") return "오늘 미션은 이미 잘 마쳤어!";
  if (reason === "safety_paused") return "오늘은 잠시 쉬어가자.";
  return "오늘 이야기는 여기까지야. 다음에 다시 만나자!";
};

export function MissionV3Conversation({ childId, onTextModeChange }: MissionV3ConversationProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [entryStatus, setEntryStatus] = useState<EntryStatus>("ready_to_start");
  const [retryKey, setRetryKey] = useState(0);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("stt_tts");
  const [liveVoiceName, setLiveVoiceName] = useState("Achernar");
  const [turns, setTurns] = useState<MissionTranscriptTurn[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isTextMode, setIsTextMode] = useState(false);
  const [isAuto, setIsAuto] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoListening, setIsAutoListening] = useState(false);
  const [isLiveKSpeaking, setIsLiveKSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [blockedMessage, setBlockedMessage] = useState("");
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [terminalReason, setTerminalReason] = useState<TerminalReason>("completed");
  const [terminalKMessage, setTerminalKMessage] = useState("");
  const [rewardStatus, setRewardStatus] = useState("none");
  const [micPermission, setMicPermission] = useState<PermissionState | "checking">("checking");

  const sessionIdRef = useRef<string | null>(null);
  const voiceModeRef = useRef<VoiceMode>("stt_tts");
  const displaySequenceRef = useRef(0);
  const localTurnIdRef = useRef(0);
  const isAutoRef = useRef(true);
  const isTextModeRef = useRef(false);
  const isMutedRef = useRef(false);
  const phaseRef = useRef<ScreenPhase>("loading");
  const turnInFlightRef = useRef(false);
  const initialKMessageRef = useRef("");
  const activeTurnAbortRef = useRef<AbortController | null>(null);
  const submitAnswerRef = useRef<(text: string) => void>(() => undefined);
  const liveRef = useRef<ReturnType<typeof useGeminiLive> | null>(null);
  const sttTtsRef = useRef<ReturnType<typeof useVoiceChat> | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { isAutoRef.current = isAuto; }, [isAuto]);
  useEffect(() => { isTextModeRef.current = isTextMode; }, [isTextMode]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { onTextModeChange?.(isTextMode); }, [isTextMode, onTextModeChange]);

  const appendTurn = useCallback((role: "child" | "k", text: string) => {
    localTurnIdRef.current += 1;
    const nextTurn = { id: `v3-${localTurnIdRef.current}`, role, text };
    setTurns((current) => [...current, nextTurn]);
  }, []);

  const handleSttTurnComplete = useCallback((turn: VoiceChatTurn) => {
    if (turn.role === "child") submitAnswerRef.current(turn.text);
  }, []);

  const handleLiveTurnComplete = useCallback((turn: GeminiLiveTurn) => {
    if (turn.role === "child") submitAnswerRef.current(turn.text);
  }, []);

  const sttTts = useVoiceChat({
    onTurnComplete: handleSttTurnComplete,
    getSessionId: () => sessionIdRef.current,
    onSpeechBegin: () => {
      if (voiceModeRef.current === "stt_tts" && isAutoRef.current) setIsAutoListening(true);
    },
    onSpeechEnd: () => setIsAutoListening(false),
    onEmptyAudio: () => setErrorMessage("목소리를 잘 못 들었어. 천천히 다시 말해 줄래?"),
    onSttFailed: () => setErrorMessage("목소리를 알아듣지 못했어. 다시 말하거나 글로 적어 줘."),
  });
  const live = useGeminiLive({
    onTurnComplete: handleLiveTurnComplete,
    canAcceptTypedInput: () => phaseRef.current === "active" && !turnInFlightRef.current,
    voiceName: liveVoiceName,
    sttMode: "gcp",
    enableNoAudioInputDetection: true,
    getSessionId: () => sessionIdRef.current,
    getChildId: () => childId,
    onAudioQueueDrained: () => {
      setIsLiveKSpeaking(false);
      liveRef.current?.setKSpeechAllowed(false);
      if (phaseRef.current === "active"
        && isAutoRef.current
        && !isTextModeRef.current
        && !turnInFlightRef.current) {
        liveRef.current?.setMicEnabled(true);
      }
    },
    onKTurnFirstOutput: () => setIsLiveKSpeaking(true),
    onKTurnTimeout: () => {
      setIsLiveKSpeaking(false);
      setErrorMessage("케이의 목소리 연결이 잠깐 끊겼어. 다시 시도해 줘.");
    },
    onTranscriptRejected: () => setErrorMessage("목소리를 잘 못 들었어. 천천히 다시 말해 줄래?"),
  });
  useEffect(() => { sttTtsRef.current = sttTts; }, [sttTts]);
  useEffect(() => { liveRef.current = live; }, [live]);

  const sessionIsLive = voiceMode === "live" ? live.status === "live" : sttTts.status === "live";
  const wakeLockWarning = useScreenWakeLock(phase === "active" && sessionIsLive);

  useEffect(() => {
    if (!navigator.permissions?.query) {
      setMicPermission("prompt");
      return;
    }
    let active = true;
    navigator.permissions.query({ name: "microphone" as PermissionName })
      .then((permission) => {
        if (!active) return;
        setMicPermission(permission.state);
        permission.onchange = () => setMicPermission(permission.state);
      })
      .catch(() => { if (active) setMicPermission("prompt"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPhase("loading");
    setErrorMessage("");
    setBlockedMessage("");
    setPendingTurn(null);
    turnInFlightRef.current = false;
    initialKMessageRef.current = "";

    const startMission = async () => {
      try {
        const response = await fetch("/api/mission/v3/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId }),
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          if (response.status === 403 || response.status === 409) {
            setBlockedMessage(getBlockedMessage(body));
            setPhase("blocked");
          } else {
            setErrorMessage(getResponseMessage(body, "미션을 준비하지 못했어요."));
            setPhase("error");
          }
          return;
        }

        const data = readStartResponse(body);
        if (!data) {
          setErrorMessage("미션 정보를 올바르게 불러오지 못했어요.");
          setPhase("error");
          return;
        }

        sessionIdRef.current = data.sessionId;
        voiceModeRef.current = data.voiceMode;
        setVoiceMode(data.voiceMode);
        setLiveVoiceName(data.liveVoiceName);

        let restoredTurns: MissionTranscriptTurn[] = [];
        if (data.resumed) {
          try {
            const historyResponse = await fetch(
              `/api/chat/messages?sessionId=${encodeURIComponent(data.sessionId)}`,
              { signal: controller.signal },
            );
            if (historyResponse.ok) {
              const historyBody: unknown = await historyResponse.json().catch(() => null);
              if (!active) return;
              restoredTurns = readRestoredTurns(historyBody);
              displaySequenceRef.current = readNextDisplaySequence(historyBody);
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            console.error("[MissionV3Conversation] 이전 대화 복원 실패, 새 화면으로 계속합니다.", error);
          }
        } else {
          displaySequenceRef.current = 0;
        }

        if (!active) return;
        if (restoredTurns.length > 0) {
          localTurnIdRef.current = restoredTurns.length;
          setTurns(restoredTurns);
          initialKMessageRef.current = [...restoredTurns].reverse().find((turn) => turn.role === "k")?.text ?? "";
        } else {
          const greeting = data.givenName
            ? `${data.givenName}, 안녕! 오늘 있었던 이야기를 편하게 들려줄래?`
            : "안녕! 오늘 있었던 이야기를 편하게 들려줄래?";
          localTurnIdRef.current = 1;
          setTurns([{ id: "v3-1", role: "k", text: greeting }]);
          initialKMessageRef.current = greeting;
        }
        setEntryStatus(data.resumed ? "ready_to_resume" : "ready_to_start");
        setPhase("active");
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        console.error("[MissionV3Conversation] 미션 시작 실패", error);
        setErrorMessage("미션을 준비하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
        setPhase("error");
      }
    };

    void startMission();
    return () => {
      active = false;
      controller.abort();
    };
  }, [childId, retryKey]);

  useEffect(() => {
    return () => {
      activeTurnAbortRef.current?.abort();
      liveRef.current?.stopSession();
      sttTtsRef.current?.stopSession();
    };
  }, []);

  const restoreInputAfterResponse = useCallback(() => {
    if (phaseRef.current !== "active" || isTextModeRef.current || !isAutoRef.current) return;
    if (voiceModeRef.current === "live") liveRef.current?.setMicEnabled(true);
    else sttTtsRef.current?.setMicEnabled(true);
  }, []);

  const presentKResponse = useCallback(async (text: string, terminal: boolean) => {
    if (isMutedRef.current || isTextModeRef.current) {
      if (!terminal) restoreInputAfterResponse();
      return;
    }
    if (voiceModeRef.current === "live" && liveRef.current?.status === "live") {
      liveRef.current.setKSpeechAllowed(true);
      if (terminal) liveRef.current.lockNow();
      const spoken = terminal ? liveRef.current.speakClosingLine(text) : liveRef.current.speakAsK(text);
      if (!spoken && !terminal) restoreInputAfterResponse();
      return;
    }
    if (voiceModeRef.current === "stt_tts" && sttTtsRef.current?.status === "live") {
      await sttTtsRef.current.speak(text);
      if (terminal) sttTtsRef.current.stopSession();
      else restoreInputAfterResponse();
      return;
    }
    if (!terminal) restoreInputAfterResponse();
  }, [restoreInputAfterResponse]);

  const sendTurn = useCallback(async (turn: PendingTurn) => {
    if (turnInFlightRef.current || phaseRef.current !== "active") return;
    turnInFlightRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");
    setPendingTurn(turn);
    setIsAutoListening(false);
    liveRef.current?.setMicEnabled(false);
    sttTtsRef.current?.setMicEnabled(false);

    const controller = new AbortController();
    activeTurnAbortRef.current = controller;
    try {
      const response = await fetch("/api/mission/v3/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(turn),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 423) {
          const reason = getTerminalReason(body);
          const message = getTerminalMessage(reason);
          phaseRef.current = "terminal";
          setPendingTurn(null);
          setTerminalReason(reason);
          setTerminalKMessage(message);
          setRewardStatus("none");
          setPhase("terminal");
          liveRef.current?.setMicEnabled(false);
          sttTtsRef.current?.setMicEnabled(false);
          return;
        }
        setErrorMessage(getResponseMessage(body, "대화를 보내지 못했어요. 다시 시도해 주세요."));
        return;
      }
      const data = readTurnResponse(body);
      if (!data) {
        setErrorMessage("케이의 답변을 불러오지 못했어요. 다시 시도해 주세요.");
        return;
      }

      setPendingTurn(null);
      appendTurn("k", data.kMessage);
      const nextTerminalReason: TerminalReason | null = data.completed
        ? "completed"
        : data.safetyPaused
          ? "safety_paused"
          : data.earlyEnded
            ? "early_ended"
            : null;

      if (nextTerminalReason) {
        phaseRef.current = "terminal";
        setTerminalReason(nextTerminalReason);
        setTerminalKMessage(data.kMessage);
        setRewardStatus(data.rewardStatus);
        setPhase("terminal");
        liveRef.current?.setMicEnabled(false);
        sttTtsRef.current?.setMicEnabled(false);
        void presentKResponse(data.kMessage, true);
      } else {
        void presentKResponse(data.kMessage, false);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[MissionV3Conversation] 턴 제출 실패", error);
      setErrorMessage("대화를 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      activeTurnAbortRef.current = null;
      turnInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, [appendTurn, presentKResponse]);

  const submitAnswer = useCallback((rawText: string) => {
    const answerText = rawText.trim();
    const currentSessionId = sessionIdRef.current;
    if (!answerText || !currentSessionId || turnInFlightRef.current || phaseRef.current !== "active") return;
    if (answerText.length > 500) {
      setPendingTurn(null);
      setErrorMessage("이야기가 조금 길어졌어. 500자보다 짧게 나누어 말해 줄래?");
      return;
    }
    const turn: PendingTurn = {
      sessionId: currentSessionId,
      clientTurnId: crypto.randomUUID(),
      answerText,
      voiceMode: voiceModeRef.current,
      displaySequence: displaySequenceRef.current,
    };
    displaySequenceRef.current += 2;
    appendTurn("child", answerText);
    void sendTurn(turn);
  }, [appendTurn, sendTurn]);
  useEffect(() => { submitAnswerRef.current = submitAnswer; }, [submitAnswer]);

  const startVoiceSession = useCallback(async () => {
    setErrorMessage("");
    const initialKMessage = initialKMessageRef.current;
    if (voiceModeRef.current === "live") {
      live.setInteractionMode(isAutoRef.current ? "auto" : "manual");
      await live.unlockAudio();
      await live.startSession();
      live.setMicEnabled(false);
      if (initialKMessage && !isMutedRef.current && !isTextModeRef.current) {
        live.setKSpeechAllowed(true);
        const spoken = live.speakAsK(initialKMessage);
        if (spoken) initialKMessageRef.current = "";
        else live.setMicEnabled(isAutoRef.current);
      } else {
        live.setMicEnabled(isAutoRef.current && !isTextModeRef.current);
      }
    } else {
      sttTts.setInputMode(isAutoRef.current ? "auto" : "manual");
      await sttTts.startSession();
      sttTts.setMicEnabled(false);
      if (initialKMessage && !isMutedRef.current && !isTextModeRef.current) {
        await sttTts.speak(initialKMessage);
        initialKMessageRef.current = "";
      }
      sttTts.setMicEnabled(isAutoRef.current && !isTextModeRef.current);
    }
  }, [live, sttTts]);

  const handleEnterConversation = useCallback(async () => {
    const resuming = entryStatus === "ready_to_resume";
    setEntryStatus(resuming ? "resuming" : "starting");
    if (!isTextModeRef.current) await startVoiceSession();
    setEntryStatus("active");
  }, [entryStatus, startVoiceSession]);

  const handleMicClick = useCallback(() => {
    const selectedStatus = voiceModeRef.current === "live" ? live.status : sttTts.status;
    if (selectedStatus !== "live") {
      void startVoiceSession();
      return;
    }
    if (isAutoRef.current) {
      if (voiceModeRef.current === "live") live.setMicEnabled(true);
      else sttTts.setMicEnabled(true);
      return;
    }
    if (!isRecording) {
      const started = voiceModeRef.current === "live"
        ? live.sendActivityStart()
        : (sttTts.setMicEnabled(true), true);
      if (started) setIsRecording(true);
      return;
    }
    if (voiceModeRef.current === "live") live.sendActivityEnd();
    else sttTts.manualFinalize();
    if (voiceModeRef.current === "stt_tts") sttTts.setMicEnabled(false);
    setIsRecording(false);
  }, [isRecording, live, startVoiceSession, sttTts]);

  const handleModeChange = useCallback((mode: "auto" | "manual") => {
    if (isRecording || isSubmitting) return;
    const auto = mode === "auto";
    setIsAuto(auto);
    isAutoRef.current = auto;
    if (voiceModeRef.current === "live") {
      live.setInteractionMode(mode);
      live.setMicEnabled(auto && live.status === "live" && !isTextModeRef.current);
    } else {
      sttTts.setInputMode(mode);
      sttTts.setMicEnabled(auto && sttTts.status === "live" && !isTextModeRef.current);
    }
  }, [isRecording, isSubmitting, live, sttTts]);

  const handleToggleTextMode = useCallback(() => {
    if (isRecording || isSubmitting) return;
    const next = !isTextModeRef.current;
    isTextModeRef.current = next;
    setIsTextMode(next);
    if (voiceModeRef.current === "live") live.setMicEnabled(!next && isAutoRef.current);
    else sttTts.setMicEnabled(!next && isAutoRef.current);
  }, [isRecording, isSubmitting, live, sttTts]);

  const handleSendText = useCallback(() => {
    const value = textInput.trim();
    if (!value || isSubmitting || entryStatus !== "active") return;
    setTextInput("");
    submitAnswer(value);
  }, [entryStatus, isSubmitting, submitAnswer, textInput]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((current) => {
      const next = !current;
      isMutedRef.current = next;
      live.setAudioMuted(next);
      if (next) sttTts.stopSpeaking();
      return next;
    });
  }, [live, sttTts]);

  const handleClose = useCallback(() => {
    live.stopSession();
    sttTts.stopSession();
    router.replace("/child/home");
  }, [live, router, sttTts]);

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-k-surface)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-transparent border-r-[var(--color-k-orange)] border-t-[var(--color-k-orange)]" />
      </div>
    );
  }

  if (phase === "blocked" || phase === "error") {
    const message = phase === "blocked" ? blockedMessage : errorMessage;
    return (
      <div className="flex h-full min-h-[100dvh] flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#D8EEFF] via-[#F4F7F5] to-[#FFF4E6] px-8 text-center">
        <KBestieMascotAnimation state="idle" size={140} />
        <p className="max-w-[320px] whitespace-pre-wrap text-[19px] font-bold leading-relaxed text-[#3a2f2a]">
          {message}
        </p>
        <div className="flex gap-3">
          {phase === "error" && (
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="rounded-2xl bg-[var(--color-k-orange)] px-5 py-3 text-sm font-bold text-white active:scale-95"
            >
              다시 시도
            </button>
          )}
          <button
            type="button"
            onClick={() => router.replace("/child/home")}
            className="rounded-2xl bg-[var(--color-k-navy)] px-5 py-3 text-sm font-bold text-white active:scale-95"
          >
            홈으로 가기
          </button>
        </div>
      </div>
    );
  }

  if (phase === "terminal") {
    const rewarded = terminalReason === "completed"
      && (rewardStatus === "awarded" || rewardStatus === "already_rewarded");
    const title = terminalReason === "completed"
      ? "짝짝짝, 오늘 이야기 잘 나눴어!"
      : terminalReason === "safety_paused"
        ? "오늘은 잠시 쉬어가자."
        : "오늘 이야기는 여기까지!";
    return (
      <div className="flex h-full min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-[#D8EEFF] via-[#FFF8E8] to-[#FFE8C8] px-7 text-center">
        <div className="mb-5 flex h-28 w-28 items-center justify-center rounded-full bg-white/90 text-6xl shadow-[0_10px_30px_rgba(211,139,38,0.25)] motion-safe:animate-bounce" aria-hidden="true">
          {rewarded ? "🔑" : "⭐"}
        </div>
        <h1 className="text-[24px] font-extrabold leading-relaxed text-[var(--color-k-navy)]">{title}</h1>
        {terminalKMessage && (
          <p className="mt-3 max-w-[340px] rounded-3xl bg-white/85 px-5 py-4 text-[16px] font-semibold leading-relaxed text-[#4B5563] shadow-sm">
            {terminalKMessage}
          </p>
        )}
        {rewarded && (
          <p className="mt-4 text-[17px] font-bold text-[#A8521F]">황금열쇠가 선물 상자에 쏙 들어갔어!</p>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="mt-7 rounded-full bg-[var(--color-k-navy)] px-8 py-3.5 text-[16px] font-bold text-white shadow-md active:scale-95"
        >
          홈으로 가기
        </button>
      </div>
    );
  }

  const selectedStatus = voiceMode === "live" ? live.status : sttTts.status;
  const selectedIsSpeaking = voiceMode === "live"
    ? isLiveKSpeaking
    : sttTts.isSpeaking;
  const selectedInterimText = voiceMode === "live" ? live.interimChildText : sttTts.interimChildText;
  const voiceState = isSubmitting
    ? "thinking"
    : selectedStatus === "connecting"
      ? "connecting"
      : selectedStatus === "error"
        ? "error"
        : selectedIsSpeaking
          ? "speaking"
          : isRecording || isAutoListening || (voiceMode === "live" && live.autoSpeechState === "active")
            ? "listening"
            : selectedStatus === "live"
              ? "listening"
              : "idle";
  const activeTurn = turns.at(-1) ?? null;
  const history = activeTurn ? turns.slice(0, -1) : turns;
  const childTurnCount = turns.filter((turn) => turn.role === "child").length;

  return (
    <>
      {wakeLockWarning && (
        <div className="pointer-events-none absolute left-0 right-0 top-20 z-[60] flex justify-center">
          <div className="rounded-full bg-gray-800/80 px-4 py-2 text-xs text-white">기기 설정으로 화면이 꺼질 수 있어요</div>
        </div>
      )}
      {errorMessage && (
        <div className="absolute left-1/2 top-[116px] z-[70] flex w-[min(88%,380px)] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm font-semibold text-red-700 shadow-lg">
          <span>{errorMessage}</span>
          {pendingTurn && (
            <button
              type="button"
              onClick={() => void sendTurn(pendingTurn)}
              disabled={isSubmitting}
              className="shrink-0 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              다시 시도
            </button>
          )}
        </div>
      )}
      {micPermission === "denied" && !isTextMode && (
        <div className="absolute left-1/2 top-[172px] z-[65] w-[min(84%,350px)] -translate-x-1/2 rounded-2xl bg-white/95 px-4 py-3 text-center text-sm font-semibold text-[#6B4F3A] shadow-md">
          마이크 권한을 허용하거나 키보드로 이야기해 줘.
        </div>
      )}
      {voiceMode === "live" && live.audioLocked && selectedStatus === "live" && !isTextMode && (
        <div className="absolute left-1/2 top-[172px] z-[66] w-[min(84%,350px)] -translate-x-1/2">
          <button
            type="button"
            onClick={() => void live.unlockAudio()}
            className="w-full rounded-2xl bg-[var(--color-k-orange)] px-4 py-3 text-sm font-bold text-white shadow-md active:scale-95"
          >
            🔊 케이 목소리 켜기
          </button>
        </div>
      )}
      <MissionConversationLayout
        onClose={handleClose}
        progressCurrent={Math.min(childTurnCount + 1, 6)}
        progressTotal={6}
        progressDisplay="ambient"
        history={history}
        activeTurn={activeTurn}
        interimChildText={selectedInterimText}
        voiceState={voiceState}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        isAuto={isAuto}
        onChangeMode={handleModeChange}
        isRecording={isRecording}
        isMicDisabled={entryStatus !== "active" || isSubmitting || selectedStatus === "connecting"}
        onMicClick={handleMicClick}
        textInput={textInput}
        onChangeTextInput={setTextInput}
        onSendText={handleSendText}
        isTextMode={isTextMode}
        onToggleTextMode={handleToggleTextMode}
        hasError={Boolean(errorMessage)}
        entryStatus={entryStatus}
        onStartMission={() => void handleEnterConversation()}
        onResumeMission={() => void handleEnterConversation()}
        onExitBeforeStart={handleClose}
      />
    </>
  );
}
