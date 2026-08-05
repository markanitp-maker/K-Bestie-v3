"use client";

import { useEffect } from "react";

// requests/request-parent-query-router-grade4-v1.md §10 — 한 번에 한 질문만 허용한다.
// 여러 질문이 감지되면 자동으로 하나를 골라 등록하지 않고, 부모가 직접 하나를 선택하게 한다.

export interface MultiQuestionCandidate {
  ruleId: string;
  parentDraftText: string;
}

export interface MultiQuestionSelectModalProps {
  questionCount: number;
  candidates: MultiQuestionCandidate[];
  onCancel: () => void;
  onSelect: (ruleId: string) => void;
}

export function MultiQuestionSelectModal({ questionCount, candidates, onCancel, onSelect }: MultiQuestionSelectModalProps) {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/40 animate-fade-in"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-question-modal-title"
    >
      <div
        className="w-full max-h-[85dvh] sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden outline-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0 border-b border-gray-100">
          <h2 id="multi-question-modal-title" className="text-base font-bold text-gray-900">
            한 번에 한 가지만 물어볼 수 있어요
          </h2>
          <button onClick={onCancel} aria-label="닫기" className="p-2 -mr-2 text-gray-400 hover:bg-gray-100 rounded-full">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto flex flex-col gap-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            질문 {questionCount}개가 담겨 있었어요. 이 중 하나만 골라 아이에게 물어볼 수 있어요.
          </p>
          {candidates.map((c) => (
            <button
              key={c.ruleId}
              onClick={() => onSelect(c.ruleId)}
              className="text-left text-sm font-medium p-3 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100"
            >
              {c.parentDraftText}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 shrink-0 border-t border-gray-100">
          <button onClick={onCancel} className="w-full py-3 text-sm font-bold rounded-xl bg-gray-100 text-gray-600">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
