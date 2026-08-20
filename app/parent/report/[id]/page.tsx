"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { useDemoView } from "@/app/demo/components/DemoViewContext";
import { ReportDetailSkeleton } from "./ReportDetailSkeleton";
import KChatbotWidget from "@/components/KChatbotWidget";
import {
  DailyReportRecommendationGuide,
  type DailyReport,
} from "@/components/ReportDetailModal";
import { buildMeaningfulReportSections } from "@/lib/reports/reportSectionAvailability";
import { useBrowserTTS } from "@/hooks/useBrowserTTS";
import { buildDailyReportTtsContent } from "@/lib/speech/reportTtsContent";

type EmotionLevel = "safe" | "warning" | "danger";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  parent_conversation_clue?: string | null;
  recommended_questions?: string[] | null;
  emotion_level: EmotionLevel | null;
  created_at: string;
  school_academy_life?: string | null;
  peer_friendship?: string | null;
  emotion_hint?: string | null;
  interests_preferences?: string | null;
  study_concerns?: string | null;
  digital_content_interests?: string | null;
  future_dreams?: string | null;
  teacher_adults?: string | null;
  recurring_stories?: string | null;
}

const TABS = [
  { id: 1, label: "빠른 요약" },
  { id: 2, label: "상세 보기" },
  { id: 3, label: "추천 가이드" },
];

function moodLabel(score: number): string {
  if (score <= 2) return "많이 힘들어 보여요";
  if (score <= 4) return "조금 힘들었던 것 같아요";
  if (score <= 6) return "평온한 하루였어요";
  if (score <= 8) return "즐거운 대화였어요";
  return "아주 신나는 하루였어요!";
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { view } = useDemoView();
  const { id } = use(params);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  // 조회가 빠르게 끝나면(체감상 순식간) 스켈레톤을 아예 건너뛴다 — 이 지연 이후에도
  // 여전히 로딩 중일 때만 스켈레톤을 보여줘서, 빠른 경우엔 하드컷 없이 바로 콘텐츠가 뜬다.
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Care Start 계정은 상세 필드(parent_guide/dashboard_cards)가 서버에서 스트리핑된 채 내려온다 —
  // "빠른 요약" 탭은 그대로 보되, "상세 보기"/"추천 가이드" 탭만 잠금 안내로 대체한다.
  const [restricted, setRestricted] = useState(false);
  const [activeTab, setActiveTab] = useState(1);
  const { isSupported: isTtsSupported, isSpeaking, speak, stop } = useBrowserTTS();

  useEffect(() => {
    stop();
  }, [activeTab, id, stop]);

  useEffect(() => {
    const skeletonTimer = setTimeout(() => setShowSkeleton(true), 150);

    fetch(`/api/parent/reports/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (d.error) setError(d.error);
        else {
          setReport(d.report);
          setRestricted(Boolean(d.restricted));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        clearTimeout(skeletonTimer);
        setLoading(false);
      });

    fetch(`/api/parent/reports/${id}/viewed`, { method: "POST" }).catch(() => {});

    return () => clearTimeout(skeletonTimer);
  }, [id]);

  if (loading) {
    if (!showSkeleton) {
      // 150ms 안에 끝날 수도 있으니 그 사이엔 빈 배경만(스켈레톤 깜빡임 방지)
      return <DemoFrame><div className="h-full" style={{ background: "#f3f4f6" }} /></DemoFrame>;
    }
    return (
      <DemoFrame>
        <ReportDetailSkeleton />
      </DemoFrame>
    );
  }

  if (error || !report) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--color-k-surface)" }}>
          <p className="text-sm font-semibold mb-4 text-red-500">{error ?? "리포트를 불러올 수 없어요"}</p>
          <Link href="/parent/report" className="text-xs underline font-bold" style={{ color: "var(--color-k-navy)" }}>
            목록으로 돌아가기
          </Link>
        </div>
      </DemoFrame>
    );
  }

  const ttsContent = buildDailyReportTtsContent(
    report as unknown as Record<string, unknown>,
    activeTab,
    restricted,
  );

  // 빠른 요약 탭
  const Tab1 = () => (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          오늘의 한 줄
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {report.summary_line || "대화 요약이 준비 중입니다."}
        </p>
        <p className="text-[11px] mt-3" style={{ color: "var(--color-k-orange)" }}>
          AI Insight by 내친구 케이
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📊 1분 요약 리포트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {report.parent_guide || "아이가 보낸 하루 대화에 대한 가이드 조언이 생성되지 않았습니다."}
        </p>
      </div>
    </div>
  );

  // 상세 보기 탭
  const Tab2 = () => {
    const sections = buildMeaningfulReportSections(report as unknown as Record<string, unknown>);

    return (
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-5">
        <h3 className="font-bold text-base -mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📄 상세 리포트
        </h3>
        {sections.length > 0 ? (
          sections.map((section) => (
            <div key={section.key} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
              <h4 className="font-bold text-sm mb-1.5" style={{ color: "var(--color-k-text-primary)" }}>
                {section.title}
              </h4>
              <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
                {section.body}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm leading-relaxed text-gray-500">
            이번 리포트에서 제공할 상세 분석이 없어요.
          </p>
        )}
      </div>
    );
  };

  // 추천 가이드 탭
  const Tab3 = () => {
    return <DailyReportRecommendationGuide report={report as unknown as DailyReport} />;
  };

  const LockedTabNotice = () => (
    <div className="bg-white rounded-2xl px-5 py-10 shadow-sm flex flex-col items-center text-center">
      <p className="text-4xl mb-3">🔒</p>
      <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
        상세 리포트는 Care Insight로 업그레이드하세요
      </p>
      <p className="text-xs text-gray-400 mb-5">
        Care Start에서는 빠른 요약만 제공돼요. 상세 대시보드와 추천 가이드는 Insight 이상에서 볼 수 있어요.
      </p>
      <Link
        href="/parent/settings"
        className="px-5 py-2.5 rounded-full text-xs font-bold text-white"
        style={{ background: "var(--color-k-navy)" }}
      >
        요금제 업그레이드
      </Link>
    </div>
  );

  const renderTab = () => {
    if (activeTab === 1) return <Tab1 />;
    if (restricted) return <LockedTabNotice />;
    if (activeTab === 2) return <Tab2 />;
    return <Tab3 />;
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden animate-fade-in" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div
          className={`flex-1 min-h-0 overflow-y-auto ${view === "tablet" ? "flex gap-6 px-4 pt-4" : ""}`}
        >
          {/* 탭 버튼들 */}
          <div
            className={
              view === "tablet"
                ? "flex flex-col gap-2 w-40 shrink-0"
                : "flex gap-2 px-4 pt-4 overflow-x-auto shrink-0 pb-1"
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
                {tab.id !== 1 && restricted ? `🔒 ${tab.label}` : tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 px-4 py-4">
            {isTtsSupported && ttsContent.length > 0 && (
              <button
                type="button"
                onClick={() => isSpeaking ? stop() : speak(ttsContent)}
                className="mb-4 min-h-11 w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm"
                style={{ background: "var(--color-k-navy)" }}
              >
                {isSpeaking ? "⏹ 정지" : "🔊 음성으로 듣기"}
              </button>
            )}
            {renderTab()}
          </div>
        </div>

        <RealParentNav />
      </div>
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
