"use client";

// 생년월일 입력 — 년·월·일을 한 화면에서 모두 고르고, 아래에서 직접 타이핑도 할 수 있다.
//
// 2026-08-19 대표님 실기기(a05.png): iOS 의 `input[type=date]` 가 년·월 휠 상태로 열려
// 일자 선택이 묻혔다. OS 피커 동작에 기대지 않도록 3단 선택으로 바꾼다 —
// 어느 기기에서든 년·월·일이 한 번에 보이고, 자판으로 쓰는 게 편한 사람은 아래 칸에 바로 친다.

import { useEffect, useMemo, useState } from "react";

import { parseDateOnly, todayInKst } from "@/lib/growth";
import { composeBirthDate, daysInMonth, parseManualBirthDate } from "@/lib/growth/birthDateInput";

interface Props {
  /** yyyy-MM-dd. 비어 있으면 미선택. */
  value: string;
  onChange: (next: string) => void;
  /** 선택 가능한 가장 과거 연도. 기본 20년 전. */
  minYear?: number;
  idPrefix?: string;
}

export function BirthDateField({ value, onChange, minYear, idPrefix = "birth-date" }: Props) {
  const today = todayInKst();
  const todayParts = parseDateOnly(today)!;
  const parsed = value ? parseDateOnly(value) : null;

  const [manualInput, setManualInput] = useState(value);
  const [manualError, setManualError] = useState<string | null>(null);

  // 위(선택)에서 바꾸면 아래(직접 입력) 칸도 따라간다.
  useEffect(() => {
    setManualInput(value);
    if (value) setManualError(null);
  }, [value]);

  const years = useMemo(() => {
    const oldest = minYear ?? todayParts.year - 20;
    const list: number[] = [];
    for (let year = todayParts.year; year >= oldest; year -= 1) list.push(year);
    return list;
  }, [minYear, todayParts.year]);

  const selectedYear = parsed?.year ?? null;
  const selectedMonth = parsed?.month ?? null;
  const selectedDay = parsed?.day ?? null;

  const dayCount =
    selectedYear !== null && selectedMonth !== null ? daysInMonth(selectedYear, selectedMonth) : 31;

  const emit = (year: number | null, month: number | null, day: number | null) => {
    onChange(composeBirthDate(year, month, day));
  };

  const handleManualChange = (raw: string) => {
    setManualInput(raw);
    const result = parseManualBirthDate(raw, today);
    if (result.ok) {
      setManualError(null);
      onChange(result.value);
      return;
    }
    if (result.reason === "empty") {
      setManualError(null);
      onChange("");
      return;
    }
    setManualError(
      result.reason === "future"
        ? "생년월일은 오늘 이후일 수 없어요."
        : "2016-02-15 처럼 8자리로 입력해 주세요."
    );
  };

  const selectClassName =
    "w-full appearance-none rounded-2xl border border-[#10315B]/20 bg-white px-3 py-3 text-[16px] font-semibold text-[#1F2937] outline-none focus:border-[var(--color-k-orange)]";

  return (
    <div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <select
          id={`${idPrefix}-year`}
          aria-label="태어난 연도"
          value={selectedYear ?? ""}
          onChange={(event) =>
            emit(event.target.value ? Number(event.target.value) : null, selectedMonth ?? 1, selectedDay ?? 1)
          }
          className={selectClassName}
        >
          <option value="">연도</option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}년
            </option>
          ))}
        </select>

        <select
          id={`${idPrefix}-month`}
          aria-label="태어난 월"
          value={selectedMonth ?? ""}
          onChange={(event) =>
            emit(selectedYear, event.target.value ? Number(event.target.value) : null, selectedDay ?? 1)
          }
          className={selectClassName}
        >
          <option value="">월</option>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
            <option key={month} value={month}>
              {month}월
            </option>
          ))}
        </select>

        <select
          id={`${idPrefix}-day`}
          aria-label="태어난 일"
          value={selectedDay ?? ""}
          onChange={(event) =>
            emit(selectedYear, selectedMonth, event.target.value ? Number(event.target.value) : null)
          }
          className={selectClassName}
        >
          <option value="">일</option>
          {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
            <option key={day} value={day}>
              {day}일
            </option>
          ))}
        </select>
      </div>

      <label
        className="mt-3 block text-[13px] font-bold text-[#1F2937]"
        htmlFor={`${idPrefix}-manual`}
      >
        직접 입력
      </label>
      <input
        id={`${idPrefix}-manual`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="예: 2016-02-15"
        value={manualInput}
        onChange={(event) => handleManualChange(event.target.value)}
        className="mt-1.5 w-full rounded-2xl border border-[#10315B]/20 bg-white px-4 py-3 text-[16px] font-semibold text-[#1F2937] outline-none focus:border-[var(--color-k-orange)]"
      />
      {manualError ? (
        <p className="mt-1.5 text-[13px] font-semibold text-[#C2410C]">{manualError}</p>
      ) : (
        <p className="mt-1.5 text-[12px] font-medium text-gray-500">
          위에서 골라도 되고, 여기에 바로 써도 돼요.
        </p>
      )}
    </div>
  );
}
