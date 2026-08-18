// 생년월일 입력 보조 — 화면(BirthDateField)이 쓰는 순수 규칙.
//
// 2026-08-19 대표님 실기기(a05.png): iOS 날짜 피커가 년·월 휠로 열려 일자가 묻혔다.
// OS 피커를 버리고 년·월·일 선택 + 직접 타이핑을 쓰기로 했고, 그 판정 규칙을 여기 모아 테스트한다.

import { parseDateOnly } from "./age";

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 해당 연·월의 마지막 날(윤년 포함). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 고른 년·월·일을 yyyy-MM-dd 로 만든다.
 * 2월 31일처럼 없는 날짜는 그 달의 마지막 날로 당긴다(선택을 되돌리지 않는다).
 */
export function composeBirthDate(
  year: number | null,
  month: number | null,
  day: number | null
): string {
  if (year === null || month === null || day === null) return "";
  if (month < 1 || month > 12 || day < 1) return "";
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(clampedDay)}`;
}

export type ManualBirthDateResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "format" | "future" };

/**
 * 직접 입력한 문자열을 해석한다.
 * "2016-02-15", "2016.2.15", "2016 2 15", "20160215" 을 모두 같은 날짜로 읽는다.
 */
export function parseManualBirthDate(raw: string, today: string): ManualBirthDateResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  let normalized: string | null = null;
  const hyphenMatch = /^(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})$/.exec(trimmed);
  if (hyphenMatch) {
    normalized = `${hyphenMatch[1]}-${pad2(Number(hyphenMatch[2]))}-${pad2(Number(hyphenMatch[3]))}`;
  } else {
    const digits = trimmed.replace(/[^0-9]/g, "");
    if (digits.length === 8 && digits === trimmed.replace(/[^0-9]/g, "")) {
      normalized = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
  }

  if (!normalized || !parseDateOnly(normalized)) return { ok: false, reason: "format" };
  if (normalized > today) return { ok: false, reason: "future" };
  return { ok: true, value: normalized };
}
