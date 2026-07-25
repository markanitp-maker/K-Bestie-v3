"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useVoiceChat, type Turn } from "@/hooks/useVoiceChat";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { VoiceInputModeSwitch } from "@/components/VoiceInputModeSwitch";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { logVoiceEvent } from "@/lib/voiceTimelineLog";

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

  // 시간 제한 하드 리밋 감지
  useEffect(() => {
    if (status === "live") {
      timerRef.current = setTimeout(() => {
        triggerHardLimitStop("오늘 대화는 여기까지야! 너무 재미있었어, 내일 또 이야기하러 와줘 🌿");
      }, MAX_SESSION_DURATION_MS);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status, triggerHardLimitStop]);

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
      isAuto &&
      micPermission === "granted" &&
      !autoStartAttempted.current &&
      status === "idle"
    ) {
      autoStartAttempted.current = true;
      handleStart();
    }
  }, [childId, isAuto, micPermission, status, handleStart]);

  // 상태 플래그
  const isIdle = status === "idle";
  const isConnecting = status === "connecting";
  const isLive = status === "live";
  const isEnded = status === "ended";

  const handleMicToggle = useCallback(async () => {
    if (isLive) {
      stopSession();
      setSessionActive(false);
    } else if (isIdle || status === "error") {
      await handleStart();
    }
  }, [isLive, isIdle, status, stopSession, handleStart]);

  if (!mounted) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        {wakeLockWarning && (
          <div className="absolute top-[80px] left-0 right-0 flex justify-center z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-gray-800/80 text-white text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
              기기 설정으로 화면이 꺼질 수 있어요
            </div>
          </div>
        )}
        {/* 상단 고정 영역: 헤더 + 마스코트 (스크롤되지 않음) */}
        <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
          <div className="relative flex items-center justify-center px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-1">
            {/* 좌상단 뒤로가기 버튼 */}
            <button
              aria-label="홈으로 돌아가기"
              onClick={() => {
                if (status === "live") stopSession();
                setSessionActive(false);
                router.push("/child/home");
              }}
              className="absolute left-2 top-[calc(50%+env(safe-area-inset-top)/2)] -translate-y-1/2 w-12 h-12 flex items-center justify-center cursor-pointer text-gray-600 z-20"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <Link href="/child/home" className="cursor-pointer">
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

          {/* 대화 종료 후에만 안내 문구 표시 — 진행 중에는 "케이가 듣고 있어요…" 류 문구 없이
              마스코트가 곧바로 보이도록 해 상단 여백을 줄인다. */}
          {isEnded && (
            <div className="text-center pt-1 pb-2">
              <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                {reportDone ? "오늘도 이야기해줘서 고마워요" : "대화가 끝났어요"}
              </h1>
              <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
                부모님이 리포트에서 확인할 수 있어요
              </p>
            </div>
          )}

          <div className="flex justify-center items-center gap-4 mb-4 mt-2 max-w-sm mx-auto">
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={96}
              height={96}
              className="object-contain shrink-0"
              priority
            />
            {mode === "voice" && (
              <VoiceInputModeSwitch isAuto={isAuto} onChange={handleModeChange} />
            )}
          </div>
        </div>

        {/* 대화 말풍선: 이 영역만 스크롤 */}
        <div
          ref={voiceBubbleRef}
          className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4"
        >
          {transcript.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center p-4">
              <p className="text-xs" style={{ color: "#9ca3af" }}>
                {isAuto
                  ? isLive
                    ? "케이가 듣고 있어요. 자유롭게 이야기해 보세요."
                    : micPermission === "checking"
                    ? "잠시만 기다려주세요..."
                    : micPermission === "denied"
                    ? "마이크 권한을 허용해주세요."
                    : "대화 시작하기 버튼을 눌러주세요!"
                  : "마이크 버튼을 눌러 자유롭게 대화를 시작해 보세요! 🌿"}
              </p>
            </div>
          ) : (
            transcript.map((turn, i) => (
              <div
                key={turn.id ?? i}
                className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  turn.role === "k" ? "self-start" : "self-end"
                }`}
                style={{
                  background: turn.role === "k" ? "#f3f4f6" : "#3b82f6",
                  color: turn.role === "k" ? "var(--color-k-text-primary)" : "#ffffff",
                  borderRadius: turn.role === "k" ? "16px 16px 16px 2px" : "16px 16px 2px 16px",
                }}
              >
                {turn.text}
              </div>
            ))
          )}
          {interimChildText && (
            <div
              className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed self-end opacity-60"
              style={{ background: "#3b82f6", color: "#ffffff", borderRadius: "16px 16px 2px 16px" }}
            >
              {interimChildText}
            </div>
          )}
        </div>

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



            {isLive && !isAuto && (
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <div className="absolute w-16 h-16 rounded-full bg-orange-400/20 animate-ping pointer-events-none" />
                )}
                <button
                  onClick={handleCentralButtonClick}
                  className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer ${
                    isRecording ? "bg-gradient-to-br from-orange-400 to-orange-500" : ""
                  }`}
                  style={!isRecording ? { background: "var(--color-k-orange)" } : undefined}
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
            )}

            {!isLive && !isConnecting && !isAuto && (
              <button
                onClick={handleMicToggle}
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white shadow-md transition-transform active:scale-95 cursor-pointer"
                style={{ background: "var(--color-k-orange)" }}
                aria-label="마이크 켜기"
              >
                🎤
              </button>
            )}

            {!isLive && !isConnecting && isAuto && (
              micPermission === "denied" ? (
                <div className="flex flex-col items-center">
                  <p className="text-xs text-red-500 mb-2 font-medium">마이크 권한 재시도가 필요해요</p>
                  <button
                    onClick={handleMicToggle}
                    className="px-5 py-2.5 bg-red-50 text-red-600 rounded-full text-sm font-bold border border-red-200 active:scale-95 transition-transform cursor-pointer"
                  >
                    권한 다시 시도하기
                  </button>
                </div>
              ) : status === "error" ? (
                <div className="flex flex-col items-center">
                  <p className="text-xs text-red-500 mb-2 font-medium">연결 오류가 발생했어요</p>
                  <button
                    onClick={handleStart}
                    className="px-5 py-2.5 bg-red-50 text-red-600 rounded-full text-sm font-bold border border-red-200 active:scale-95 transition-transform cursor-pointer"
                  >
                    다시 연결하기
                  </button>
                </div>
              ) : micPermission === "checking" ? (
                <button disabled className="px-6 py-3 rounded-full text-white font-bold shadow-md opacity-50 text-sm" style={{ background: "var(--color-k-orange)" }}>
                  확인 중...
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  className="px-6 py-3 rounded-full text-white font-bold shadow-md transition-transform active:scale-95 cursor-pointer text-sm"
                  style={{ background: "var(--color-k-orange)" }}
                  aria-label="대화 시작하기"
                >
                  대화 시작하기
                </button>
              )
            )}

            <button
              onClick={() => {
                if (isLive) stopSession();
                setSessionActive(false);
                router.replace("/child/home");
              }}
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
              placeholder="케이에게 이야기해봐..."
              disabled={isEnded || isConnecting}
              className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
              maxLength={200}
            />
            <button
              onClick={handleSendText}
              disabled={isEnded || isConnecting || !textInput.trim()}
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 cursor-pointer"
              style={{ background: "var(--color-k-orange)" }}
              aria-label="전송"
            >
              ➤
            </button>
            <button
              onClick={() => {
                if (isLive) stopSession();
                setSessionActive(false);
                router.replace("/child/home");
              }}
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </DemoFrame>
  );
}
