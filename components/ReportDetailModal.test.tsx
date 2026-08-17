import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyReportRecommendationGuide, type DailyReport } from "./ReportDetailModal";

test("ReportDetailModal: recurring_stories가 존재해도 '주의 깊게 볼 변화' 문구 및 카드가 렌더되지 않는다", () => {
  const mockReport: DailyReport = {
    id: "rep-001",
    business_date: "2026-08-16",
    summary_line: "오늘 대화 요약",
    mood_score: 8,
    emotion_tags: ["즐거움"],
    parent_guide: "아이의 이야기를 잘 들어주세요.",
    emotion_level: "safe",
    school_academy_life: "학교에서 친구들과 잘 놀았음",
    peer_friendship: "친구와 즐겁게 대화함",
    emotion_hint: "기분 좋은 하루",
    interests_preferences: "로봇 만들기",
    study_concerns: null,
    digital_content_interests: null,
    future_dreams: null,
    teacher_adults: null,
    recurring_stories: "방학이라 학교에 가지 않는다는 점과 미션이 안 끝난다는 이야기를 반복했습니다.",
    parent_conversation_clue: "오늘 만든 로봇에 대해 물어봐 주세요.",
    recommended_questions: ["어떤 로봇을 가장 만들고 싶어?"],
    created_at: new Date().toISOString(),
  };

  const html = renderToStaticMarkup(
    <DailyReportRecommendationGuide report={mockReport} />,
  );

  // 1. 변화 카드 문구 및 키워드가 전혀 나타나지 않아야 함
  assert.doesNotMatch(html, /주의 깊게 볼 변화/);
  assert.doesNotMatch(html, /부모가 주의 깊게 볼 변화/);
  assert.doesNotMatch(html, /방학이라 학교에 가지 않는다는 점과 미션이 안 끝난다는 이야기를 반복했습니다/);

  // 2. 다른 정상 추천 가이드 카드는 정상 렌더되어야 함
  assert.match(html, /부모 대화 실마리/);
  assert.match(html, /오늘 만든 로봇에 대해 물어봐 주세요/);
  assert.match(html, /부모용 추천 질문/);
  assert.match(html, /어떤 로봇을 가장 만들고 싶어\?/);
  assert.match(html, /오늘의 케이 코멘트/);
  assert.match(html, /로봇 만들기 이야기에 가장 밝게 마음을 열고 대답했습니다/);
});

test("ReportDetailModal: recurring_stories만 있고 다른 추천 섹션이 비었을 때 빈 컨테이너 없이 안내 문구를 표시한다", () => {
  const mockReportWithOnlyRecurringStories: DailyReport = {
    id: "rep-002",
    business_date: "2026-08-16",
    summary_line: "요약",
    mood_score: 5,
    emotion_tags: ["보통"],
    parent_guide: "",
    emotion_level: "safe",
    school_academy_life: null,
    peer_friendship: null,
    emotion_hint: null,
    interests_preferences: null,
    study_concerns: null,
    digital_content_interests: null,
    future_dreams: null,
    teacher_adults: null,
    recurring_stories: "게임 이야기를 반복함",
    parent_conversation_clue: null,
    recommended_questions: [],
    created_at: new Date().toISOString(),
  };

  const html = renderToStaticMarkup(
    <DailyReportRecommendationGuide report={mockReportWithOnlyRecurringStories} />,
  );

  // watchOut이 hasAnySection에서 제외되었으므로 빈 컨테이너가 아니라 안내 문구만 렌더
  assert.match(html, /이번 리포트에서 제공할 추천 가이드가 없어요/);
  assert.doesNotMatch(html, /주의 깊게 볼 변화/);
  assert.doesNotMatch(html, /게임 이야기를 반복함/);
  assert.doesNotMatch(html, /부모 대화 실마리/);
  assert.doesNotMatch(html, /부모용 추천 질문/);
  assert.doesNotMatch(html, /오늘의 케이 코멘트/);
});

test("ReportDetailModal: 모든 추천 가이드 섹션이 완전히 비었을 때 빈 컨테이너 없이 안내 문구를 표시한다", () => {
  const completelyEmptyReport: DailyReport = {
    id: "rep-003",
    business_date: "2026-08-16",
    summary_line: "요약",
    mood_score: 5,
    emotion_tags: [],
    parent_guide: "대화 실마리가 준비 중입니다.", // placeholder
    emotion_level: "safe",
    school_academy_life: null,
    peer_friendship: null,
    emotion_hint: null,
    interests_preferences: "대화 정보 부족", // placeholder
    study_concerns: null,
    digital_content_interests: null,
    future_dreams: null,
    teacher_adults: null,
    recurring_stories: null,
    parent_conversation_clue: null,
    recommended_questions: ["생성된 질문 가이드가 아직 없습니다."], // placeholder
    created_at: new Date().toISOString(),
  };

  const html = renderToStaticMarkup(
    <DailyReportRecommendationGuide report={completelyEmptyReport} />,
  );

  assert.match(html, /이번 리포트에서 제공할 추천 가이드가 없어요/);
  assert.doesNotMatch(html, /주의 깊게 볼 변화/);
  assert.doesNotMatch(html, /부모 대화 실마리/);
  assert.doesNotMatch(html, /부모용 추천 질문/);
  assert.doesNotMatch(html, /오늘의 케이 코멘트/);
});
