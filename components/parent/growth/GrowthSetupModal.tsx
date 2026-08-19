"use client";

// 요청서 012 §3-2, §3-10 — 성장정보 최초 설정.
//
// 회원가입·아이 추가에는 생년월일을 넣지 않고, 부모가 성장 카드를 처음 눌렀을 때만 여기서 받는다.
// 동의하지 않으면 아무것도 저장하지 않는다(취소 시 생성 0건).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

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
  // 017 §3-2, §3-3 — 동의 상세는 기본 접힘. 문구는 그대로 두고 렌더링만 접는다.
  const [consentExpanded, setConsentExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 017 §3-4 — 동의가 끝나면 빈 성장정보 화면으로 보내지 않고 첫 기록 입력으로 잇는다.
  const [step, setStep] = useState<"consent" | "firstMeasurement">("consent");
  const [profileState, setProfileState] = useState<GrowthStateResponse | null>(null);
  const [measuredAt, setMeasuredAt] = useState(todayInKst());
  const [heightInput, setHeightInput] = useState("");
  const [weightInput, setWeightInput] = useState("");

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
      // 017 §3-4 — 프로필·동의는 저장됐다. 이어서 첫 측정값을 받는다.
      setProfileState(data as GrowthStateResponse);
      setStep("firstMeasurement");
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * 첫 측정기록 저장. 기존 `새 기록 추가`와 같은 엔드포인트·검증을 쓴다(017 §3-5).
   *
   * 017 §3-7 — 여기서 실패해도 생년월일·동의는 되돌리지 않는다. 이미 저장된 사실이고,
   * 되돌리면 부모가 처음부터 다시 해야 한다. 입력값을 남긴 채 다시 시도하게 둔다.
   */
  const handleFirstMeasurement = async () => {
    if (saving) return;
    if (heightInput.trim() === "" && weightInput.trim() === "") {
      setError("키와 몸무게 중 하나는 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/parent/growth/${encodeURIComponent(childId)}/measurements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            measuredAt,
            heightCm: heightInput.trim() === "" ? null : heightInput.trim(),
            weightKg: weightInput.trim() === "" ? null : weightInput.trim(),
          }),
        }
      );
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

  /** 첫 기록을 건너뛰면 지금까지 저장된 상태로 상세 화면을 연다. */
  const skipFirstMeasurement = () => {
    if (profileState) onCompleted(profileState);
    else onClose();
  };

  // 017 §3-4 STEP 3 — 생년월일·동의가 끝난 뒤 같은 모달 안에서 첫 기록을 받는다.
  if (step === "firstMeasurement") {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
        <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] sm:rounded-3xl sm:pb-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-bold text-[var(--color-k-navy)]">첫 성장기록 입력</h2>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                지금 키와 몸무게를 넣으면 바로 성장도표를 볼 수 있어요.
              </p>
            </div>
            <button
              type="button"
              onClick={skipFirstMeasurement}
              aria-label="닫기"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-[var(--color-k-navy)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <label className="block text-[14px] font-bold text-[#1F2937]" htmlFor="growth-first-measured-at">
            측정일
          </label>
          <input
            id="growth-first-measured-at"
            type="date"
            value={measuredAt}
            max={today}
            min={birthDate || undefined}
            onChange={(event) => setMeasuredAt(event.target.value)}
            className="mt-2 h-12 w-full rounded-2xl border border-[#10315B]/20 px-4 text-[15px] font-semibold text-[var(--color-k-navy)]"
          />

          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <label className="block text-[14px] font-bold text-[#1F2937]" htmlFor="growth-first-height">
                키 (cm)
              </label>
              <input
                id="growth-first-height"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={heightInput}
                onChange={(event) => setHeightInput(event.target.value)}
                placeholder="예: 138.5"
                className="mt-2 h-12 w-full rounded-2xl border border-[#10315B]/20 px-4 text-[15px] font-semibold text-[var(--color-k-navy)]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[14px] font-bold text-[#1F2937]" htmlFor="growth-first-weight">
                몸무게 (kg)
              </label>
              <input
                id="growth-first-weight"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={weightInput}
                onChange={(event) => setWeightInput(event.target.value)}
                placeholder="예: 32.4"
                className="mt-2 h-12 w-full rounded-2xl border border-[#10315B]/20 px-4 text-[15px] font-semibold text-[var(--color-k-navy)]"
              />
            </div>
          </div>

          <p className="mt-2 text-[12px] font-medium text-gray-500">
            둘 중 하나만 입력해도 저장돼요. 나머지는 나중에 추가할 수 있어요.
          </p>

          {error && <p className="mt-3 text-[13px] font-bold text-red-600">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={skipFirstMeasurement}
              className="h-[52px] flex-1 rounded-2xl bg-black/5 text-[15px] font-bold text-[var(--color-k-navy)]"
            >
              나중에 입력
            </button>
            <button
              type="button"
              onClick={handleFirstMeasurement}
              disabled={saving}
              className="h-[52px] flex-[1.4] rounded-2xl bg-[var(--color-k-orange)] text-[15px] font-bold text-white disabled:opacity-40"
            >
              {saving ? "저장 중…" : "저장하고 성장정보 보기"}
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* 017 §3-2, §3-3 — 동의 문구는 하나도 지우지 않고 기본 접힘으로만 바꾼다.
            CSS 로 숨기지 않고 조건부 렌더링 + aria-expanded 로 접근성을 지킨다. */}
        <div className="mt-5 rounded-2xl bg-[#F7F9FC] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-bold text-[var(--color-k-navy)]">{GROWTH_CONSENT_TITLE}</h3>
            <button
              type="button"
              onClick={() => setConsentExpanded((expanded) => !expanded)}
              aria-expanded={consentExpanded}
              aria-controls="growth-consent-details"
              className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-bold text-[var(--color-k-navy)]"
            >
              {consentExpanded ? "내용 접기" : "내용 확인"}
              {consentExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          {consentExpanded && (
            <div id="growth-consent-details">
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
          )}
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
