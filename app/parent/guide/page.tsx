"use client";

import { useState, useEffect } from "react";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";

import { RegisteredQuestionsList, type Question } from "@/components/RegisteredQuestionsList";

export default function ParentGuidePage() {
  const [childName, setChildName] = useState("");
  const [todayGuide, setTodayGuide] = useState("");
  const [emotionTags, setEmotionTags] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qInput, setQInput] = useState("");
  const [qLoading, setQLoading] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    setChildId(id);
    if (!id) return;

    Promise.all([
      fetch(`/api/child/${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/parent/reports?childId=${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/parent/questions?childId=${id}`).then((r) => r.ok ? r.json() : null),
    ]).then(([childData, reportData, qData]) => {
      if (childData?.name) setChildName(childData.name);
      const reports = reportData?.reports ?? [];
      if (reports.length > 0) {
        const latest = reports[0];
        if (latest.emotion_tags?.length > 0) setEmotionTags(latest.emotion_tags);
        if (latest.parent_guide) setTodayGuide(latest.parent_guide);
      }
      setQuestions(qData?.questions ?? []);
    }).catch(() => {});
  }, []);

  const refreshQuestions = () => {
    if (!childId) return;
    fetch(`/api/parent/questions?childId=${childId}`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []));
  };

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!qInput.trim() || !childId) return;
    setQLoading(true);
    try {
      await fetch("/api/parent/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, questionText: qInput.trim() }),
      });
      setQInput("");
      refreshQuestions();
    } finally {
      setQLoading(false);
    }
  }

  async function stopQuestion(id: string) {
    if (!childId) return;
    await fetch(`/api/parent/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "중지됨" }),
    });
    refreshQuestions();
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold" style={{ color: "#6b7280" }}>
              오늘의 가이드
            </p>
            <h1 className="text-lg font-bold text-gray-900 mt-0.5">대화 가이드 📖</h1>
          </div>

          {/* 오늘의 한마디 */}
          <div
            className="rounded-2xl p-5"
            style={{ background: "#1a6b5a", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
          >
            <p className="text-xs font-bold mb-2.5 text-white/80">오늘의 한마디</p>
            <p className="text-sm font-semibold text-white leading-relaxed">
              {todayGuide || "아이와 대화한 후 AI 가이드가 여기에 표시됩니다"}
            </p>
          </div>

          {/* 오늘의 감정 태그 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold mb-3.5" style={{ color: "#6b7280" }}>
              {childName ? `오늘 ${childName}이의 감정` : "오늘의 감정"}
            </p>
            {emotionTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {emotionTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold"
                    style={{ background: "#e8f2f0", color: "#1a6b5a" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                대화 후 감정 태그가 표시됩니다
              </p>
            )}
          </div>

          {/* 대화 팁 */}
          <div
            className="rounded-2xl p-5 shadow-sm"
            style={{ background: "#FFFBEB" }}
          >
            <p className="text-xs font-bold mb-2.5" style={{ color: "#D97706" }}>
              💛 대화 팁
            </p>
            <p className="text-sm text-gray-700 leading-relaxed font-medium">
              아이의 대답에 즉각 반응하지 말고 3초 여유를 두고 듣는 것이 효과적이에요.
            </p>
          </div>

          {/* 케이에게 질문 등록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold mb-3.5" style={{ color: "#6b7280" }}>
              케이에게 전달할 질문
            </p>
            <form onSubmit={addQuestion} className="flex gap-2 mb-3.5">
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="케이가 아이에게 전달할 질문..."
                maxLength={100}
                className="flex-1 min-w-0 px-3.5 py-3 rounded-xl text-sm outline-none border-2 border-transparent transition-colors"
                style={{ background: "#F9FAFB" }}
                onFocus={(e) => (e.target.style.borderColor = "#1a6b5a")}
                onBlur={(e) => (e.target.style.borderColor = "transparent")}
              />
              <button
                type="submit"
                disabled={qLoading || !qInput.trim() || !childId}
                className="px-4 py-3 rounded-xl text-white text-sm font-bold disabled:opacity-50 shrink-0 transition-opacity"
                style={{ background: "#1a6b5a" }}
              >
                등록
              </button>
            </form>

            {/* 질문 목록 */}
            <RegisteredQuestionsList questions={questions} />
          </div>

          {/* AI 고지 */}
          <p className="text-xs text-center py-4 text-gray-400">
            이 가이드는 AI가 생성한 제안으로 참고용입니다.
          </p>
        </div>

        {/* 하단 탭바 통일 */}
        <RealParentNav active="케이와 대화" />
      </div>
    </DemoFrame>
  );
}
