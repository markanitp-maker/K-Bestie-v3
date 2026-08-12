"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";
import { getRecentKUtterances } from "@/lib/conversation/recentKUtterances";
import { AppTopHeader } from "@/components/AppTopHeader";
import { useKeyboardConversationViewport } from "@/hooks/useKeyboardConversationViewport";

export interface MissionTranscriptTurn {
  id: string;
  role: "child" | "k";
  text: string;
}

export interface MissionConversationLayoutProps {
  onClose: () => void;
  isClosing?: boolean;

  progressCurrent: number;
  progressTotal: number;

  history: MissionTranscriptTurn[];
  activeTurn: MissionTranscriptTurn | null;
  interimChildText?: string;

  voiceState: "idle" | "listening" | "thinking" | "speaking" | "connecting" | "reconnecting" | "error" | "no_input";
  
  isMuted: boolean;
  onToggleMute: () => void;

  isAuto: boolean;
  onChangeMode: (mode: "auto" | "manual") => void;

  isRecording: boolean;
  isMicDisabled: boolean;
  onMicClick: () => void;
  onMicStop?: () => void; // for manual mode to stop

  textInput: string;
  onChangeTextInput: (text: string) => void;
  onSendText: () => void;
  isTextMode: boolean;
  onToggleTextMode: () => void;

  hasError?: boolean;
  
  entryStatus?: "checking" | "ready_to_start" | "ready_to_resume" | "starting" | "resuming" | "active" | "error";
  onStartMission?: () => void;
  onResumeMission?: () => void;
  onExitBeforeStart?: () => void;
}

