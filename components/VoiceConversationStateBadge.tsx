"use client";

import React from "react";

export type VoiceConversationState = "connecting" | "listening" | "thinking" | "speaking" | "idle" | "no_input";

interface VoiceConversationStateBadgeProps {
  state: VoiceConversationState;
}

export function VoiceConversationStateBadge({ state }: VoiceConversationStateBadgeProps) {
  if (state === "idle") return null;

  const config = {
    connecting: { text: "연결 중...", bg: "#f3f4f6", color: "#6b7280", icon: "🔄", border: "#e5e7eb" },
    listening: { text: "듣는 중", bg: "#f0fdf4", color: "#16a34a", icon: "👂", border: "#bbf7d0" },
    thinking: { text: "생각하는 중...", bg: "#eff6ff", color: "#2563eb", icon: "💭", border: "#bfdbfe" },
    speaking: { text: "말하는 중", bg: "#fdf4ff", color: "#c026d3", icon: "💬", border: "#fbcfe8" },
    // Care Premium(Live API) 전용 — AUTO 모드에서 마이크가 켜져 있는데도 일정 시간 소리가
    // 감지되지 않을 때 표시. 아이가 겁먹지 않도록 "고장" 느낌 대신 다시 말해보라는 톤으로.
    no_input: { text: "다시 말해줄래?", bg: "#fffbeb", color: "#b45309", icon: "🎤", border: "#fde68a" },
  };

  const current = config[state];

  return (
    <div
      // key={state}로 상태가 바뀔 때마다 이 요소를 새로 마운트시킨다 — key 없이는
      // "듣는 중"→"말하는 중"처럼 className이 우연히 같은 전환(둘 다 animate-in
      // fade-in 그룹)에서 CSS 애니메이션이 재생되지 않아 텍스트/아이콘이 순간적으로
      // 바뀌기만 하고 fade 전환처럼 보이지 않는 문제가 있었다.
      key={state}
      style={{
        background: current.bg,
        color: current.color,
        border: `1px solid ${current.border}`,
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 4,
        boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
        zIndex: 10,
        whiteSpace: "nowrap",
        transition: "background-color 0.3s ease-in-out, color 0.3s ease-in-out, border-color 0.3s ease-in-out",
      }}
      className={
        state === "connecting" || state === "thinking" || state === "no_input"
          ? "animate-pulse"
          : "animate-in fade-in zoom-in-95 duration-200"
      }
    >
      <span>{current.icon}</span>
      {current.text}
    </div>
  );
}
