"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import { SkeletonBox } from "@/components/Skeleton";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { getMissionRewardPresentation } from "@/lib/mission/missionRewardPresentation";
import {
  parseMissionEntrySnapshot,
  resolveMissionDestination,
  resolveMissionDisplay,
  type MissionDisplay,
} from "@/lib/mission-v3/clientEntry";
import type {
  MissionEntrySnapshot,
  MissionEntryState,
} from "@/lib/mission-v3/entryContract";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GoalProgressSummary {
  total: number;
  satisfied: number;
  partial: number;
  pending: number;
  declined: number;
  skipped: number;
  completionThreshold: number;
}

export interface MissionV3StartSuccessData {
  resumed: boolean;
  sessionId: string;
  policyVersion: "v3_single_daily";
  effectiveAt: string | null;
  businessDate: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED" | string;
  completed: boolean;
  goalProgress: GoalProgressSummary | null;
  tier: string;
  voiceMode: "stt_tts" | "live";
  liveVoiceName: string | null;
  givenName: string | null;
  childContext: {
    childId: string;
    displayName: string;
    givenName: string | null;
    grade: number;
    knownProfileFacts: Record<string, unknown>;
  };
}

type V3MissionPhase =
  | "loading"
  | "completed"
  | "safety_paused"
  | "force_ended"
  | "before_open"
  | "closed"
  | "active"
  | "error";

