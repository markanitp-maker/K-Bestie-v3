import React from "react";

export default function TestLayout() {
  const isLive = true;
  const isRecording = false;
  const isAuto = true;
  const isConnecting = false;
  const olderKText = "지지난 발화 텍스트입니다.";
  const prevKText = "지난 발화 텍스트가 여기에 표시됩니다.";
  const latestKText = "현재 발화 텍스트입니다.";

  return (
    <div className="w-full h-[100dvh] flex justify-center bg-[#D5ECFF]" style={{ overflowX: "hidden", overflowY: "hidden" }}>
      <div className="w-full max-w-[480px] min-w-0 box-border h-[100dvh] flex flex-col relative shrink-0" style={{ background: "linear-gradient(to bottom, #D5ECFF 0%, #F4F7F5 50%, #FFF5E8 100%)" }}>
        
        {/* 공통 헤더 */}
        <div className="absolute top-0 left-0 right-0 z-50 pointer-events-auto flex justify-between h-[60px] items-center px-4">
          <div>뒤로</div>
          <div>대화</div>
          <div>X</div>
        </div>

        {/* Chat Area (Flexible & Vertically Centered, Top-clipped when long) */}
        <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-end overflow-hidden z-20 px-[clamp(16px,4vw,24px)] pt-[calc(58px+env(safe-area-inset-top))] pb-[clamp(38px,6.5dvh,48px)]">
          {olderKText && (
            <div className="mb-[clamp(10px,2vw,14px)] text-gray-400 text-[clamp(14px,4vw,16px)] leading-[1.45] text-center max-w-[80%] font-medium shrink-0 h-auto overflow-visible" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "break-word" }}>
              {olderKText}
            </div>
          )}
          {prevKText && (
            <div className="mb-[clamp(12px,2.5vw,16px)] text-gray-500 text-[clamp(15px,4.5vw,17px)] leading-[1.5] text-center max-w-[85%] font-medium shrink-0 h-auto overflow-visible" style={{ whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "break-word" }}>
              {prevKText}
            </div>
          )}
          {latestKText && (
            <div className="relative shrink-0 flex flex-col items-center justify-end w-full max-w-[90%] z-20 min-h-0 pb-[12px] animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-white px-[clamp(16px,5vw,20px)] py-[clamp(12px,4vw,16px)] rounded-[24px] shadow-sm border-[2.5px] border-[var(--color-k-orange)] text-[#3a2f2a] text-[clamp(16px,4.8vw,19px)] font-bold leading-[1.6] text-center shrink-0 min-w-[60%] w-auto break-words relative overflow-visible max-h-[40dvh] overflow-y-auto overscroll-contain">
                {latestKText}
              </div>
              {/* Triangle tail */}
              <div className="absolute -bottom-[12.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-transparent border-t-[var(--color-k-orange)]" />
              <div className="absolute -bottom-[9.5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[9px] border-r-[9px] border-t-[9px] border-transparent border-t-white" />
            </div>
          )}
        </div>

        {/* Mascot Area & Side Cards */}
        <div className="relative w-full shrink-0 h-[clamp(145px,22.6dvh,160px)]">
          {/* Mascot */}
          <div className="relative z-10 flex justify-center items-end pb-[clamp(38px,6.2dvh,46px)]">
            <img src="/k-bestie-mascot.png" alt="Mascot" className="!w-[clamp(115px,39.2vw,145px)] !h-[clamp(115px,39.2vw,145px)] object-contain bg-orange-200" />
          </div>

          <div className="absolute top-[65%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[clamp(130px,44vw,170px)] h-[clamp(30px,6vw,38px)] bg-black/10 rounded-[100%] blur-[4px] pointer-events-none" />

          {/* Right Card */}
          <div className="absolute right-[clamp(10px,4vw,20px)] top-[10%] flex flex-col items-center gap-[6px] pointer-events-auto z-20">
            <div className="w-[60px] h-[60px] bg-white/70 backdrop-blur-sm rounded-[16px] shadow-sm flex flex-col items-center justify-center border border-white/50">
              <span className="text-[11px] font-bold text-[#554c46]">대기 중</span>
            </div>
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="shrink-0 w-full px-[clamp(16px,5vw,24px)] pb-[calc(clamp(16px,3.5dvh,24px)+env(safe-area-inset-bottom))] z-30 pt-1">
          {/* Action Row */}
          <div className="flex justify-between items-center w-full relative">
            <button className="w-[48px] h-[48px] flex items-center justify-center bg-white/80 backdrop-blur-md rounded-[16px] shadow-sm text-gray-700 active:scale-95 border border-white/50">K</button>
            
            <div className="flex bg-white/90 backdrop-blur-md rounded-full shadow-sm p-1 border border-white/50">
              <button className="px-5 py-2 rounded-full text-sm font-bold bg-[#e05a3f] text-white">자동</button>
              <button className="px-5 py-2 rounded-full text-sm font-bold text-gray-500">수동</button>
            </div>
            
            <div className="w-[48px]"></div>

            <div className="absolute left-1/2 -translate-x-1/2 -bottom-[clamp(10px,2.5dvh,20px)] z-40">
              <button className="w-[clamp(76px,21vw,88px)] h-[clamp(76px,21vw,88px)] rounded-full flex items-center justify-center text-white bg-[var(--color-k-orange)]" aria-label="마이크"></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
