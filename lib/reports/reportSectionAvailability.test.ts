import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeaningfulReportSections,
  isMeaningfulReportSection,
  meaningfulReportSectionContent,
  sanitizeReportSectionRecord,
} from "./reportSectionAvailability";

test("null, blank and normalized placeholder variants are unavailable", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   \n  ",
    "이 항목은 확인할 대화가 충분하지 않아요.",
    "  확인할  대화가\n충분하지 않아요  ",
    "대화 정보 부족",
    "데이터 부족.",
    "정보 없음",
    "확인된 내용이 없어요",
    "분석을 준비 중이에요",
    "새로운 이야기가 있어요!",
    "오늘은 관련 기록이 없어요.",
  ]) {
    assert.equal(isMeaningfulReportSection(value), false, String(value));
    assert.equal(meaningfulReportSectionContent(value), null, String(value));
  }
});

test("actual analysis saying there is no problem remains meaningful", () => {
  for (const value of [
    "공부나 숙제에서 특별히 어려운 점은 없다고 답했습니다.",
    "학교생활에서 힘든 부분은 없다고 이야기했습니다.",
    "친구 관계에서 특별한 갈등은 없다고 말했습니다.",
    "데이터가 부족한 문제를 스스로 해결했다고 말했습니다.",
  ]) {
    assert.equal(isMeaningfulReportSection(value), true, value);
  }
});

test("section builder preserves canonical order and supports legacy weekly keys", () => {
  const sections = buildMeaningfulReportSections({
    recurring_stories: "주말마다 보드게임 이야기",
    school_life: "학교생활은 편안했다고 말함",
    peer_friendship: "이 항목은 확인할 대화가 충분하지 않아요.",
    interests: "우주 그림을 좋아함",
  });

  assert.deepEqual(
    sections.map(({ key, body }) => [key, body]),
    [
      ["school_academy_life", "학교생활은 편안했다고 말함"],
      ["interests_preferences", "우주 그림을 좋아함"],
      ["recurring_stories", "주말마다 보드게임 이야기"],
    ],
  );
});

test("record sanitizer removes only unavailable content", () => {
  assert.deepEqual(
    sanitizeReportSectionRecord({
      future_dreams: "분석을 준비 중이에요",
      teacher_adults: "담임 선생님께 칭찬받음",
      recurring_stories: " ",
    }),
    { teacher_adults: "담임 선생님께 칭찬받음" },
  );
});
