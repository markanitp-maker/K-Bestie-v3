"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "../../components/DemoFrame";
import { ChildNav } from "../../components/ChildNav";
import { childVoiceScript } from "../../lib/mockData";

const INITIAL_VISIBLE = 2;

export default function DemoChildChatPage() {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const isDone = visibleCount >= childVoiceScript.length;
  const visibleTurns = childVoiceScript.slice(0, visibleCount);

  const handleMic = () => {
    if (isDone) return;
    setVisibleCount((c) => Math.min(c + 1, childVoiceScript.length));
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
        {/* 상단 고정 영역: 헤더 + 마스코트 (스크롤되지 않음) */}
        <div className="shrink-0 sticky top-0 z-10" style={{ background: "var(--color-k-surface)" }}>
          <div className="flex items-center justify-center px-4 pt-4 pb-2">
            <Link
              href="/demo"
              className="font-bold text-sm cursor-pointer"
              style={{ color: "var(--color-k-navy)" }}
            >
              내친구 케이
            </Link>
          </div>

          <div className="text-center pt-2 pb-4">
            <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              {isDone ? "오늘도 이야기해줘서 고마워요" : "케이가 듣고 있어요…"}
            </h1>
            <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
              {isDone ? "부모님이 리포트에서 확인할 수 있어요" : "자유롭게 이야기해 보세요"}
            </p>
          </div>

          <div className="flex justify-center mb-4">
            <div className="w-24 h-24 rounded-full bg-white shadow-sm flex items-center justify-center overflow-hidden">
              <Image
                src="/Images/mascot/mascot-standing.png"
                alt="케이 마스코트"
                width={80}
                height={80}
                className="object-contain"
              />
            </div>
          </div>
        </div>

        {/* 대화 말풍선: 이 영역만 스크롤 */}
        <div className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4">
          {visibleTurns.map((turn, i) => (
            <div
              key={i}
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                turn.speaker === "kay" ? "self-start" : "self-end"
              }`}
              style={{
                background: turn.speaker === "kay" ? "#f3f4f6" : "#3b82f6",
                color: turn.speaker === "kay" ? "var(--color-k-text-primary)" : "#ffffff",
              }}
            >
              {turn.text}
            </div>
          ))}
        </div>

        {/* 하단 버튼 바 */}
        <div className="flex items-center justify-center gap-8 py-5">
          <button
            disabled
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg opacity-50 cursor-not-allowed"
            aria-label="텍스트로 대화하기"
          >
            💬
          </button>
          <button
            onClick={handleMic}
            disabled={isDone}
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white shadow-md transition-transform active:scale-95 disabled:opacity-40 cursor-pointer"
            style={{ background: "var(--color-k-orange)" }}
            aria-label="마이크로 대화하기"
          >
            🎤
          </button>
          <Link
            href="/demo/child"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg"
            aria-label="닫기"
          >
            ✕
          </Link>
        </div>

        <ChildNav active="대화" />
      </div>
    </DemoFrame>
  );
}
