"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useDemoView } from "./DemoViewContext";
import { ViewToggle } from "./ViewToggle";

// SSR 중에는 useLayoutEffect가 아무 일도 안 하고 콘솔 경고만 남기므로(React 표준 이슈),
// 서버에서는 useEffect로 폴백한다. 클라이언트에서는 useLayoutEffect를 써서 라우트
// 전환마다 브라우저가 첫 페인트를 하기 전에 determined를 확정한다 — 그래야 빈 배경
// 프레임이 실제로 눈에 보이는 일 없이 device 판정이 끝난다(claude-review 지적사항 반영,
// 2026-08-03: children을 gate하는 최초 수정이 useEffect였을 때는 26개 페이지 전부에서
// 라우트 전환마다 빈 화면이 매번 페인트되는 새 회귀가 있었다).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// 최신 디바이스 목업 사양:
// tablet = iPad Pro (가로 landscape, 얇은 은색 베젤)
// mobile = iPhone 15 Pro (세로 portrait, 실버/티타늄 프레임, 다이나믹 아일랜드)
// requests/055 — 프레임을 더 크게 확대. 태블릿은 가로(vw) 기준, 스마트폰은
// 세로(dvh) 기준으로 가용 영역의 대부분을 쓰되, calc()에 반대쪽 축 상한도 함께
// 넣어 두 축 모두 화면 밖으로 잘리지 않게 한다(비율은 기존 값 그대로 유지 —
// 4/3, 9/19.5). width/height 중 하나만 명시하고 나머지는 aspectRatio로 유도한다.
const DEVICE_SPEC = {
  tablet: {
    ratio: 4 / 3,
    bezel: 16,
    radius: 36,
    width: "min(94vw, 1500px, calc(88dvh * 4 / 3))",
    height: "auto",
    innerPaddingTop: "pt-8",
    innerPaddingBottom: "pb-4",
  },
  mobile: {
    ratio: 9 / 19.5,
    bezel: 12,
    radius: 44,
    width: "auto",
    // 96dvh(스펙 권장 88dvh보다 높임): 테스트 해상도 중 가장 낮은 768px 높이에서
    // 82vh(구) 대비 88dvh는 +7.3%뿐이라 "최소 20~30%" 기준에 못 미침 — 96dvh가
    // 클리핑 없이 갈 수 있는 실질적 상한(+17.1%, 위아래 여백 약 15px씩). 768px보다
    // 큰 화면(920px 캡에 걸리는 지점부터)은 구버전 760px 캡 대비 +21%로 기준 충족.
    height: "min(96dvh, 920px)",
    innerPaddingTop: "pt-10",
    innerPaddingBottom: "pb-5",
  },
};

function useDeviceMode(setView: (v: "tablet" | "mobile") => void) {
  const [isPc, setIsPc] = useState(false);
  // 2026-08-03: isPc는 초기값이 항상 false(서버 렌더와 맞추기 위함)라, 실제로는 PC인
  // 뷰어(pointer:fine + min-width:900px)에서 마운트 직후 useEffect가 true로 뒤집는다.
  // 이때 아래 두 분기(!isPc / isPc)는 children이 위치하는 JSX 트리 구조 자체가 달라서
  // React가 children의 DOM을 재사용하지 못하고 통째로 언마운트 후 재마운트한다 —
  // children 안에 iframe(MBTI/퀴즈마스터 등)이 있으면 이 재마운트가 진행 중이던 요청을
  // 중단시키고 완전히 새 요청을 시작시켜, 업스트림의 1회용 실행 티켓 교환이 두 번
  // 경합하는 문제로 이어졌다(MBTI 빈 화면/오류 조사 중 발견). determined가 true가 될
  // 때까지 children을 아예 마운트하지 않아 이 최초 1회 뒤집힘 자체를 없앤다(실기기
  // 모바일 사용자는 애초에 isPc가 false→false라 이 문제와 무관하지만, 게이트를 걸어도
  // matchMedia는 동기 계산이라 체감 지연이 없다).
  const [determined, setDetermined] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const pcMq = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const sizeMq = window.matchMedia("(min-width: 768px)");

    const update = () => {
      const pc = pcMq.matches;
      setIsPc(pc);
      if (!pc) {
        setView(sizeMq.matches ? "tablet" : "mobile");
      }
      setDetermined(true);
    };

    update();
    pcMq.addEventListener("change", update);
    sizeMq.addEventListener("change", update);
    return () => {
      pcMq.removeEventListener("change", update);
      sizeMq.removeEventListener("change", update);
    };
  }, [setView]);

  return { isPc, determined };
}

export function DemoFrame({ children }: { children: ReactNode }) {
  const { view, setView } = useDemoView();
  const { isPc, determined } = useDeviceMode(setView);

  if (!determined) {
    // 최초 디바이스 판정 전에는 children(내부에 iframe이 있을 수 있음)을 마운트하지
    // 않는다 — 위 useDeviceMode 주석 참고. matchMedia가 동기 계산이라 다음 틱에 바로
    // determined=true가 되므로 실사용자에게는 체감되지 않는다.
    return <div className="h-dvh w-full" style={{ background: "var(--color-k-surface)" }} />;
  }

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
      className="h-dvh w-full relative flex items-center justify-center px-8 overflow-hidden select-none"
      style={{
        background: "radial-gradient(circle at center, #f8fafc 0%, #e2e8f0 100%)",
      }}
    >
      {/* 스마트폰 / 태블릿 전환 토글 — requests/055: 확대된 프레임과 겹치지 않도록
          flex 레이아웃에서 빼서 좌측에 absolute로 고정한다(프레임 너비 계산에
          영향을 주지 않음). 좁은 브라우저 폭에서는 프레임 상단으로 이동. */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 max-[1100px]:left-1/2 max-[1100px]:top-4 max-[1100px]:-translate-x-1/2 max-[1100px]:translate-y-0">
        <ViewToggle orientation="vertical" />
      </div>

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
              // transform은 시각적으로 아무것도 바꾸지 않지만(translateZ(0)), CSS 스펙상
              // transform이 있는 조상은 position:fixed 자손의 containing block이 된다.
              // 이게 없으면 이 안에 렌더되는 fixed 요소(예: 케이 챗봇 플로팅 버튼)가 이
              // 목업 프레임을 무시하고 실제 브라우저 뷰포트 모서리에 붙어버린다(PC 전용
              // 버그 - 실기기는 이 분기 자체를 안 타므로 영향 없음).
              transform: "translateZ(0)",
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
