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
    <div style={{ height: "100dvh", width: "100%", overflow: "hidden", display: "flex", justifyContent: "center", background: "#fafaf8" }}>
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

        {/* 대화 내용 영역 (히스토리 + 액티브 존) */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "20px 14px" }}>
          
          {/* 히스토리 존 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {history.map((turn, index) => {
              // 역순 인덱스 (끝에서 멀수록 0에 가까움)
              const distanceFromEnd = history.length - 1 - index;
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

          {/* 중앙 액티브 존 */}
          {activeTurn && (
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 20 }}>
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
        </div>

        {/* 하단 마이크 존 */}
        <div style={{ flexShrink: 0, borderTop: "1px solid #e5e7eb", background: "#fff", padding: "16px 14px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 90 }}>
          {isListening ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b5a", marginBottom: 12 }}>
                듣고 있어요
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, height: 24 }}>
                {[...Array(5)].map((_, i) => {
                  // 간단한 파형 생성: micLevel (0~1)과 인덱스를 조합해 높이를 다르게
                  const centerDist = Math.abs(i - 2);
                  const baseHeight = 4 + (2 - centerDist) * 4;
                  const dynamicHeight = Math.max(4, baseHeight + micLevel * 16 * (3 - centerDist));
                  
                  return (
                    <div
                      key={i}
                      style={{
                        width: 4,
                        borderRadius: 2,
                        background: "#1a6b5a",
                        height: `${dynamicHeight}px`,
                        transition: "height 0.1s ease",
                      }}
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, color: "#9ca3af" }}>
              대기 중...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
