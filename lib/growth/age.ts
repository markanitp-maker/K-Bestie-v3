// 측정 당시 연령/월령 계산 (요청서 012 §3-5).
//
// 계산 규칙은 질병관리청 공식 성장상태 측정계산기의 동작을 2026-08-18 실측해 확정했다.
// 공식 계산기(/knhanes/grtcht/findMeasClcltData.json)가 돌려주는 diffMth 와 완전히 같다.
//
//   생년월일 2016-08-18, 측정일 2026-08-17 → 119개월  (측정일 일자 < 생일 일자)
//   생년월일 2016-08-18, 측정일 2026-08-18 → 120개월
//   생년월일 2016-08-31, 측정일 2026-09-01 → 120개월
//   생년월일 2016-09-01, 측정일 2026-08-31 → 119개월
//   생년월일 2016-02-29, 측정일 2026-02-28 → 119개월  (윤년 생일을 2/28로 당겨주지 않는다)
//
// 즉 "완전히 경과한 개월 수"이며, 30일·30.4일 같은 근사 나눗셈을 쓰지 않는다.
// (성장도표 산출용 SAS 프로그램은 원시자료 집계 시 int(일수/30.4) 를 쓰지만, 이는 도표를
//  만들 때 표본을 묶는 규칙이고 개인 측정값 판정에 쓰는 규칙은 위의 완전월령이다.)

/** yyyy-MM-dd 문자열을 연·월·일로 분해한다. 형식이 어긋나면 null. */
export function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 2월 30일처럼 존재하지 않는 날짜를 걸러낸다.
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * 측정 당시 만나이(개월). 측정일이 생년월일보다 이르면 null 을 반환한다.
 * 두 인자는 모두 yyyy-MM-dd (KST 기준 달력 날짜)다.
 */
export function calculateAgeInMonths(birthDate: string, measuredAt: string): number | null {
  const birth = parseDateOnly(birthDate);
  const measured = parseDateOnly(measuredAt);
  if (!birth || !measured) return null;

  let months = (measured.year - birth.year) * 12 + (measured.month - birth.month);
  if (measured.day < birth.day) months -= 1;
  return months < 0 ? null : months;
}

/** 부모에게 보여줄 "만 N세 N개월" 표기. */
export function formatKoreanAge(ageMonths: number): string {
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months === 0 ? `만 ${years}세` : `만 ${years}세 ${months}개월`;
}

/** KST 기준 오늘(yyyy-MM-dd). 측정일 기본값에 쓴다. */
export function todayInKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 미래 날짜인지 판정한다(생년월일·측정일 검증용). */
export function isFutureDate(value: string, now: Date = new Date()): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) return false;
  return value > todayInKst(now);
}
