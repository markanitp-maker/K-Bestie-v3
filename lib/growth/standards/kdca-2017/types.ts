// 성장도표 기준 데이터의 형태. 기준 개정(예: 2027 성장도표)에도 이 형태를 재사용해
// 계산 로직과 데이터를 분리한다(요청서 012 §3-6 "2017 데이터와 계산 로직을 강결합하지 않는다").

/** [L, M, S] — 공식 성장도표가 제공하는 LMS 계수. */
export type LmsTriple = [number, number, number];

/** 만나이(개월) → LMS. 공식 데이터가 제공하지 않는 월령은 키 자체가 없다. */
export type LmsByAgeMonths = Record<number, LmsTriple>;

export interface LmsBySex {
  male: LmsByAgeMonths;
  female: LmsByAgeMonths;
}

/** 공식 성장도표가 제공하는 지표. v1 은 부모 화면에 필요한 3종만 담는다. */
export interface LmsTableSet {
  heightForAge: LmsBySex;
  weightForAge: LmsBySex;
  bmiForAge: LmsBySex;
}

export type GrowthIndicator = keyof LmsTableSet;
export type GrowthSex = keyof LmsBySex;
