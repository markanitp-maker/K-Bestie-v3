"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDemoView } from "./DemoViewContext";
import { ViewToggle } from "./ViewToggle";

// 최신 디바이스 목업 사양:
// tablet = iPad Pro (가로 landscape, 얇은 은색 베젤)
// mobile = iPhone 15 Pro (세로 portrait, 실버/티타늄 프레임, 다이나믹 아일랜드)
const DEVICE_SPEC = {
  tablet: {
    ratio: 4 / 3,
    bezel: 16,
    radius: 36,
    width: "min(88vh * 1.33, 960px)",
    height: "min(82vh, 700px)",
    innerPaddingTop: "pt-8",
    innerPaddingBottom: "pb-4",
  },
  mobile: {
    ratio: 9 / 19.5,
    bezel: 12,
    radius: 44,
    width: "min(82vh * 0.46, 360px)",
    height: "min(82vh, 760px)",
    innerPaddingTop: "pt-10",
    innerPaddingBottom: "pb-5",
  },
};

function useDeviceMode(setView: (v: "tablet" | "mobile") => void) {
  const [isPc, setIsPc] = useState(false);

  useEffect(() => {
    const pcMq = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const sizeMq = window.matchMedia("(min-width: 768px)");

    const update = () => {
      const pc = pcMq.matches;
      setIsPc(pc);
      if (!pc) {
        setView(sizeMq.matches ? "tablet" : "mobile");
      }
    };

    update();
    pcMq.addEventListener("change", update);
    sizeMq.addEventListener("change", update);
    return () => {
      pcMq.removeEventListener("change", update);
      sizeMq.removeEventListener("change", update);
    };
  }, [setView]);

  return isPc;
}

