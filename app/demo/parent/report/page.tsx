"use client";

import { useState } from "react";
import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { useDemoView } from "../../components/DemoViewContext";
import { ParentNav } from "../../components/ParentNav";
import {
  oneLineSummary,
  oneMinuteSummary,
  detailReport,
  conversationClue,
  recommendedQuestions,
  watchOutChange,
  kayComment,
} from "../../lib/mockData";

const TABS = [
  { id: 1, label: "빠른 요약" },
  { id: 2, label: "상세 보기" },
  { id: 3, label: "추천 가이드" },
];

function QuoteCard() {
  return (
    <div
      className="rounded-2xl px-5 py-5 mb-5"
      style={{ background: "#fdf1ec" }}
    >
      <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
        오늘의 한 줄
      </h3>
      <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
        {oneLineSummary}
      </p>
      <p className="text-[11px] mt-3" style={{ color: "var(--color-k-orange)" }}>
        AI Insight by 내친구 케이
      </p>
    </div>
  );
}

function Tab1() {
  return (
    <div>
      <QuoteCard />
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📊 1분 요약 리포트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {oneMinuteSummary}
        </p>
      </div>
    </div>
  );
}

function Tab2() {
  const sections = [
    detailReport.todayAndEvents,
    detailReport.moodOfDay,
    detailReport.schoolAndAcademy,
    detailReport.friends,
    detailReport.interests,
    detailReport.parentSignal,
  ];

  return (
    <div>
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-5">
        <h3 className="font-bold text-base -mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📄 상세 리포트
        </h3>
        {sections.map((section) => (
          <div key={section.title}>
            <h4 className="font-bold text-sm mb-1.5" style={{ color: "var(--color-k-text-primary)" }}>
              {section.title}
            </h4>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tab3() {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          💬 부모 대화 실마리
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {conversationClue}
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-3" style={{ color: "var(--color-k-text-primary)" }}>
          ❓ 부모용 추천 질문
        </h3>
        <ul className="flex flex-col gap-2.5">
          {recommendedQuestions.map((q, i) => (
            <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--color-k-text-primary)" }}>
              <span style={{ color: "#22c55e" }}>✓</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "#3b82f6" }}>
          👁️ 부모가 주의 깊게 볼 변화
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {watchOutChange}
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          ✨ 오늘의 케이 코멘트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {kayComment}
        </p>
      </div>
    </div>
  );
}

export default function DemoReportPage() {
  const { view } = useDemoView();
  const [activeTab, setActiveTab] = useState(1);

  const renderTab = () => {
    if (activeTab === 1) return <Tab1 />;
    if (activeTab === 2) return <Tab2 />;
    return <Tab3 />;
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            내친구 케이
          </Link>
        </div>

        <div
          className={`flex-1 min-h-0 overflow-y-auto ${view === "tablet" ? "flex gap-6 px-4 pt-4" : ""}`}
        >
          <div
            className={
              view === "tablet"
                ? "flex flex-col gap-2 w-40 shrink-0"
                : "flex gap-2 px-4 pt-4 overflow-x-auto"
            }
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-colors cursor-pointer ${
                  activeTab === tab.id ? "text-white" : "bg-white"
                }`}
                style={{
                  background: activeTab === tab.id ? "var(--color-k-navy)" : "#ffffff",
                  color: activeTab === tab.id ? "#ffffff" : "var(--color-k-text-primary)",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 px-4 py-4">{renderTab()}</div>
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
