"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { useDemoView } from "@/app/demo/components/DemoViewContext";
import { ReportDetailSkeleton } from "./ReportDetailSkeleton";

type EmotionLevel = "safe" | "warning" | "danger";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  emotion_level: EmotionLevel | null;
  created_at: string;
  school_academy_life?: string | null;
  peer_friendship?: string | null;
  emotion_hint?: string | null;
  interests_preferences?: string | null;
  study_concerns?: string | null;
  digital_content_interests?: string | null;
  future_dreams?: string | null;
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
        <div className="h-full flex flex-col items-center justify-center px-6 text-center" style={{ background: "#fafaf8" }}>
          <p className="text-sm font-semibold mb-4 text-red-500">{error ?? "리포트를 불러올 수 없어요"}</p>
          <Link href="/parent/report" className="text-xs underline font-bold" style={{ color: "#1a6b5a" }}>
            목록으로 돌아가기
          </Link>
        </div>
      </DemoFrame>
    );
  }

  // 빠른 요약 탭
  const Tab1 = () => (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
        <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
          오늘의 한 줄
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
          {report.summary_line || "대화 요약이 준비 중입니다."}
        </p>
        <p className="text-[11px] mt-3" style={{ color: "#e8845a" }}>
          AI Insight by 내친구 케이
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
          📊 1분 요약 리포트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
          {report.parent_guide || "아이가 보낸 하루 대화에 대한 가이드 조언이 생성되지 않았습니다."}
        </p>
      </div>
    </div>
  );

  // 상세 보기 탭
  const Tab2 = () => {
    const sections = [
      { title: "학교·학원 생활", body: report.school_academy_life },
      { title: "친구 관계와 또래 생활", body: report.peer_friendship },
      { title: "감정 힌트", body: report.emotion_hint },
      { title: "관심사와 개인 취향", body: report.interests_preferences },
      { title: "공부 고민", body: report.study_concerns },
      { title: "디지털 관심사와 콘텐츠 취향", body: report.digital_content_interests },
      { title: "미래·진로·꿈", body: report.future_dreams },
      { title: "반복되는 이야기", body: report.recurring_stories },
    ];

    return (
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-5">
        <h3 className="font-bold text-base -mb-2" style={{ color: "#1e1e2d" }}>
          📄 상세 리포트
        </h3>
        {sections.map((section) => (
          <div key={section.title} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
            <h4 className="font-bold text-sm mb-1.5" style={{ color: "#1e1e2d" }}>
              {section.title}
            </h4>
            <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
              {section.body || "오늘은 관련 기록이 없어요."}
            </p>
          </div>
        ))}
      </div>
    );
  };

  // 추천 가이드 탭
  const Tab3 = () => {
    // parent_guide에서 질문 후보들을 파싱
    const candidateSentences = report.parent_guide
      ? report.parent_guide
          .split(/[.\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 5 && (s.includes("?") || s.endsWith("요") || s.endsWith("까")))
      : [];

    const watchOut = report.recurring_stories || "아이가 대화 중 반복하여 꺼낸 특별한 주말/기타 일정 이야기가 확인되지 않았습니다.";
    const comment = `오늘 아이는 ${report.interests_preferences || "케이와의 소소한 일상"} 이야기에 가장 밝게 마음을 열고 대답했습니다.`;

    return (
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
            💬 부모 대화 실마리
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {report.parent_guide || "대화 실마리가 준비 중입니다."}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-3" style={{ color: "#1e1e2d" }}>
            ❓ 부모용 추천 질문
          </h3>
          {candidateSentences.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {candidateSentences.slice(0, 5).map((q, i) => (
                <li key={i} className="flex gap-2 text-sm" style={{ color: "#3a3a4a" }}>
                  <span style={{ color: "#22c55e" }}>✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">생성된 질문 가이드가 아직 없습니다.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#3b82f6" }}>
            👁️ 부모가 주의 깊게 볼 변화
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {watchOut}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
            ✨ 오늘의 케이 코멘트
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {comment}
          </p>
        </div>
      </div>
    );
  };

  const LockedTabNotice = () => (
    <div className="bg-white rounded-2xl px-5 py-10 shadow-sm flex flex-col items-center text-center">
      <p className="text-4xl mb-3">🔒</p>
      <p className="text-sm font-bold mb-2" style={{ color: "#1e1e2d" }}>
        상세 리포트는 Care Insight로 업그레이드하세요
      </p>
      <p className="text-xs text-gray-400 mb-5">
        Care Start에서는 빠른 요약만 제공돼요. 상세 대시보드와 추천 가이드는 Insight 이상에서 볼 수 있어요.
      </p>
      <Link
        href="/parent/settings"
        className="px-5 py-2.5 rounded-full text-xs font-bold text-white"
        style={{ background: "#1a6b5a" }}
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
                  background: activeTab === tab.id ? "#1a6b5a" : "#ffffff",
                  color: activeTab === tab.id ? "#ffffff" : "#3a3a4a",
                }}
              >
                {tab.id !== 1 && restricted ? `🔒 ${tab.label}` : tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 px-4 py-4">{renderTab()}</div>
        </div>

        <RealParentNav />
      </div>
    </DemoFrame>
  );
}