export function DemoFrame({ children }: { children: ReactNode }) {
  const { view, setView } = useDemoView();
  const isPc = useDeviceMode(setView);

  if (!isPc) {
    return (
      <div className="h-dvh w-full overflow-y-auto" style={{ background: "var(--color-k-surface)" }}>
        {children}
      </div>
    );
  }

  const spec = DEVICE_SPEC[view];
  const innerRadius = Math.max(spec.radius - spec.bezel, 12);

  return (
    <div
      className="h-dvh w-full flex items-center justify-center gap-10 px-8 overflow-hidden select-none"
      style={{
        background: "radial-gradient(circle at center, #f8fafc 0%, #e2e8f0 100%)",
      }}
    >
      {/* 스마트폰 / 태블릿 전환 토글 */}
      <ViewToggle orientation="vertical" />

      {/* 디바이스 본체 Wrapper */}
      <div className="relative shrink-0 flex items-center justify-center transition-all duration-300 ease-out">
        {/* 실버/티타늄 메탈릭 아웃라인 3D 효과 */}
        <div
          className="relative transition-all duration-300 ease-out"
          style={{
            width: spec.width,
            height: spec.height,
            aspectRatio: spec.ratio,
            borderRadius: spec.radius,
            padding: spec.bezel,
            // 실버 메탈 프레임 느낌을 살린 그라데이션 광택 테두리
            background: "linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 25%, #94a3b8 50%, #cbd5e1 75%, #f1f5f9 100%)",
            boxShadow: `
              0 0 0 1px rgba(255, 255, 255, 0.8) inset,
              0 0 0 4px #0f172a,
              0 15px 35px -5px rgba(0, 0, 0, 0.2),
              0 30px 60px -15px rgba(15, 23, 42, 0.3)
            `,
          }}
        >
          {/* 안쪽 실제 검은색 베젤 (디바이스 베젤 테두리) */}
          <div
            className="absolute inset-[3px]"
            style={{
              borderRadius: spec.radius - 3,
              background: "#0f172a", // 실제 기기 전면 글래스 베젤
            }}
          />

          {/* ==================== 기기별 특수 에셋 배치 ==================== */}
          {view === "mobile" ? (
            <>
              {/* iPhone 측면 버튼 (실버/메탈릭 입체감) */}
              {/* 좌측 볼륨/액션 버튼 */}
              <div className="absolute left-[-4px] top-[16%] w-[4px] h-[20px] rounded-l bg-slate-300 border-r border-slate-500 shadow-sm" />
              <div className="absolute left-[-4px] top-[24%] w-[4px] h-[34px] rounded-l bg-slate-300 border-r border-slate-500 shadow-sm" />
              <div className="absolute left-[-4px] top-[30%] w-[4px] h-[34px] rounded-l bg-slate-300 border-r border-slate-500 shadow-sm" />
              {/* 우측 전원 버튼 */}
              <div className="absolute right-[-4px] top-[28%] w-[4px] h-[52px] rounded-r bg-slate-300 border-l border-slate-500 shadow-sm" />
            </>
          ) : (
            <>
              {/* iPad 측면 버튼 */}
              {/* 상단 전원 버튼 */}
              <div className="absolute top-[-4px] right-[10%] w-[38px] h-[4px] rounded-t bg-slate-300 border-b border-slate-500 shadow-sm" />
              {/* 우측 볼륨 버튼 */}
              <div className="absolute right-[-4px] top-[8%] w-[4px] h-[24px] rounded-r bg-slate-300 border-l border-slate-500 shadow-sm" />
              <div className="absolute right-[-4px] top-[12%] w-[4px] h-[24px] rounded-r bg-slate-300 border-l border-slate-500 shadow-sm" />
            </>
          )}

          {/* ==================== 이너 디스플레이 영역 ==================== */}
          <div
            className="w-full h-full relative overflow-hidden select-text"
            style={{
              background: "var(--color-k-surface)",
              borderRadius: innerRadius,
              boxShadow: "0 0 6px rgba(0, 0, 0, 0.6) inset",
            }}
          >
            {/* ==================== 1. 상단 상태바 (Status Bar) ==================== */}
            <div
              className="absolute top-0 left-0 right-0 z-40 px-6 flex items-center justify-between text-black select-none pointer-events-none"
              style={{
                height: view === "mobile" ? "38px" : "32px",
                background: "rgba(250, 250, 248, 0.82)",
                backdropFilter: "blur(8px)",
                fontSize: view === "mobile" ? "12px" : "11px",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                fontWeight: "600",
                letterSpacing: "-0.1px",
                borderBottom: "1px solid rgba(0, 0, 0, 0.03)",
              }}
            >
              {/* 왼쪽 시각 */}
              <div>9:41</div>

              {/* 오른쪽 아이콘 세트 (📶 🛜 🔋 직접 SVG 렌더링) */}
              <div className="flex items-center gap-1.5 opacity-85">
                {/* 셀룰러 신호 */}
                <svg width="17" height="11" viewBox="0 0 17 11" fill="none" className="text-black">
                  <rect x="0.5" y="8.5" width="2.5" height="2" rx="0.5" fill="currentColor"/>
                  <rect x="4.5" y="6.5" width="2.5" height="4" rx="0.5" fill="currentColor"/>
                  <rect x="8.5" y="4.5" width="2.5" height="6" rx="0.5" fill="currentColor"/>
                  <rect x="12.5" y="1.5" width="2.5" height="9" rx="0.5" fill="currentColor" opacity="0.3"/>
                </svg>
                {/* 와이파이 */}
                <svg width="15" height="11" viewBox="0 0 15 11" fill="none" className="text-black">
                  <path d="M7.5 10C8.32843 10 9 9.32843 9 8.5C9 7.67157 8.32843 7 7.5 7C6.67157 7 6 7.67157 6 8.5C6 9.32843 6.67157 10 7.5 10Z" fill="currentColor"/>
                  <path d="M7.5 0.5C4.2 0.5 1.5 2.1 0 4.6L1.5 6.1C2.6 4.1 4.9 2.8 7.5 2.8C10.1 2.8 12.4 4.1 13.5 6.1L15 4.6C13.5 2.1 10.8 0.5 7.5 0.5Z" fill="currentColor"/>
                  <path d="M7.5 3.8C5.4 3.8 3.5 4.8 2.5 6.4L4 7.9C4.6 7 6 6.3 7.5 6.3C9 6.3 10.4 7 11 7.9L12.5 6.4C11.5 4.8 9.6 3.8 7.5 3.8Z" fill="currentColor"/>
                </svg>
                {/* 배터리 */}
                <svg width="22" height="11" viewBox="0 0 22 11" fill="none" className="text-black">
                  <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke="currentColor"/>
                  <rect x="2.5" y="2.5" width="14" height="6" rx="1" fill="currentColor"/>
                  <path d="M20.5 3.5V7.5" stroke="currentColor" stroke-linecap="round"/>
                </svg>
              </div>
            </div>

            {/* ==================== 2. iPhone 전용 다이나믹 아일랜드 (상단 알약 모양) ==================== */}
            {view === "mobile" && (
              <div
                className="absolute left-1/2 -translate-x-1/2 z-50 rounded-full flex items-center justify-between px-2.5 pointer-events-auto"
                style={{
                  top: "6px",
                  width: "82px",
                  height: "25px",
                  background: "#000000",
                  boxShadow: "0 1px 3px rgba(255,255,255,0.06) inset, 0 1px 1px rgba(0,0,0,0.8)",
                }}
              >
                {/* 좌측 카메라 렌즈 녹색/파란색 빛 반사 */}
                <div className="w-2.5 h-2.5 rounded-full bg-[#141414] border border-[#222] flex items-center justify-center">
                  <div className="w-1 h-1 rounded-full bg-blue-900/30" />
                </div>
                {/* 우측 페이스ID 조도 센서 */}
                <div className="w-1.5 h-1.5 rounded-full bg-[#0d0d0d]" />
              </div>
            )}

            {/* iPad 전용 카메라 베젤 홀 */}
            {view === "tablet" && (
              <div
                className="absolute left-[8px] top-1/2 -translate-y-1/2 z-50 w-2 h-2 rounded-full bg-[#050505] flex items-center justify-center pointer-events-none"
                style={{ boxShadow: "0 0 1px rgba(255,255,255,0.2) inset" }}
              >
                <div className="w-0.5 h-0.5 rounded-full bg-blue-900/30" />
              </div>
            )}

            {/* ==================== 3. 실제 앱 렌더링 뷰포트 ==================== */}
            <div
              className={`w-full h-full overflow-y-auto ${spec.innerPaddingTop} ${spec.innerPaddingBottom}`}
            >
              {children}
            </div>

            {/* ==================== 4. 하단 홈 인디케이터 (Home Indicator Bar) ==================== */}
            <div
              className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-40 rounded-full pointer-events-none"
              style={{
                width: view === "mobile" ? "110px" : "160px",
                height: "5px",
                background: "rgba(0, 0, 0, 0.4)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
