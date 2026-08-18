"use client";

// 요청서 012 §3-4, §3-7, §3-8 — 부모 성장 상세.
//
// 표시 원칙: 백분위·또래 중앙값·성장 흐름을 함께 보여주고, 한 번의 측정값으로 단정하지 않는다.
// 가치판단(살쪘다/말랐다)·의료 처방·최종 키 예측은 넣지 않는다. 공식 판정 라벨은 공식 표현 그대로 쓴다.

import { useMemo, useState } from "react";
import { X, Pencil, Trash2 } from "lucide-react";

import {
  GROWTH_PROFESSIONAL_NOTICE,
  GROWTH_SINGLE_RECORD_NOTICE,
  GROWTH_TREND_NOTICE,
  GROWTH_UNSUPPORTED_NOTICE,
  formatPercentile,
  needsProfessionalNotice,
  todayInKst,
  type EvaluatedMeasurement,
  type IndicatorEvaluation,
} from "@/lib/growth";
import type { GrowthStateResponse } from "@/lib/growth/types";
import { GrowthTrendChart } from "./GrowthTrendChart";

interface Props {
  childId: string;
  state: GrowthStateResponse;
  onClose: () => void;
  onStateChange: (state: GrowthStateResponse) => void;
}

type FormMode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; measurement: EvaluatedMeasurement };

function formatValue(value: number, unit: string): string {
  return `${value.toFixed(1)}${unit}`;
}

function PercentileLine({
  evaluation,
  unit,
  indicatorLabel,
}: {
  evaluation: IndicatorEvaluation;
  unit: string;
  indicatorLabel: string;
}) {
  if (!evaluation.supported || evaluation.percentile === null) {
    return <p className="text-[13px] font-semibold text-gray-500">{GROWTH_UNSUPPORTED_NOTICE}</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-[13.5px] font-semibold leading-[1.5] text-gray-700">
        같은 성별·연령 성장도표에서 약 <span className="text-[var(--color-k-navy)]">{formatPercentile(evaluation.percentile)}백분위</span>에 있어요.
      </p>
      {evaluation.median !== null && (
        <p className="text-[13px] font-medium text-gray-500">
          또래 중앙값은 약 {formatValue(evaluation.median, unit)}예요.
        </p>
      )}
      {evaluation.verdict && (
        <p className="text-[12.5px] font-bold text-[var(--color-k-navy)]">
          공식 판정: {evaluation.verdict}
        </p>
      )}
      {needsProfessionalNotice(
        indicatorLabel === "체질량지수" ? "bmiForAge" : indicatorLabel === "몸무게" ? "weightForAge" : "heightForAge",
        evaluation.percentile
      ) && (
        <p className="text-[12.5px] font-semibold text-[#C2410C]">{GROWTH_PROFESSIONAL_NOTICE}</p>
      )}
    </div>
  );
}

