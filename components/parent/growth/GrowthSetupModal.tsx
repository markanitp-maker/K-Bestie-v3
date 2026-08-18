"use client";

// 요청서 012 §3-2, §3-10 — 성장정보 최초 설정.
//
// 회원가입·아이 추가에는 생년월일을 넣지 않고, 부모가 성장 카드를 처음 눌렀을 때만 여기서 받는다.
// 동의하지 않으면 아무것도 저장하지 않는다(취소 시 생성 0건).

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  GROWTH_CONSENT_ITEMS,
  GROWTH_CONSENT_MEDICAL_NOTICE,
  GROWTH_CONSENT_TITLE,
  GROWTH_CONSENT_VERSION,
  calculateAgeInMonths,
  formatKoreanAge,
  needsBirthDateConfirmation,
  todayInKst,
} from "@/lib/growth";
import type { GrowthStateResponse } from "@/lib/growth/types";
import { BirthDateField } from "./BirthDateField";

interface Props {
  childId: string;
  childName: string;
  /** child_profiles.gender — 이미 있으면 성별을 다시 묻지 않는다. */
  currentGender: "male" | "female" | null;
  onClose: () => void;
  onCompleted: (state: GrowthStateResponse) => void;
}

export function GrowthSetupModal({ childId, childName, currentGender, onClose, onCompleted }: Props) {
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayInKst();
  const needsGender = currentGender === null;

  const agePreview = useMemo(() => {
    if (!birthDate) return null;
    const months = calculateAgeInMonths(birthDate, today);
    if (months === null) return null;
    return { months, label: formatKoreanAge(months) };
  }, [birthDate, today]);

  const ageWarning = agePreview !== null && needsBirthDateConfirmation(agePreview.months);
  const canSubmit = consent && birthDate !== "" && (!needsGender || gender !== "") && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/parent/growth/${encodeURIComponent(childId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          birthDate,
          consent: true,
          ...(needsGender ? { gender } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data?.error === "string" ? data.error : "저장하지 못했어요.");
        return;
      }
      onCompleted(data as GrowthStateResponse);
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] sm:rounded-3xl sm:pb-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-bold text-[var(--color-k-navy)]">우리 아이 성장정보 시작하기</h2>
            <p className="mt-1 text-[13px] font-medium text-gray-500">
              {childName}의 성장 기록을 보려면 생년월일이 필요해요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-[var(--color-k-navy)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <span className="block text-[14px] font-bold text-[#1F2937]">생년월일</span>
        {/* iOS 의 날짜 피커가 년·월 휠로 열려 일자가 묻히던 문제(2026-08-19 대표님 실기기)로,
            OS 피커 대신 년·월·일을 한 번에 고르고 직접 타이핑도 되는 입력으로 바꿨다. */}
        <BirthDateField value={birthDate} onChange={setBirthDate} />
        {agePreview && (
          <p className="mt-2 text-[13px] font-semibold text-gray-600">
            측정 기준 나이: {agePreview.label}
          </p>
        )}
        {ageWarning && (
          <p className="mt-1 text-[13px] font-semibold text-[#C2410C]">
            내친구 케이는 초등학생(만 6~13세) 서비스예요. 생년월일을 한 번 더 확인해 주세요.
          </p>
        )}

        {needsGender && (
          <div className="mt-5">
            <span className="block text-[14px] font-bold text-[#1F2937]">성별</span>
            <p className="mt-1 text-[12px] font-medium text-gray-500">
              성장도표는 성별·연령 기준으로 비교하기 때문에 필요해요.
            </p>
            <div className="mt-2 flex gap-2">
              {(["male", "female"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setGender(option)}
                  className={`h-12 flex-1 rounded-2xl border text-[15px] font-bold transition-colors ${
                    gender === option
                      ? "border-[var(--color-k-orange)] bg-[var(--color-k-orange)] text-white"
                      : "border-[#10315B]/20 bg-white text-[var(--color-k-navy)]"
                  }`}
                >
                  {option === "male" ? "남자" : "여자"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-2xl bg-[#F7F9FC] p-4">
          <h3 className="text-[14px] font-bold text-[var(--color-k-navy)]">{GROWTH_CONSENT_TITLE}</h3>
          <ul className="mt-2 space-y-1.5">
            {GROWTH_CONSENT_ITEMS.map((item) => (
              <li key={item} className="text-[12.5px] font-medium leading-[1.5] text-gray-700">
                · {item}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-gray-500">{GROWTH_CONSENT_MEDICAL_NOTICE}</p>
          <p className="mt-1 text-[11px] font-medium text-gray-400">동의 버전 {GROWTH_CONSENT_VERSION}</p>
        </div>

        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-k-orange)]"
          />
          <span className="text-[14px] font-bold text-[#1F2937]">
            위 성장정보 수집·이용에 동의합니다.
          </span>
        </label>

        {error && <p className="mt-3 text-[13px] font-bold text-red-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[52px] flex-1 rounded-2xl bg-black/5 text-[15px] font-bold text-[var(--color-k-navy)]"
          >
            나중에 하기
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-[52px] flex-[1.4] rounded-2xl bg-[var(--color-k-orange)] text-[15px] font-bold text-white disabled:opacity-40"
          >
            {saving ? "저장 중…" : "동의하고 시작하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
