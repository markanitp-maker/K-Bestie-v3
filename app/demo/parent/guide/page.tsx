"use client";

import { useState } from "react";
import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ParentNav } from "../../components/ParentNav";
import { parentGuideTurns } from "../../lib/mockData";

const INITIAL_VISIBLE = 2;

export default function DemoParentGuidePage() {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const isDone = visibleCount >= parentGuideTurns.length;
  const visibleTurns = parentGuideTurns.slice(0, visibleCount);

  const handleNext = () => {
    if (isDone) return;
    setVisibleCount((c) => Math.min(c + 1, parentGuideTurns.length));
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2">
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            케이와 대화
          </Link>
        </div>

        <p className="shrink-0 text-center text-xs pb-3" style={{ color: "#6b7280" }}>
          AI 대화 가이드 — 상황별 추천 질문과 대화법
        </p>

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

        {/* 하단 버튼 바 — 아이 대화 화면과 동일 */}
        <div className="flex items-center justify-center gap-8 py-5">
          <button
            disabled
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg opacity-50 cursor-not-allowed"
            aria-label="텍스트로 대화하기"
          >
            💬
          </button>
          <button
            onClick={handleNext}
            disabled={isDone}
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white shadow-md transition-transform active:scale-95 disabled:opacity-40 cursor-pointer"
            style={{ background: "var(--color-k-orange)" }}
            aria-label="마이크로 대화하기"
          >
            🎤
          </button>
          <Link
            href="/demo/parent"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg"
            aria-label="닫기"
          >
            ✕
          </Link>
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
