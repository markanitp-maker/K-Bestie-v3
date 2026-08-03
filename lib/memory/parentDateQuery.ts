// P0 긴급수정(안서현 부모-케이 장애) — 부모가 "오늘/어제/그제/이번 주/특정 날짜"처럼
// 시간 범위가 있는 질문을 하면, 의미 기반 Vector Retrieval만으로는 "그 날짜에 있었던 일"을
// 안정적으로 찾지 못한다(유사도 검색은 날짜를 모른다). KST business_date로 명시적으로
// 해석해 daily_reports/corrected_daily_conversations_v3 기반 조회를 우선시킨다.

import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export function nowKSTDateStr(): string {
  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  return nowKST.toISOString().slice(0, 10);
}

export interface DateQueryMatch {
  businessDates: string[]; // 최신 날짜가 마지막
  label: string;
}

/** 질문에서 날짜 범위 의도를 감지한다. 감지 실패 시 null(호출부는 이때 날짜 무관
 *  Vector Retrieval만 사용). */
export function detectDateRangeQuery(question: string, todayStr: string = nowKSTDateStr()): DateQueryMatch | null {
  const q = question.trim();

  // 명시적 날짜가 있으면 "오늘/어제" 같은 상대 표현보다 우선한다(예: "어제 8월 2일에" 같은
  // 혼합 표현에서 명시적 날짜가 더 신뢰도 높음).
  const isoMatch = q.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return { businessDates: [dateStr], label: dateStr };
  }
  const koreanMatch = q.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanMatch) {
    const [, m, d] = koreanMatch;
    const year = todayStr.slice(0, 4);
    const dateStr = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return { businessDates: [dateStr], label: `${m}월 ${d}일` };
  }

  if (/그제|그끄제|그저께/.test(q)) {
    return { businessDates: [getOffsetDateStr(todayStr, -2)], label: "그제" };
  }
  if (/어제/.test(q)) {
    return { businessDates: [getOffsetDateStr(todayStr, -1)], label: "어제" };
  }
  if (/이번\s*주/.test(q)) {
    const day = new Date(todayStr + "T00:00:00Z").getUTCDay(); // 0=일 .. 6=토
    const mondayOffset = day === 0 ? -6 : -(day - 1);
    const dates: string[] = [];
    for (let off = mondayOffset; off <= 0; off++) dates.push(getOffsetDateStr(todayStr, off));
    return { businessDates: dates, label: "이번 주" };
  }
  if (/오늘/.test(q)) {
    return { businessDates: [todayStr], label: "오늘" };
  }

  return null;
}

/** daily_reports 행 → 부모에게 이미 노출 가능한 텍스트 필드만 모아 안전한 요약을 만든다.
 *  원문(대화)은 전혀 포함하지 않는다. */
export function buildDailyReportSummaryText(report: Record<string, unknown>): string {
  const fields: Array<[string, unknown]> = [
    ["학교·학원 생활", report.school_academy_life],
    ["친구 관계", report.peer_friendship],
    ["감정 상태", report.emotion_hint],
    ["관심사·취향", report.interests_preferences],
    ["학업 관련", report.study_concerns],
    ["디지털 콘텐츠 관심", report.digital_content_interests],
    ["꿈·미래 이야기", report.future_dreams],
    ["반복되는 이야기", report.recurring_stories],
  ];
  return fields
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([label, v]) => `- ${label}: ${v}`)
    .join("\n");
}

/** corrected_daily_conversation_messages_v3 행(들)에서 대화 내용을 추출한다 —
 *  daily_report가 아직 없는 날짜의 fallback 소스. 이 함수의 반환값은 LLM 프롬프트
 *  내부 컨텍스트로만 쓰고 절대 API 응답으로 그대로 반환하지 않는다(부모 원문 열람
 *  불가 규칙). 주의: corrected_daily_conversations_v3.mission_1/free_chat_1/... 는
 *  구(舊) 스키마 컬럼으로 현재 파이프라인(complete_context_correction_job_v3)이 더
 *  이상 쓰지 않는다 — 실제 데이터는 정규화된 corrected_daily_conversation_messages_v3
 *  테이블에 있다(generateMemoryFacts가 조회하는 것과 동일 테이블, display_sequence로
 *  정렬). */
export function buildCorrectedConversationInternalText(
  messages: Array<{ role: unknown; content: unknown }>
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content !== "string" || !m.content.trim()) continue;
    const speaker = m.role === "child" ? "아이" : "케이";
    lines.push(`[${speaker}] ${m.content}`);
  }
  return lines.join("\n");
}
