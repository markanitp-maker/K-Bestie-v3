/**
 * 게임 참여: MBTI — 공용 타입 정의
 *
 * 이 파일은 questionBank.ts / typeProfiles.ts가 공통으로 사용하는
 * 축(Axis)·극(Pole)·유형(MbtiType) 타입을 담는다.
 *
 * 200문항뱅크 전환(2026-07-25, 축당 5문항 다수결)으로 동점이 구조적으로 불가능해져
 * (5표는 절대 2.5:2.5로 나뉠 수 없음) 기존 TIE_BREAK_POLE 기본극 상수는 제거했다.
 */

/** 4개 진단 축. SPEC.md §3.1 기준 표기 순서(E/I · N/S · F/T · P/J)를 따른다. */
export type Axis = "EI" | "SN" | "TF" | "JP";

/** 각 축의 두 극. */
export type EIPole = "E" | "I";
export type SNPole = "S" | "N";
export type TFPole = "T" | "F";
export type JPPole = "J" | "P";
export type Pole = EIPole | SNPole | TFPole | JPPole;

/** 축 → 그 축에 속한 두 극 집합. */
export const AXIS_POLES: Record<Axis, readonly [Pole, Pole]> = {
  EI: ["E", "I"],
  SN: ["S", "N"],
  TF: ["T", "F"],
  JP: ["J", "P"],
};

/**
 * 16유형 코드. MBTI 표준 표기 순서(EI → SN → TF → JP)로 4글자를 조합한다.
 * 예: "ENFP" = E + N + F + P.
 */
export type MbtiType = `${EIPole}${SNPole}${TFPole}${JPPole}`;

/** 16유형 전체 목록(표기 순서 고정, 판정 로직 검증용으로도 재사용 가능). */
export const ALL_MBTI_TYPES: readonly MbtiType[] = [
  "ISTJ",
  "ISFJ",
  "ISTP",
  "ISFP",
  "INFJ",
  "INTJ",
  "INFP",
  "INTP",
  "ENFP",
  "ENFJ",
  "ENTP",
  "ENTJ",
  "ESFP",
  "ESFJ",
  "ESTP",
  "ESTJ",
];
