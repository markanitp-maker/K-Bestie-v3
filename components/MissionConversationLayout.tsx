"use client";

import React from "react";

export interface MissionTranscriptTurn {
  id: string;
  role: "child" | "k";
  text: string;
}

export interface MissionConversationLayoutProps {
  /** 상단 고정 헤더 */
  onBack: () => void;
  progressCurrent: number; // 예: 3
  progressTotal: number;   // 예: 10

  /** 히스토리 존 — 최신이 아닌 지난 대화들(오래될수록 흐리게 표시) */
  history: MissionTranscriptTurn[];

  /** 중앙 액티브 존 — 현재 진행 중인 발화 1개(케이 또는 아이) */
  activeTurn: MissionTranscriptTurn | null;
  /** activeTurn.role==="k"일 때 옆에 표시할 마스코트 애니메이션 요소(다른 팀이 만든
   *  KBestieMascotAnimation 컴포넌트를 여기 슬롯으로 그대로 끼워 넣을 수 있게 ReactNode로
   *  받는다 — 이 컴포넌트 자신은 마스코트를 모른다). */
  mascotSlot?: React.ReactNode;

  /** 하단 마이크 존 */
  isListening: boolean;
  micLevel: number; // 0~1, 실제 RMS 등 정규화된 값

  /** 우측 상단 등에 표시할 부가 슬롯(음성 켜기/끄기 버튼, 연결 품질 표시 등을 다른
   *  담당자가 여기 끼워 넣을 수 있게 ReactNode로 받는다). */
  headerExtraSlot?: React.ReactNode;
}