export function MissionConversationLayout({
  onClose,
  isClosing,
  progressCurrent,
  progressTotal,
  history,
  activeTurn,
  voiceState,
  isMuted,
  onToggleMute,
  isAuto,
  onChangeMode,
  isRecording,
  isMicDisabled,
  onMicClick,
  textInput,
  onChangeTextInput,
  onSendText,
  isTextMode,
  onToggleTextMode,
  hasError,
  entryStatus = "active",
  onStartMission,
  onResumeMission,
  onExitBeforeStart
}: MissionConversationLayoutProps) {
  // Extract turns
  const allTurns = activeTurn ? [...history, activeTurn] : history;

  // 048 hotfix: 1·2·3 영역은 화자별 채팅이 아니라 "케이가 실제로 말한 발화"만의
  // 최근 3단계 타임라인이다(아이 발화는 어디에도 노출하지 않는다). 미션·자유대화가
  // 동일한 규칙을 쓰도록 공유 selector로 계산한다.
  const { current: currentKText, previous: prevKText, older: olderKText } = getRecentKUtterances(allTurns);

  let currentQuestionText = currentKText || "케이가 질문을 준비하고 있어요...";
  if (entryStatus === "checking") {
    currentQuestionText = "미션을 확인하고 있어요.";
  } else if (entryStatus === "starting") {
    currentQuestionText = "준비 중...";
  } else if (entryStatus === "resuming") {
    currentQuestionText = "불러오는 중...";
  }

  // Text mode disables microphone input. Do not present a stale Live AUTO state as
  // active listening while the child is typing and no recording is in progress.
  const displayVoiceState = isTextMode && !isRecording && (voiceState === "listening" || voiceState === "no_input")
    ? "idle"
    : voiceState;

  // Map state
  let stateText = "";
  let StateIcon = null;
  switch (displayVoiceState) {
    case "listening":
    case "no_input":
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
    case "reconnecting":
      stateText = "다시 연결 중";
      StateIcon = <div className="w-5 h-5 border-[2.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
      break;
    case "error":
      stateText = "연결 오류";
      StateIcon = <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
      break;
    default:
      stateText = "대기 중";
  }

  // Override voiceState if entryStatus is not active
  if (entryStatus === "checking") {
    stateText = "확인 중";
    StateIcon = <div className="w-5 h-5 border-[2.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
  } else if (entryStatus === "ready_to_start") {
    stateText = "시작 전";
    StateIcon = <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />;
  } else if (entryStatus === "ready_to_resume") {
    stateText = "중단됨";
    StateIcon = <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />;
  } else if (entryStatus === "starting") {
    stateText = "준비 중";
    StateIcon = <div className="w-5 h-5 border-[2.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
  } else if (entryStatus === "resuming") {
    stateText = "불러오는 중";
    StateIcon = <div className="w-5 h-5 border-[2.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
  }

  // 진행 중(isDone===false → isClosing===false) 구간에서도 연속 클릭으로 stopSession/라우팅이
  // 중복 실행되지 않도록 컴포넌트 로컬로 한 번 더 잠근다(부모의 isClosing은 미션 완료 여부만 반영).
  const [closeRequested, setCloseRequested] = useState(false);
  const handleCloseClick = () => {
    if (closeRequested) return;
    setCloseRequested(true);
    if (entryStatus === "ready_to_start" || entryStatus === "checking" || entryStatus === "starting" || entryStatus === "ready_to_resume" || entryStatus === "resuming") {
      onExitBeforeStart?.();
    } else {
      onClose();
    }
  };

  const { viewportHeight, isKeyboardOpen } = useKeyboardConversationViewport();

  // The conversation viewport is intentionally measured after the current bubble.  Older
  // messages are optional UI, while the active question must never be clipped or squeezed.
  const conversationAreaRef = useRef<HTMLDivElement>(null);
  const currentBubbleRef = useRef<HTMLDivElement>(null);
  const previousMeasureRef = useRef<HTMLDivElement>(null);
  const olderMeasureRef = useRef<HTMLDivElement>(null);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(0);
  const currentBottomPadding = 32;
  const historyGap = 10;

  const updateVisibleHistoryCount = useCallback(() => {
    if (!conversationAreaRef.current || !currentBubbleRef.current || entryStatus !== "active") {
      setVisibleHistoryCount(0);
      return;
    }

    const availableHeight = conversationAreaRef.current.clientHeight - currentBottomPadding;
    const currentHeight = currentBubbleRef.current.offsetHeight;
    const previousHeight = previousMeasureRef.current?.offsetHeight ?? 0;
    const olderHeight = olderMeasureRef.current?.offsetHeight ?? 0;
    let nextCount = 0;
    let usedHeight = currentHeight;

    // Keep each optional bubble whole. A message that cannot fit is not rendered, so the
    // previous layout's partially obscured bubbles cannot occur.
    if (prevKText && usedHeight + historyGap + previousHeight <= availableHeight) {
      nextCount = 1;
      usedHeight += historyGap + previousHeight;
    }
    if (olderKText && nextCount === 1 && usedHeight + historyGap + olderHeight <= availableHeight) {
      nextCount = 2;
    }
    setVisibleHistoryCount((count) => (count === nextCount ? count : nextCount));
  }, [currentBottomPadding, entryStatus, olderKText, prevKText]);

  useLayoutEffect(() => {
    updateVisibleHistoryCount();

    const resizeObserver = new ResizeObserver(updateVisibleHistoryCount);
    [conversationAreaRef.current, currentBubbleRef.current, previousMeasureRef.current, olderMeasureRef.current]
      .filter((element): element is HTMLDivElement => element !== null)
      .forEach((element) => resizeObserver.observe(element));

    return () => resizeObserver.disconnect();
  }, [currentQuestionText, updateVisibleHistoryCount]);

  // 100dvh는 최신 모바일 브라우저(iOS Safari 15+ 등)에서 키보드 등장 시 동적으로
  // 잘 대응되므로, 억지로 viewportHeight px를 강제 주입하면 오히려 resize 시
  // 화면이 튀는 현상(jitter)이 발생할 수 있습니다.
  // 우측으로 밀리거나 잘리는 문제는 viewport 높이보다는 flex/grid 내의 
  // min-width: 0 또는 width: 100vw 사용이 주 원인이므로 가로폭 안전 조건에 집중합니다.

  const [lastProgress, setLastProgress] = useState(progressCurrent);
  const [scaleStar, setScaleStar] = useState(-1);
  useEffect(() => {
    if (progressCurrent > lastProgress) {
      setScaleStar(progressCurrent - 1);
      setTimeout(() => setScaleStar(-1), 200);
      setLastProgress(progressCurrent);
    } else if (progressCurrent < lastProgress) {
      setLastProgress(progressCurrent);
    }
  }, [progressCurrent, lastProgress]);

  return (
    // overflowY 는 의도적으로 hidden이 아니라 auto다: Grid Row 2가 minmax(0,1fr)로
    // 히스토리부터 줄여가며 현재 발화 공간을 최대한 확보하지만, 현재 발화 자체가
    // 극단적으로 길어 그 최소 공간조차 넘어서는 경우 hidden이면 상단이 조용히
    // 잘린다. auto는 그 극단적인 경우에만 스크롤로 전체 표시를 보장하는
    // 최후 방어선이고, 평소에는 콘텐츠가 뷰포트 안에 들어와 스크롤이 나타나지 않는다.
    <div className="w-full h-[100dvh] flex justify-center bg-[#D5ECFF]" style={{ overflowX: "hidden", overflowY: "auto" }}>
      <div className="w-full max-w-[480px] min-w-0 h-[100dvh] relative box-border grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto_auto]" style={{ background: "linear-gradient(180deg, #D8EEFF 0%, #EAF6FB 46%, #FFF9EE 76%, #FFF4E6 100%)" }}>
        
        {/* Decorations */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
          {/* Soft cloud peeking in from the upper-right edge. */}
          <div className="absolute top-[22%] -right-[25px] w-[112px] h-[48px]">
            <div className="absolute bottom-0 right-0 w-[98px] h-[30px] rounded-full bg-white/72 shadow-[0_5px_18px_rgba(100,150,180,0.05)]" />
            <div className="absolute bottom-[14px] right-[45px] w-[45px] h-[45px] rounded-full bg-white/72" />
            <div className="absolute bottom-[10px] right-[13px] w-[57px] h-[57px] rounded-full bg-white/72" />
          </div>
          <div className="absolute top-[47%] -left-[34px] w-[92px] h-[42px] opacity-65">
            <div className="absolute bottom-0 left-0 w-[86px] h-[25px] rounded-full bg-white" />
            <div className="absolute bottom-[10px] left-[28px] w-[39px] h-[39px] rounded-full bg-white" />
          </div>
          <div className="absolute top-[17%] left-[8%] w-[11px] h-[7px] rounded-[2px] bg-[#F38D75]/85 -rotate-[24deg]" />
          <div className="absolute top-[14%] right-[13%] w-[8px] h-[15px] rounded-[2px] bg-[#89D48A]/75 rotate-[24deg]" />
          <div className="absolute top-[25%] left-[9%] text-[22px] leading-none text-[#F6B33F]/70 -rotate-12">☆</div>
          <div className="absolute top-[42%] right-[9%] text-[21px] leading-none text-[#F5A623]/65 rotate-12">☆</div>
          <div className="absolute top-[35%] left-[13%] text-[13px] leading-none text-white/80">✦</div>
          <div className="absolute top-[31%] right-[18%] text-[10px] leading-none text-[#F6A21A]/45">✦</div>
        </div>

        {/* 공통 헤더 */}
        <div className="absolute top-0 left-0 right-0 z-50 pointer-events-auto">
          <AppTopHeader title="미션" onBack={handleCloseClick} />
        </div>

        {/* Grid Row 1: Top Area */}
        <div className="relative z-10 flex flex-col shrink-0 w-full min-w-0 max-w-full">
          {/* Star progress display: progress calculation remains owned by the mission page. */}
          <div className="mt-[calc(61px+env(safe-area-inset-top))] mx-auto w-[90%] max-w-[400px] min-w-0 h-[clamp(46px,6dvh,50px)] bg-white/90 rounded-full shadow-[0_3px_10px_rgba(75,85,99,0.10)] flex items-center px-[clamp(12px,3.5vw,16px)] relative z-10 shrink-0" aria-label={`미션 진행률 ${progressCurrent} / ${progressTotal}`}>
            <div className="flex w-full justify-center gap-[clamp(2px,1vw,6px)] h-full items-center">
              {Array.from({length: progressTotal}).map((_, i) => {
                const isFilled = i < progressCurrent;
                const isAnimating = i === scaleStar;
                return (
                  <div key={i} className="relative flex items-center justify-center min-w-0" style={{ transform: isAnimating ? "scale(1.28)" : "scale(1)", transition: "transform 180ms ease-out" }}>
                    <svg viewBox="0 0 24 24" className={`w-[clamp(20px,6.5vw,28px)] h-[clamp(20px,6.5vw,28px)] drop-shadow-[0_1px_1px_rgba(224,144,0,0.18)] transition-colors duration-300 ${isFilled ? "fill-[#F6A21A] stroke-[#E99000]" : "fill-[#DDE6EF] stroke-[#C8D5E1]"}`} strokeWidth="1.25" aria-hidden="true">
                      <path d="m12 2.7 2.84 5.76 6.36.92-4.6 4.48 1.09 6.33L12 17.2l-5.69 2.99 1.09-6.33-4.6-4.48 6.36-.92L12 2.7Z" />
                    </svg>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Keep the conversation close to the progress display without crowding it. */}
          <div className="h-[clamp(12px,2dvh,20px)] w-full shrink-0" />
        </div>

        {/* Grid Row 2: current question first; history is added only when its measured whole
            bubble fits. The 32px bottom padding minus the 12px tail keeps a 20px mascot gap. */}
        <div ref={conversationAreaRef} className={`relative z-10 flex flex-col items-center justify-end min-h-0 w-full h-full min-w-0 max-w-full px-[clamp(14px,4vw,22px)] pb-8 ${isTextMode ? 'overflow-y-auto overflow-x-hidden' : 'overflow-visible'}`}>

          <div className="flex flex-col items-center w-full min-h-0 max-h-full">
            {visibleHistoryCount > 0 && (
              <div className="flex flex-col justify-start items-center w-full shrink-0 mb-[10px]">
                {visibleHistoryCount === 2 && olderKText && (
                  <div className="relative min-h-0 mb-[clamp(7px,1dvh,9px)] text-[#798896]/65 text-[clamp(13px,3.5vw,15px)] leading-[1.42] text-center max-w-[76%] font-medium shrink-0" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                    <span className="absolute -left-[18px] top-1/2 -translate-y-1/2 text-[11px] text-white/85" aria-hidden="true">✦</span>
                    {olderKText}
                  </div>
                )}
                {prevKText && (
                  <div className="relative min-h-0 bg-white/86 backdrop-blur-[2px] px-[clamp(16px,4.5vw,19px)] py-[clamp(10px,1.35dvh,12px)] rounded-[17px] text-[clamp(14px,3.8vw,16px)] leading-[1.43] text-[#3F4A54] shadow-[0_3px_10px_rgba(63,83,98,0.08)] w-fit max-w-[77%] text-left shrink-0" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                    <span className="absolute -left-[27px] top-1/2 -translate-y-1/2 text-[21px] leading-none text-[#F6B33F]/65 -rotate-12" aria-hidden="true">☆</span>
                    {prevKText}
                  </div>
                )}
              </div>
            )}

            {/* Current Bubble (never yields before the older history) */}
            <div className="relative z-20 flex flex-col items-center w-full min-w-0 max-w-full shrink-0">
            {entryStatus === "ready_to_start" || entryStatus === "ready_to_resume" ? (
              <button
                onClick={entryStatus === "ready_to_start" ? onStartMission : onResumeMission}
                disabled={isClosing}
                aria-label={
                  entryStatus === "ready_to_start"
                    ? "새 미션 시작하기"
                    : `진행 중인 미션 이어하기, 현재 진행률 ${progressCurrent}단계 중 ${progressTotal}단계`
                }
                className="relative z-20 w-[86%] max-w-[350px] mx-auto bg-white rounded-[20px] border-[2px] border-[#F58A34] shadow-[0_5px_15px_rgba(211,102,29,0.14)] px-[20px] flex flex-col justify-center items-center min-h-[88px] shrink-0 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <div className="text-[var(--color-k-navy)] text-[clamp(22px,6vw,26px)] font-[700]">
                  {entryStatus === "ready_to_start" ? "시작하기" : "이어하기"}
                </div>
                {/* Triangle tail */}
                <div className="absolute -bottom-[12.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-transparent border-t-[var(--color-k-orange)]" />
                <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent border-t-white" />
              </button>
            ) : (
              <div ref={currentBubbleRef} data-ui="current-bubble" className="relative z-20 w-[86%] max-w-[350px] mx-auto bg-white rounded-[20px] border-[2px] border-[#F58A34] shadow-[0_5px_15px_rgba(211,102,29,0.14)] px-[clamp(20px,5.5vw,23px)] py-[clamp(15px,2dvh,18px)] flex flex-col min-w-0">
                <div className="w-full min-w-0">
                  <p className="text-center text-[#211D1B] text-[clamp(18px,5vw,21px)] font-[800] tracking-[-0.015em] leading-[1.4] whitespace-pre-wrap break-words" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                    {currentQuestionText}
                  </p>
                </div>
                {/* Triangle tail */}
                <div className="absolute -bottom-[12.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-transparent border-t-[var(--color-k-orange)]" />
                <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent border-t-white" />
              </div>
            )}
            </div>

            {/* Invisible, same-width measurement candidates. They never occupy layout space;
                their heights decide whether React renders each older message above. */}
            <div className="absolute invisible pointer-events-none w-full flex flex-col items-center" aria-hidden="true">
              {prevKText && (
                <div ref={previousMeasureRef} className="relative bg-white/86 px-[clamp(16px,4.5vw,19px)] py-[clamp(10px,1.35dvh,12px)] rounded-[17px] text-[clamp(14px,3.8vw,16px)] leading-[1.43] text-[#3F4A54] shadow-[0_3px_10px_rgba(63,83,98,0.08)] w-fit max-w-[77%] text-left" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                  {prevKText}
                </div>
              )}
              {olderKText && (
                <div ref={olderMeasureRef} className="relative mt-[10px] text-[#798896]/65 text-[clamp(13px,3.5vw,15px)] leading-[1.42] text-center max-w-[76%] font-medium" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                  {olderKText}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Grid Row 3: Mascot Area & Side Cards OR Text-Mode CTA.
            Text mode keeps K's state visible even while the software keyboard is open. */}
        <div className="relative w-full shrink-0 h-[clamp(204px,25.5dvh,228px)] transition-all duration-300 flex items-center justify-center">
           {isTextMode ? (
             /* Text overlay retains K's latest state above the close CTA. */
             <div className="relative z-30 flex flex-col items-center justify-center gap-4 my-auto pointer-events-auto animate-in fade-in duration-300">
               <div
                 data-ui="text-mode-voice-state"
                 data-keyboard-open={isKeyboardOpen}
                 className="flex items-center gap-2 rounded-full border border-white/80 bg-white/85 px-4 py-2 text-[#5F7181] shadow-[0_3px_10px_rgba(75,85,99,0.10)] backdrop-blur-md"
                 aria-live="polite"
                 aria-busy={entryStatus === "checking" || entryStatus === "starting" || entryStatus === "resuming"}
               >
                 <div data-ui="text-mode-state-icon" className="flex h-[clamp(40px,10.5vw,46px)] w-[clamp(40px,10.5vw,46px)] items-center justify-center">
                   {StateIcon}
                 </div>
                 <span className="text-[14px] font-bold leading-none">{stateText}</span>
               </div>
               <button
                 onClick={onToggleTextMode}
                 disabled={isClosing}
                 style={{ backgroundColor: "#EF5350" }}
                 className="h-[68px] min-w-[270px] px-9 rounded-full text-white font-[700] text-[21px] shadow-xl shadow-red-300/40 flex items-center justify-center gap-3 cursor-pointer active:scale-95 hover:bg-[#E53935] transition-all border border-red-300/30 disabled:opacity-50"
                 aria-label="채팅창 닫기"
               >
                 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                 <span>채팅창 닫기</span>
               </button>
             </div>
           ) : (
             /* isTextMode === false: 케이 마스코트 & Platform & lightweight states */
             <div data-ui="mascot-stage" className="relative z-10 w-full h-full min-w-0 max-w-full">
               {/* Left Mute Control */}
               <button onClick={onToggleMute} disabled={isClosing} className="absolute z-30 left-[clamp(17px,6vw,30px)] top-[43%] -translate-y-1/2 flex w-[clamp(66px,18vw,78px)] flex-col items-center justify-center active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                 <div className="w-[clamp(40px,10.5vw,46px)] h-[clamp(40px,10.5vw,46px)] rounded-full bg-white/72 flex items-center justify-center text-[#637486] mb-[5px]">
                   {isMuted ? (
                     <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                   ) : (
                     <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                   )}
                 </div>
                 <span className="text-[clamp(13px,3.55vw,15px)] leading-[1.15] font-bold text-[#5F7181] text-center break-keep">{isMuted ? '소리 꺼짐' : '소리 켜짐'}</span>
               </button>

               {/* Mascot & Platform */}
               <div className="absolute inset-0 flex flex-col items-center justify-end">
                  {/* A quiet ring keeps the character readable without becoming the focal point. */}
                  <div className="absolute left-1/2 top-[4px] -translate-x-1/2 w-[clamp(185px,51vw,214px)] h-[clamp(185px,51vw,214px)] rounded-full border border-[#F7C46B]/30 bg-[#FFF4D8]/16 pointer-events-none" />
                  {/* Mascot */}
                  <div data-ui="mascot" className="relative z-20 flex justify-center items-end pb-[clamp(37px,4.8dvh,43px)]">
                    <KBestieMascotAnimation state={voiceState === "speaking" ? "talking" : "idle"} size={202} className="!w-[clamp(188px,51.8vw,208px)] !h-auto object-contain drop-shadow-[0_7px_5px_rgba(109,74,39,0.13)]" />
                  </div>
                  {/* Platform */}
                  <div data-ui="platform" className="absolute z-10 bottom-0 w-[clamp(282px,82vw,340px)] h-[clamp(54px,7.8dvh,66px)] pointer-events-none drop-shadow-[0_8px_7px_rgba(142,91,48,0.14)]">
                    {/* Top oval */}
                    <div className="absolute top-0 w-full h-[53%] bg-gradient-to-b from-[#FFFDF7] to-[#FFF3DF] rounded-[100%] border-[1.5px] border-[#EAB889] shadow-[inset_0_-4px_7px_rgba(211,154,98,0.12)] z-20" />
                    {/* Side cylinder */}
                    <div className="absolute top-[27%] left-[1px] right-[1px] h-[68%] bg-gradient-to-b from-[#FFEBD2] via-[#FBE1C5] to-[#F5D5B5] rounded-b-[48%] border-x border-b border-[#E8B17E] shadow-[inset_0_-5px_8px_rgba(184,118,62,0.10)]" />
                    {/* Shadow on platform */}
                    <div className="absolute top-[11%] left-[20%] w-[60%] h-[25%] bg-[#8A5A34]/10 rounded-[100%] z-20 blur-[3px]" />
                  </div>
               </div>

               {/* Right Voice State */}
               <div
                 className="absolute z-30 right-[clamp(17px,6vw,30px)] top-[43%] -translate-y-1/2 flex w-[clamp(66px,18vw,78px)] min-w-0 flex-col items-center justify-center"
                 aria-live="polite"
                 aria-busy={entryStatus === "checking" || entryStatus === "starting" || entryStatus === "resuming"}
               >
                  <div className="w-[clamp(40px,10.5vw,46px)] h-[clamp(40px,10.5vw,46px)] rounded-full bg-white/72 flex items-center justify-center text-[#637486] mb-[5px]">
                    {StateIcon}
                  </div>
                  <span className="text-[clamp(13px,3.55vw,15px)] leading-[1.15] font-bold text-[#5F7181] text-center break-keep">{stateText}</span>
               </div>
             </div>
           )}
        </div>

        {/* Grid Row 4: Bottom Area */}
        <div className="relative z-20 row-start-4 flex flex-col shrink-0 w-full min-w-0 max-w-full">
          {/* Auto/Manual Mode Toggles */}
          {!isTextMode && !isKeyboardOpen && (
          <div className="flex justify-center -mt-[clamp(18px,2.4dvh,21px)] h-[clamp(38px,4.8dvh,42px)] shrink-0 relative z-40">
            <div data-ui="mode-toggle" className="flex w-[clamp(136px,38vw,152px)] h-full p-[3px] rounded-full bg-white border border-[#E7C9A8] shadow-[0_4px_9px_rgba(133,86,42,0.15)]">
             <button onClick={() => onChangeMode('auto')} disabled={isClosing || entryStatus !== "active"} aria-pressed={isAuto} className={`relative flex-1 flex items-center justify-center rounded-full transition-colors cursor-pointer ${isAuto ? 'bg-[#FFC84A] border border-[#E99B13] text-[#5C3B12] font-extrabold shadow-[0_2px_5px_rgba(191,122,15,0.22)]' : 'text-[#4E5965] font-semibold'} text-[clamp(13px,3.5vw,15px)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
               자동
             </button>
             <button onClick={() => onChangeMode('manual')} disabled={isClosing || entryStatus !== "active"} aria-pressed={!isAuto} className={`relative flex-1 flex items-center justify-center rounded-full transition-colors cursor-pointer ${!isAuto ? 'bg-[#FFC84A] border border-[#E99B13] text-[#5C3B12] font-extrabold shadow-[0_2px_5px_rgba(191,122,15,0.22)]' : 'text-[#4E5965] font-semibold'} text-[clamp(13px,3.5vw,15px)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
               수동
             </button>
            </div>
          </div>
          )}

          {/* Spacer between mode and mic */}
          {!isTextMode && !isKeyboardOpen && (
          <div className="h-[clamp(12px,1.8dvh,16px)] w-full shrink-0" />
          )}

          {/* Bottom Inputs Area - 미션 하단 UI 원본 100% 복원 (주황 테두리 input + 주황 52px 전송 + 흰색 52px X) */}
          <div className="relative z-30 w-full min-w-0 max-w-full shrink-0 flex items-center justify-center pb-[calc(clamp(18px,2.5dvh,24px)+env(safe-area-inset-bottom))]">
            {isTextMode ? (
              <div
                className="w-full min-w-0 flex gap-2 box-border"
                style={{
                  paddingLeft: "max(16px, env(safe-area-inset-left))",
                  paddingRight: "max(16px, env(safe-area-inset-right))",
                }}
              >
                <input
                  ref={(el) => { if (el && !isClosing) el.focus(); }}
                  type="text"
                  value={textInput}
                  onChange={(e) => onChangeTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendText(); }
                  }}
                  placeholder="케이에게 텍스트로 답하기..."
                  disabled={isClosing || entryStatus !== "active"}
                  className="flex-1 min-w-0 bg-white/90 backdrop-blur-md px-4 py-3.5 rounded-2xl text-[16px] font-medium text-gray-800 shadow-sm border border-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-k-orange)] focus:border-[var(--color-k-orange)] transition-colors disabled:opacity-50"
                  maxLength={200}
                />
                <button
                  onClick={onSendText}
                  disabled={!textInput.trim() || isClosing || entryStatus !== "active"}
                  className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shadow-md bg-[var(--color-k-orange)] active:scale-95 transition-all"
                  aria-label="전송"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
                <button
                  onClick={onToggleTextMode}
                  disabled={isClosing}
                  className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center bg-white shadow-sm text-gray-600 cursor-pointer active:scale-95 border border-gray-200 disabled:opacity-40 transition-all"
                  aria-label="텍스트 입력창 닫기"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ) : (
              <div className="w-full flex items-center justify-center h-[clamp(92px,24vw,100px)] relative">
                {/* Keyboard Button */}
                <div className="absolute left-[clamp(8px,2vw,16px)] flex w-[clamp(112px,29vw,128px)] flex-col items-center gap-1">
                  <button
                    onClick={onToggleTextMode}
                    disabled={isClosing || entryStatus !== "active" || isRecording}
                    className="w-[clamp(46px,12vw,50px)] h-[clamp(46px,12vw,50px)] bg-white/85 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-[0_3px_10px_rgba(75,85,99,0.10)] border border-gray-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="텍스트로 답하기"
                    aria-describedby={isRecording ? "keyboard-recording-hint" : undefined}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/><line x1="14" y1="12" x2="14.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
                  </button>
                  {isRecording && (
                    <span id="keyboard-recording-hint" className="text-center text-[11px] font-bold leading-tight text-[#B45309]">
                      녹음을 먼저 끝내 주세요
                    </span>
                  )}
                </div>

                {/* Main Mic Button */}
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-[clamp(100px,27vw,108px)] h-[clamp(100px,27vw,108px)] rounded-full bg-[#FF9B3F]/13 border border-[#FFD2A6]/80" />
                  {isRecording && (
                    <>
                      <div className="absolute w-[clamp(102px,27vw,112px)] h-[clamp(102px,27vw,112px)] rounded-full bg-[var(--color-k-orange)] opacity-20 animate-ping motion-reduce:animate-none" />
                      <div className="absolute w-[clamp(116px,31vw,128px)] h-[clamp(116px,31vw,128px)] rounded-full bg-[var(--color-k-orange)] opacity-10 animate-pulse motion-reduce:animate-none" />
                    </>
                  )}
                  <button 
                    onClick={onMicClick} 
                    disabled={isMicDisabled || entryStatus !== "active"} 
                    className={`w-[clamp(88px,24vw,96px)] h-[clamp(88px,24vw,96px)] rounded-full flex items-center justify-center text-white border-[4px] border-[#FFF3DF] ring-2 ring-[#F6A35D] shadow-[0_7px_19px_rgba(211,81,24,0.38)] z-10 transition-all duration-200 ${(isMicDisabled || entryStatus !== "active") ? 'opacity-60 cursor-not-allowed bg-gray-400' : 'cursor-pointer active:scale-95 bg-gradient-to-b from-[#FF8A2A] to-[#F16A18]'}`}
                    aria-label={isRecording ? "녹음 종료" : "마이크 켜기"}
                  >
                    {isRecording ? (
                      <div className="w-[24px] h-[24px] rounded-sm bg-white" />
                    ) : (isMicDisabled || entryStatus !== "active") ? (
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4m-4 0h8"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
                    ) : (
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}
