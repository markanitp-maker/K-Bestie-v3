"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import {
  AUTO_REFUND_STAGES,
  isMbtiCloseRequest,
  isMbtiCompleted,
  isMbtiError,
  isMbtiInitAck,
  isMbtiProgress,
  isMbtiReady,
  isPlayBugReport,
  MbtiInitPayload
} from "@/lib/play/protocol";

const GAMES = [
  { id: "comic_book", icon: "📚", title: "만화책 읽기", bg: "#e8845a", keys: 2 },
  { id: "quiz", icon: "🧠", title: "퀴즈 게임", bg: "#3b82f6", keys: 2 },
  { id: "mbti", icon: "🔮", title: "MBTI 성격 유형", bg: "#22c55e", keys: 3 },
  { id: "hairstyle", icon: "💇", title: "헤어스타일", bg: "#2d9f8f", keys: 3 },
];

function MbtiGameScreen({
  childId,
  sessionInfo,
  onComplete,
}: {
  childId: string;
  sessionInfo: { sessionId: string; startMode: "new" | "resume"; expiresAt: string };
  onComplete: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  let iframeSrc = "";
  let MBTI_ORIGIN = "*";

  try {
    const rawUrl = process.env.NEXT_PUBLIC_MBTI_APP_URL;
    if (!rawUrl) throw new Error("No URL");
    const parsed = new URL("/play/mbti", rawUrl);
    iframeSrc = parsed.toString();
    MBTI_ORIGIN = parsed.origin;
  } catch (e) {
    iframeSrc = typeof window !== "undefined" ? `${window.location.origin}/play/mock-mbti` : "";
    MBTI_ORIGIN = typeof window !== "undefined" ? window.location.origin : "*";
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 1. origin check
      if (MBTI_ORIGIN !== "*" && event.origin !== MBTI_ORIGIN) return;
      // 2. source check
      if (event.source !== iframeRef.current?.contentWindow) return;
      // 3. schema check
      const data = event.data;

      if (data && typeof data === 'object' && data !== null && 'playSessionId' in data && (data as any).playSessionId !== sessionInfo.sessionId) {
        console.warn(`[MbtiGameScreen] Ignored message for mismatched session ID. Expected ${sessionInfo.sessionId}, got ${(data as any).playSessionId}`);
        return;
      }

      if (isMbtiReady(data)) {
        const initPayload: MbtiInitPayload = {
          playType: "mbti",
          eventType: "MBTI_INIT",
          occurredAt: new Date().toISOString(),
          playSessionId: sessionInfo.sessionId,
          childId: childId,
          startMode: sessionInfo.startMode,
          expiresAt: sessionInfo.expiresAt,
        };
        iframeRef.current?.contentWindow?.postMessage(initPayload, MBTI_ORIGIN);

        initTimeoutRef.current = setTimeout(() => {
          fetch("/api/play/callback/refund", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              child_id: childId,
              play_session_id: sessionInfo.sessionId,
              stage: "init",
              error_code: "init_ack_timeout",
              error_message: "MBTI_INIT 전송 후 15초 이내 MBTI_INIT_ACK 미수신",
            }),
          })
            .then((r) => r.json())
            .then((resData) => {
              if (resData.refunded) {
                alert(`정상적으로 시작되지 않아 황금열쇠를 ${resData.refunded_quantity}개 되돌렸어요.`);
              }
              onComplete();
            });
        }, 15000);
      } else if (isMbtiInitAck(data)) {
        if (data.playSessionId === sessionInfo.sessionId) {
          if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
        }
      } else if (isMbtiError(data)) {
        if (AUTO_REFUND_STAGES.has(data.stage)) {
          fetch("/api/play/callback/refund", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              child_id: childId,
              play_session_id: data.playSessionId,
              stage: data.stage,
              error_code: data.errorCode,
              error_message: data.errorMessage,
            }),
          })
            .then((r) => r.json())
            .then((resData) => {
              if (resData.refunded) {
                alert(`정상적으로 시작되지 않아 황금열쇠를 ${resData.refunded_quantity}개 되돌렸어요.`);
              }
            });
        }
      } else if (isMbtiProgress(data)) {
        // 서버 진행상태 기록(자동환불 오남용 방지의 서버측 근거). 진행률 백분율만 저장.
        fetch("/api/play/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            child_id: childId,
            play_session_id: sessionInfo.sessionId,
            progress_percent: data.progressPercent,
          }),
        });
      } else if (isPlayBugReport(data)) {
        if (data.sessionId !== sessionInfo.sessionId) {
          console.warn(`[MbtiGameScreen] Ignored bug report for mismatched session ID. Expected ${sessionInfo.sessionId}, got ${data.sessionId}`);
          return;
        }
        fetch("/api/play/bug-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else if (isMbtiCompleted(data)) {
        fetch("/api/play/callback/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            child_id: childId,
            play_session_id: sessionInfo.sessionId,
            result_type: data.resultType,
          }),
        }).catch(() => {});
        if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
        onComplete();
      } else if (isMbtiCloseRequest(data)) {
        if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
        onComplete();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
    };
  }, [childId, sessionInfo, MBTI_ORIGIN, onComplete]);

  return (
    <div className="absolute inset-0 bg-[#fafaf8] z-[60] flex flex-col animate-in fade-in duration-300">
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="w-full h-full border-0"
        allow="camera; microphone"
      />
    </div>
  );
}

