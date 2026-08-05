"use client";

import { useState, useEffect, useRef } from "react";

// requests/request-parent-question-draft-modal-fix.md §4 — 초안 질문 확인 모달.
// "아이에게 물어보기" 클릭 → 이 모달에서 확인/수정 → "질문 등록하기"를 눌러야만
// 실제로 등록된다(버튼 클릭 즉시 등록되던 기존 결함을 고치기 위한 필수 확인 절차).

export interface AskChildDraftModalProps {
  childName: string;
  draftQuestion: string;
  rewriteApplied?: boolean;
  weeklyUsedCount: number;
  weeklyLimit: number;
  isSubmitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  onSubmit: (finalQuestionText: string) => void;
  // requests/request-parent-query-router-grade4-v1.md §6.2/§12 — 4학년 라우터의 GREEN
  // 문구는 상담사 검토를 거친 고정 화이트리스트 문장이라 부모가 자유롭게 고쳐 쓸 수 없다
  // (자유 재작성 문구를 다루는 기존 흐름과 달리 읽기 전용으로 보여주기만 한다).
  editable?: boolean;
  // §9.1 "오늘 질문 0/1" — 라우터 경로에서만 값이 전달된다(undefined면 숨김).
  dailyUsedToday?: boolean;
}

export function AskChildDraftModal({
  childName,
  draftQuestion,
  rewriteApplied = false,
  weeklyUsedCount,
  weeklyLimit,
  isSubmitting,
  submitError,
  onCancel,
  onSubmit,
  editable = true,
  dailyUsedToday,
}: AskChildDraftModalProps) {
  const [editedText, setEditedText] = useState(draftQuestion);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditedText(draftQuestion);
  }, [draftQuestion]);

  // §4.3 모바일 요구사항 — 모달 열린 동안 배경 스크롤을 막는다.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onCancel]);

  const remaining = Math.max(0, weeklyLimit - weeklyUsedCount);
  const trimmedText = editedText.trim();
  const canSubmit = trimmedText.length > 0 && trimmedText.length <= 100 && !isSubmitting;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/40 animate-fade-in"
      onClick={() => { if (!isSubmitting) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-child-modal-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-h-[85dvh] sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden outline-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0 border-b border-gray-100">
          <h2 id="ask-child-modal-title" className="text-base font-bold text-gray-900">
            아이에게 이렇게 물어볼까요?
          </h2>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="닫기"
            className="p-2 -mr-2 text-gray-400 hover:bg-gray-100 rounded-full disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto flex flex-col gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">대상 아이</p>
            <p className="text-sm font-bold text-gray-900">{childName}</p>
          </div>

          <div>
            <p className="text-xs font-bold" style={{ color: "var(--color-k-navy)" }}>
              이번 주 질문 {weeklyUsedCount}/{weeklyLimit}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">남은 질문 {remaining}회</p>
            {typeof dailyUsedToday === "boolean" && (
              <p className="text-[11px] text-gray-400 mt-0.5">오늘 질문 {dailyUsedToday ? 1 : 0}/1</p>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1.5">질문 초안{editable ? " (수정할 수 있어요)" : ""}</p>
            {editable ? (
              <>
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  disabled={isSubmitting}
                  maxLength={100}
                  rows={3}
                  className="w-full text-sm p-3 border border-gray-200 rounded-xl outline-none resize-none disabled:opacity-60"
                  style={{ background: "#f9fafb" }}
                />
                <p className="text-[10px] text-gray-400 mt-1 text-right">{trimmedText.length}/100</p>
              </>
            ) : (
              <p className="w-full text-sm p-3 rounded-xl" style={{ background: "#f9fafb" }}>
                {draftQuestion}
              </p>
            )}
          </div>

          {rewriteApplied && (
            <p className="text-[11px] font-medium leading-relaxed" style={{ color: "var(--color-k-navy)" }}>
              질문을 아이가 편하게 답할 수 있도록 다듬었어요.
            </p>
          )}
          <p className="text-[11px] text-gray-500 leading-relaxed">
            한 번에 한 가지 질문만 아이에게 전달할 수 있어요.
            케이는 아이와 자연스럽게 대화할 수 있는 순간에 질문하고,
            아이의 답변을 다시 확인한 뒤 부모님께 알려드려요.
          </p>

          {submitError && (
            <p className="text-xs text-red-500 leading-relaxed">{submitError}</p>
          )}
        </div>

        <div className="px-5 py-4 flex gap-2 shrink-0 border-t border-gray-100">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-3 text-sm font-bold rounded-xl bg-gray-100 text-gray-600 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => onSubmit(trimmedText)}
            disabled={!canSubmit}
            className="flex-1 py-3 text-sm font-bold rounded-xl text-white disabled:opacity-50"
            style={{ background: "var(--color-k-navy)" }}
          >
            {isSubmitting ? "등록하는 중..." : "질문 등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
