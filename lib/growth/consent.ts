// 성장정보 수집·이용 동의 (요청서 012 §3-10).
//
// 성장 기능 최초 진입에서만 받는 별도 동의다. 기존 법정대리인 동의(guardian consent)와
// 완전히 분리해 저장하며(child_growth_profiles.growth_consent_*), 어느 쪽도 다른 쪽을
// 덮어쓰지 않는다. 동의하지 않아도 기존 서비스는 그대로 쓸 수 있다.

/** 동의 본문이 바뀔 때만 올린다. DB(child_growth_profiles.growth_consent_version)에 그대로 저장된다. */
export const GROWTH_CONSENT_VERSION = "2026-08-18";

export const GROWTH_CONSENT_TITLE = "성장정보 수집·이용 동의";

export const GROWTH_CONSENT_ITEMS = [
  "수집 항목: 아이의 생년월일, 성별, 측정일, 키(cm), 몸무게(kg)",
  "이용 목적: 보호자에게 아이의 성장 기록과 질병관리청 2017 소아청소년 성장도표 기반 비교 정보(백분위·또래 중앙값·BMI)를 제공하기 위함",
  "파생 정보: 입력하신 값으로 계산되는 연령·월령, BMI, 백분위는 따로 저장하지 않고 조회할 때마다 계산합니다.",
  "열람 범위: 성장정보는 보호자만 조회·수정·삭제할 수 있고 아이 화면에는 표시되지 않습니다.",
  "보유·파기: 성장정보는 보호자가 삭제하거나 아이 계정이 삭제될 때 함께 삭제됩니다.",
  "동의하지 않아도 미션·자유대화·리포트 등 기존 서비스는 그대로 이용할 수 있습니다.",
] as const;

export const GROWTH_CONSENT_MEDICAL_NOTICE =
  "성장정보는 공식 성장도표와 비교한 참고 정보이며 의료 진단이나 처방이 아닙니다.";

// ── 대상 연령 (초등학생 전용 서비스) ─────────────────────────────
// 내친구 케이는 초등학생(초1~초6, 한국나이 8~13세) 서비스다.
// 만나이로는 초1 입학 시점 만 6세부터 초6 재학 중 만 13세까지가 정상 범위다.
// 이 범위를 벗어나면 계산을 막지는 않되(공식 기준이 0~227개월을 제공한다) 입력 확인 안내를 띄운다.

/** 초등학생 기대 월령 범위 — 만 6세 0개월 ~ 만 13세 11개월. */
export const ELEMENTARY_AGE_MONTHS = { min: 72, max: 167 } as const;

/** 생년월일 입력 시 "확인해 주세요" 안내를 띄우는 여유 범위(조기입학·유급 등 고려). */
export const ELEMENTARY_AGE_MONTHS_TOLERANT = { min: 60, max: 191 } as const;

export function isElementaryAgeMonths(ageMonths: number): boolean {
  return ageMonths >= ELEMENTARY_AGE_MONTHS.min && ageMonths <= ELEMENTARY_AGE_MONTHS.max;
}

/** 초등학생 서비스 기준에서 확인이 필요한 생년월일인지(경고용, 차단용이 아니다). */
export function needsBirthDateConfirmation(ageMonths: number): boolean {
  return (
    ageMonths < ELEMENTARY_AGE_MONTHS_TOLERANT.min ||
    ageMonths > ELEMENTARY_AGE_MONTHS_TOLERANT.max
  );
}