export default function ChildPlayPage() {
  const router = useRouter();
  const [childId, setChildId] = useState<string | null>(null);

  // States for flows
  const [selectedGame, setSelectedGame] = useState<typeof GAMES[0] | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [resumeCheckLoading, setResumeCheckLoading] = useState(false);
  const [canResume, setCanResume] = useState(false);
  
  const [isStarting, setIsStarting] = useState(false);
  
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const [showGameScreen, setShowGameScreen] = useState(false);

  // mbti specific
  const mbtiIdemKeyRef = useRef<string | null>(null);
  const [mbtiSessionInfo, setMbtiSessionInfo] = useState<{ sessionId: string; startMode: "new" | "resume"; expiresAt: string } | null>(null);

  useEffect(() => {
    let active = true;
    const id = localStorage.getItem("k_child_id");
    if (id) {
      setChildId(id);
    } else {
      fetch("/api/child/me")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (active && data?.id) {
            setChildId(data.id);
            localStorage.setItem("k_child_id", data.id);
          }
        });
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (childId) {
      fetch(`/api/play/refund-notification?child_id=${childId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (active && data?.notification) {
            alert(`정상적으로 시작되지 않아 황금열쇠를 ${data.notification.refunded_quantity}개 되돌렸어요.`);
          }
        });
    }
    return () => { active = false; };
  }, [childId]);

  const handleGameClick = async (game: typeof GAMES[0]) => {
    if (!childId) {
      alert("로그인 정보가 필요합니다. 다시 로그인해주세요.");
      return;
    }
    setSelectedGame(game);
    if (game.id === "mbti") {
      if (!mbtiIdemKeyRef.current) {
        mbtiIdemKeyRef.current = crypto.randomUUID();
      }
    }
    setResumeCheckLoading(true);
    setShowActionModal(true);
    try {
      const res = await fetch(`/api/play/session?child_id=${childId}&play_type=${game.id}`);
      if (res.ok) {
        const data = await res.json();
        setCanResume(data.canResume);
      } else {
        setCanResume(false);
      }
    } catch (e) {
      setCanResume(false);
    } finally {
      setResumeCheckLoading(false);
    }
  };

  const handleStart = async () => {
    if (!childId || !selectedGame) return;
    setIsStarting(true);
    try {
      if (selectedGame.id === "mbti") {
        const res = await fetch("/api/play/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ child_id: childId, play_type: "mbti", idempotency_key: mbtiIdemKeyRef.current })
        });
        
        if (res.status === 402) {
          alert("황금열쇠가 부족합니다.");
          setShowActionModal(false);
        } else if (res.ok) {
          const data = await res.json();
          setMbtiSessionInfo({ sessionId: data.session_id, startMode: data.start_mode, expiresAt: data.expires_at });
          setShowActionModal(false);
          setShowGameScreen(true);
          mbtiIdemKeyRef.current = null;
        } else {
          alert("놀이 예약에 실패했습니다.");
        }
      } else {
        const res = await fetch("/api/play/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ child_id: childId, play_type: selectedGame.id })
        });
        
        if (res.status === 409) {
          setShowFinalConfirm(true);
        } else if (res.status === 402) {
          alert("황금열쇠가 부족합니다.");
          setShowActionModal(false);
        } else if (res.ok) {
          const { reservation_id } = await res.json();
          const startRes = await fetch("/api/play/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ child_id: childId, play_type: selectedGame.id, reservation_id })
          });
          if (startRes.ok) {
            setShowActionModal(false);
            setShowGameScreen(true);
          } else {
            alert("놀이 세션 시작에 실패했습니다.");
          }
        } else {
          alert("놀이 예약에 실패했습니다.");
        }
      }
    } catch (e) {
      alert("오류가 발생했습니다.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleResume = async () => {
    if (!childId || !selectedGame) return;
    if (selectedGame.id === "mbti") {
      setIsStarting(true);
      try {
        const res = await fetch("/api/play/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ child_id: childId, play_type: "mbti", idempotency_key: mbtiIdemKeyRef.current })
        });
        if (res.ok) {
          const data = await res.json();
          setMbtiSessionInfo({ sessionId: data.session_id, startMode: data.start_mode, expiresAt: data.expires_at });
          setShowActionModal(false);
          setShowGameScreen(true);
          mbtiIdemKeyRef.current = null;
        } else {
          alert("이어하기 처리에 실패했습니다.");
        }
      } catch (e) {
        alert("오류가 발생했습니다.");
      } finally {
        setIsStarting(false);
      }
    } else {
      setShowActionModal(false);
      setShowGameScreen(true);
    }
  };

  const handleRestart = async () => {
    if (!childId || !selectedGame) return;
    setIsRestarting(true);
    try {
      const res = await fetch("/api/play/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: childId, play_type: selectedGame.id })
      });
      if (res.ok) {
        setShowFinalConfirm(false);
        setShowActionModal(false);
        setShowGameScreen(true);
      } else {
        alert("초기화에 실패했습니다. 기존 상태가 유지됩니다.");
        setShowFinalConfirm(false);
      }
    } catch (e) {
      alert("오류가 발생했습니다.");
      setShowFinalConfirm(false);
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden relative" style={{ background: "#fafaf8" }}>
        
        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2 z-10">
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            케이와 놀이
          </Link>
        </div>

        {/* 놀이 목록 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 z-10">
          <p className="text-sm text-center mb-5" style={{ color: "#6b7280" }}>
            하고 싶은 놀이를 골라보세요
          </p>

          <div className="grid grid-cols-2 gap-4 pb-20">
            {GAMES.map((game) => (
              <div
                key={game.id}
                onClick={() => handleGameClick(game)}
                className="flex flex-col items-center justify-center gap-3 rounded-3xl px-3 py-6 shadow-md cursor-pointer select-none active:scale-95 transition-transform relative overflow-hidden"
                style={{ background: game.bg }}
              >
                <div className="absolute top-2 right-3 bg-black/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  🔑 {game.keys}
                </div>
                <div
                  className="w-14 h-14 mt-3 rounded-2xl flex items-center justify-center text-3xl"
                  style={{ background: "rgba(255,255,255,0.25)" }}
                >
                  {game.icon}
                </div>
                <p className="text-white font-bold text-[13px] text-center tracking-tight">{game.title}</p>
              </div>
            ))}
          </div>
        </div>

        <RealChildNav active="놀이" />

        {/* 1. 이어하기/시작하기 액션 모달 */}
        {showActionModal && selectedGame && !showFinalConfirm && !showGameScreen && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-40 p-5">
            <div className="bg-white rounded-[28px] w-full max-w-sm p-6 shadow-2xl flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl mb-4" style={{ background: `${selectedGame.bg}20` }}>
                {selectedGame.icon}
              </div>
              
              {resumeCheckLoading ? (
                <div className="py-8 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mb-3" style={{ borderColor: `${selectedGame.bg} ${selectedGame.bg} transparent transparent` }} />
                  <p className="text-sm text-gray-500">진행 기록을 확인하는 중...</p>
                </div>
              ) : (
                <>
                  <p className="text-gray-800 mb-2 font-bold text-lg">
                    {canResume ? "이전에 하던 놀이가 있어요" : "새로운 놀이를 시작할까요?"}
                  </p>
                  <p className="text-gray-500 text-sm mb-6">
                    {canResume ? "이어서 놀이를 진행할까요?" : `황금열쇠 ${selectedGame.keys}개가 소모됩니다`}
                  </p>
                  <div className="flex gap-3 w-full">
                    <button 
                      onClick={() => setShowActionModal(false)} 
                      className="flex-1 py-3.5 rounded-2xl bg-gray-100 text-gray-600 font-bold active:scale-95 transition-transform"
                    >
                      취소
                    </button>
                    {canResume ? (
                      <button 
                        onClick={handleResume} 
                        disabled={isStarting}
                        className="flex-1 py-3.5 rounded-2xl text-white font-bold shadow-md active:scale-95 transition-transform disabled:opacity-70 disabled:scale-100" 
                        style={{ background: selectedGame.bg }}
                      >
                        {isStarting ? "준비 중..." : "이어하기"}
                      </button>
                    ) : (
                      <button 
                        onClick={handleStart} 
                        disabled={isStarting} 
                        className="flex-[1.2] py-3.5 rounded-2xl text-white font-bold shadow-md active:scale-95 transition-transform flex items-center justify-center gap-1 disabled:opacity-70 disabled:scale-100" 
                        style={{ background: selectedGame.bg }}
                      >
                        {isStarting ? "준비 중..." : "시작하기"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 2. 기존 놀이 초기화 확인 모달 (409 에러 시) */}
        {showFinalConfirm && selectedGame && !showGameScreen && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 p-5">
            <div className="bg-white rounded-[28px] w-full max-w-sm p-6 shadow-2xl text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="font-bold text-gray-800 text-lg mb-3">기존 놀이를 초기화할까요?</p>
              <div className="bg-red-50 rounded-2xl p-4 mb-6 text-sm text-red-800 leading-relaxed text-left border border-red-100">
                <ul className="list-disc pl-4 space-y-1">
                  <li>다른 놀이가 이미 진행 중입니다.</li>
                  <li><strong>기존 진행 기록이 초기화됩니다.</strong></li>
                  <li>황금열쇠 <strong>{selectedGame.keys}개</strong>가 소모됩니다.</li>
                </ul>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowFinalConfirm(false)} 
                  className="flex-1 py-3.5 rounded-2xl bg-gray-100 text-gray-600 font-bold active:scale-95 transition-transform"
                >
                  취소
                </button>
                <button 
                  onClick={handleRestart} 
                  disabled={isRestarting} 
                  className="flex-1 py-3.5 rounded-2xl bg-red-500 text-white font-bold shadow-md active:scale-95 transition-transform disabled:opacity-70 disabled:scale-100"
                >
                  {isRestarting ? "초기화 중..." : "확인 (초기화)"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. 실제 게임 진행 화면 */}
        {showGameScreen && selectedGame && (
          selectedGame.id === "mbti" && childId && mbtiSessionInfo ? (
            <MbtiGameScreen 
              childId={childId} 
              sessionInfo={mbtiSessionInfo} 
              onComplete={() => {
                setShowGameScreen(false);
                setMbtiSessionInfo(null);
              }} 
            />
          ) : (
            <div className="absolute inset-0 bg-[#fafaf8] z-[60] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
              <div className="w-24 h-24 bg-white rounded-[32px] shadow-sm flex items-center justify-center text-5xl mb-6">
                🚀
              </div>
              <p className="font-bold text-2xl text-gray-800 mb-3 tracking-tight">놀이 준비 완료!</p>
              <p className="text-gray-500 mb-10 leading-relaxed">
                별도 케이 놀이 앱에서 이어집니다<br/>
                <span className="text-sm bg-gray-200 px-2 py-1 rounded-md mt-2 inline-block">(준비 중)</span>
              </p>
              <button 
                onClick={() => setShowGameScreen(false)} 
                className="w-full max-w-[200px] py-4 rounded-2xl font-bold text-white bg-gray-800 shadow-md active:scale-95 transition-transform"
              >
                홈으로 돌아가기
              </button>
            </div>
          )
        )}

      </div>
    </DemoFrame>
  );
}
