// requests/065~070 — 학년별 미션 질문지(각 140문항)의 한글 세부 영역명을
// mission_questions.dashboard_area_tag(고정 10개 영문 태그) + question-bank-v2.0.json의
// domain_id/daily_report_field(고정 8개 상태체크 도메인)로 매핑한다.
//
// 근거: question-bank-v2.0.json 기존 state_check 항목들에서 domain_id가
// daily_reports 상세 필드(daily_report_field)와 1:1 대응함을 확인:
//   ①학교·학원 생활→school_academy_life, ②친구관계와 또래생활→peer_friendship,
//   ③감정 힌트→emotion_hint, ④관심사와 개인취향→interests_preferences,
//   ⑤공부 고민→study_concerns, ⑥디지털 관심사와 콘텐츠 취향→digital_content_interests,
//   ⑦미래·진로·꿈→future_dreams, ⑧반복되는 이야기→recurring_stories
//
// 요청서 6개 파일에 등장하는 세부 영역명은 약 20개 이상으로 8개 상태체크 도메인보다
// 세분화돼 있다(예: "학교·수업"/"학원·방과후"는 둘 다 학교·학원 생활). 아래 매핑은
// 키워드 포함 여부로 판정하며, 상태체크 도메인에 깔끔히 대응하지 않는 항목(가족·집,
// 안전망, 믿을 수 있는 어른, 자기효능감 등 정서/자기이해/지지체계 계열)은 가장 가까운
// 기존 카테고리로 근사 배정한다 — dashboard_area_tag는 관리자 리포팅 분류 용도이지
// 출제 로직 자체에는 영향을 주지 않으므로(학년/라운드/승인상태/쿨다운이 핵심 필터),
// 완벽한 분류보다 안전한 근사치를 우선한다.

export interface AreaMapping {
  dashboardAreaTag: string; // mission_questions.dashboard_area_tag
  domainId: string; // question-bank-v2.0.json domain_id (①~⑧ 한글)
  dailyReportField: string; // daily_reports 상세 필드명
}

const DOMAIN_SCHOOL: AreaMapping = { dashboardAreaTag: "school_life", domainId: "①학교·학원 생활", dailyReportField: "school_academy_life" };
const DOMAIN_PEER: AreaMapping = { dashboardAreaTag: "peer_relations", domainId: "②친구관계와 또래생활", dailyReportField: "peer_friendship" };
const DOMAIN_EMOTION: AreaMapping = { dashboardAreaTag: "emotion", domainId: "③감정 힌트", dailyReportField: "emotion_hint" };
const DOMAIN_INTERESTS: AreaMapping = { dashboardAreaTag: "interests", domainId: "④관심사와 개인취향", dailyReportField: "interests_preferences" };
const DOMAIN_STUDY: AreaMapping = { dashboardAreaTag: "study_concerns", domainId: "⑤공부 고민", dailyReportField: "study_concerns" };
const DOMAIN_DIGITAL: AreaMapping = { dashboardAreaTag: "digital_interests", domainId: "⑥디지털 관심사와 콘텐츠 취향", dailyReportField: "digital_content_interests" };
const DOMAIN_FUTURE: AreaMapping = { dashboardAreaTag: "future_dreams", domainId: "⑦미래·진로·꿈", dailyReportField: "future_dreams" };
const DOMAIN_RECURRING: AreaMapping = { dashboardAreaTag: "recurring_stories", domainId: "⑧반복되는 이야기", dailyReportField: "recurring_stories" };
// greeting/daily_general은 dashboard_area_tag CHECK 제약에는 있지만 question-bank-v2.0.json의
// isValidMissionQuestion()이 요구하는 8개 상태체크 domainId 목록에는 없다 — 이 두 태그로 분류된
// 질문(하루 열기/하루 회고 등 오프닝·클로징성 문항)은 domain_id를 붙이지 않고
// purpose를 "state_check"가 아닌 값으로 둬 별도 취급한다(FIXED 오프닝 슬롯 전용, 상태체크 8분류에는
// 안 실림 — daily_once_key로 매 세션 1회만 출제).
const OPENING: AreaMapping = { dashboardAreaTag: "greeting", domainId: "", dailyReportField: "" };
const CLOSING: AreaMapping = { dashboardAreaTag: "daily_general", domainId: "", dailyReportField: "" };

// 키워드(부분 문자열) → 매핑. 배열 순서대로 먼저 매칭되는 것을 사용한다(구체적인 것을 위에).
const KEYWORD_RULES: Array<[string[], AreaMapping]> = [
  [["하루 열기"], OPENING],
  [["하루 회고", "하루 마무리", "긍정 마무리", "내일 기대"], CLOSING],
  [["학교·수업", "학원·방과후", "학교 적응", "수업·활동", "쉬는 시간", "학업·학원", "학업·진학", "학업·진로"], DOMAIN_SCHOOL],
  [["친구·또래", "친구·놀이", "친구 관계"], DOMAIN_PEER],
  [["관계", "공정함", "규칙"], DOMAIN_PEER], // 또래 간 공정함/억울함/규칙 이슈 — 관계 범주로
  [["감정", "몸·컨디션", "Rose-Thorn-Bud", "속상했던 일", "좋았던 일", "힘들거나", "힘들었던 일", "감정 그림"], DOMAIN_EMOTION],
  [["안전망", "믿을 수 있는 어른", "선생님·믿을 수 있는 어른"], DOMAIN_EMOTION], // 정서적 지지체계 — 가장 가까운 근사치
  [["자기효능감", "자기이해", "성취", "자립"], DOMAIN_EMOTION], // 자기개념/자존감 계열 — 정서 근사
  [["디지털·콘텐츠", "디지털·SNS"], DOMAIN_DIGITAL],
  [["관심사·진로"], DOMAIN_FUTURE],
  [["개인취향", "취향·놀이", "좋아하는 것", "관심사"], DOMAIN_INTERESTS],
  [["가족·집"], DOMAIN_RECURRING], // daily_reports에 별도 가족 카테고리가 없어 반복되는 이야기로 근사
];

export function mapQuestionArea(koreanArea: string): AreaMapping {
  const normalized = koreanArea.trim();
  for (const [keywords, mapping] of KEYWORD_RULES) {
    if (keywords.some((kw) => normalized.includes(kw))) return mapping;
  }
  // 매칭 실패 시 안전한 기본값(개인취향) — 호출부에서 unmapped 목록을 별도로 기록해
  // 리뷰 시 확인할 수 있게 한다.
  return DOMAIN_INTERESTS;
}

export const FREQUENCY_TO_CYCLE_TYPE: Record<string, string> = {
  DAILY: "always",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
};

export const MISSION_SLOT_TO_ROUND_TYPE: Record<string, string> = {
  // Historical v2 question-slot metadata. daily_single Goal Engine은 이 매핑을 사용하지 않는다.
  MISSION_I: "round1_day",
  MISSION_II: "round2_night",
};
