"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useVoiceChat, type Turn } from "@/hooks/useVoiceChat";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

const MAX_SESSION_DURATION_MS = 10 * 60 * 1000; // 10분
const MAX_SESSION_TURNS = 20; // 20턴

export default function ChatPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");

  const voiceBubbleRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<string>("idle");
  // respondText는 훅 생성 이후에만 얻을 수 있어 ref로 우회(핸들러는 훅 생성 전에 정의 필요)
  const respondTextRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const getLastAsrConfidenceRef = useRef<(() => number | undefined) | undefined>(undefined);

  // 실시간 메시지 저장 + 아이 발화 시 케이 텍스트 응답 생성(음성 없음, 텍스트만)
  const handleTurnComplete = useCallback((turn: Turn) => {
    const sid = sessionIdRef.current;
    if (sid) {
      const asrConfidence = turn.role === "child" ? getLastAsrConfidenceRef.current?.() : undefined;
      fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, role: turn.role, content: turn.text, asrConfidence }),
      }).catch(() => {});
    }
    if (turn.role === "child") {
      void respondTextRef.current?.();
    }
  }, []);

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
  } = useVoiceChat({ onTurnComplete: handleTurnComplete, getSessionId: () => sessionIdRef.current });
  respondTextRef.current = respondText;
  getLastAsrConfidenceRef.current = getLastAsrConfidence;

  const status = mounted ? rawStatus : "idle";

  // 실시간 status 동기화
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // 하드 리밋 세션 중단 핸들러 — 자유대화는 케이가 음성으로 말하지 않음(텍스트만) → 세션 종료
  const triggerHardLimitStop = useCallback((noticeText: string) => {
    sayText(noticeText);
    stopSession();
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

  // 페이지 이탈 시 세션 마감 연동
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sid = sessionIdRef.current;
      if (sid && statusRef.current !== "ended") {
        const turnCount = getTranscript().filter((t) => t.role === "child").length;
        fetch("/api/chat/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, turnCount, ended: true }),
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload();
    };
  }, [getTranscript]);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  useEffect(() => {
    reset();
    localStorage.removeItem("k_session_id");
    setSessionId(null);
    sessionIdRef.current = null;
    setReportDone(false);
    setReportError(null);
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("k_child_id");
    if (stored) {
      setChildId(stored);
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

  const switchToText = useCallback(() => {
    setMode("text");
    setMicEnabled(false);
  }, [setMicEnabled]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    setMicEnabled(true);
  }, [setMicEnabled]);

  const handleStart = useCallback(async () => {
    if (!childId) return;
    setReportDone(false);
    setReportError(null);

    const { data } = await getSupabase()
      .from("chat_sessions")
      .insert({ child_id: childId })
      .select("id")
      .single();
    if (data) {
      setSessionId(data.id);
      sessionIdRef.current = data.id;
      localStorage.setItem("k_session_id", data.id);
    }
    await startSession();
  }, [childId, startSession, getSupabase]);

  const handleSendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;

    if (statusRef.current === "idle" || statusRef.current === "error") {
      await handleStart();
    }

    setTextInput("");
    sendTypedText(text);
  }, [textInput, handleStart, sendTypedText]);

  // 상태 플래그
  const isIdle = status === "idle";
  const isConnecting = status === "connecting";
  const isLive = status === "live";
  const isEnded = status === "ended";

  const handleMicToggle = useCallback(async () => {
    if (isLive) {
      stopSession();
    } else if (isIdle || status === "error") {
      await handleStart();
    }
  }, [isLive, isIdle, status, stopSession, handleStart]);

  if (!mounted) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        {/* 상단 고정 영역: 헤더 + 마스코트 (스크롤되지 않음) */}
        <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
          <div className="flex items-center justify-center px-4 pt-4 pb-2">
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

          <div className="text-center pt-2 pb-4">
            <h1 className="text-lg font-bold" style={{ color: "#1e1e2d" }}>
              {isEnded ? (reportDone ? "오늘도 이야기해줘서 고마워요" : "대화가 끝났어요") : isConnecting ? "케이를 부르는 중이에요…" : "케이가 듣고 있어요…"}
            </h1>
            <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
              {isEnded ? "부모님이 리포트에서 확인할 수 있어요" : "자유롭게 이야기해 보세요"}
            </p>
          </div>

          <div className="flex justify-center mb-4">
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={96}
              height={96}
              className="object-contain"
              priority
            />
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
                마이크 버튼을 눌러 자유롭게 대화를 시작해 보세요! 🌿
              </p>
            </div>
          ) : (
            transcript.map((turn, i) => (
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

            {isLive && (
              <div className="relative flex items-center justify-center">
                <div className="absolute w-16 h-16 rounded-full bg-orange-400/20 animate-ping pointer-events-none" />
                <button
                  onClick={handleMicToggle}
                  className="relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer bg-gradient-to-br from-orange-400 to-orange-500"
                  aria-label="마이크 끄기"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              </div>
            )}

            {!isLive && !isConnecting && (
              <button
                onClick={handleMicToggle}
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white shadow-md transition-transform active:scale-95 cursor-pointer"
                style={{ background: "#e8845a" }}
                aria-label="마이크 켜기"
              >
                🎤
              </button>
            )}

            <button
              onClick={() => {
                if (isLive) stopSession();
                router.replace("/child/home");
              }}
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
              placeholder="케이에게 이야기해봐..."
              disabled={isEnded || isConnecting}
              className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
              maxLength={200}
            />
            <button
              onClick={handleSendText}
              disabled={isEnded || isConnecting || !textInput.trim()}
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 cursor-pointer"
              style={{ background: "#e8845a" }}
              aria-label="전송"
            >
              ➤
            </button>
            <button
              onClick={() => {
                if (isLive) stopSession();
                router.replace("/child/home");
              }}
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        )}

        <RealChildNav active="대화" />
      </div>
    </DemoFrame>
  );
}
