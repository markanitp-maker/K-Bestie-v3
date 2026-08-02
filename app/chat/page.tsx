"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useVoiceChat, type Turn } from "@/hooks/useVoiceChat";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { logVoiceEvent } from "@/lib/voiceTimelineLog";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import KChatbotWidget from "@/components/KChatbotWidget";
import { getRecentKUtterances } from "@/lib/conversation/recentKUtterances";

const MAX_SESSION_DURATION_MS = 10 * 60 * 1000; // 10분
const MAX_SESSION_TURNS = 20; // 20턴

const getCurrentKSTWindow = () => {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${kstNow.getUTCHours() < 18 ? 'day' : 'evening'}`;
};
export default function ChatPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");
  const restoredTranscriptRef = useRef<Turn[]>([]);
  const displaySequenceCounterRef = useRef(0);
  const nextDisplaySequence = useCallback(() => {
    displaySequenceCounterRef.current += 1;
    return displaySequenceCounterRef.current;
  }, []);
  const [isAuto, setIsAuto] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);

  const [micPermission, setMicPermission] = useState<PermissionState | "checking" | "not_needed">("checking");
  const autoStartAttempted = useRef(false);

  // 030: 서버 시간 기준 10분 연속 사용 + 1분 휴식 게이트. usagePhase가 "ready"가 되기
  // 전에는 음성/텍스트 대화 화면을 아예 렌더링하지 않는다(클라이언트 버튼 비활성화만으로
  // 처리하지 않기 위함 — 주소창 직접 접근도 이 게이트를 거친다).
  const [usagePhase, setUsagePhase] = useState<"checking" | "cooldown" | "ready">("checking");
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState(0);
  const usageSessionStartedAtRef = useRef<string | null>(null);
  const usageSessionEndsAtMsRef = useRef<number | null>(null);

  const voiceBubbleRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<string>("idle");
  const currentWindowRef = useRef<string | null>(null);
  const childIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    childIdRef.current = childId;
  }, [childId]);
  // respondText는 훅 생성 이후에만 얻을 수 있어 ref로 우회(핸들러는 훅 생성 전에 정의 필요)
  const respondTextRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const getLastAsrConfidenceRef = useRef<(() => number | undefined) | undefined>(undefined);

  // 실시간 메시지 저장 + 아이 발화 시 케이 텍스트 응답 생성(음성 없음, 텍스트만)
  const handleTurnComplete = useCallback((turn: Turn) => {
    logVoiceEvent({ ts: Date.now(), eventType: "freechat_handleTurnComplete", extra: { role: turn.role } });
    const sid = sessionIdRef.current;
    if (sid) {
      const asrConfidence = turn.role === "child" ? getLastAsrConfidenceRef.current?.() : undefined;
      const turnId = turn.id || crypto.randomUUID();
      const displaySequence = (turn as any).displaySequence ?? nextDisplaySequence();
      
      fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sessionId: sid, 
          role: turn.role, 
          content: turn.text, 
          asrConfidence,
          turnId,
          displaySequence
        }),
      }).catch(() => {});
    }
    if (turn.role === "child") {
      void respondTextRef.current?.();
    }
  }, [nextDisplaySequence]);

  const {
    status: rawStatus,
    transcript,
    interimChildText,
    startSession,
    stopSession,
    getTranscript,
    reset,
    respondText,
    sayText,
    sendTypedText,
    setMicEnabled,
    getLastAsrConfidence,
    setInputMode,
    manualFinalize,
    isResponding,
    isSpeaking,
    seedTranscript,
  } = useVoiceChat({ onTurnComplete: handleTurnComplete, getSessionId: () => sessionIdRef.current });
  respondTextRef.current = respondText;
  getLastAsrConfidenceRef.current = getLastAsrConfidence;

  const status = mounted ? rawStatus : "idle";

  // 실시간 status 동기화
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [sessionActive, setSessionActive] = useState(false);

  // 세션 종료(대화 종료 처리) 시에만 명시적으로 false 처리
  useEffect(() => {
    if (status === "ended") {
      setSessionActive(false);
    }
  }, [status]);

  // 페이지 이탈(언마운트) 시 false 처리
  useEffect(() => {
    return () => setSessionActive(false);
  }, []);

  // 화면 wake lock — 프리챗 세션이 실제로 연결돼 있는 동안(live)만 유지. status가 ended/
  // error/idle로 바뀌는 즉시(대화 종료, 하드리밋 종료, 홈 이동으로 인한 언마운트 등) 훅
  // 내부에서 자동 반납된다.
  const wakeLockWarning = useScreenWakeLock(sessionActive);

  // 하드 리밋 세션 중단 핸들러 — 자유대화는 케이가 음성으로 말하지 않음(텍스트만) → 세션 종료
  const triggerHardLimitStop = useCallback((noticeText: string) => {
    sayText(noticeText);
    stopSession();
    setSessionActive(false);
  }, [sayText, stopSession]);

  // 030: 서버가 내려준 sessionEndsAt 기준 하드 리밋(음성/텍스트 모드 공통 — 기존에는
  // status==="live"일 때만 고정 10분 타이머가 걸려 텍스트 전용 사용에는 시간 제한이
  // 전혀 없었다). usagePhase가 "ready"가 된 시점의 남은 시간만큼만 타이머를 건다(새로고침
  // 복귀 시 남은 시간이 10분보다 짧을 수 있음).
  useEffect(() => {
    if (usagePhase !== "ready" || usageSessionEndsAtMsRef.current === null) return;
    const delay = Math.max(0, usageSessionEndsAtMsRef.current - Date.now());
    timerRef.current = setTimeout(() => {
      const cId = childIdRef.current;
      const startedAt = usageSessionStartedAtRef.current;
      if (cId && startedAt) {
        fetch("/api/chat/freechat-usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId: cId, action: "end", startedAt }),
        }).catch(() => {});
      }
      triggerHardLimitStop("오늘 대화는 여기까지야! 1분 쉬었다가 다시 이야기하러 와줘 🌿");
      setCooldownRemainingSec(60);
      setUsagePhase("cooldown");
    }, delay);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [usagePhase, triggerHardLimitStop]);

  // 030: 자유대화 진입 게이트 — childId가 확정되면 서버 상태를 먼저 확인한다.
  // 휴식 중이면 대화 화면을 렌더링하지 않고 휴식 안내로 전환하고, 그 외에는
  // start를 호출해(이미 활성 세션이면 그대로 재개) 서버 기준 종료 시각을 받는다.
  useEffect(() => {
    if (!childId) return;
    let cancelled = false;
    (async () => {
      try {
        const statusRes = await fetch(`/api/chat/freechat-usage?childId=${childId}`);
        const statusData = await statusRes.json();
        if (cancelled) return;
        if (statusData.status === "cooldown") {
          setCooldownRemainingSec(statusData.remainingCooldownSeconds ?? 60);
          setUsagePhase("cooldown");
          return;
        }
        const startRes = await fetch("/api/chat/freechat-usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId, action: "start" }),
        });
        const startData = await startRes.json();
        if (cancelled) return;
        if (!startData.allowed) {
          setCooldownRemainingSec(startData.remainingCooldownSeconds ?? 60);
          setUsagePhase("cooldown");
          return;
        }
        usageSessionStartedAtRef.current = startData.startedAt;
        usageSessionEndsAtMsRef.current = new Date(startData.sessionEndsAt).getTime();
        setUsagePhase("ready");
      } catch (e) {
        console.error("[freechat-usage] init error:", e);
        // 서버 상태 확인 자체가 실패하면(네트워크 등) 정상 사용자를 완전히 막지 않고
        // 클라이언트 기준 10분으로 fail-open — 단, DB 기준 우회 방지가 핵심 목적인
        // 다중기기/새로고침 우회 시나리오는 서버 응답이 정상일 때만 보장된다.
        usageSessionEndsAtMsRef.current = Date.now() + MAX_SESSION_DURATION_MS;
        setUsagePhase("ready");
      }
    })();
    return () => { cancelled = true; };
  }, [childId]);

  // 030: 휴식 카운트다운 — 1초마다 감소, 0이 되면 새로고침 없이 재진입 시도(§5)
  useEffect(() => {
    if (usagePhase !== "cooldown") return;
    if (cooldownRemainingSec <= 0) {
      const cId = childIdRef.current;
      if (!cId) return;
      setUsagePhase("checking");
      (async () => {
        try {
          const startRes = await fetch("/api/chat/freechat-usage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ childId: cId, action: "start" }),
          });
          const startData = await startRes.json();
          if (startData.allowed) {
            usageSessionStartedAtRef.current = startData.startedAt;
            usageSessionEndsAtMsRef.current = new Date(startData.sessionEndsAt).getTime();
            setUsagePhase("ready");
          } else {
            setCooldownRemainingSec(startData.remainingCooldownSeconds ?? 60);
            setUsagePhase("cooldown");
          }
        } catch (e) {
          console.error("[freechat-usage] cooldown re-check error:", e);
          setCooldownRemainingSec(1);
          setUsagePhase("cooldown");
        }
      })();
      return;
    }
    const t = setTimeout(() => setCooldownRemainingSec((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [usagePhase, cooldownRemainingSec]);

  // 턴 수 제한 하드 리밋 감지
  useEffect(() => {
    if (status === "live") {
      const childTurns = transcript.filter((t) => t.role === "child").length;
      if (childTurns >= MAX_SESSION_TURNS) {
        triggerHardLimitStop("오늘 대화는 여기까지야! 다음에 더 재미있는 이야기 많이 들려줘 👋");
      }
    }
  }, [transcript, status, triggerHardLimitStop]);

  // 페이지 이탈 시 세션 마감 연동 로직 제거됨

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  useEffect(() => {
    reset();
    setReportDone(false);
    setReportError(null);
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("k_child_id");
    if (stored) {
      setChildId(stored);
      void restoreSession(stored).then(() => {
        seedTranscript(restoredTranscriptRef.current);
      });
      const storedMode = localStorage.getItem(`k_voice_input_mode:${stored}`);
      const auto = storedMode !== "manual";
      setIsAuto(auto);
      
      if (auto) {
        if (navigator.permissions && navigator.permissions.query) {
          navigator.permissions.query({ name: "microphone" as PermissionName })
            .then(res => {
              setMicPermission(res.state);
              res.onchange = () => setMicPermission(res.state);
            })
            .catch(() => {
              setMicPermission("prompt");
            });
        } else {
          setMicPermission("prompt");
        }
      } else {
        setMicPermission("not_needed");
      }
      return;
    }
    router.replace("/");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 대화 종료 시 리포트 자동 생성
  useEffect(() => {
    if (status !== "ended" || !sessionId) return;
    const t = getTranscript();
    fetch("/api/report/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, transcript: t }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setReportError(d.error);
        else setReportDone(true);
      })
      .catch((e) => setReportError(e.message));
  }, [status, sessionId, getTranscript]);

  useEffect(() => {
    voiceBubbleRef.current?.scrollTo({ top: voiceBubbleRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, interimChildText]);

  // 세션이 live가 될 때 저장된 자동/수동 모드를 훅에 반영 — 수동 모드는 아이가 명시적으로
  // 말하기 버튼을 누르기 전까지 마이크를 꺼둔다(불필요한 상시 캡처 방지).
  useEffect(() => {
    if (status === "live") {
      setInputMode(isAuto ? "auto" : "manual");
      setMicEnabled(isAuto);
    }
  }, [status, isAuto, setInputMode, setMicEnabled]);

  const restoreSession = useCallback(async (cId: string) => {
    logVoiceEvent({ ts: Date.now(), eventType: "freechat_restore_start", extra: { childId: cId } });
    console.log("[freechat] restoreSession start", { childId: cId });
    try {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: cId }),
      });
      const data = await res.json();
      logVoiceEvent({ ts: Date.now(), eventType: "freechat_session_response", extra: { resumed: data.resumed, sessionId: data.sessionId, conversationWindow: data.conversationWindow } });
      console.log("[freechat] session response", { sessionId: data.sessionId, resumed: data.resumed, businessDate: data.businessDate, conversationWindow: data.conversationWindow });
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        if (data.businessDate && data.conversationWindow) {
          currentWindowRef.current = `${data.businessDate}-${data.conversationWindow}`;
        } else {
          currentWindowRef.current = getCurrentKSTWindow();
        }
        localStorage.setItem("k_session_id", data.sessionId);

        if (data.resumed) {
          const msgRes = await fetch(`/api/chat/messages?sessionId=${data.sessionId}`);
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            logVoiceEvent({ ts: Date.now(), eventType: "freechat_restore_messages", extra: { messageCount: msgData.messages?.length ?? 0 } });
            if (msgData.messages) {
              type MessageRow = {
                turn_id?: string;
                display_sequence?: number;
                role: "child" | "k" | "system";
                content: string;
              };
              const mapped: Turn[] = msgData.messages.map((m: MessageRow) => ({
                id: m.turn_id || m.display_sequence?.toString() || Math.random().toString(),
                role: m.role as "child" | "k",
                text: m.content,
                displaySequence: m.display_sequence
              } as Turn));
              
              const maxSeq = Math.max(0, ...msgData.messages.map((m: MessageRow) => m.display_sequence ?? 0));
              displaySequenceCounterRef.current = Math.max(displaySequenceCounterRef.current, maxSeq);

              restoredTranscriptRef.current = mapped;
              console.log("[freechat] restored messages", { sessionId: data.sessionId, count: mapped.length });
            }
          }
        } else {
          restoredTranscriptRef.current = [];
        }
      }
    } catch (err) {
      console.error("Session restore error:", err);
    }
  }, []);
  const handleStart = useCallback(async () => {
    if (!childId) return;
    setReportDone(false);
    setReportError(null);
    setSessionActive(true);

    await restoreSession(childId);

    await startSession();
    seedTranscript(restoredTranscriptRef.current);

    if (navigator.serviceWorker?.controller) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        fetch("/api/client-version", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            childId,
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
          sessionId: sessionIdRef.current, 
          childId, 
          clientSha: process.env.NEXT_PUBLIC_DEPLOYMENT_SHA, 
          swVersion: "no-sw-controller" 
        }),
      }).catch(() => {});
    }
  }, [childId, startSession, restoreSession, seedTranscript]);

  // 주기적으로 윈도우 변경을 감지하고 세션 갱신
  useEffect(() => {
    const interval = setInterval(() => {
      if (childIdRef.current && currentWindowRef.current) {
        const currentWindow = getCurrentKSTWindow();
        if (currentWindowRef.current !== currentWindow) {
          const wasLive = statusRef.current === "live";
          if (wasLive) stopSession();
          reset();
          
          void restoreSession(childIdRef.current).then(() => {
            if (wasLive) {
              void startSession().then(() => {
                seedTranscript(restoredTranscriptRef.current);
              });
            } else {
              seedTranscript(restoredTranscriptRef.current);
            }
          });
        }
      }
    }, 10000); // 10초마다 확인
    return () => clearInterval(interval);
  }, [restoreSession, stopSession, reset, startSession, seedTranscript]);

  const handleModeChange = useCallback((newMode: "auto" | "manual") => {
    if (newMode === "auto") {
      // 수동 모드에서 녹음 중이던 발화가 있었다면 안전하게 먼저 확정
      if (isRecordingRef.current) {
        manualFinalize();
        setIsRecording(false);
        isRecordingRef.current = false;
      }
      setInputMode("auto");
      setMicEnabled(true);
      
      // manual -> auto 전환 시, 세션이 안 켜져있다면 즉시 시작 시도
      if (statusRef.current === "idle" || statusRef.current === "error") {
        handleStart();
      }
    } else {
      setInputMode("manual");
      setMicEnabled(false);
    }
    setIsAuto(newMode === "auto");
    if (childId) localStorage.setItem(`k_voice_input_mode:${childId}`, newMode);
  }, [childId, manualFinalize, setInputMode, setMicEnabled, handleStart]);

  const handleCentralButtonClick = useCallback(() => {
    if (!isRecordingRef.current) {
      // 케이가 아직 반응을 생성/전송하는 중이면 새 녹음을 시작하지 않는다(턴 겹침 방지 —
      // useVoiceChat.ts의 respondingRef 가드와 동일한 원칙을 버튼 단에서도 재확인).
      if (isResponding) return;
      setMicEnabled(true);
      setIsRecording(true);
      isRecordingRef.current = true;
    } else {
      manualFinalize();
      setMicEnabled(false);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, [setMicEnabled, manualFinalize, isResponding]);

  const switchToText = useCallback(() => {
    setMode("text");
    setMicEnabled(false);
  }, [setMicEnabled]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    setMicEnabled(true);
  }, [setMicEnabled]);

  const handleSendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;

    if (statusRef.current === "idle" || statusRef.current === "error") {
      await handleStart();
    }

    setTextInput("");
    sendTypedText(text);
  }, [textInput, handleStart, sendTypedText]);

  // 자동 모드일 때 마이크 권한이 이미 'granted'라면 자동 시작
  useEffect(() => {
    if (
      childId &&
      usagePhase === "ready" &&
      isAuto &&
      micPermission === "granted" &&
      !autoStartAttempted.current &&
      status === "idle"
    ) {
      autoStartAttempted.current = true;
      handleStart();
    }
  }, [childId, usagePhase, isAuto, micPermission, status, handleStart]);

  // 상태 플래그
  const isConnecting = status === "connecting";
  const isLive = status === "live";
  const isEnded = status === "ended";

  let computedVoiceState: "listening" | "thinking" | "speaking" | "connecting" | "error" | "idle" = "idle";
  if (status === "error") computedVoiceState = "error";
  else if (isConnecting) computedVoiceState = "connecting";
  else if (isSpeaking) computedVoiceState = "speaking";
  else if (isResponding) computedVoiceState = "thinking";
  else if (isRecording) computedVoiceState = "listening";
  else if (isLive) computedVoiceState = "listening";

  let stateText = "";
  let StateIcon = null;
  switch (computedVoiceState) {
    case "listening":
      stateText = "듣고 있어";
      StateIcon = <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
      break;
    case "thinking":
      stateText = "생각 중";
      StateIcon = <div className="flex gap-1"><div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"0ms"}}/><div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"150ms"}}/><div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"300ms"}}/></div>;
      break;
    case "speaking":
      stateText = "말하는 중";
      StateIcon = <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
      break;
    case "connecting":
      stateText = "연결 중";
      StateIcon = <div className="w-5 h-5 border-[2.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
      break;
    case "error":
      stateText = "연결 오류";
      StateIcon = <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
      break;
    default:
      stateText = "대기 중";
  }

  // 048 hotfix: 1·2·3 영역은 화자별 채팅이 아니라 "케이가 실제로 말한 발화"만의
  // 최근 3단계 타임라인이다(아이 발화는 어디에도 노출하지 않는다). 미션·자유대화가
  // 동일한 규칙을 쓰도록 공유 selector로 계산한다.
  const { current: currentKText, previous: prevKText, older: olderKText } = getRecentKUtterances(transcript);
  let currentQuestionText = currentKText || "케이가 이야기를 준비하고 있어요...";

  if (isEnded) {
    // codex 047 리뷰 지적: 기존에는 대화 종료 후 별도 헤더로 "오늘도 이야기해줘서
    // 고마워요"(reportDone) 또는 "대화가 끝났어요" 안내를 보여줬는데, 새 레이아웃으로
    // 옮기며 그 안내 자체가 완전히 사라졌었다 - 현재 말풍선 영역에 동일한 문구로 복원한다.
    currentQuestionText = reportDone
      ? "오늘도 이야기해줘서 고마워요.\n부모님이 리포트에서 확인할 수 있어요."
      : "대화가 끝났어요.\n부모님이 리포트에서 확인할 수 있어요.";
  } else if (status === "connecting") {
    currentQuestionText = "연결 중...";
  } else if (status === "error") {
    currentQuestionText = "연결에 오류가 발생했어요.\n아래 🎤 버튼을 눌러 다시 연결해주세요.";
  } else if (status === "idle") {
    if (isAuto) {
      if (micPermission === "checking") currentQuestionText = "잠시만 기다려주세요...";
      else if (micPermission === "denied") currentQuestionText = "대화를 위해 마이크 권한을 허용해주세요.";
      else currentQuestionText = "아래 🎤 버튼을 눌러 대화를 시작해 보세요! 🌿";
    } else {
      currentQuestionText = "아래 🎤 버튼을 눌러 대화를 시작해 보세요! 🌿";
    }
  }

  if (!mounted || usagePhase === "checking") {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "var(--color-k-surface)" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  if (usagePhase === "cooldown") {
    const mm = String(Math.floor(cooldownRemainingSec / 60)).padStart(2, "0");
    const ss = String(cooldownRemainingSec % 60).padStart(2, "0");
    return (
      <DemoFrame>
        <div className="w-full h-[100dvh] flex justify-center bg-[#D5ECFF]">
          <div className="w-full max-w-[480px] min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-8 text-center" style={{ background: "linear-gradient(to bottom, #D5ECFF 0%, #F4F7F5 50%, #FFF5E8 100%)" }}>
            <KBestieMascotAnimation state="idle" size={120} />
            <p className="text-[#3a2f2a] text-[19px] font-bold leading-relaxed">
              지금은 잠깐 쉬는 시간이야.<br />
              {cooldownRemainingSec > 0 ? `${mm}:${ss} 뒤에 다시 이야기할 수 있어.` : "이제 다시 이야기할 수 있어."}
            </p>
            <button
              onClick={() => router.replace("/child/home")}
              className="mt-2 px-6 py-3 rounded-2xl text-sm font-bold text-white cursor-pointer active:scale-95"
              style={{ background: "var(--color-k-orange)" }}
            >
              홈으로 갈래요
            </button>
          </div>
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="w-full h-[100dvh] flex justify-center bg-[#D5ECFF]" style={{ overflowX: "hidden", overflowY: "hidden" }}>
        {wakeLockWarning && (
          <div className="absolute top-[80px] left-0 right-0 flex justify-center z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-gray-800/80 text-white text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
              기기 설정으로 화면이 꺼질 수 있어요
            </div>
          </div>
        )}
        <div className="w-full max-w-[480px] min-w-0 box-border h-[100dvh] flex flex-col relative shrink-0" style={{ background: "linear-gradient(to bottom, #D5ECFF 0%, #F4F7F5 50%, #FFF5E8 100%)" }}>
          
          {/* Decorations */}
          <div className="absolute inset-0 pointer-events-none opacity-30 overflow-hidden">
            <div className="absolute top-[10%] left-[10%] w-16 h-8 bg-white rounded-full blur-[2px]" />
            <div className="absolute top-[20%] right-[15%] w-12 h-6 bg-white rounded-full blur-[2px]" />
            <div className="absolute top-[15%] left-[50%] w-2 h-2 bg-yellow-200 rounded-full blur-[1px]" />
            <div className="absolute top-[40%] left-[20%] w-3 h-3 bg-yellow-100 rounded-full blur-[1px]" />
            <div className="absolute top-[60%] right-[10%] w-10 h-10 bg-white/50 rounded-lg rotate-12 blur-[1px]" />
            <div className="absolute top-[75%] left-[15%] w-8 h-8 bg-white/40 rounded-full blur-[1px]" />
          </div>

          {/* Top Right Close Button */}
          <div className="absolute top-0 right-0 p-[calc(10px+env(safe-area-inset-top))] z-50">
            <button onClick={() => {
                  if (isLive) stopSession();
                  setSessionActive(false);
                  router.replace("/child/home");
                }} aria-label="자유대화 종료" className="w-[44px] h-[44px] flex items-center justify-center cursor-pointer active:scale-95 text-gray-700">
              <svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Chat Area (Flexible & Vertically Centered, Top-clipped when long) */}
          <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-end overflow-hidden z-20 px-[clamp(16px,4vw,24px)] pt-[calc(58px+env(safe-area-inset-top))] pb-[clamp(10px,1.9dvh,16px)]">
            {olderKText && (
              <div className="mb-[clamp(10px,2vw,14px)] text-gray-400 text-[clamp(14px,4vw,16px)] leading-[1.45] text-center max-w-[80%] font-medium shrink-0 h-auto overflow-visible" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "break-word" }}>
                {olderKText}
              </div>
            )}
            {prevKText && (
              <div className="mb-[clamp(10px,1.6dvh,14px)] bg-white/70 backdrop-blur-md px-[18px] py-[14px] rounded-[16px] text-[clamp(15px,4.5vw,17px)] leading-[1.5] text-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.04)] w-fit max-w-[75%] text-center shrink-0 h-auto overflow-visible" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "break-word" }}>
                {prevKText}
              </div>
            )}
            <div className="relative w-[clamp(240px,78.9vw,270px)] max-w-[79%] bg-white rounded-[20px] border-[2.5px] border-[var(--color-k-orange)] shadow-[0_4px_16px_rgba(224,90,63,0.15)] px-[20px] py-[17px] flex flex-col min-h-[65px] shrink-0 h-auto overflow-visible">
              <div className="w-full">
                <p className="text-left text-[#3a2f2a] text-[clamp(17px,5.1vw,20px)] font-[700] leading-[1.45] whitespace-pre-wrap break-words" style={{ wordBreak: "keep-all", overflowWrap: "break-word" }}>
                  {currentQuestionText}
                </p>
              </div>
              {/* Triangle tail */}
              <div className="absolute -bottom-[12.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-transparent border-t-[var(--color-k-orange)]" />
              <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent border-t-white" />
            </div>
          </div>

          {/* Mascot Area & Side Cards */}
          <div className="relative w-full shrink-0 h-[clamp(145px,22.6dvh,160px)]">
            
            {/* Mascot & Platform - Centered strictly */}
            <div className="absolute inset-0 flex flex-col items-center justify-end pointer-events-none">
               {/* Halo */}
               <div className="absolute top-[5%] w-[150px] h-[150px] rounded-full bg-[#c0e0ff]/60 blur-xl pointer-events-none" />
               
               {/* Mascot */}
               <div className="relative z-10 flex justify-center items-end pb-[clamp(38px,6.2dvh,46px)]">
                 <KBestieMascotAnimation state={computedVoiceState === "speaking" ? "talking" : "idle"} size={140} className="!w-[clamp(115px,39.2vw,145px)] !h-[clamp(115px,39.2vw,145px)] object-contain" />
               </div>
               
               {/* Platform */}
               <div className="absolute bottom-0 w-[clamp(145px,50.9vw,185px)] h-[clamp(38px,6.1dvh,46px)] pointer-events-none">
                 <div className="absolute top-0 w-full h-[60%] bg-[#FFF5E8] rounded-[100%] border border-[#f0e4d4] shadow-inner z-10" />
                 <div className="absolute top-[30%] w-full h-[70%] bg-[#f2e1cc] rounded-b-[70px] shadow-sm" />
                 <div className="absolute top-[15%] left-[15%] w-[70%] h-[35%] bg-black/5 rounded-[100%] z-10 blur-sm" />
               </div>
            </div>

            {/* Right State Card - Independent Absolute Overlay */}
            <div className="absolute right-[clamp(24px,8.7vw,36px)] top-[clamp(24px,4.1dvh,32px)]">
              <div
                className="relative z-20 bg-[#D5ECFF]/60 backdrop-blur-md rounded-[16px] flex flex-col items-center justify-center w-[clamp(58px,19.5vw,72px)] h-[clamp(76px,12dvh,86px)] py-[10px] shadow-sm pointer-events-auto"
                aria-live="polite"
              >
                 <div className="w-[clamp(30px,8.5vw,38px)] h-[clamp(30px,8.5vw,38px)] rounded-full bg-white flex items-center justify-center text-gray-700 mb-1.5 shrink-0">
                   {StateIcon}
                 </div>
                 <span className="text-[clamp(12px,3.6vw,14px)] leading-[1.2] font-bold text-gray-600 text-center break-keep">{stateText}</span>
              </div>
            </div>
          </div>

          {/* Auto/Manual Mode Toggles */}
          <div className="relative z-20 flex justify-center gap-2 mt-[clamp(6px,1dvh,10px)] h-[clamp(44px,6dvh,48px)] shrink-0">
             <button onClick={() => handleModeChange('auto')} disabled={isConnecting} aria-pressed={isAuto} className={`flex items-center justify-center min-w-[64px] px-2 h-full rounded-[14px] border-[1.5px] transition-colors cursor-pointer ${isAuto ? 'bg-[#fff0e6] border-[var(--color-k-orange)] text-[var(--color-k-orange)] font-bold' : 'bg-white border-gray-200 text-gray-500 font-semibold'} shadow-sm text-[13px] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
               자동
               {isAuto && <div className="absolute -bottom-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[var(--color-k-orange)]" />}
             </button>
             <button onClick={() => handleModeChange('manual')} disabled={isConnecting} aria-pressed={!isAuto} className={`flex items-center justify-center min-w-[64px] px-2 h-full rounded-[14px] border-[1.5px] transition-colors cursor-pointer ${!isAuto ? 'bg-[#fff0e6] border-[var(--color-k-orange)] text-[var(--color-k-orange)] font-bold' : 'bg-white border-gray-200 text-gray-500 font-semibold'} shadow-sm text-[13px] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
               수동
               {!isAuto && <div className="absolute -bottom-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[var(--color-k-orange)]" />}
             </button>
          </div>

          {/* Spacer between mode and mic */}
          <div className="h-[clamp(16px,2.5dvh,24px)] w-full shrink-0" />

          {/* Bottom Inputs Area */}
          <div className="relative z-30 w-full shrink-0 flex items-center justify-center pb-[calc(clamp(54px,8dvh,66px)+env(safe-area-inset-bottom))]">
            {mode === "text" ? (
              <div
                className="w-full min-w-0 flex gap-2 box-border"
                style={{
                  paddingLeft: "max(16px, env(safe-area-inset-left))",
                  paddingRight: "max(16px, env(safe-area-inset-right))",
                }}
              >
                <input
                  ref={(el) => { if (el) el.focus(); }}
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
                  }}
                  placeholder="케이에게 텍스트로 답하기..."
                  disabled={isConnecting || isEnded}
                  className="flex-1 min-w-0 bg-white/90 backdrop-blur-md px-4 py-3.5 rounded-2xl text-[16px] font-medium text-gray-800 shadow-sm border border-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-k-orange)] focus:border-[var(--color-k-orange)] transition-colors disabled:opacity-50"
                  maxLength={200}
                />
                <button
                  onClick={handleSendText}
                  disabled={!textInput.trim() || isConnecting || isEnded}
                  className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shadow-md bg-[var(--color-k-orange)] active:scale-95"
                  aria-label="전송"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
                <button
                  onClick={switchToVoice}
                  className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center bg-white shadow-sm text-gray-600 cursor-pointer active:scale-95 border border-gray-200 disabled:opacity-40"
                  aria-label="텍스트 입력창 닫기"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ) : (
              <div className="w-full flex items-center justify-center h-[clamp(72px,11vw,82px)] relative">
                {/* Keyboard Button */}
                <button 
                  onClick={switchToText}
                  disabled={isConnecting}
                  className="absolute left-[clamp(16px,5vw,24px)] w-[clamp(44px,11vw,54px)] h-[clamp(44px,11vw,54px)] bg-white/80 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-sm border border-gray-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" 
                  aria-label="텍스트로 답하기"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/><line x1="14" y1="12" x2="14.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
                </button>

                {/* Main Mic Button */}
                <div className="relative flex items-center justify-center">
                  {isRecording && (
                    <>
                      <div className="absolute w-[clamp(90px,13vw,100px)] h-[clamp(90px,13vw,100px)] rounded-full bg-[var(--color-k-orange)] opacity-20 animate-ping motion-reduce:animate-none" />
                      <div className="absolute w-[clamp(108px,16vw,120px)] h-[clamp(108px,16vw,120px)] rounded-full bg-[var(--color-k-orange)] opacity-10 animate-pulse motion-reduce:animate-none" />
                    </>
                  )}

                  {isLive && !isAuto ? (
                    <button
                      onClick={handleCentralButtonClick}
                      className={`w-[clamp(72px,11vw,82px)] h-[clamp(72px,11vw,82px)] flex items-center justify-center text-white shadow-[0_4px_16px_rgba(224,90,63,0.3)] z-10 transition-all duration-200 cursor-pointer active:scale-95 bg-[var(--color-k-orange)] ${isRecording ? 'rounded-2xl' : 'rounded-[50%]'}`}
                      aria-label={isRecording ? "녹음 종료" : "마이크 켜기"}
                    >
                      {isRecording ? (
                        <div className="w-[24px] h-[24px] rounded-sm bg-white" />
                      ) : (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4m-4 0h8"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
                      )}
                    </button>
                  ) : isLive && isAuto ? (
                    // 자동 모드에서는 VAD가 자동으로 듣기 시작/종료를 처리한다(수동 토글 버튼
                    // 없음 - 원본 코드도 이 상태에서 별도 버튼을 그리지 않았다). 아래 "마이크
                    // 사용 불가" 회색 처리로 떨어지면 정상 자동 청취 중에도 고장난 것처럼
                    // 보이므로, 클릭 불가한 정적 활성 표시만 보여준다.
                    <div
                      className="w-[clamp(72px,11vw,82px)] h-[clamp(72px,11vw,82px)] rounded-[50%] flex items-center justify-center text-white shadow-[0_4px_16px_rgba(224,90,63,0.3)] z-10 bg-[var(--color-k-orange)]"
                      aria-label="자동으로 듣고 있어요"
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    </div>
                  ) : (!isLive && !isConnecting) ? (
                    isAuto && micPermission === "denied" ? (
                      <div className="flex flex-col items-center">
                        <button
                          onClick={handleStart}
                          className="px-5 py-2.5 bg-red-50 text-red-600 rounded-full text-sm font-bold border border-red-200 active:scale-95 transition-transform cursor-pointer"
                        >
                          권한 다시 시도하기
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={handleStart} 
                        className={`w-[clamp(72px,11vw,82px)] h-[clamp(72px,11vw,82px)] rounded-[50%] flex items-center justify-center text-white shadow-[0_4px_16px_rgba(224,90,63,0.3)] z-10 transition-all duration-200 cursor-pointer active:scale-95 bg-[var(--color-k-orange)]`}
                        aria-label="대화 시작하기"
                      >
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                      </button>
                    )
                  ) : (
                    <button 
                      disabled 
                      className={`w-[clamp(72px,11vw,82px)] h-[clamp(72px,11vw,82px)] rounded-[50%] flex items-center justify-center text-white shadow-[0_4px_16px_rgba(224,90,63,0.3)] z-10 transition-all duration-200 opacity-60 cursor-not-allowed bg-gray-400`}
                      aria-label="마이크 사용 불가"
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4m-4 0h8"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* 047 QA 실측: topOffsetPx가 너무 작아 문의 위젯이 상단 X(자유대화 종료) 버튼과
            정확히 같은 자리에 겹쳐 X가 완전히 가려졌다 - 미션 화면과 달리 진행률 바가
            없어 X 버튼 아래로 충분히 내려야 한다(X 버튼 높이 44px + 상단 패딩 고려). */}
        <KChatbotWidget appSurface="child" topOffsetPx={64} />
      </div>
    </DemoFrame>
  );
}
