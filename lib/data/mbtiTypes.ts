/**
 * 케이 놀이: MBTI — 공용 타입 정의
 *
 * 이 파일은 questionBank.ts / typeProfiles.ts가 공통으로 사용하는
 * 축(Axis)·극(Pole)·유형(MbtiType) 타입과 동점 처리 기본극 상수를 담는다.
 *
 * 통합 지점 안내(오케스트레이터용):
 * 스캐폴딩 단계에서 `lib/play-protocol.ts`가 별도로 생성되면, 그 모듈이
 * 정의하는 공용 놀이 프로토콜 타입(PlaySessionId 등)과 이 파일의 MBTI 전용
 * 타입은 서로 독립적으로 유지하면 된다. 판정 로직(§3.1 구현 시)에서
 * `MbtiType`과 `TIE_BREAK_POLE`을 그대로 가져다 쓰면 된다.
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

/**
 * 축별 동점 처리 기본극(SPEC.md §3.1 "동점 시 기본 극(사전 정의) 채택" 대응).
 *
 * 근거(초안 — 대표 검토 시 변경 가능): 상황형 이지선다 특성상 "바로 뛰어나간다/
 * 미리 정해둔다"처럼 능동적·결정적으로 들리는 선택지(E·S·T·J)가 사회적으로 더
 * 매력적으로 읽혀 과대 선택될 수 있다는 우려가 있어, 균형을 맞추기 위해 반대쪽
 * 극(I·N·F·P)을 기본값으로 채택했다. 두 극 모두 우열이 없다는 서비스 톤과도
 * 부합한다.
 */
export const TIE_BREAK_POLE: {
  EI: EIPole;
  SN: SNPole;
  TF: TFPole;
  JP: JPPole;
} = {
  EI: "I",
  SN: "N",
  TF: "F",
  JP: "P",
};