export function MissionConversationLayout({
  onBack,
  progressCurrent,
  progressTotal,
  history,
  activeTurn,
  mascotSlot,
  isListening,
  micLevel,
  headerExtraSlot,
}: MissionConversationLayoutProps) {
  const progressPercent = progressTotal > 0 ? (progressCurrent / progressTotal) * 100 : 0;

  return (
    // height는 100dvh가 아니라 100%여야 한다 — 이 컴포넌트는 PC/PWA(desktop)에서
    // app/child/missions/page.tsx가 DemoFrame(태블릿/스마트폰 기기 목업 프레임)으로
    // 감싼 상태로 렌더된다. DemoFrame의 목업 화면 영역은 실제 브라우저 뷰포트보다 훨씬
    // 작은 고정 픽셀 높이(예: 1920x1080 PC에서 약 700px)를 갖는데, 100dvh는 그 부모
    // 크기와 무관하게 항상 "실제 기기 전체 뷰포트" 높이로 계산되어(2026-07-25 대표님
    // PC PWA 재현 — 하단 마스코트 미노출) 목업 프레임보다 훨씬 큰 콘텐츠가 렌더되고
    // 그 초과분(하단 고정 마스코트 영역)이 화면 밖으로 밀려나 보이지 않았다. 100%는
    // 실제 부모 컨테이너 크기를 그대로 물려받으므로 DemoFrame 안(PC)과 DemoFrame의
    // h-dvh 래퍼 안(실기기, 값은 100dvh와 동일)에서 모두 정확히 맞아떨어진다.
    <div style={{ height: "100%", width: "100%", overflow: "hidden", display: "flex", justifyContent: "center", background: "#fafaf8" }}>
      <div style={{ width: "100%", maxWidth: 560, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        
        {/* 상단 고정 헤더 */}
        <div style={{ flexShrink: 0, padding: "calc(10px + env(safe-area-inset-top)) 14px 10px", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
            <button
              onClick={onBack}
              style={{ padding: "4px 8px", background: "transparent", border: "none", color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}
            >
              ← 뒤로가기
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#1e1e2d", whiteSpace: "nowrap" }}>내친구 케이</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 40, justifyContent: "flex-end" }}>
              {headerExtraSlot}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", fontWeight: 600 }}>
              {progressCurrent}/{progressTotal}
            </span>
            <div style={{ flex: 1, height: 6, background: "#eef2f1", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${progressPercent}%`, height: "100%", background: "#1a6b5a", transition: "width .3s" }} />
            </div>
          </div>
        </div>

        {/* 중앙 히스토리 존 — 011 "최근 대화 말풍선 최대 3개만 표시, 나머지는 쌓지 않음":
            여기서 최근 3개로 자른다(호출부가 더 많이 넘기더라도 이 컴포넌트가 최종 방어).
            현재 활성 발화(activeTurn)는 더 이상 이 스크롤 영역에 두지 않고 하단 고정
            영역으로 옮겼다 — 예전엔 activeTurn(케이 말풍선+마스코트+상태배지)이 이 스크롤
            가능한 영역 안에 있어서, 히스토리가 쌓이면 화면 밖으로 밀려날 수 있었다(011
            "하단 고정 영역: 현재 케이 말풍선/마스코트/상태배지" 요구사항과 불일치). overflow는
            auto가 아니라 hidden — 3개로 자른 이상 스크롤이 필요할 일이 없고, 011은 별도
            스크롤바 표시 자체를 금지한다. */}
        {/* minHeight:0은 필수다 — flex:1 자식은 기본값이 min-height:auto라 콘텐츠가 조금만
            많아도(실기기 Safari의 100dvh는 툴바 상태에 따라 데스크톱 시뮬레이션보다 실제로
            더 작을 수 있음) 이 영역이 필요한 만큼 줄어들지 않고 전체 flex 컬럼(100dvh,
            overflow:hidden)을 넘쳐서, 바깥 overflow:hidden이 하단 고정 영역 일부(마스코트)를
            잘라내는 원인이 됐다(2026-07-25 대표님 실기기 확인 - "마스코트가 반쯤 잘림"). */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "20px 14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {history.slice(-3).map((turn, index, arr) => {
              // 역순 인덱스 (끝에서 멀수록 0에 가까움)
              const distanceFromEnd = arr.length - 1 - index;
              // 오래된 것일수록 투명도를 낮춤 (최대 1, 최소 0.4)
              const baseOpacity = Math.max(0.4, 1 - distanceFromEnd * 0.15);

              const isChild = turn.role === "child";
              return (
                <div
                  key={turn.id}
                  style={{
                    alignSelf: isChild ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    padding: "10px 14px",
                    borderRadius: 16,
                    background: isChild ? "#1a6b5a" : "#fff",
                    color: isChild ? "#fff" : "#1e1e2d",
                    border: isChild ? "none" : "1px solid #e5e7eb",
                    fontSize: 14,
                    lineHeight: 1.45,
                    opacity: baseOpacity,
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {turn.text}
                </div>
              );
            })}
          </div>
        </div>

        {/* 하단 고정 영역 — 011 "현재 케이 말풍선 / 케이 마스코트 / 상태 배지 / 음성 ON/OFF /
            대화·종료 메뉴". activeTurn(현재 발화 중인 말풍선)과 mascotSlot(마스코트+상태배지)을
            여기로 옮겨 스크롤 영역과 완전히 분리했다 — 히스토리가 몇 개든 이 영역은 항상 보인다.
            2026-07-25 대표님 실기기 확인: 마스코트가 반쯤 잘리는 문제 수정 —
            (1) overflow:visible로 명시(내부에서 잘라내지 않음, 실제 클리핑 원인은 바깥
                히스토리 영역의 minHeight:0 누락이었지만 방어적으로 여기도 visible 명시),
            (2) 실제 조작 버튼(app/child/missions/page.tsx가 이 컴포넌트 위에
                absolute bottom-0으로 겹쳐 그리는 마이크/텍스트/종료 버튼 행,
                약 20px+64px+20px+safe-area ≈ 104px+safe-area)과 마스코트가 겹치지
                않도록 하단 여백을 120px+safe-area로 늘림(기존 16px+safe-area는
                실제 버튼 행 높이보다 훨씬 작아서 마스코트 아랫부분이 그 버튼 행에
                가려질 수 있었음),
            (3) 예전에 있던 자체 "듣고 있어요/파형" 장식 영역은 어차피 실제 버튼 행에
                완전히 가려지도록 설계돼 있었던 죽은 UI라(주석 그대로: 이 컴포넌트 위에
                "겹쳐서 표시") 제거해 마스코트가 쓸 수 있는 세로 공간을 늘림. */}
        <div style={{ flexShrink: 0, borderTop: "1px solid #e5e7eb", background: "#fff", padding: "16px 14px calc(120px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", overflow: "visible" }}>
          {activeTurn && (
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              {activeTurn.role === "k" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%" }}>
                  <div style={{
                    position: "relative",
                    background: "#fff",
                    border: "2px solid #1a6b5a",
                    borderRadius: 20,
                    padding: "16px 20px",
                    color: "#1e1e2d",
                    fontSize: 18,
                    fontWeight: 700,
                    lineHeight: 1.4,
                    textAlign: "center",
                    maxWidth: "90%",
                    boxShadow: "0 4px 12px rgba(26, 107, 90, 0.1)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                    {activeTurn.text}
                    {/* 말풍선 꼬리 (아래쪽 마스코트를 향함) */}
                    <div style={{
                      position: "absolute",
                      bottom: -10,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "10px solid transparent",
                      borderRight: "10px solid transparent",
                      borderTop: "10px solid #1a6b5a",
                    }} />
                    <div style={{
                      position: "absolute",
                      bottom: -7,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "8px solid transparent",
                      borderRight: "8px solid transparent",
                      borderTop: "8px solid #fff",
                    }} />
                  </div>
                  {mascotSlot && (
                    <div style={{ marginTop: 8 }}>
                      {mascotSlot}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  background: "#1a6b5a",
                  color: "#fff",
                  borderRadius: 20,
                  padding: "16px 20px",
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1.4,
                  textAlign: "center",
                  maxWidth: "90%",
                  boxShadow: "0 4px 12px rgba(26, 107, 90, 0.2)",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}>
                  {activeTurn.text}
                </div>
              )}
            </div>
          )}
          {/* 2026-07-25 대표님 실기기 확인 후 제거: 이 자리에 있던 자체 "듣고 있어요/파형"
              장식 영역은 app/child/missions/page.tsx가 이 컴포넌트 바로 위에 absolute로
              겹쳐 그리는 실제 마이크/텍스트/종료 버튼 행에 항상 완전히 가려지도록 설계돼
              있었다(이 파일 상단 주석 "장식용 마이크 파형 존 위에 겹쳐서 표시" 참고) — 즉
              애초에 사용자에게 보인 적이 없는 죽은 UI였다. 상태 표시는 mascotSlot에 이미
              포함된 VoiceConversationStateBadge(듣는 중/생각하는 중/말하는 중)가 activeTurn과
              함께 보여준다. 이 죽은 UI를 제거해 마스코트가 쓸 수 있는 세로 공간을 넓혔다
              (마스코트가 반쯤 잘리던 원인 중 하나 — 나머지 원인은 위 히스토리 영역의
              minHeight:0 누락). isListening/micLevel prop은 호출부 호환을 위해 인터페이스에
              남겨두되 더 이상 이 안에서 렌더링하지 않는다. */}
        </div>
      </div>
    </div>
  );
}
