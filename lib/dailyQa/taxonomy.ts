// 요청서 019 §3-5 — 일일 대화 QA 이슈 taxonomy.
//
// 이 목록이 단일 출처다. DB 는 taxonomy_code 를 text 로 받으므로(운영 중 새 코드를
// 추가할 때 마이그레이션을 강제하지 않기 위해) 코드 쪽에서 유효성을 지킨다.
//
// severity 기본값은 "아이가 실제로 겪는 피해" 기준이다:
//   BLOCKER — 대화가 성립하지 않는다. 아이가 답을 못 받거나 안전 신호를 놓쳤다.
//   HIGH    — 대화가 이어지긴 하지만 아이가 무시당했다고 느낀다.
//   MEDIUM  — 품질 저하. 반복·단조로움.
//   LOW     — 개선 여지. 즉시 손해는 아니다.

export type DailyQaSeverity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";

/** 탐지 방식. 규칙만으로 확정할 수 있는 것과 문맥 판단이 필요한 것을 구분한다(§3-6, §3-7). */
export type DailyQaDetectionMode = "RULE" | "HYBRID";

export interface DailyQaTaxonomyEntry {
  code: string;
  /** 관리자 화면에 그대로 보이는 이름. 대표님이 읽는 문장이라 기술 용어를 쓰지 않는다. */
  label: string;
  /** 무엇이 잘못된 것인지 한 줄. */
  description: string;
  defaultSeverity: DailyQaSeverity;
  detection: DailyQaDetectionMode;
}

export const DAILY_QA_TAXONOMY: readonly DailyQaTaxonomyEntry[] = [
  {
    code: "LLM_FALLBACK",
    label: "케이가 답을 못 만들어 고정 문구가 나갔다",
    description: '응답 생성이 실패해 "응, 듣고 있어. 더 얘기해줄래?" 같은 폴백이 아이에게 나갔다.',
    defaultSeverity: "BLOCKER",
    detection: "RULE",
  },
  {
    code: "PARDON_REPEAT",
    label: '"다시 말해줄래?"가 반복됐다',
    description: "못 알아들었다는 말이 연속으로 나가 아이가 같은 말을 여러 번 반복했다.",
    defaultSeverity: "HIGH",
    detection: "RULE",
  },
  {
    code: "STT_TRANSCRIPT_ANOMALY",
    label: "아이 말이 잘리거나 깨져서 들어왔다",
    description: "자모만 남거나 문장이 중간에 끊긴 전사가 저장됐다.",
    defaultSeverity: "HIGH",
    detection: "RULE",
  },
  {
    code: "REACTION_REPETITION",
    label: "케이가 같은 공감 문구를 반복했다",
    description: '"그랬구나", "좋았겠다" 같은 반응이 연속으로 나왔다.',
    defaultSeverity: "MEDIUM",
    detection: "RULE",
  },
  {
    code: "MISSION_ABRUPT_END",
    label: "미션이 갑자기 끊겼다",
    description: "미션이 마무리 발화 없이 끝나거나 진행 중 세션이 죽었다.",
    defaultSeverity: "HIGH",
    detection: "RULE",
  },
  {
    code: "SAFETY_FALSE_POSITIVE",
    label: "안전 검사가 정상 대화를 막았다",
    description: "놀이·말놀이 낱말이 안전 키워드에 부분 일치해 대화가 끊겼다.",
    defaultSeverity: "MEDIUM",
    detection: "RULE",
  },
  {
    code: "BOREDOM_REFUSAL_IGNORED",
    label: "아이가 그만하고 싶다는데 계속 물었다",
    description: '"귀찮아", "그만할래" 같은 거부 신호 뒤에도 같은 질문이 이어졌다.',
    defaultSeverity: "HIGH",
    detection: "HYBRID",
  },
  {
    code: "MEMORY_REPEAT",
    label: "기억이 안 난다는 말이 반복됐다",
    description: "같은 기억 폴백 문구가 연속으로 나가 대화가 벽에 부딪혔다.",
    defaultSeverity: "MEDIUM",
    detection: "HYBRID",
  },
  {
    code: "REPEATED_QUESTION",
    label: "이미 답한 것을 다시 물었다",
    description: "아이가 방금 말한 내용을 케이가 또 질문했다.",
    defaultSeverity: "HIGH",
    detection: "HYBRID",
  },
  {
    code: "MISSION_FORCED_QUESTION",
    label: "아이 이야기를 무시하고 질문지로 돌아갔다",
    description: "아이가 꺼낸 화제를 받지 않고 고정 질문을 그대로 냈다.",
    defaultSeverity: "HIGH",
    detection: "HYBRID",
  },
  {
    code: "SAFETY_POTENTIAL_MISS",
    label: "안전 신호를 놓쳤을 수 있다",
    description: "위험 신호로 볼 수 있는 발화에 안전 처리가 걸리지 않았다.",
    defaultSeverity: "BLOCKER",
    detection: "HYBRID",
  },
  {
    code: "RELATIONSHIP_RESPONSE_MISS",
    label: "아이가 마음을 표현했는데 그냥 지나갔다",
    description: '"케이 좋아해" 같은 말을 받아주지 않고 다음 질문으로 넘어갔다.',
    defaultSeverity: "MEDIUM",
    detection: "HYBRID",
  },
] as const;

export type DailyQaTaxonomyCode = (typeof DAILY_QA_TAXONOMY)[number]["code"];

const BY_CODE = new Map(DAILY_QA_TAXONOMY.map((entry) => [entry.code, entry]));

export function findDailyQaTaxonomy(code: string): DailyQaTaxonomyEntry | undefined {
  return BY_CODE.get(code);
}

export function isDailyQaTaxonomyCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** 규칙만으로 확정하는 taxonomy(§3-6). */
export const RULE_BASED_TAXONOMY_CODES: readonly string[] = DAILY_QA_TAXONOMY
  .filter((entry) => entry.detection === "RULE")
  .map((entry) => entry.code);

/** 1차로 후보를 좁힌 뒤 LLM Judge 를 태우는 taxonomy(§3-7). */
export const HYBRID_TAXONOMY_CODES: readonly string[] = DAILY_QA_TAXONOMY
  .filter((entry) => entry.detection === "HYBRID")
  .map((entry) => entry.code);

export const DAILY_QA_SEVERITY_ORDER: Record<DailyQaSeverity, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** LLM Judge 판정(§3-8). LIKELY 까지 이슈로 올리고 FALSE_POSITIVE 는 버린다. */
export type DailyQaJudgeVerdict = "CONFIRMED" | "LIKELY" | "FALSE_POSITIVE";

export type DailyQaTrendStatus =
  | "NEW"
  | "RECURRED"
  | "ONGOING"
  | "IMPROVED"
  | "RESOLVED_CANDIDATE";

/** 대표 사례 excerpt 상한(§3-13). 원문을 복제하지 않는다는 원칙의 실무적 상한이다. */
export const DAILY_QA_EXCERPT_MAX_CHARS = 200;
/** 이슈당 저장하는 대표 사례 최대 개수(§3-13). */
export const DAILY_QA_MAX_EXAMPLES = 3;
