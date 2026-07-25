"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";

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
  /** 012: 좌측에 표시할 현재 미션 라벨(예: "하교 후 미션"/"취침 전 미션"). 없으면 라벨 생략. */
  missionLabel?: string;

  /** 히스토리 존 — 최신이 아닌 지난 대화들(오래될수록 흐리게 표시) */
  history: MissionTranscriptTurn[];

  /** 중앙 액티브 존 — 현재 진행 중인 발화 1개(케이 또는 아이) */
  activeTurn: MissionTranscriptTurn | null;
  /** 012: 마스코트/상태배지/자동-수동 토글 — activeTurn 여부와 무관하게 항상 노출한다
   *  (다른 팀이 만든 KBestieMascotAnimation 등을 그대로 끼워 넣을 수 있게 ReactNode로
   *  받는다 — 이 컴포넌트 자신은 마스코트를 모른다). */
  mascotSlot?: React.ReactNode;

  /** 하단 마이크 존 */
  isListening: boolean;
  micLevel: number; // 0~1, 실제 RMS 등 정규화된 값

  /** 우측 상단 등에 표시할 부가 슬롯(연결 품질 표시 등을 다른 담당자가 여기 끼워 넣을 수
   *  있게 ReactNode로 받는다). */
  headerExtraSlot?: React.ReactNode;
}

