"use client";

import React from "react";

export type VoiceConversationState = "connecting" | "listening" | "thinking" | "speaking" | "idle";

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
  };

  const current = config[state];

  return (
    <div
      style={{
        position: "absolute",
        top: -8,
        right: -80,
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
      }}
      className={
        state === "connecting" || state === "thinking"
          ? "animate-pulse"
          : "animate-in fade-in zoom-in-95 duration-200"
      }
    >
      <span>{current.icon}</span>
      {current.text}
    </div>
  );
}