export function GrowthDetailModal({ childId, state, onClose, onStateChange }: Props) {
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [measuredAt, setMeasuredAt] = useState(todayInKst());
  const [heightInput, setHeightInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const summary = state.summary;
  const today = todayInKst();

  const heightPoints = useMemo(
    () =>
      (summary?.history ?? [])
        .filter((item) => item.height !== null)
        .map((item) => ({ ageMonths: item.ageMonths, value: item.height!.value, measuredAt: item.measuredAt })),
    [summary]
  );
  const weightPoints = useMemo(
    () =>
      (summary?.history ?? [])
        .filter((item) => item.weight !== null)
        .map((item) => ({ ageMonths: item.ageMonths, value: item.weight!.value, measuredAt: item.measuredAt })),
    [summary]
  );

  const openCreate = () => {
    setFormMode({ kind: "create" });
    setMeasuredAt(today);
    setHeightInput("");
    setWeightInput("");
    setError(null);
  };

  const openEdit = (measurement: EvaluatedMeasurement) => {
    setFormMode({ kind: "edit", measurement });
    setMeasuredAt(measurement.measuredAt);
    setHeightInput(measurement.height ? String(measurement.height.value) : "");
    setWeightInput(measurement.weight ? String(measurement.weight.value) : "");
    setError(null);
  };

  const submitForm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        measuredAt,
        heightCm: heightInput.trim() === "" ? null : heightInput.trim(),
        weightKg: weightInput.trim() === "" ? null : weightInput.trim(),
      };
      const isEdit = formMode.kind === "edit";
      const url = isEdit
        ? `/api/parent/growth/${encodeURIComponent(childId)}/measurements/${encodeURIComponent(formMode.measurement.id)}`
        : `/api/parent/growth/${encodeURIComponent(childId)}/measurements`;
      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        // 입력값을 유실시키지 않고 오류만 보여준다(§7-6).
        setError(typeof data?.error === "string" ? data.error : "저장하지 못했어요.");
        return;
      }
      onStateChange(data as GrowthStateResponse);
      setFormMode({ kind: "closed" });
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const deleteMeasurement = async (measurementId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/parent/growth/${encodeURIComponent(childId)}/measurements/${encodeURIComponent(measurementId)}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data?.error === "string" ? data.error : "삭제하지 못했어요.");
        return;
      }
      onStateChange(data as GrowthStateResponse);
      setConfirmingDeleteId(null);
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const latestHeight = summary?.latestHeight ?? null;
  const latestWeight = summary?.latestWeight ?? null;
  const latestBmi = summary?.latestBmi ?? null;
  const historyCount = summary?.history.length ?? 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] sm:rounded-3xl sm:pb-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-bold text-[var(--color-k-navy)]">우리 아이 성장정보</h2>
            <p className="mt-1 text-[13px] font-medium text-gray-500">
              {state.childName ?? "아이"}
              {latestHeight ? ` · 측정 당시 ${latestHeight.ageLabel}` : ""}
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

        {!state.gender && (
          <p className="mb-4 rounded-2xl bg-[#FFF7ED] p-3 text-[13px] font-semibold text-[#C2410C]">
            성별 정보가 없어 성장도표 비교를 보여드릴 수 없어요. 아이 설정에서 성별을 등록해 주세요.
          </p>
        )}

        {/* 키 */}
        <section className="mb-4 rounded-2xl border border-[#10315B]/15 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-[#1F2937]">키</h3>
            {latestHeight ? (
              <span className="text-[13px] font-semibold text-gray-500">최근 측정 {latestHeight.measuredAt}</span>
            ) : null}
          </div>
          {latestHeight ? (
            <>
              <p className="mb-2 text-[24px] font-bold text-[var(--color-k-navy)]">
                {formatValue(latestHeight.evaluation.value, "cm")}
              </p>
              <PercentileLine evaluation={latestHeight.evaluation} unit="cm" indicatorLabel="키" />
            </>
          ) : (
            <p className="text-[14px] font-semibold text-gray-500">기록 없음</p>
          )}
        </section>

        {/* 몸무게 */}
        <section className="mb-4 rounded-2xl border border-[#10315B]/15 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-[#1F2937]">몸무게</h3>
            {latestWeight ? (
              <span className="text-[13px] font-semibold text-gray-500">최근 측정 {latestWeight.measuredAt}</span>
            ) : null}
          </div>
          {latestWeight ? (
            <>
              <p className="mb-2 text-[24px] font-bold text-[var(--color-k-navy)]">
                {formatValue(latestWeight.evaluation.value, "kg")}
              </p>
              <PercentileLine evaluation={latestWeight.evaluation} unit="kg" indicatorLabel="몸무게" />
            </>
          ) : (
            <p className="text-[14px] font-semibold text-gray-500">기록 없음</p>
          )}
        </section>

        {/* BMI — 같은 측정일에 키·몸무게가 함께 있을 때만 */}
        <section className="mb-4 rounded-2xl border border-[#10315B]/15 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-[#1F2937]">체질량지수(BMI)</h3>
            {latestBmi ? (
              <span className="text-[13px] font-semibold text-gray-500">{latestBmi.measuredAt} 기준</span>
            ) : null}
          </div>
          {latestBmi ? (
            <>
              <p className="mb-2 text-[24px] font-bold text-[var(--color-k-navy)]">
                {latestBmi.evaluation.value.toFixed(1)}
                <span className="ml-1 text-[14px] font-semibold text-gray-500">kg/㎡</span>
              </p>
              <PercentileLine evaluation={latestBmi.evaluation} unit="" indicatorLabel="체질량지수" />
            </>
          ) : (
            <p className="text-[13.5px] font-semibold text-gray-500">
              같은 날짜에 키와 몸무게가 함께 기록되면 BMI 를 보여드릴 수 있어요.
            </p>
          )}
        </section>

        <p className="mb-4 text-[13px] font-semibold text-gray-600">{GROWTH_TREND_NOTICE}</p>

        {/* 성장 추세 */}
        {state.gender && historyCount > 0 && (
          <section className="mb-4">
            <h3 className="mb-1 text-[15px] font-bold text-[#1F2937]">성장 흐름</h3>
            {historyCount === 1 ? (
              <p className="mb-2 text-[13px] font-medium text-gray-500">{GROWTH_SINGLE_RECORD_NOTICE}</p>
            ) : null}
            {heightPoints.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-[13px] font-bold text-gray-600">키 (cm)</p>
                <GrowthTrendChart indicator="heightForAge" sex={state.gender} points={heightPoints} unit="cm" />
              </div>
            )}
            {weightPoints.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] font-bold text-gray-600">몸무게 (kg)</p>
                <GrowthTrendChart indicator="weightForAge" sex={state.gender} points={weightPoints} unit="kg" />
              </div>
            )}
          </section>
        )}

        {/* 기록 목록 */}
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-[#1F2937]">측정 기록</h3>
            <button
              type="button"
              onClick={openCreate}
              className="h-10 rounded-full bg-[var(--color-k-orange)] px-4 text-[14px] font-bold text-white"
            >
              새 기록 추가
            </button>
          </div>

          {historyCount === 0 ? (
            <p className="text-[13.5px] font-semibold text-gray-500">
              아직 기록이 없어요. 첫 측정값을 입력해 주세요.
            </p>
          ) : (
            <ul className="space-y-2">
              {summary!.history.map((item) => (
                <li key={item.id} className="rounded-2xl bg-[#F7F9FC] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#1F2937]">{item.measuredAt}</p>
                      <p className="text-[12.5px] font-semibold text-gray-600">
                        {item.ageLabel} ·{" "}
                        {item.height ? `키 ${formatValue(item.height.value, "cm")}` : "키 -"} ·{" "}
                        {item.weight ? `몸무게 ${formatValue(item.weight.value, "kg")}` : "몸무게 -"}
                        {item.bmi ? ` · BMI ${item.bmi.value.toFixed(1)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        aria-label={`${item.measuredAt} 기록 수정`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--color-k-navy)]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(item.id)}
                        aria-label={`${item.measuredAt} 기록 삭제`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {confirmingDeleteId === item.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white p-2">
                      <span className="text-[13px] font-semibold text-gray-700">이 기록을 삭제할까요?</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="h-9 rounded-full bg-black/5 px-3 text-[13px] font-bold text-[var(--color-k-navy)]"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMeasurement(item.id)}
                          disabled={busy}
                          className="h-9 rounded-full bg-red-600 px-3 text-[13px] font-bold text-white disabled:opacity-40"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 입력 폼 */}
        {formMode.kind !== "closed" && (
          <section className="mb-4 rounded-2xl border border-[var(--color-k-orange)]/40 bg-[#FFF9F2] p-4">
            <h3 className="mb-3 text-[15px] font-bold text-[var(--color-k-navy)]">
              {formMode.kind === "edit" ? "기록 수정" : "새 기록 추가"}
            </h3>
            <label className="block text-[13px] font-bold text-[#1F2937]" htmlFor="growth-measured-at">
              측정일
            </label>
            <input
              id="growth-measured-at"
              type="date"
              value={measuredAt}
              max={today}
              min={state.profile?.birthDate}
              onChange={(event) => setMeasuredAt(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[#10315B]/20 bg-white px-3 py-2.5 text-[15px] font-semibold text-[#1F2937] outline-none"
            />
            <div className="mt-3 flex gap-2">
              <div className="flex-1">
                <label className="block text-[13px] font-bold text-[#1F2937]" htmlFor="growth-height">
                  키 (cm)
                </label>
                <input
                  id="growth-height"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={heightInput}
                  placeholder="예: 140.5"
                  onChange={(event) => setHeightInput(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#10315B]/20 bg-white px-3 py-2.5 text-[15px] font-semibold text-[#1F2937] outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[13px] font-bold text-[#1F2937]" htmlFor="growth-weight">
                  몸무게 (kg)
                </label>
                <input
                  id="growth-weight"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={weightInput}
                  placeholder="예: 34.2"
                  onChange={(event) => setWeightInput(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#10315B]/20 bg-white px-3 py-2.5 text-[15px] font-semibold text-[#1F2937] outline-none"
                />
              </div>
            </div>
            <p className="mt-2 text-[12px] font-medium text-gray-500">
              키와 몸무게 중 하나만 입력해도 저장돼요. 같은 날짜에 다시 입력하면 그 날짜의 기록이 갱신됩니다.
            </p>
            {error && <p className="mt-2 text-[13px] font-bold text-red-600">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setFormMode({ kind: "closed" })}
                className="h-[48px] flex-1 rounded-xl bg-black/5 text-[14px] font-bold text-[var(--color-k-navy)]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitForm}
                disabled={busy}
                className="h-[48px] flex-[1.4] rounded-xl bg-[var(--color-k-orange)] text-[14px] font-bold text-white disabled:opacity-40"
              >
                {busy ? "저장 중…" : "저장"}
              </button>
            </div>
          </section>
        )}

        {error && formMode.kind === "closed" && (
          <p className="mb-3 text-[13px] font-bold text-red-600">{error}</p>
        )}

        <p className="text-[11.5px] font-medium leading-[1.5] text-gray-400">
          적용 기준: {summary?.standardLabel ?? "2017 소아청소년 성장도표"} ({summary?.standardSource ?? "질병관리청·대한소아청소년과학회"})
          <br />
          성장정보는 공식 성장도표와 비교한 참고 정보이며 의료 진단이 아닙니다.
        </p>
      </div>
    </div>
  );
}