export function MissionConversationLayout({
  onBack,
  progressCurrent,
  progressTotal,
  missionLabel,
  history,
  activeTurn,
  mascotSlot,
  isListening,
  micLevel,
  headerExtraSlot,
}: MissionConversationLayoutProps) {
  const progressPercent = progressTotal > 0 ? (progressCurrent / progressTotal) * 100 : 0;
  const isMissionComplete = progressTotal > 0 && progressCurrent >= progressTotal;

  // 012 "새 말풍선 추가 시 자동 최하단 스크롤 + 사용자가 위로 스크롤 중이면 자동 스크롤을
  // 멈추고 '새 메시지' 플로팅 버튼 노출". history/activeTurn이 바뀔 때마다(새 말풍선 추가)
  // 사용자가 바닥 근처에 있으면(shouldAutoScroll) 부드럽게 최하단으로 스크롤하고, 위로
  // 스크롤해 올라가 있는 중이면 스크롤을 건드리지 않고 플로팅 버튼만 띄운다.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showNewMessageButton, setShowNewMessageButton] = useState(false);

  // claude-review 지적: history는 호출부(missions/page.tsx)가 매 렌더마다
  // historyTurns.map(...)으로 새 배열을 만들어 넘기므로, [history, activeTurn]을 그대로
  // 의존성으로 쓰면 메시지 내용과 무관한 부모 리렌더(turnPhase 변화 등)마다 이 effect가
  // 재실행돼 사용자가 위로 스크롤 중이어도 스크롤이 하단으로 튕길 수 있다. 실제 "내용이
  // 바뀌었는가"만 반영하는 안정적인 값(길이 + 마지막 히스토리 항목 id + activeTurn의
  // id/text)만 의존성으로 쓴다.
  const lastHistoryTurn = history[history.length - 1];
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (shouldAutoScroll) {
      el.scrollTop = el.scrollHeight;
      setShowNewMessageButton(false);
    } else {
      setShowNewMessageButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length, lastHistoryTurn?.id, activeTurn?.id, activeTurn?.text]);

  const handleHistoryScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 24;
    setShouldAutoScroll(nearBottom);
    if (nearBottom) setShowNewMessageButton(false);
  };

  const scrollToBottomNow = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShouldAutoScroll(true);
    setShowNewMessageButton(false);
  };

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
    <div style={{ height: "100%", width: "100%", overflow: "hidden", display: "flex", justifyContent: "center", background: "var(--color-k-surface)" }}>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Image src="/Images/logo/Logo.png" alt="내친구 케이" width={98} height={28} className="object-contain" priority />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 40, justifyContent: "flex-end" }}>
              {headerExtraSlot}
            </div>
          </div>
          {/* 012 "0/10을 스텝 인디케이터로": 좌측 미션 라벨, 우측 n/10 카운터, 완료 시
              인디케이터 영역 전체가 축하 색상으로 바뀌고 완료 배지 표시. */}
          {missionLabel && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: isMissionComplete ? "#b8860b" : "var(--color-k-navy)" }}>
                {missionLabel}
              </span>
              {isMissionComplete && (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#f0a020", borderRadius: 999, padding: "2px 8px" }}>
                  🎉 완료!
                </span>
              )}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: isMissionComplete ? "#b8860b" : "#6b7280", whiteSpace: "nowrap", fontWeight: 600 }}>
              {progressCurrent}/{progressTotal}
            </span>
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: 4,
                height: 6,
                padding: isMissionComplete ? 3 : 0,
                borderRadius: 999,
                background: isMissionComplete ? "#fff3d6" : "transparent",
                transition: "background-color 0.3s ease-in-out",
              }}
            >
              {Array.from({ length: progressTotal }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: "100%",
                    borderRadius: 999,
                    background: isMissionComplete ? "#f0a020" : i < progressCurrent ? "var(--color-k-navy)" : "#eef2f1",
                    transition: "background-color 0.25s ease-in-out",
                  }}
                  className={!isMissionComplete && i === progressCurrent ? "animate-pulse" : ""}
                />
              ))}
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
        {/* 중앙 히스토리 존 — 전체 히스토리를 렌더하되 최대 3개 높이 정도로 스크롤 적용 */}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div
          ref={scrollContainerRef}
          onScroll={handleHistoryScroll}
          className="mission-history-scroll-container"
          style={{ height: "100%", maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", padding: "20px 14px", scrollBehavior: "smooth" }}
        >
          <style>{`
            .mission-history-scroll-container::-webkit-scrollbar {
              width: 4px;
            }
            .mission-history-scroll-container::-webkit-scrollbar-thumb {
              background: rgba(156, 163, 175, 0.5);
              border-radius: 4px;
            }
          `}</style>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: "auto" }}>
            {history.map((turn, index, arr) => {
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
                    background: isChild ? "var(--color-k-navy)" : "#fff",
                    color: isChild ? "#fff" : "var(--color-k-text-primary)",
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
        {/* 012 "새 말풍선 추가 시 자동 최하단 스크롤, 사용자가 위로 스크롤 중이면 자동 스크롤을
            멈추고 새 메시지 플로팅 버튼 노출" */}
        {showNewMessageButton && (
          <button
            onClick={scrollToBottomNow}
            style={{
              position: "absolute",
              bottom: 8,
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--color-k-navy)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
              cursor: "pointer",
              zIndex: 5,
            }}
          >
            ↓ 새 메시지
          </button>
        )}
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
                    border: "2px solid var(--color-k-navy)",
                    borderRadius: 20,
                    padding: "16px 20px",
                    color: "var(--color-k-text-primary)",
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
                      borderTop: "10px solid var(--color-k-navy)",
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
                </div>
              ) : (
                <div style={{
                  background: "var(--color-k-navy)",
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
          {/* 012: 마스코트/상태배지/자동-수동 토글은 activeTurn(케이가 실제 말하는 순간)
              여부와 무관하게 항상 노출한다 — 이전엔 K 말풍선이 뜬 순간에만 mascotSlot이
              함께 렌더돼, 그 슬롯 안에 자동/수동 토글을 옮기면 아이 차례·침묵 구간엔 토글
              자체가 사라져 모드를 바꿀 수 없는 문제가 있었다(대표님께 직접 확인해 "항상
              표시"로 확정). */}
          {mascotSlot && (
            <div style={{ marginTop: activeTurn ? 8 : 0 }}>
              {mascotSlot}
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
