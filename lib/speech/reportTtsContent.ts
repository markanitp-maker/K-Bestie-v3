import { buildMeaningfulReportSections, meaningfulReportSectionContent } from "@/lib/reports/reportSectionAvailability";

type ReportRecord = Record<string, unknown>;

function appendContent(target: string[], label: string, value: unknown): void {
  const content = meaningfulReportSectionContent(value);
  if (content) target.push(label, content);
}

function meaningfulQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question) => {
    const content = meaningfulReportSectionContent(question);
    return content ? [content] : [];
  });
}

export function buildDailyReportTtsContent(report: ReportRecord, activeTab: number, restricted: boolean): string[] {
  if (restricted && activeTab !== 1) return [];
  const content: string[] = [];
  if (activeTab === 1) {
    appendContent(content, "오늘의 한 줄", report.summary_line);
    appendContent(content, "1분 요약 리포트", report.parent_guide);
  } else if (activeTab === 2) {
    const sections = buildMeaningfulReportSections(report);
    if (sections.length > 0) content.push("상세 리포트");
    sections.forEach((section) => content.push(section.title, section.body));
  } else if (activeTab === 3) {
    appendContent(content, "부모 대화 실마리", report.parent_conversation_clue ?? report.parent_guide);
    const questions = meaningfulQuestions(report.recommended_questions);
    if (questions.length > 0) content.push("부모용 추천 질문", ...questions);
    const interests = meaningfulReportSectionContent(report.interests_preferences);
    if (interests) content.push("오늘의 케이 코멘트", `오늘 아이는 ${interests} 이야기에 가장 밝게 마음을 열고 대답했습니다.`);
  }
  return content;
}

export function buildWeeklyReportTtsContent(report: ReportRecord, activeTab: number, restricted: boolean): string[] {
  if (restricted && activeTab !== 1) return [];
  const content: string[] = [];
  if (activeTab === 1) {
    appendContent(content, "이번 주 요약", report.summary_text);
    const score = typeof report.mood_average === "number" ? report.mood_average : 0;
    if (score > 0) {
      const mood = score <= 2 ? "많이 힘들어 보여요" : score <= 4 ? "조금 힘들었던 것 같아요" : score <= 6 ? "평온한 하루였어요" : score <= 8 ? "즐거운 대화였어요" : "아주 신나는 하루였어요!";
      content.push("주간 감정 상태", mood);
    }
  } else if (activeTab === 2) {
    appendContent(content, "이번 주 상세 분석", report.detail_text);
    buildMeaningfulReportSections(report.detail_dashboard_cards as ReportRecord | null).forEach((section) => content.push(section.title, section.body));
  } else if (activeTab === 3) {
    appendContent(content, "부모 대화 실마리", report.parent_conversation_clue ?? report.parent_guide);
    const questions = meaningfulQuestions(report.recommended_questions);
    if (questions.length > 0) content.push("부모용 추천 질문", ...questions);
    appendContent(content, "주말 활동 추천", report.weekend_activity_recommendation);
  }
  return content;
}

export function buildStandaloneWeeklyReportTtsContent(report: ReportRecord, restricted: boolean): string[] {
  const content: string[] = [];
  appendContent(content, "이번 주 요약", report.summary_text);
  appendContent(content, "주말 활동 추천", report.weekend_activity_recommendation);
  if (restricted) return content;
  appendContent(content, "이번 주 상세 분석", report.detail_text);
  buildMeaningfulReportSections(report.detail_dashboard_cards as ReportRecord | null).forEach((section) => content.push(section.title, section.body));
  appendContent(content, "부모님께 드리는 이번 주 가이드", report.parent_guide);
  return content;
}
