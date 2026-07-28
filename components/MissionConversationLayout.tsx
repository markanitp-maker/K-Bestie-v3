"use client";

import React, { useEffect, useRef, useState } from "react";
import { KBestieMascotAnimation } from "@/components/KBestieMascotAnimation";

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
}

export function MissionConversationLayout({
  onClose,
  isClosing,
  progressCurrent,
  progressTotal,
  history,
  activeTurn,
  interimChildText,
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
  hasError
}: MissionConversationLayoutProps) {
  // Extract turns
  const allTurns = activeTurn ? [...history, activeTurn] : history;
  
  const lastKIndex = allTurns.findLastIndex(t => t.role === 'k');
  const currentQuestionText = lastKIndex >= 0 ? allTurns[lastKIndex].text : "케이가 질문을 준비하고 있어요...";
  
  const childTurnsBeforeK = allTurns.slice(0, lastKIndex >= 0 ? lastKIndex : allTurns.length).filter(t => t.role === 'child');
  const prevChildText = childTurnsBeforeK.length > 0 ? childTurnsBeforeK[childTurnsBeforeK.length - 1].text : "";

  const kTurnsBeforeK = allTurns.slice(0, lastKIndex >= 0 ? lastKIndex : allTurns.length).filter(t => t.role === 'k');
  const prevKText = kTurnsBeforeK.length > 0 ? kTurnsBeforeK[kTurnsBeforeK.length - 1].text : "";

  // Map state
  let stateText = "";
  let StateIcon = null;
  switch (voiceState) {
    case "listening":
    case "no_input":
      stateText = "듣는 중";
      StateIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
      break;
    case "thinking":
      stateText = "생각 중";
      StateIcon = <div className="flex gap-0.5"><div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"0ms"}}/><div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"150ms"}}/><div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce motion-reduce:animate-none" style={{animationDelay:"300ms"}}/></div>;
      break;
    case "speaking":
      stateText = "말하는 중";
      StateIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
      break;
    case "connecting":
      stateText = "연결 중";
      StateIcon = <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
      break;
    case "reconnecting":
      stateText = "다시 연결 중";
      StateIcon = <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin motion-reduce:animate-none" />;
      break;
    case "error":
      stateText = "연결 오류";
      StateIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
      break;
    default:
      stateText = "대기 중";
      StateIcon = <div className="w-2 h-2 rounded-full bg-gray-300" />;
      break;
  }

  // 진행 중(isDone===false → isClosing===false) 구간에서도 연속 클릭으로 stopSession/라우팅이
  // 중복 실행되지 않도록 컴포넌트 로컬로 한 번 더 잠근다(부모의 isClosing은 미션 완료 여부만 반영).
  const [closeRequested, setCloseRequested] = useState(false);
  const handleCloseClick = () => {
    if (closeRequested) return;
    setCloseRequested(true);
    onClose();
  };

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
    <div className="w-full h-[100dvh] flex justify-center bg-[#D5ECFF]" style={{ overflow: "hidden" }}>
      <div className="w-full max-w-[480px] h-full flex flex-col relative" style={{ background: "linear-gradient(to bottom, #D5ECFF 0%, #F4F7F5 50%, #FFF5E8 100%)" }}>
        
        {/* Decorations */}
        <div className="absolute inset-0 pointer-events-none opacity-30 overflow-hidden">
          {/* Simple CSS shapes for decorations as per requirement not to use heavy canvas */}
          <div className="absolute top-[10%] left-[10%] w-16 h-8 bg-white rounded-full blur-[2px]" />
          <div className="absolute top-[20%] right-[15%] w-12 h-6 bg-white rounded-full blur-[2px]" />
          <div className="absolute top-[15%] left-[50%] w-2 h-2 bg-yellow-200 rounded-full blur-[1px]" />
          <div className="absolute top-[40%] left-[20%] w-3 h-3 bg-yellow-100 rounded-full blur-[1px]" />
          <div className="absolute top-[60%] right-[10%] w-10 h-10 bg-white/50 rounded-lg rotate-12 blur-[1px]" />
          <div className="absolute top-[75%] left-[15%] w-8 h-8 bg-white/40 rounded-full blur-[1px]" />
        </div>

        {/* Top Right Close Button */}
        <div className="absolute top-0 right-0 p-[calc(10px+env(safe-area-inset-top))] z-50">
          <button onClick={handleCloseClick} disabled={isClosing || closeRequested} className="w-[44px] h-[44px] flex items-center justify-center cursor-pointer disabled:opacity-50 active:scale-95 text-gray-700">
            <svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Pill Progress Bar */}
        <div className="mt-[calc(54px+env(safe-area-inset-top))] mx-auto w-[90%] max-w-[400px] h-[44px] bg-white rounded-full shadow-sm flex items-center px-4 relative z-10 shrink-0">
          <div className="flex w-full justify-between gap-1.5 h-full py-2.5">
            {Array.from({length: progressTotal}).map((_, i) => {
              const isFilled = i < progressCurrent;
              const isAnimating = i === scaleStar;
              return (
                <div key={i} className="flex-1 relative flex items-center justify-center">
                  <div 
                    className={`w-full h-full rounded-full transition-colors duration-300 ${isFilled ? 'bg-[var(--color-k-orange)]' : 'bg-[#D5ECFF]'}`} 
                    style={{ transform: isAnimating ? 'scale(1.3)' : 'scale(1)', transition: 'transform 150ms ease-out, background-color 300ms' }}
                  />
                  {isFilled && <div className="absolute inset-0 rounded-full border border-yellow-300/50" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Previous Chat Summary Area (Flexible) */}
        <div className="flex-1 flex flex-col justify-end items-center pb-3 z-10 px-4 min-h-[40px] w-full">
          {interimChildText ? (
            // 확정 답변이 아닌 실시간 중간 자막 — 진행률/유효답변 판정에는 영향 없음, 표시만.
            <div className="text-gray-400 text-[13px] text-center max-w-[85%] line-clamp-2 mb-2 font-medium italic">
              {interimChildText}
            </div>
          ) : prevChildText && (
            <div className="text-gray-500 text-[13px] text-center max-w-[85%] line-clamp-2 mb-2 font-medium">
              {prevChildText}
            </div>
          )}
          {prevKText && (
            <div className="bg-white/70 backdrop-blur-md px-4 py-2.5 rounded-2xl text-[13px] text-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.04)] max-w-[85%] line-clamp-4 text-center">
              {prevKText}
            </div>
          )}
        </div>

        {/* Current Question Bubble */}
        <div className="relative z-20 w-[84%] mx-auto bg-white rounded-[20px] border-[2.5px] border-[var(--color-k-orange)] shadow-[0_4px_16px_rgba(224,90,63,0.15)] px-[18px] py-[16px] flex flex-col max-h-[160px] shrink-0">
          <div className="overflow-y-auto w-full styled-scrollbar pr-1">
            <p className="text-left text-[#3a2f2a] text-[16px] font-[650] leading-[1.45] whitespace-pre-wrap break-words">
              {currentQuestionText}
            </p>
          </div>
          {/* Triangle tail */}
          <div className="absolute -bottom-[12.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-transparent border-t-[var(--color-k-orange)]" />
          <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent border-t-white" />
        </div>

        {/* Mascot Area & Side Cards */}
        <div className="relative z-10 mt-6 flex items-end justify-between px-6 w-full h-[180px] shrink-0">
          
          {/* Left Mute Card */}
          <button onClick={onToggleMute} className="relative z-20 bg-[#D5ECFF]/60 backdrop-blur-md rounded-[16px] p-2 flex flex-col items-center justify-center min-w-[64px] min-h-[64px] shadow-sm mb-12 active:scale-95 cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-lg mb-1">{isMuted ? '🔇' : '🔊'}</div>
            <span className="text-[10px] font-extrabold text-gray-600">{isMuted ? '소리 꺼짐' : '소리 켜짐'}</span>
          </button>

          {/* Mascot & Platform */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 flex flex-col items-center justify-end h-full w-[160px]">
             {/* Halo */}
             <div className="absolute bottom-[30px] w-[140px] h-[140px] rounded-full bg-[#c0e0ff]/60 blur-xl pointer-events-none" />
             {/* Mascot */}
             <div className="relative z-10 w-full flex justify-center items-end pb-[26px]">
               <KBestieMascotAnimation state={voiceState === "speaking" ? "talking" : "idle"} size={130} />
             </div>
             {/* Platform */}
             <div className="absolute bottom-0 w-[140px] h-[40px] pointer-events-none">
               {/* Top oval */}
               <div className="absolute top-0 w-full h-[24px] bg-[#FFF5E8] rounded-[100%] border border-[#f0e4d4] shadow-inner z-10" />
               {/* Side cylinder */}
               <div className="absolute top-[12px] w-full h-[28px] bg-[#f2e1cc] rounded-b-[70px] shadow-sm" />
               {/* Shadow on platform */}
               <div className="absolute top-[6px] left-[20px] w-[100px] h-[12px] bg-black/5 rounded-[100%] z-10 blur-sm" />
             </div>
          </div>

          {/* Right State Card */}
          <div className="relative z-20 bg-[#D5ECFF]/60 backdrop-blur-md rounded-[16px] p-2 flex flex-col items-center justify-center min-w-[64px] min-h-[64px] shadow-sm mb-12">
             <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-700 mb-1">
               {StateIcon}
             </div>
             <span className="text-[10px] font-extrabold text-gray-600">{stateText}</span>
          </div>
        </div>

        {/* Auto/Manual Mode Toggles */}
        <div className="relative z-20 flex justify-center gap-2 -mt-2 mb-3 h-[44px] shrink-0">
           <button onClick={() => onChangeMode('auto')} disabled={isClosing} aria-pressed={isAuto} className={`flex items-center justify-center min-w-[64px] h-[44px] rounded-[14px] border-[1.5px] transition-colors cursor-pointer ${isAuto ? 'bg-[#fff0e6] border-[var(--color-k-orange)] text-[var(--color-k-orange)] font-bold' : 'bg-white border-gray-200 text-gray-500 font-semibold'} shadow-sm text-[13px] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
             자동
             {isAuto && <div className="absolute -bottom-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[var(--color-k-orange)]" />}
           </button>
           <button onClick={() => onChangeMode('manual')} disabled={isClosing} aria-pressed={!isAuto} className={`flex items-center justify-center min-w-[64px] h-[44px] rounded-[14px] border-[1.5px] transition-colors cursor-pointer ${!isAuto ? 'bg-[#fff0e6] border-[var(--color-k-orange)] text-[var(--color-k-orange)] font-bold' : 'bg-white border-gray-200 text-gray-500 font-semibold'} shadow-sm text-[13px] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}>
             수동
             {!isAuto && <div className="absolute -bottom-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[var(--color-k-orange)]" />}
           </button>
        </div>

        {/* Bottom Inputs Area */}
        <div className="relative z-30 w-full shrink-0 bg-transparent flex items-center pb-[calc(16px+env(safe-area-inset-bottom))]">
          {isTextMode ? (
            <div className="w-full px-4 flex gap-2">
              <input
                ref={(el) => el?.focus()}
                type="text"
                value={textInput}
                onChange={(e) => onChangeTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendText(); }
                }}
                placeholder="케이에게 텍스트로 답하기..."
                className="flex-1 bg-white/90 backdrop-blur-md px-4 py-3.5 rounded-2xl text-[15px] font-medium text-gray-800 shadow-sm border border-gray-200 outline-none focus:border-[var(--color-k-orange)] transition-colors"
                maxLength={200}
              />
              <button
                onClick={onSendText}
                disabled={!textInput.trim() || isClosing}
                className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shadow-md bg-[var(--color-k-orange)] active:scale-95"
                aria-label="전송"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
              <button
                onClick={onToggleTextMode}
                className="w-[52px] h-[52px] shrink-0 rounded-2xl flex items-center justify-center bg-white shadow-sm text-gray-600 cursor-pointer active:scale-95 border border-gray-200"
                aria-label="닫기"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center h-[72px] relative">
              {/* Keyboard Button */}
              <button 
                onClick={onToggleTextMode}
                disabled={isClosing}
                className="absolute left-6 w-[48px] h-[48px] bg-white/80 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-sm border border-gray-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" 
                aria-label="텍스트로 답하기"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/><line x1="14" y1="12" x2="14.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
              </button>

              {/* Main Mic Button */}
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <>
                    <div className="absolute w-[90px] h-[90px] rounded-full bg-[var(--color-k-orange)] opacity-20 animate-ping motion-reduce:animate-none" />
                    <div className="absolute w-[110px] h-[110px] rounded-full bg-[var(--color-k-orange)] opacity-10 animate-pulse motion-reduce:animate-none" />
                  </>
                )}
                <button 
                  onClick={onMicClick} 
                  disabled={isMicDisabled} 
                  className={`w-[72px] h-[72px] rounded-[36px] flex items-center justify-center text-white shadow-[0_4px_16px_rgba(224,90,63,0.3)] z-10 transition-all duration-200 ${isMicDisabled ? 'opacity-60 cursor-not-allowed bg-gray-400' : 'cursor-pointer active:scale-95 bg-[var(--color-k-orange)]'}`}
                  aria-label={isRecording ? "녹음 종료" : "마이크 켜기"}
                >
                  {isRecording ? (
                    <div className="w-[24px] h-[24px] rounded-sm bg-white" />
                  ) : isMicDisabled ? (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4m-4 0h8"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Interim Text absolutely positioned near mic if needed. Leaving out as per requirements focus */}
        <style dangerouslySetInnerHTML={{__html:`
          .styled-scrollbar::-webkit-scrollbar {
            width: 4px;
          }
          .styled-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(224,90,63,0.3);
            border-radius: 4px;
          }
        `}} />
      </div>
    </div>
  );
}
