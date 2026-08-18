"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { PlaySkillDto, PlaySkillsCatalogResponse, ExecuteSkillSelectionResult } from "@/lib/k-conversation/play/playSelection";

export interface PlaySkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatSessionId: string | null;
  onSkillStarted?: (openingLine?: string) => void;
}

export function PlaySkillModal({
  isOpen,
  onClose,
  chatSessionId,
  onSkillStarted,
}: PlaySkillModalProps) {
  const [skills, setSkills] = useState<PlaySkillDto[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingSkillId, setSelectingSkillId] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const fetchCatalog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const query = chatSessionId ? `?chatSessionId=${encodeURIComponent(chatSessionId)}` : "";
      const res = await fetch(`/api/play/skills${query}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `카탈로그 조회 실패 (${res.status})`);
      }
      const data: PlaySkillsCatalogResponse = await res.json();
      setSkills(data.skills || []);
      setActiveSkillId(data.activeSkillId || null);
    } catch (err) {
      console.error("[PlaySkillModal] fetchCatalog error:", err);
      setError(err instanceof Error ? err.message : "놀이 목록을 불러오지 못했어요.");
    } finally {
      setIsLoading(false);
    }
  }, [chatSessionId]);

  useEffect(() => {
    if (isOpen) {
      setSelectingSkillId(null);
      setIsEnding(false);
      setError(null);
      void fetchCatalog();
    }
  }, [isOpen, fetchCatalog]);

  const handleSelectSkill = async (skill: PlaySkillDto) => {
    if (!skill.available || selectingSkillId || isEnding) return;

    if (!chatSessionId) {
      setError("대화 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.");
      return;
    }

    setSelectingSkillId(skill.id);
    setError(null);

    try {
      const res = await fetch("/api/play/skill/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatSessionId,
          skillId: skill.id,
        }),
      });

      const data: ExecuteSkillSelectionResult = await res.json().catch(() => ({ ok: false, error: "응답 처리 오류" }));

      if (res.ok && data.ok) {
        onClose();
        onSkillStarted?.(data.openingLine);
      } else {
        setError(data.error || "놀이를 시작하지 못했어요. 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("[PlaySkillModal] selectSkill error:", err);
      setError(err instanceof Error ? err.message : "놀이 시작 중 오류가 발생했어요.");
    } finally {
      setSelectingSkillId(null);
    }
  };

  const handleEndSkill = async () => {
    if (isEnding || selectingSkillId) return;

    if (!chatSessionId) {
      setError("대화 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.");
      return;
    }

    setIsEnding(true);
    setError(null);

    try {
      const res = await fetch("/api/play/skill/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatSessionId,
        }),
      });

      const data: { ok: boolean; ended?: boolean; error?: string } = await res
        .json()
        .catch(() => ({ ok: false, error: "응답 처리 오류" }));

      if (res.ok && data.ok) {
        // 성공 시 모달 닫고 자유대화 복귀 (§3-9)
        onClose();
      } else {
        // 실패 시 모달을 닫지 않고 오류 표시 (§3-9)
        setError(data.error || "놀이를 종료하지 못했어요. 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("[PlaySkillModal] endSkill error:", err);
      setError(err instanceof Error ? err.message : "놀이 종료 중 오류가 발생했어요.");
    } finally {
      setIsEnding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-200 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="play-skill-modal-title"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="relative w-[clamp(280px,calc(var(--frame-w,100vw)*0.88),380px)] max-h-[85vh] flex flex-col bg-white rounded-[24px] shadow-2xl border border-[#FFE0B5] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-orange-100/60">
          <div className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label="놀이">🎲</span>
            <div>
              <h2
                id="play-skill-modal-title"
                className="text-[clamp(16px,calc(var(--frame-w,100vw)*0.045),19px)] font-bold text-gray-800 leading-snug"
              >
                케이 놀이 선택
              </h2>
              <p className="text-[clamp(12px,calc(var(--frame-w,100vw)*0.032),13px)] text-gray-500">
                하고 싶은 놀이를 골라봐!
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="놀이 선택창 닫기"
            className="w-[36px] h-[36px] rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:scale-95 transition-all cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div
              className="p-3 bg-red-50 border border-red-200 rounded-2xl text-[13px] text-red-600 font-medium flex items-center gap-2"
              role="alert"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="flex-1">{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-gray-400">
              <div className="w-8 h-8 border-3 border-[var(--color-k-orange)] border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px]">놀이 목록을 불러오고 있어요...</span>
            </div>
          ) : skills.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-[14px]">
              이용 가능한 놀이가 없어요.
            </div>
          ) : (
            <div className="space-y-2.5">
              {skills.map((skill) => {
                const isActive = skill.id === activeSkillId;
                const isCurrentSelecting = selectingSkillId === skill.id;
                const isAnySelecting = !!selectingSkillId;

                return (
                  <button
                    key={skill.id}
                    disabled={!skill.available || isAnySelecting}
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isActive
                        ? "bg-[#FFF8F3] border-[var(--color-k-orange)] shadow-sm ring-1 ring-[var(--color-k-orange)]/30"
                        : skill.available
                        ? "bg-white hover:bg-orange-50/40 border-gray-200 hover:border-orange-200 active:scale-[0.98] shadow-xs cursor-pointer"
                        : "bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-gray-800 text-[clamp(14px,calc(var(--frame-w,100vw)*0.038),16px)]">
                          {skill.name}
                        </span>
                        {isActive && (
                          <span className="px-2 py-0.5 bg-[#FFF0E6] text-[var(--color-k-orange)] border border-[var(--color-k-orange)] text-[11px] font-bold rounded-full">
                            진행 중
                          </span>
                        )}
                        {!skill.available && (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[11px] font-medium rounded-full">
                            {skill.unavailableReason || "준비 중"}
                          </span>
                        )}
                      </div>
                      <p className="text-[clamp(12px,calc(var(--frame-w,100vw)*0.032),13px)] text-gray-500 leading-snug line-clamp-2">
                        {skill.description}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center">
                      {isCurrentSelecting ? (
                        <div className="w-6 h-6 border-2 border-[var(--color-k-orange)] border-t-transparent rounded-full animate-spin" />
                      ) : skill.available ? (
                        <div className="w-8 h-8 rounded-full bg-orange-100/70 text-[var(--color-k-orange)] flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active Play End Section (§3-9: 활성 놀이가 있을 때만 표시, 목록과 명확히 구분) */}
          {activeSkillId && !isLoading && (
            <div className="pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={isEnding || !!selectingSkillId}
                onClick={handleEndSkill}
                className="w-full py-2.5 px-4 rounded-2xl bg-red-50/80 hover:bg-red-100/80 active:bg-red-200/80 border border-red-200/70 text-red-600 font-bold text-[clamp(13px,calc(var(--frame-w,100vw)*0.035),14px)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs active:scale-[0.98]"
              >
                {isEnding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    <span>놀이를 마치는 중...</span>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                    <span>지금 하는 놀이 그만하기</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 bg-orange-50/50 border-t border-orange-100/60 text-center">
          <p className="text-[12px] text-gray-500 font-medium">
            놀이 중 언제든 <span className="text-[var(--color-k-orange)] font-bold">&quot;그만&quot;</span>이라고 말하면 마칠 수 있어!
          </p>
        </div>
      </div>
    </div>
  );
}
