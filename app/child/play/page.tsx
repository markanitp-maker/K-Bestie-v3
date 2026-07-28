"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { writeQuizSessionHandoff } from "@/lib/play/quizSessionHandoff";
import KChatbotWidget from "@/components/KChatbotWidget";

function LogOut({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

const GAMES = [
  // comingSoon: 실제 게임 화면이 아직 없는 placeholder 카드 — 클릭해도 황금열쇠 차감/
  // 시작 확인 모달로 이어지면 안 된다(2026-07-27 실사용 손실 발견, 즉시 차단).
  { id: "comic_book", icon: "📚", title: "만화책 읽기", bg: "var(--color-k-orange)", keys: 2, comingSoon: true },
  // keys는 화면 표시·부족 판정용 값이다. 실제 차감은 서버가 하므로
  // lib/quiz/handoffToken.ts의 QUIZ_GOLD_KEY_COST와 반드시 같아야 한다(2026-07-27: 1 → 2).
  { id: "quizmaster", icon: "🧠", title: "퀴즈마스터", bg: "#3b82f6", keys: 2, comingSoon: false },
  { id: "mbti", icon: "🔮", title: "MBTI 성격 유형", bg: "#22c55e", keys: 3, comingSoon: false },
  { id: "hairstyle", icon: "💇", title: "헤어스타일", bg: "var(--color-k-sky-blue)", keys: 3, comingSoon: true },
];

/**
 * 티켓 기반(1회용 실행 티켓 발급 → 독립 배포로 하드 내비게이션) 놀이 시작 공통 처리.
 * 현재는 MBTI만 이 흐름을 쓰지만, 향후 다른 독립 놀이가 같은 방식을 쓸 수 있어
 * playId를 파라미터로 받는다(놀이별 분기 없이 재사용 가능).
 *
 * 실측 버그(2026-07-27): reserve_gold_keys_for_play가 resume_expires_at 만료를 몰라
 * /api/play/session(canResume=false, "시작하기" 노출)과 어긋나는 already_in_progress
 * (409)를 반환한 적이 있다 — RPC는 수정했지만(20260762000000 마이그레이션), 서버가
 * 막 만료 정리를 하는 경쟁 상태에서 여전히 409가 한 번 더 뜰 가능성에 대비해 클라이언트도
 * 방어한다: 409를 받으면 (1) 실제 이어하기 가능 여부를 재조회해 가능하면 그 세션으로
 * 진입하고, (2) 불가능하면 "시작하기"를 한 번만 더 안전하게 재시도하며, (3) 그래도
 * 실패하면 사유가 보이는 안내를 띄운다 — "놀이 예약에 실패했습니다" 같은 범용 문구로
 * 원인을 감추지 않는다.
 */
async function startTicketBasedPlay(
  childId: string,
  playId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const issueTicket = (mode: "start" | "resume") =>
    fetch("/api/play/execution-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId, playId, mode }),
    });

  const readErrorReason = async (res: Response, fallback: string): Promise<string> => {
    try {
      const body = await res.json();
      return typeof body?.error === "string" ? body.error : fallback;
    } catch {
      return fallback;
    }
  };

  const firstRes = await issueTicket("start");

  if (firstRes.status === 402) {
    return { ok: false, reason: "insufficient_balance" };
  }
  if (firstRes.ok) {
    return { ok: true };
  }
  if (firstRes.status !== 409) {
    return { ok: false, reason: await readErrorReason(firstRes, `http_${firstRes.status}`) };
  }

  // 409: 서버가 "이미 진행중"이라고 판단 — 실제 이어하기 가능 여부를 재확인한다.
  const sessionRes = await fetch(`/api/play/session?child_id=${childId}&play_type=${playId}`);
  const sessionData = sessionRes.ok ? await sessionRes.json().catch(() => null) : null;

  if (sessionData?.canResume) {
    const resumeRes = await issueTicket("resume");
    if (resumeRes.ok) {
      return { ok: true };
    }
  }

  // 이어하기가 불가능한데도 409 — 만료 정리와 신규 예약 사이의 경쟁 상태일 수 있으니
  // "시작하기"를 한 번만 더 안전하게 재시도한다(직전 시도는 예약 자체가 거부됐으므로
  // 아무 것도 차감되지 않았다 — 중복 차감 아님).
  const retryRes = await issueTicket("start");
  if (retryRes.status === 402) {
    return { ok: false, reason: "insufficient_balance" };
  }
  if (retryRes.ok) {
    return { ok: true };
  }

  return { ok: false, reason: await readErrorReason(retryRes, `retry_failed_${retryRes.status}`) };
}

export default function ChildPlayPage() {
  const [childId, setChildId] = useState<string | null>(null);
  const [goldKeyBalance, setGoldKeyBalance] = useState<number | null>(null);

  const refetchBalance = useCallback(async (cid: string) => {
    try {
      const res = await fetch(`/api/goldkey/balance?childId=${cid}`);
      if (res.ok) {
        const data = await res.json();
        setGoldKeyBalance(data.balance);
      }
    } catch {}
  }, []);

  // States for flows
  const [selectedGame, setSelectedGame] = useState<typeof GAMES[0] | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [resumeCheckLoading, setResumeCheckLoading] = useState(false);
  const [canResume, setCanResume] = useState(false);
  // quizmaster 전용: /api/play/session이 돌려주는 quiz_attempts.id — 재차감 없는
  // 이어하기(claim)에 필요하다. 다른 놀이 타입은 이 값을 쓰지 않는다.
  const [resumeAttemptId, setResumeAttemptId] = useState<string | null>(null);
  
  const [isStarting, setIsStarting] = useState(false);
  
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);

  const [showGameScreen, setShowGameScreen] = useState(false);
  const [isLogoutProcessing, setIsLogoutProcessing] = useState(false);

  const handleLogout = async () => {
    if (isLogoutProcessing) return;
    if (window.confirm("로그아웃할까요?")) {
      setIsLogoutProcessing(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
      localStorage.removeItem("k_child_id");
      localStorage.removeItem("login_role");
      window.location.href = "/login?role=child";
    }
  };

  useEffect(() => {
    let active = true;
    const id = localStorage.getItem("k_child_id");
    if (id) {
      setChildId(id);
      refetchBalance(id);
    } else {
      fetch("/api/child/me")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (active && data?.id) {
            setChildId(data.id);
            localStorage.setItem("k_child_id", data.id);
            refetchBalance(data.id);
          }
        });
    }
    return () => { active = false; };
  }, [refetchBalance]);

  useEffect(() => {
    let active = true;
    if (childId) {
      fetch(`/api/play/refund-notification?child_id=${childId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (active && data?.notification) {
            alert(`정상적으로 시작되지 않아 황금열쇠를 ${data.notification.refunded_quantity}개 되돌렸어요.`);
            refetchBalance(childId);
          }
        });
    }
    return () => { active = false; };
  }, [childId, refetchBalance]);

  const handleGameClick = async (game: typeof GAMES[0]) => {
    // 아직 실제 게임 화면이 없는 placeholder(만화책/헤어스타일) — 황금열쇠 차감/시작
    // 확인 모달로 절대 이어지지 않게 여기서 즉시 종료한다(예약 API 호출 자체를 막음).
    if (game.comingSoon) {
      alert("열심히 준비하고 있어요.\n조금만 기다려 주세요!");
      return;
    }
    if (!childId) {
      alert("로그인 정보가 필요합니다. 다시 로그인해주세요.");
      return;
    }
    setSelectedGame(game);
    setResumeCheckLoading(true);
    setShowActionModal(true);
    try {
      const res = await fetch(`/api/play/session?child_id=${childId}&play_type=${game.id}`);
      if (res.ok) {
        const data = await res.json();
        setCanResume(data.canResume);
        setResumeAttemptId(game.id === "quizmaster" ? (data.sessionId ?? null) : null);
      } else {
        setCanResume(false);
        setResumeAttemptId(null);
      }
    } catch (e) {
      setCanResume(false);
      setResumeAttemptId(null);
    } finally {
      setResumeCheckLoading(false);
    }
  };

  const handleStart = async () => {
    if (!childId || !selectedGame) return;
    setIsStarting(true);
    try {
      if (selectedGame.id === "mbti") {
        // 딥 인터뷰 확정(.omc/specs/deep-interview-mbti-platform-connection.md ①②③):
        // MBTI는 독립 Vercel 프로젝트로 프록시되는 별도 전체화면 경로다. router.push
        // (소프트 내비게이션)가 아니라 하드 내비게이션을 쓴다 — Multi-Zones 경계를
        // 넘어가는 이동이라 Next.js 클라이언트 라우터가 이어서 처리할 수 없다.
        const result = await startTicketBasedPlay(childId, "mbti");

        if (result.ok) {
          setShowActionModal(false);
          window.location.assign("/play/mbti");
        } else if (result.reason === "insufficient_balance") {
          setIsStarting(false);
          setShowActionModal(false);
          setShowInsufficientModal(true);
          return;
        } else {
          alert(`놀이를 시작할 수 없어요. (사유: ${result.reason})\n잠시 후 다시 시도하거나 앱을 새로고침해주세요.`);
        }
      } else if (selectedGame.id === "quizmaster") {
        const res = await fetch("/api/quiz/start-handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId })
        });
        
        if (res.status === 402) {
          setIsStarting(false);
          setShowActionModal(false);
          setShowInsufficientModal(true);
          return;
        } else if (res.ok) {
          const { token } = await res.json();
          setShowActionModal(false);
          writeQuizSessionHandoff({ token, childId });
          // MBTI와 동일한 이유로 하드 내비게이션이다(계획 Phase 5.4): quiz_proxy
          // 게이트가 켜지면 /play/quiz는 인앱 Next.js 라우트가 아니라 독립 Quiz
          // 배포로 리버스 프록시되는 경로가 되므로, router.push는 존재하지 않는
          // RSC 페이로드를 기대하다 실패한다.
          window.location.assign("/play/quiz");
        } else {
          alert("퀴즈마스터를 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
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
          setIsStarting(false);
          setShowActionModal(false);
          setShowInsufficientModal(true);
          return;
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
            refetchBalance(childId);
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
        const res = await fetch("/api/play/execution-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId, playId: "mbti", mode: "resume" })
        });
        if (res.ok) {
          setShowActionModal(false);
          window.location.assign("/play/mbti");
        } else {
          alert("이어하기 처리에 실패했습니다.");
        }
      } catch (e) {
        alert("오류가 발생했습니다.");
      } finally {
        setIsStarting(false);
      }
    } else if (selectedGame.id === "quizmaster") {
      // 재차감 없는 이어하기(계획 Phase 5.1): start-handoff(황금열쇠 차감)를 호출하지
      // 않는다. claim(순수 재인증) 호출도 여기서 하지 않는다 — Quiz 앱이 자기 세션으로
      // 소유권을 확인한 뒤 자기 쪽 claim 엔드포인트를 호출하는 것이 주경로다.
      // K-Bestie는 attemptId만 넘기고(쿼리 + sessionStorage) 하드 내비게이션한다.
      setIsStarting(true);
      try {
        if (!resumeAttemptId) {
          alert("이어서 진행할 놀이를 찾지 못했어요. 다시 시도해주세요.");
          return;
        }
        setShowActionModal(false);
        writeQuizSessionHandoff({ token: "", childId, attemptId: resumeAttemptId });
        window.location.assign(`/play/quiz?resume=${encodeURIComponent(resumeAttemptId)}`);
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
        refetchBalance(childId);
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
      <div className="h-full flex flex-col overflow-hidden relative" style={{ background: "var(--background-page, #FFF9F2)" }}>
        
        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-[env(safe-area-inset-top,16px)] mt-4 h-[52px] z-10 w-full max-w-[480px] mx-auto bg-white/50 backdrop-blur-sm border-b border-black/5">
          <Link href="/child/home" className="w-[80px] h-[44px] flex items-center text-sm font-bold" style={{ color: "var(--color-k-navy)" }} aria-label="아이 홈으로 돌아가기">
            ← 뒤로
          </Link>
          <h1 className="flex-1 text-center text-base font-bold truncate px-2" style={{ color: "var(--color-k-navy)" }}>
            케이와 놀이
          </h1>
          <div className="w-[80px] flex justify-end">
            <button 
              onClick={handleLogout}
              disabled={isLogoutProcessing}
              className="w-[44px] h-[44px] flex items-center justify-center rounded-2xl bg-white/50 shadow-sm transition-transform active:scale-95"
              aria-label="로그아웃"
            >
              <LogOut size={20} color="var(--color-k-navy)" />
            </button>
          </div>
        </div>

        {/* 메인 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto w-full max-w-[480px] mx-auto pb-[180px] relative z-10">
          
          {/* 황금열쇠 보유 현황 카드 */}
          <div className="px-4 mt-5">
            <div className="bg-white rounded-[20px] shadow-sm flex items-center justify-between p-4" style={{ border: "1px solid rgba(226, 91, 18, 0.1)" }}>
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔑</span>
                {goldKeyBalance === null ? (
                  <div className="w-[56px] h-[20px] bg-black/10 rounded animate-pulse" />
                ) : (
                  <span className="font-bold text-base" style={{ color: "var(--color-k-navy)" }}>열쇠 {goldKeyBalance}개</span>
                )}
              </div>
              <Link 
                href="/child/missions" 
                className="px-4 py-2.5 rounded-[16px] font-bold text-sm text-white shadow-sm transition-transform active:scale-95 flex items-center justify-center min-h-[44px]"
                style={{ background: "var(--color-k-orange, #E25B12)" }}
                aria-label="미션으로 이동해 황금열쇠 모으기"
              >
                더 모으기 →
              </Link>
            </div>
          </div>

          {/* 열쇠로 열어요 */}
          <div className="px-4 mt-8">
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-k-navy)" }}>열쇠로 열어요</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 퀴즈마스터 */}
              {(() => {
                const game = GAMES.find(g => g.id === "quizmaster")!;
                return (
                  <button
                    key={game.id}
                    onClick={() => handleGameClick(game)}
                    className="flex flex-col rounded-[24px] p-5 shadow-sm active:scale-[0.98] transition-transform text-left border border-black/5"
                    style={{ background: "#EBF5FF" }}
                    aria-label={`퀴즈마스터, 황금열쇠 ${game.keys}개 필요`}
                  >
                    <div className="flex justify-between items-start w-full mb-4">
                      <div className="w-12 h-12 rounded-[16px] flex items-center justify-center text-2xl bg-white shadow-sm">
                        {game.icon}
                      </div>
                      <div className="bg-white/60 px-2 py-1 rounded-full text-xs font-bold text-blue-700 flex items-center gap-1">
                        {goldKeyBalance === null ? (
                          <div className="w-[100px] h-[16px] bg-blue-700/10 rounded animate-pulse" />
                        ) : goldKeyBalance >= game.keys ? (
                          <>🔓 시작할 수 있어요</>
                        ) : (
                          <>🔒 열쇠가 더 필요해요</>
                        )}
                      </div>
                    </div>
                    <h3 className="font-bold text-base mb-1" style={{ color: "var(--color-k-navy)" }}>{game.title}</h3>
                    <p className="text-sm font-bold text-blue-600">🔑 {game.keys}개 필요</p>
                  </button>
                );
              })()}

              {/* 오늘의 나 (MBTI) */}
              {(() => {
                const game = GAMES.find(g => g.id === "mbti")!;
                return (
                  <button
                    key={game.id}
                    onClick={() => handleGameClick(game)}
                    className="flex flex-col rounded-[24px] p-5 shadow-sm active:scale-[0.98] transition-transform text-left border border-black/5"
                    style={{ background: "#E8F5E9" }}
                    aria-label={`오늘의 나, 황금열쇠 ${game.keys}개 필요`}
                  >
                    <div className="flex justify-between items-start w-full mb-4">
                      <div className="w-12 h-12 rounded-[16px] flex items-center justify-center text-2xl bg-white shadow-sm">
                        {game.icon}
                      </div>
                      <div className="bg-white/60 px-2 py-1 rounded-full text-xs font-bold text-green-700 flex items-center gap-1">
                        {goldKeyBalance === null ? (
                          <div className="w-[100px] h-[16px] bg-green-700/10 rounded animate-pulse" />
                        ) : goldKeyBalance >= game.keys ? (
                          <>🔓 시작할 수 있어요</>
                        ) : (
                          <>🔒 열쇠가 더 필요해요</>
                        )}
                      </div>
                    </div>
                    <h3 className="font-bold text-base mb-1" style={{ color: "var(--color-k-navy)" }}>오늘의 나</h3>
                    <p className="text-sm text-green-800 mb-1 opacity-80">나의 성향 알아보기</p>
                    <p className="text-sm font-bold text-green-700">🔑 {game.keys}개 필요</p>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* 곧 만나요 */}
          <div className="px-4 mt-8">
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-k-navy)" }}>곧 만나요</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 만화책 읽기 */}
              {(() => {
                const game = GAMES.find(g => g.id === "comic_book")!;
                return (
                  <button
                    type="button"
                    key={game.id}
                    onClick={() => handleGameClick(game)}
                    className="flex flex-col rounded-[24px] p-5 shadow-sm text-left border border-black/5 opacity-70 bg-gray-100 cursor-default"
                  >
                    <div className="flex justify-between items-start w-full mb-4">
                      <div className="w-12 h-12 rounded-[16px] flex items-center justify-center text-2xl bg-white/50 grayscale">
                        {game.icon}
                      </div>
                      <div className="bg-gray-200 px-2 py-1 rounded-full text-xs font-bold text-gray-600">
                        준비 중
                      </div>
                    </div>
                    <h3 className="font-bold text-base mb-1 text-gray-600">{game.title}</h3>
                  </button>
                );
              })()}

              {/* 헤어스타일 */}
              {(() => {
                const game = GAMES.find(g => g.id === "hairstyle")!;
                return (
                  <button
                    type="button"
                    key={game.id}
                    onClick={() => handleGameClick(game)}
                    className="flex flex-col rounded-[24px] p-5 shadow-sm text-left border border-black/5 opacity-70 bg-gray-100 cursor-default"
                  >
                    <div className="flex justify-between items-start w-full mb-4">
                      <div className="w-12 h-12 rounded-[16px] flex items-center justify-center text-2xl bg-white/50 grayscale">
                        {game.icon}
                      </div>
                      <div className="bg-gray-200 px-2 py-1 rounded-full text-xs font-bold text-gray-600">
                        준비 중
                      </div>
                    </div>
                    <h3 className="font-bold text-base mb-1 text-gray-600">{game.title}</h3>
                  </button>
                );
              })()}
            </div>
          </div>

        </div>

        {/* 하단 케이 마스코트 영역 (Fixed) */}
        <div className="absolute bottom-0 w-full max-w-[480px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="flex items-end justify-between px-4 pb-[env(safe-area-inset-bottom,16px)] w-full relative">
            <div className="w-[120px] shrink-0 z-10 pointer-events-auto">
              <Image 
                src="/Images/mascot/mascot-standing.png" 
                alt="케이 마스코트" 
                width={120}
                height={120}
                className="w-full h-auto object-contain drop-shadow-md -mb-2"
                style={{ filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.1))" }}
                priority
              />
            </div>
            
            <div className="flex-1 flex flex-col items-end mb-4 ml-[-10px] pointer-events-auto z-20">
              <div className="relative bg-white px-4 py-3 rounded-2xl rounded-bl-sm border-2 shadow-sm mb-3 text-center max-w-full" style={{ borderColor: "var(--color-k-orange, #E25B12)" }}>
                <p className="text-[13px] sm:text-sm font-bold" style={{ color: "var(--color-k-navy)" }}>미션 하면 열쇠를 줄게!</p>
              </div>
              
              <Link 
                href="/child/missions"
                className="text-white font-bold py-3 px-5 rounded-[16px] shadow-md transition-transform active:scale-95 flex items-center min-h-[44px]"
                style={{ background: "var(--color-k-orange, #E25B12)" }}
              >
                미션하러 가기 →
              </Link>
            </div>
          </div>
        </div>

        {/* 1. 이어하기/시작하기 액션 모달 */}
        {showActionModal && selectedGame && !showFinalConfirm && !showGameScreen && !showInsufficientModal && (
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

        {/* 1-1. 황금열쇠 부족 모달 */}
        {showInsufficientModal && selectedGame && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-40 p-5">
            <div className="bg-white rounded-[28px] w-full max-w-sm p-6 shadow-2xl flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="text-4xl mb-3">🔑</div>
              <p className="font-bold text-gray-800 text-lg mb-2">황금열쇠가 부족해요</p>
              <p className="text-gray-600 text-sm mb-6">
                현재 {goldKeyBalance ?? 0}개 · 필요 {selectedGame.keys}개 · {Math.max(0, selectedGame.keys - (goldKeyBalance ?? 0))}개 부족
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowInsufficientModal(false)}
                  className="flex-1 py-3.5 rounded-2xl bg-gray-100 text-gray-600 font-bold active:scale-95 transition-transform"
                >
                  닫기
                </button>
                <Link
                  href="/child/missions"
                  className="flex-[1.2] py-3.5 rounded-2xl text-white font-bold shadow-md active:scale-95 transition-transform flex items-center justify-center"
                  style={{ background: "var(--color-k-orange, #E25B12)" }}
                >
                  미션하러 가기
                </Link>
              </div>
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

        {/* 3. 실제 게임 진행 화면 (comic_book/quiz/hairstyle — MBTI는 /play/mbti 네이티브 페이지로 이동) */}
        {showGameScreen && selectedGame && (
          <div className="absolute inset-0 bg-k-surface z-[60] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
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
        )}

      </div>
    
        <KChatbotWidget appSurface="child" />
      </DemoFrame>
  );
}