type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function MissionV3Inner() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();

  const [phase, setPhase] = useState<V3MissionPhase>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [childId, setChildId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MissionEntrySnapshot | null>(null);
  const [displayInfo, setDisplayInfo] = useState<MissionDisplay | null>(null);
  const [sessionData, setSessionData] = useState<MissionV3StartSuccessData | null>(null);

  // U7 턴 상태 및 대화 관리
  const [currentKMessage, setCurrentKMessage] = useState<string>("");
  const [kMessageHistory, setKMessageHistory] = useState<string[]>([]);
  const [turnHistory, setTurnHistory] = useState<Array<{ id: string; role: "child" | "k"; text: string }>>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isTextMode, setIsTextMode] = useState<boolean>(false);
  const [textInput, setTextInput] = useState<string>("");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showRetryOverlay, setShowRetryOverlay] = useState<boolean>(false);
  const [retryErrorMsg, setRetryErrorMsg] = useState<string>("");

  // 완료 및 보상 상태 (U8)
  const [completed, setCompleted] = useState<boolean>(false);
  const [rewardStatus, setRewardStatus] = useState<string>("none");
  const [isRewardModalOpen, setIsRewardModalOpen] = useState<boolean>(false);
  const [hasClosedRewardModal, setHasClosedRewardModal] = useState<boolean>(false);
  const rewardCloseXBtnRef = useRef<HTMLButtonElement | null>(null);
  const rewardCloseBottomBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleCloseRewardModal = useCallback(() => {
    setIsRewardModalOpen(false);
    setHasClosedRewardModal(true);
    const sid = sessionDataRef.current?.sessionId;
    if (sid && typeof window !== "undefined") {
      try {
        sessionStorage.setItem(`k_reward_modal_closed:${sid}`, "1");
      } catch {}
    }
  }, []);

  const isMountedRef = useRef(true);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const sessionDataRef = useRef<MissionV3StartSuccessData | null>(null);
  sessionDataRef.current = sessionData;

  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;
  const isSpeakingRef = useRef(false);
  isSpeakingRef.current = isSpeaking;
  const isSubmittingRef = useRef(false);
  isSubmittingRef.current = isSubmitting;

  // 멱등 키 및 순번
  const activeClientTurnIdRef = useRef<string | null>(null);
  const lastSubmittedTextRef = useRef<string>("");
  const displaySequenceRef = useRef<number>(1);

  // Web Audio 재생 관리
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeAbortControllerRef.current?.abort();
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop();
        } catch {}
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  /**
   * TTS 재생 함수: 기존 app/child/missions/page.tsx:116-141 패턴 재사용
   */
  const playKMessageViaTts = useCallback(async (text: string, sid: string | null) => {
    if (isMutedRef.current || !text.trim()) return;
    try {
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop();
        } catch {}
        currentSourceRef.current = null;
      }

      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), sessionId: sid }),
      });

      if (!res.ok) return;
      const data = await res.json();
      if (!data.audioContent) return;

      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => {});
      }

      const audioBuffer = await audioCtxRef.current.decodeAudioData(
        base64ToArrayBuffer(data.audioContent)
      );
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtxRef.current.destination);
      currentSourceRef.current = source;

      setIsSpeaking(true);
      setVoiceState("speaking");

      await new Promise<void>((resolve) => {
        source.onended = () => {
          if (currentSourceRef.current === source) {
            currentSourceRef.current = null;
          }
          setIsSpeaking(false);
          setVoiceState("idle");
          resolve();
        };
        try {
          source.start();
        } catch {
          setIsSpeaking(false);
          setVoiceState("idle");
          resolve();
        }
      });
    } catch (err) {
      console.error("[TTS] 재생 실패", err);
      setIsSpeaking(false);
      setVoiceState("idle");
    }
  }, []);

  /**
   * 진입 절차:
   * 1. childId 확인 (searchParams -> localStorage -> /api/child/me)
   * 2. GET /api/mission/v3/today-progress?childId=... 호출 및 parseMissionEntrySnapshot 검증
   * 3. resolveMissionDestination / resolveMissionDisplay 로 상태 분기
   * 4. entryState 가 start / resume 인 경우 POST /api/mission/v3/start 호출하여 세션 확정
   */
  const initializeMission = useCallback(async () => {
    activeAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;
    const signal = abortController.signal;

    setPhase("loading");
    setErrorMsg("");

    // 1. childId 식별
    let cid = searchParams.get("childId")?.trim() || null;
    if (!cid && typeof window !== "undefined") {
      cid = localStorage.getItem("k_child_id");
    }

    if (!cid || !UUID_PATTERN.test(cid)) {
      try {
        const meRes = await fetch("/api/child/me", { signal });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData?.id && UUID_PATTERN.test(meData.id)) {
            cid = meData.id;
            if (typeof window !== "undefined") {
              localStorage.setItem("k_child_id", meData.id);
            }
          }
        }
      } catch (err) {
        if (signal.aborted) return;
      }
    }

    if (!cid || !UUID_PATTERN.test(cid)) {
      if (!isMountedRef.current || signal.aborted) return;
      setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
      setPhase("error");
      return;
    }

    setChildId(cid);

    // 2. snapshot 조회 및 parseMissionEntrySnapshot 검증
    let rawSnapshotData: unknown = null;
    try {
      const progressRes = await fetch(
        `/api/mission/v3/today-progress?childId=${encodeURIComponent(cid)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal,
        },
      );

      if (!progressRes.ok) {
        if (!isMountedRef.current || signal.aborted) return;
        setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
        setPhase("error");
        return;
      }

      rawSnapshotData = await progressRes.json();
    } catch (err) {
      if (!isMountedRef.current || signal.aborted) return;
      setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
      setPhase("error");
      return;
    }

    const validatedSnapshot = parseMissionEntrySnapshot(rawSnapshotData);
    if (!validatedSnapshot) {
      if (!isMountedRef.current || signal.aborted) return;
      setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
      setPhase("error");
      return;
    }

    setSnapshot(validatedSnapshot);
    const destination = resolveMissionDestination(validatedSnapshot);
    const display = resolveMissionDisplay(validatedSnapshot);
    setDisplayInfo(display);

    // 3. 목적지 화면 및 terminal/시간 분기
    if (destination.kind === "v2") {
      router.replace(`/child/missions?childId=${encodeURIComponent(cid)}`);
      return;
    }

    if (destination.kind === "blocked") {
      switch (validatedSnapshot.entryState) {
        case "completed":
          setCompleted(true);
          setRewardStatus("already_rewarded");
          setPhase("completed");
          return;
        case "safety_paused":
          setCompleted(false);
          setPhase("safety_paused");
          return;
        case "force_ended":
          setCompleted(false);
          setPhase("force_ended");
          return;
        case "before_open":
          setCompleted(false);
          setPhase("before_open");
          return;
        case "closed":
          setCompleted(false);
          setPhase("closed");
          return;
        case "unavailable":
        default:
          setCompleted(false);
          setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
          setPhase("error");
          return;
      }
    }

    // 4. entryState 가 start 또는 resume 인 경우: POST /api/mission/v3/start 호출
    try {
      const startRes = await fetch("/api/mission/v3/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ childId: cid }),
        signal,
      });

      if (!isMountedRef.current || signal.aborted) return;

      if (!startRes.ok) {
        let errJson: Record<string, unknown> | null = null;
        try {
          errJson = await startRes.json();
        } catch {
          // non-JSON response
        }

        // 403 처리
        if (startRes.status === 403) {
          if (
            errJson?.code === "MISSION_POLICY_CHANGED" ||
            errJson?.reason === "policy_not_effective"
          ) {
            router.replace("/child/home");
            return;
          }

          if (errJson?.reason === "before_open") {
            setCompleted(false);
            setPhase("before_open");
            return;
          }

          if (errJson?.reason === "closed") {
            setCompleted(false);
            setPhase("closed");
            return;
          }

          setCompleted(false);
          setErrorMsg(
            typeof errJson?.error === "string"
              ? errJson.error
              : "미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.",
          );
          setPhase("error");
          return;
        }

        // 409 처리 (daily_limit_reached -> terminal 분기)
        if (startRes.status === 409) {
          const terminalStatus = errJson?.status;
          if (terminalStatus === "COMPLETED") {
            setCompleted(true);
            setRewardStatus("already_rewarded");
            setPhase("completed");
            return;
          }
          if (terminalStatus === "SAFETY_PAUSED") {
            setCompleted(false);
            setPhase("safety_paused");
            return;
          }
          if (terminalStatus === "FORCE_ENDED") {
            setCompleted(false);
            setPhase("force_ended");
            return;
          }

          // 상태 구분이 불명확한 경우 다시 snapshot 검증
          const retryProgressRes = await fetch(
            `/api/mission/v3/today-progress?childId=${encodeURIComponent(cid)}`,
            { signal },
          );
          if (retryProgressRes.ok) {
            const retryRaw = await retryProgressRes.json();
            const retrySnapshot = parseMissionEntrySnapshot(retryRaw);
            if (retrySnapshot) {
              setSnapshot(retrySnapshot);
              setDisplayInfo(resolveMissionDisplay(retrySnapshot));
              if (retrySnapshot.entryState === "completed") {
                setCompleted(true);
                setRewardStatus("already_rewarded");
                setPhase("completed");
                return;
              }
              if (retrySnapshot.entryState === "safety_paused") {
                setCompleted(false);
                setPhase("safety_paused");
                return;
              }
              if (retrySnapshot.entryState === "force_ended") {
                setCompleted(false);
                setPhase("force_ended");
                return;
              }
            }
          }

          setCompleted(false);
          setErrorMsg("오늘 미션은 이미 마쳤어요.");
          setPhase("error");
          return;
        }

        // 500 등 기타 오류
        setErrorMsg("미션을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
        setPhase("error");
        return;
      }

      // 200 OK: 세션 상태 검증 및 분기
      const startData = (await startRes.json()) as MissionV3StartSuccessData;
      if (!startData || typeof startData !== "object") {
        setCompleted(false);
        setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
        setPhase("error");
        return;
      }

      // 불가능 조합 fail-closed 검사: completed: true인데 status !== "COMPLETED"
      if (startData.completed && startData.status !== "COMPLETED") {
        setCompleted(false);
        setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
        setPhase("error");
        return;
      }

      switch (startData.status) {
        case "IN_PROGRESS":
          setSessionData(startData);
          setPhase("active");
          break;
        case "COMPLETED":
          setCompleted(true);
          setRewardStatus("already_rewarded");
          setPhase("completed");
          break;
        case "SAFETY_PAUSED":
          setCompleted(false);
          setPhase("safety_paused");
          break;
        case "FORCE_ENDED":
          setCompleted(false);
          setPhase("force_ended");
          break;
        default:
          setCompleted(false);
          setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
          setPhase("error");
          break;
      }
    } catch (err) {
      if (!isMountedRef.current || signal.aborted) return;
      setErrorMsg("미션을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setPhase("error");
    }
  }, [searchParams, router]);

  useEffect(() => {
    void initializeMission();
  }, [initializeMission]);

  // 초기 인사말 설정 및 1회 음성 재생
  const initialGreetingPlayedRef = useRef(false);
  useEffect(() => {
    if (phase === "active" && sessionData && !initialGreetingPlayedRef.current) {
      initialGreetingPlayedRef.current = true;
      const namePrefix = sessionData.givenName ? `${sessionData.givenName}아, ` : "";
      const initialGreeting = `${namePrefix}오늘 하루는 어땠어? 이야기 들려줘!`;
      setCurrentKMessage(initialGreeting);
      void playKMessageViaTts(initialGreeting, sessionData.sessionId);
    }
  }, [phase, sessionData, playKMessageViaTts]);

  /**
   * U7: v3 턴 송수신 함수
   * POST /api/mission/v3/turn
   */
  const sendTurn = useCallback(
    async (answerText: string, isRetry = false) => {
      const sid = sessionDataRef.current?.sessionId;
      if (!sid) return;
      const trimmed = answerText.trim();
      if (!trimmed) return;

      // 연타 방지: 이미 전송 중이거나 발화 재생 중인 경우 차단
      if (isSubmittingRef.current || isSpeakingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setVoiceState("thinking");
      setShowRetryOverlay(false);

      // 1. clientTurnId 멱등성: 재시도 시 같은 값을 유지, 새 턴이면 새로 생성
      if (!isRetry || !activeClientTurnIdRef.current) {
        activeClientTurnIdRef.current = crypto.randomUUID();
      }
      lastSubmittedTextRef.current = trimmed;
      const turnIdToSend = activeClientTurnIdRef.current;

      const max409Retries = 3;
      const backoffDelays = [1500, 2500, 3500];

      for (let attempt = 0; attempt <= max409Retries; attempt++) {
        try {
          const res = await fetch("/api/mission/v3/turn", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              sessionId: sid,
              clientTurnId: turnIdToSend,
              answerText: trimmed,
              voiceMode: sessionDataRef.current?.voiceMode || "stt_tts",
              displaySequence: displaySequenceRef.current,
            }),
          });

          // 409 처리: TURN_IN_PROGRESS 정상 계약 (에러 화면 노출 금지, 백오프 재시도)
          if (res.status === 409) {
            const errData = await res.json().catch(() => ({}));
            if (errData.code === "TURN_IN_PROGRESS" && attempt < max409Retries) {
              setVoiceState("thinking");
              await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
              continue;
            }
            if (errData.code === "TURN_PAYLOAD_CONFLICT") {
              activeClientTurnIdRef.current = null;
              setIsSubmitting(false);
              isSubmittingRef.current = false;
              setVoiceState("idle");
              return;
            }
            // 최대 재시도 초과 시 안내 및 재시도 버튼 표시
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            setVoiceState("idle");
            setRetryErrorMsg("케이가 답변을 생각하고 있어요. 잠시 후 다시 이야기해 줄래?");
            setShowRetryOverlay(true);
            return;
          }

          // 423 처리: LOCKED / BLOCKED 세션 터미널 상태 전이 (재시도 금지)
          if (res.status === 423) {
            const errData = await res.json().catch(() => ({}));
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();
            setVoiceState("idle");
            activeClientTurnIdRef.current = null;
            if (errData.status === "COMPLETED") {
              setCompleted(true);
              setRewardStatus("already_rewarded");
              setPhase("completed");
            } else if (errData.status === "SAFETY_PAUSED") {
              setCompleted(false);
              setPhase("safety_paused");
            } else if (errData.status === "FORCE_ENDED") {
              setCompleted(false);
              setPhase("force_ended");
            } else {
              setCompleted(false);
              setPhase("closed");
            }
            return;
          }

          // 403 / 404 처리: 세션 무효 -> snapshot 다시 조회
          if (res.status === 403 || res.status === 404) {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();
            setVoiceState("idle");
            activeClientTurnIdRef.current = null;
            void initializeMission();
            return;
          }

          // 500 / 503 / 기타 에러: 재시도 버튼 노출 (낙관적 완료 금지)
          if (!res.ok) {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            setVoiceState("error");
            setRetryErrorMsg("대화를 저장하지 못했어요. 다시 시도해 주세요.");
            setShowRetryOverlay(true);
            return;
          }

          // 200 OK: 턴 성공 확정
          const data = await res.json();

          // 성공 확정 후 다음 턴을 위해 clientTurnId 리셋
          activeClientTurnIdRef.current = null;
          displaySequenceRef.current += 2;
          setTextInput("");

          // 2. replayed: true 응답 처리 (중복 말풍선 추가 방지)
          if (!data.replayed) {
            setTurnHistory((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: "child", text: trimmed },
              { id: crypto.randomUUID(), role: "k", text: data.kMessage },
            ]);
          }

          // 케이 응답 메시지 갱신
          if (data.kMessage) {
            setKMessageHistory((prev) =>
              [...prev, currentKMessage].filter(Boolean).slice(-2)
            );
            setCurrentKMessage(data.kMessage);
          }

          // 4. goalProgress 갱신
          if (data.goalProgress) {
            setSessionData((prev) =>
              prev ? { ...prev, goalProgress: data.goalProgress } : null
            );
          }

          // 5-1. safetyPaused 상태 전이 (완료 처리 절대 금지, 안전 최우선)
          if (data.safetyPaused || data.status === "SAFETY_PAUSED") {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();
            setVoiceState("idle");
            setCompleted(false);
            setIsRewardModalOpen(false);
            setPhase("safety_paused");
            if (data.kMessage) {
              void playKMessageViaTts(data.kMessage, sid);
            }
            return;
          }

          // 5-2. earlyEnded / force_ended 상태 전이 (완료 처리 절대 금지)
          if (data.earlyEnded || data.status === "FORCE_ENDED") {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();
            setVoiceState("idle");
            setCompleted(false);
            setIsRewardModalOpen(false);
            setPhase("force_ended");
            if (data.kMessage) {
              void playKMessageViaTts(data.kMessage, sid);
            }
            return;
          }

          // 5-3. 불가능 조합 fail-closed 검사: completed: true인데 status !== "COMPLETED"
          if (data.completed && data.status !== "COMPLETED") {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();
            setVoiceState("error");
            setCompleted(false);
            setIsRewardModalOpen(false);
            setErrorMsg("미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.");
            setPhase("error");
            return;
          }

          // 5-4. 정상 completed / status === "COMPLETED"
          const isTurnCompleted = Boolean(data.completed || data.status === "COMPLETED");
          if (isTurnCompleted) {
            setCompleted(true);
            const rStatus = data.rewardStatus || "none";
            setRewardStatus(rStatus);

            let alreadyClosed = false;
            if (sid && typeof window !== "undefined") {
              try {
                alreadyClosed = sessionStorage.getItem(`k_reward_modal_closed:${sid}`) === "1";
              } catch {}
            }

            // awarded일 때만 황금열쇠 획득(+1) 연출, already_rewarded 및 기타 사유는 중복/오발차 모달 노출 금지
            if (
              !alreadyClosed &&
              !hasClosedRewardModal &&
              data.completed === true &&
              data.status === "COMPLETED" &&
              rStatus === "awarded"
            ) {
              setIsRewardModalOpen(true);
            }

            setIsSubmitting(false);
            isSubmittingRef.current = false;
            voiceChat.stopSession();

            if (data.kMessage) {
              await playKMessageViaTts(data.kMessage, sid);
            } else {
              setVoiceState("idle");
            }

            setPhase("completed");
            return;
          }

          // 6. 비-terminal 진행 중 TTS 재생
          setIsSubmitting(false);
          isSubmittingRef.current = false;
          if (data.kMessage) {
            await playKMessageViaTts(data.kMessage, sid);
          } else {
            setVoiceState("idle");
          }
          return;
        } catch (err) {
          console.error("[mission/v3/turn] 턴 통신 실패", err);
          setIsSubmitting(false);
          isSubmittingRef.current = false;
          setVoiceState("error");
          setRetryErrorMsg("네트워크 연결을 확인하고 다시 시도해 주세요.");
          setShowRetryOverlay(true);
          return;
        }
      }
    },
    [initializeMission, playKMessageViaTts, currentKMessage]
  );

  // useVoiceChat 훅 연동 (STT 발화 확정 시 sendTurn 호출)
  const voiceChat = useVoiceChat({
    onTurnComplete: (turn) => {
      if (turn.role === "child" && turn.text.trim()) {
        void sendTurn(turn.text.trim());
      }
    },
    getSessionId: () => sessionData?.sessionId ?? null,
    onSpeechBegin: () => {
      if (!isSubmittingRef.current && !isSpeakingRef.current) {
        setVoiceState("listening");
      }
    },
    onSpeechEnd: () => {
      if (!isSubmittingRef.current && !isSpeakingRef.current) {
        setVoiceState("thinking");
      }
    },
    onEmptyAudio: () => {
      if (!isSubmittingRef.current && !isSpeakingRef.current) {
        setVoiceState("idle");
      }
    },
    onSttFailed: () => {
      if (!isSubmittingRef.current && !isSpeakingRef.current) {
        setVoiceState("idle");
      }
    },
  });

  // 음성 모드 자동 세션 시작/정리
  useEffect(() => {
    if (phase === "active" && !isTextMode && sessionData?.sessionId) {
      void voiceChat.startSession().catch(() => {});
    }
    return () => {
      voiceChat.stopSession();
    };
  }, [phase, isTextMode, sessionData?.sessionId]);

  const handleToggleTextMode = useCallback(() => {
    if (isSubmitting || isSpeaking) return;
    if (!isTextMode) {
      voiceChat.releaseMicrophone();
      setIsTextMode(true);
    } else {
      void voiceChat.reacquireMicrophone();
      setIsTextMode(false);
    }
  }, [isTextMode, isSubmitting, isSpeaking, voiceChat]);

  const handleSendText = useCallback(() => {
    if (!textInput.trim() || isSubmitting || isSpeaking) return;
    void sendTurn(textInput.trim());
  }, [textInput, isSubmitting, isSpeaking, sendTurn]);

  const handleMicClick = useCallback(() => {
    if (isSubmitting || isSpeaking) return;
    // useVoiceChat은 isTurnActive를 노출하지 않는다(hooks/useVoiceChat.ts:501-506).
    // 세션이 live일 때만 수동 확정이 의미가 있으므로 status로 가드한다.
    if (voiceChat.status === "live") {
      voiceChat.manualFinalize();
    }
  }, [isSubmitting, isSpeaking, voiceChat]);

  // 1. 로딩 상태
  if (phase === "loading") {
    return (
      <div
        className="h-full flex flex-col overflow-hidden"
        style={{ background: "var(--color-k-surface)" }}
      >
        <div
          className="shrink-0 sticky top-0 z-10"
          style={{ background: "var(--color-k-surface)" }}
        >
          <div className="flex items-center justify-center px-4 pt-4 pb-2">
            <SkeletonBox className="w-24 h-6" />
          </div>
          <div className="text-center pt-2 pb-4 flex flex-col items-center gap-2">
            <SkeletonBox className="w-44 h-5" />
            <div className="px-6 mt-1 w-full max-w-xs">
              <SkeletonBox className="h-2.5 rounded-full" />
            </div>
          </div>
          <div className="flex justify-center mb-4">
            <SkeletonBox className="w-24 h-24 rounded-full" />
          </div>
        </div>
        <div className="flex-1 min-h-0 px-4 flex flex-col items-center justify-center gap-3">
          <SkeletonBox className="h-16 w-3/4 max-w-sm" />
        </div>
        <div className="h-24 shrink-0 border-t border-gray-50" />
      </div>
    );
  }

  // 2-A. 완료 잠금 화면
  if (phase === "completed") {
    const rewardPresentation = getMissionRewardPresentation(rewardStatus);
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center relative overflow-hidden"
        style={{ background: "var(--color-k-surface)" }}
      >
        <p className="text-5xl" aria-hidden="true">
          🔒
        </p>
        <p className="text-base font-bold text-gray-800">
          오늘의 미션을 모두 완료했어요. 이야기해 줘서 고마워!
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          {displayInfo?.description || "오늘의 미션을 모두 완료했어요"}
        </p>
        <div className="flex w-full max-w-xs flex-col gap-2.5">
          <button
            onClick={() => router.replace("/chat")}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
            style={{ background: "var(--color-k-orange)" }}
          >
            자유대화 하러 가기
          </button>
          <button
            onClick={() => router.replace("/child/home")}
            className="w-full py-3.5 rounded-2xl font-bold text-gray-600 bg-gray-100 text-sm active:scale-[0.98] transition-transform cursor-pointer"
          >
            홈으로 돌아가기
          </button>
        </div>

        {/* 황금열쇠 보상 모달: 오직 completed === true 일 때만 렌더링, already_rewarded는 띄우지 않음 */}
        {completed && isRewardModalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reward-modal-title"
            aria-describedby="reward-modal-desc"
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              e.preventDefault();
              const onX = document.activeElement === rewardCloseXBtnRef.current;
              const target = onX ? rewardCloseBottomBtnRef.current : rewardCloseXBtnRef.current;
              target?.focus();
            }}
          >
            <div
              className="w-[90%] max-w-[340px] bg-white rounded-[24px] shadow-lg p-6 flex flex-col items-center relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                ref={rewardCloseXBtnRef}
                onClick={handleCloseRewardModal}
                aria-label="보상 화면 닫기"
                className="absolute top-4 right-4 w-[44px] h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 active:scale-95 text-gray-500 cursor-pointer"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div
                className="w-[90px] h-[90px] mt-2 mb-4 bg-yellow-50 rounded-full flex items-center justify-center text-[48px]"
                style={{ animation: "rewardScaleIn 0.35s ease-out forwards" }}
                aria-hidden="true"
              >
                🔑
              </div>

              <h2
                id="reward-modal-title"
                className="text-[24px] font-extrabold text-[var(--color-k-navy)] mb-1 text-center"
                style={{ animation: "rewardSlideUp 0.35s ease-out forwards" }}
              >
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

              <p
                id="reward-modal-desc"
                className="text-gray-500 font-medium text-[15px] mb-8 text-center"
                style={{ animation: "rewardSlideUp 0.4s ease-out forwards" }}
              >
                {rewardPresentation.description}
              </p>

              <button
                ref={rewardCloseBottomBtnRef}
                autoFocus
                onClick={handleCloseRewardModal}
                className="w-full max-w-[140px] h-[48px] rounded-full text-white font-bold text-[16px] shadow-sm active:scale-95 transition-transform cursor-pointer"
                style={{ backgroundColor: "var(--color-k-navy)" }}
              >
                닫기
              </button>
            </div>
            <style
              dangerouslySetInnerHTML={{
                __html: `
                  @keyframes rewardScaleIn {
                    from { transform: scale(0.85); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                  }
                  @keyframes rewardSlideUp {
                    from { transform: translateY(10px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .w-\\[90px\\], h2, p { animation: none !important; }
                  }
                `,
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // 2-B. 안전 중단 화면
  if (phase === "safety_paused") {
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center"
        style={{ background: "var(--color-k-surface)" }}
      >
        <p className="text-5xl" aria-hidden="true">
          🛡️
        </p>
        <p className="text-base font-bold text-gray-800">
          안전을 위해 오늘 미션을 잠시 쉬고 있어요. 보호자 확인 후 다시 만나요.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          {displayInfo?.description || "안전을 위해 오늘 미션을 잠시 쉬어요"}
        </p>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 2-C. 강제 종료 화면
  if (phase === "force_ended") {
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center"
        style={{ background: "var(--color-k-surface)" }}
      >
        <p className="text-5xl" aria-hidden="true">
          🌙
        </p>
        <p className="text-base font-bold text-gray-800">
          오늘 미션이 종료되었어요. 내일 다시 만나요.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          {displayInfo?.description || "오늘 미션은 여기까지예요"}
        </p>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 2-D. 시간 게이트 닫힘 화면
  if (phase === "before_open" || phase === "closed") {
    const isBeforeOpen = phase === "before_open";
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center"
        style={{ background: "var(--color-k-surface)" }}
      >
        <p className="text-5xl" aria-hidden="true">
          ⏰
        </p>
        <p className="text-base font-bold text-gray-800">
          {isBeforeOpen
            ? "아직 미션 시간이 아니에요. 오전 9시에 다시 만나요!"
            : "오늘 미션 시간이 끝났어요. 내일 다시 만나요!"}
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          미션은 하루에 딱 한 번만 할 수 있어요.
          <br />
          오전 9시~밤 11시 50분 전까지 만나요!
        </p>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 3. 오류 화면
  if (phase === "error") {
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center"
        style={{ background: "var(--color-k-surface)" }}
      >
        <p className="text-5xl text-red-500" aria-hidden="true">
          ⚠️
        </p>
        <p className="text-base font-bold text-red-500">
          {errorMsg || "미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요."}
        </p>
        <p className="text-xs text-gray-500">잠시 후 다시 시도해 주세요.</p>
        <button
          onClick={() => void initializeMission()}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "var(--color-k-orange)" }}
        >
          다시 시도
        </button>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3 rounded-2xl font-bold text-gray-500 text-sm active:scale-[0.98] transition-transform cursor-pointer"
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  // 4. 활성 세션 화면
  const currentSatisfied = sessionData?.goalProgress?.satisfied ?? 0;
  const currentThreshold = sessionData?.goalProgress?.completionThreshold ?? 3;
  const progressRatio = Math.min(
    100,
    Math.max(0, (currentSatisfied / currentThreshold) * 100),
  );

  const prevKMessage = kMessageHistory[kMessageHistory.length - 1];

  let voiceStateLabel = "대기 중";
  if (voiceState === "listening") voiceStateLabel = "듣고 있어";
  else if (voiceState === "thinking" || isSubmitting) voiceStateLabel = "생각 중";
  else if (voiceState === "speaking" || isSpeaking) voiceStateLabel = "말하는 중";

  return (
    <div
      className="h-full flex flex-col justify-between overflow-hidden relative"
      style={{ background: "var(--color-k-surface)" }}
    >
      {/* 500 / 네트워크 오류 재시도 오버레이 */}
      {showRetryOverlay && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 px-6 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-xl p-5 flex flex-col items-center gap-3 max-w-xs w-full text-center">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-xl">
              🔄
            </div>
            <p className="text-sm font-bold text-gray-800">
              {retryErrorMsg || "대화를 저장하지 못했어요."}
            </p>
            <p className="text-xs text-gray-500">
              연결을 확인하고 현재 대화만 다시 시도해 주세요.
            </p>
            <div className="flex gap-2 w-full mt-2">
              <button
                onClick={() => void sendTurn(lastSubmittedTextRef.current, true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer active:scale-95 transition-transform"
                style={{ background: "var(--color-k-orange)" }}
              >
                다시 시도
              </button>
              <button
                onClick={() => {
                  setShowRetryOverlay(false);
                  router.replace("/child/home");
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 cursor-pointer active:scale-95 transition-transform"
              >
                미션 나가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상단 헤더 */}
      <div className="shrink-0">
        <AppTopHeader
          title={sessionData?.givenName ? `${sessionData.givenName}의 미션` : "오늘의 미션"}
          backHref="/child/home"
          backLabel="홈으로 돌아가기"
        />

        {/* 진행 상황 영역 (분모: completionThreshold 3) */}
        <div className="px-4 pt-2 pb-1 flex flex-col items-center">
          <div className="flex items-center justify-between w-full max-w-xs px-2 mb-1 text-xs font-bold text-gray-600">
            <span>오늘의 대화</span>
            <span style={{ color: "var(--color-k-orange)" }}>
              {currentSatisfied}/{currentThreshold}
            </span>
          </div>
          <div className="w-full max-w-xs h-2.5 bg-gray-200/80 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressRatio}%`,
                background: "var(--color-k-orange)",
              }}
            />
          </div>
        </div>
      </div>

      {/* 중앙 케이 말풍선 및 마스코트 영역 */}
      <div className="flex-1 min-h-0 flex flex-col justify-center items-center px-4 w-full max-w-md mx-auto my-auto overflow-y-auto">
        {/* 이전 케이 메시지 */}
        {prevKMessage && (
          <div className="mb-2 bg-white/70 backdrop-blur-[2px] px-3.5 py-1.5 rounded-xl text-xs text-gray-500 max-w-[80%] text-center shadow-sm">
            {prevKMessage}
          </div>
        )}

        {/* 현재 케이 말풍선 */}
        <div className="relative w-full max-w-[340px] bg-white rounded-[20px] border-[2px] border-[#F58A34] shadow-[0_5px_15px_rgba(211,102,29,0.14)] px-5 py-4 flex flex-col items-center text-center">
          {voiceState === "thinking" || isSubmitting ? (
            <div className="flex items-center gap-1.5 py-1">
              <div className="w-2 h-2 rounded-full bg-[#F58A34] animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#F58A34] animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#F58A34] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : (
            <p className="text-[#211D1B] text-[18px] md:text-[20px] font-extrabold tracking-[-0.015em] leading-[1.4] whitespace-pre-wrap break-words" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
              {currentKMessage || "케이가 이야기할 준비를 하고 있어요..."}
            </p>
          )}

          {/* 말풍선 꼬리 */}
          <div className="absolute -bottom-[12px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[12px] border-transparent border-t-[#F58A34]" />
          <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[10px] border-transparent border-t-white" />
        </div>

        {/* 케이 마스코트 애니메이션 */}
        <div className="shrink-0 flex justify-center pt-5 pb-2">
          <KBestieMascotAnimation
            state={voiceState === "speaking" || isSpeaking ? "talking" : "idle"}
            size={110}
          />
        </div>

        {/* 상태 배지 */}
        <div className="mt-1 px-3 py-1 rounded-full bg-white/80 border border-gray-200 shadow-sm text-xs font-bold text-gray-500 flex items-center gap-1.5">
          {voiceState === "speaking" || isSpeaking ? (
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          ) : voiceState === "thinking" || isSubmitting ? (
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping" />
          ) : voiceState === "listening" ? (
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-gray-400" />
          )}
          <span>{voiceStateLabel}</span>
        </div>
      </div>

      {/* 하단 입력 영역 컨테이너 */}
      <div className="shrink-0 pb-6 pt-2 px-4 flex flex-col justify-center items-center w-full max-w-md mx-auto">
        {isTextMode ? (
          /* 텍스트 모드 UI */
          <div className="w-full flex gap-2 items-center">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              placeholder="케이에게 텍스트로 답하기..."
              disabled={isSubmitting || isSpeaking}
              className="flex-1 min-w-0 bg-white px-4 py-3.5 rounded-2xl text-[15px] font-medium text-gray-800 shadow-sm border border-gray-200 focus:outline-none focus:border-[var(--color-k-orange)] disabled:opacity-50"
              maxLength={200}
            />
            <button
              onClick={handleSendText}
              disabled={!textInput.trim() || isSubmitting || isSpeaking}
              className="w-[50px] h-[50px] shrink-0 rounded-2xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shadow-md active:scale-95 transition-all"
              style={{ background: "var(--color-k-orange)" }}
              aria-label="전송"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
            <button
              onClick={handleToggleTextMode}
              disabled={isSubmitting || isSpeaking}
              className="w-[50px] h-[50px] shrink-0 rounded-2xl flex items-center justify-center bg-white shadow-sm text-gray-600 cursor-pointer active:scale-95 border border-gray-200 disabled:opacity-40 transition-all"
              aria-label="텍스트 입력창 닫기"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          /* 음성 모드 UI */
          <div className="w-full flex items-center justify-between px-6 relative">
            {/* 좌측 키보드 전환 버튼 */}
            <button
              onClick={handleToggleTextMode}
              disabled={isSubmitting || isSpeaking}
              className="w-[46px] h-[46px] bg-white rounded-2xl flex items-center justify-center shadow-sm border border-gray-200 cursor-pointer active:scale-95 disabled:opacity-50 transition-all text-gray-600"
              aria-label="텍스트로 답하기"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <line x1="6" y1="8" x2="6.01" y2="8" />
                <line x1="10" y1="8" x2="10.01" y2="8" />
                <line x1="14" y1="8" x2="14.01" y2="8" />
                <line x1="18" y1="8" x2="18.01" y2="8" />
                <line x1="6" y1="12" x2="6.01" y2="12" />
                <line x1="10" y1="12" x2="10.01" y2="12" />
                <line x1="14" y1="12" x2="14.01" y2="12" />
                <line x1="18" y1="12" x2="18.01" y2="12" />
                <line x1="8" y1="16" x2="16" y2="16" />
              </svg>
            </button>

            {/* 중앙 마이크 버튼 */}
            <div className="relative flex items-center justify-center">
              {voiceState === "listening" && (
                <div className="absolute w-[96px] h-[96px] rounded-full bg-[var(--color-k-orange)] opacity-20 animate-ping" />
              )}
              <button
                onClick={handleMicClick}
                disabled={isSubmitting || isSpeaking}
                className={`w-[80px] h-[80px] rounded-full flex items-center justify-center text-white border-[4px] border-[#FFF3DF] shadow-[0_7px_19px_rgba(211,81,24,0.38)] z-10 transition-all duration-200 ${
                  isSubmitting || isSpeaking
                    ? "opacity-60 cursor-not-allowed bg-gray-400"
                    : "cursor-pointer active:scale-95 bg-gradient-to-b from-[#FF8A2A] to-[#F16A18]"
                }`}
                aria-label={voiceState === "listening" ? "녹음 종료" : "마이크"}
              >
                {voiceState === "listening" ? (
                  <div className="w-[22px] h-[22px] rounded-sm bg-white" />
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                )}
              </button>
            </div>

            {/* 우측 음소거 토글 버튼 */}
            <button
              onClick={() => setIsMuted((prev) => !prev)}
              disabled={isSubmitting}
              className="w-[46px] h-[46px] bg-white rounded-2xl flex items-center justify-center shadow-sm border border-gray-200 cursor-pointer active:scale-95 disabled:opacity-50 transition-all text-gray-600"
              aria-label={isMuted ? "소리 켜기" : "소리 끄기"}
            >
              {isMuted ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChildMissionV3Page() {
  return (
    <DemoFrame>
      <div className="mission-frame-wrapper relative w-full h-full">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .mission-frame-wrapper [class*="h-[100dvh]"],
              .mission-frame-wrapper [class*="min-h-[100dvh]"] {
                height: 100% !important;
                min-height: 100% !important;
              }
            `,
          }}
        />
        <Suspense fallback={null}>
          <MissionV3Inner />
        </Suspense>
      </div>
    </DemoFrame>
  );
}
