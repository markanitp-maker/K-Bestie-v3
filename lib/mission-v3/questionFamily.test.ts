import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QUESTION_FAMILIES,
  classifyQuestionFamily,
  type QuestionFamily,
} from "@/lib/mission-v3/questionFamily";

describe("questionFamily classifier (078 Phase A)", () => {
  it("요청서 §2.1의 두 예문을 동일한 family(SCHOOL_HIGHLIGHT)로 분류한다", () => {
    const q1 = "학교에서 제일 기억나는 일 뭐야?";
    const q2 = "오늘 학교에서 가장 기억에 남는 순간 뭐였어?";

    const fam1 = classifyQuestionFamily({ questionText: q1 });
    const fam2 = classifyQuestionFamily({ questionText: q2 });

    assert.equal(fam1, "SCHOOL_HIGHLIGHT");
    assert.equal(fam2, "SCHOOL_HIGHLIGHT");
    assert.equal(fam1, fam2);
  });

  it("22개 family 각각에 대해 대표 질문 1개 이상을 올바로 분류한다", () => {
    const representativeCases: Record<QuestionFamily, { text: string; sg?: string; topic?: string }> = {
      SCHOOL_HIGHLIGHT: {
        text: "오늘 학교에서 제일 기억에 남는 순간이 뭐였어?",
        sg: "SCHOOL_EXPERIENCE",
      },
      SCHOOL_CLASS: {
        text: "오늘 학교에서 제일 재밌었던 수업 뭐였어?",
        sg: "SCHOOL_EXPERIENCE",
      },
      FRIEND_PLAY: {
        text: "오늘 친구랑 뭐 하고 놀았어?",
        sg: "PEER_CONNECTION",
      },
      FRIEND_FUNNY: {
        text: "오늘 친구가 웃기게 한 일 있었어?",
        sg: "PEER_CONNECTION",
      },
      FRIEND_CONFLICT: {
        text: "친구랑 살짝 삐친 일은 없었어?",
        sg: "FRIEND_CONFLICT",
      },
      GAME_TODAY: {
        text: "주말에 게임할 거야? 무슨 게임 하고 싶어?",
        sg: "DIGITAL_CONTENT",
      },
      VIDEO_TODAY: {
        text: "좋아하는 유튜브나 영상 있어?",
        sg: "DIGITAL_CONTENT",
      },
      ACADEMY_TODAY: {
        text: "오늘 학원 갔어? 무슨 학원이었어?",
        sg: "LEARNING_AND_STUDY",
      },
      ACADEMY_LEARNING: {
        text: "학원에서 오늘 뭐 배웠어?",
        sg: "LEARNING_AND_STUDY",
      },
      FOOD_TODAY: {
        text: "오늘 급식이나 간식 중 맛있었던 거 있었어?",
        sg: "MEAL_AND_TASTE",
      },
      OUTING_TODAY: {
        text: "오늘 밖에 어디 다녀왔어?",
        sg: "DAILY_LIFE",
      },
      WEEKEND_EXPECTATION: {
        text: "내일 토요일이라 기분 좋아?",
        sg: "EMOTIONAL_EXPERIENCE",
      },
      WEEKEND_HIGHLIGHT: {
        text: "이번 주말에 제일 재밌었던 게 뭐야?",
        sg: "DAILY_HIGHLIGHT",
      },
      MOOD_TODAY: {
        text: "월요일이라 좀 졸렸어, 괜찮았어?",
        sg: "MOOD_CHECK",
      },
      ACHIEVEMENT_TODAY: {
        text: "오늘 “나 이거 잘했다” 한 거 있어?",
        sg: "ACHIEVEMENT",
      },
      RAPPORT_INTEREST: {
        text: "요즘 제일 좋아하는 놀이가 뭐야?",
        sg: "INTEREST_AND_PREFERENCE",
      },
      RAPPORT_PREFERENCE: {
        text: "케이는 너랑 친해지고 싶은데, 뭐라고 불러주면 좋아?",
        sg: "RAPPORT_IDENTITY",
      },
      RAPPORT_COMMUNICATION_STYLE: {
        text: "케이랑 무슨 이야기하면 제일 재밌을 것 같아?",
        sg: "RAPPORT_IDENTITY",
      },
      // 078 Phase A-2 신규 4개 family 대표 케이스
      FAMILY_TODAY: {
        text: "오늘 가족과 함께해서 좋았던 일이 있었어?",
        sg: "FAMILY_RELATIONSHIP",
      },
      DAILY_HIGHLIGHT: {
        text: "오늘 하루 중 가장 기억에 남는 순간은?",
        sg: "DAILY_HIGHLIGHT",
      },
      FUTURE_EXPECTATION: {
        text: "다음 주에 꼭 해보고 싶은 게 있어?",
        sg: "FUTURE_HOPE",
      },
      ADULT_SUPPORT: {
        text: "도움이 필요할 때 편하게 말할 수 있는 어른이 있어?",
        sg: "SUPPORT_NETWORK",
      },
    };

    // 22개 family 전체가 목록에 포함되어 있는지 검증
    assert.equal(QUESTION_FAMILIES.length, 22);

    for (const fam of QUESTION_FAMILIES) {
      const fixture = representativeCases[fam];
      assert.ok(fixture, `Fixture for ${fam} must exist`);
      const result = classifyQuestionFamily({
        questionText: fixture.text,
        semanticGroup: fixture.sg,
        topic: fixture.topic,
      });
      assert.equal(result, fam, `Expected ${fam} for text: "${fixture.text}"`);
    }
  });

  it("분류 불가 또는 20건 미만 범위 외 질문에 대해 null을 반환한다", () => {
    const unclassifiable = [
      { text: "만약 투명인간이 된다면 뭘 제일 먼저 해보고 싶어?", sg: "PLAYFUL_IMAGINATION" },
      { text: "오늘 온라인에서 신경 쓰였던 일이 있었어? 말하기 싫으면 넘어가도 돼.", sg: "DIGITAL_WELLBEING" },
      { text: "오늘 차례나 규칙 때문에 기억나는 일이 있었어?", sg: "PEER_CONNECTION" },
      { text: "오늘 공평하게 나눴다고 느낀 일이 있었어?", sg: "PEER_CONNECTION" },
      { text: "이번 달에 고마웠던 사람이 있어? 어떤 일이 있었어?", sg: "PEER_CONNECTION" },
      { text: "그때 어떤 일이 있었는지 말해줄래?", sg: "EMOTIONAL_EXPERIENCE" },
      { text: "오늘 무서웠던 게 있었어? 없으면 넘어가도 돼.", sg: "SAFETY_EXPERIENCE" },
      { text: "" },
      { text: "   " },
    ];

    for (const item of unclassifiable) {
      const res = classifyQuestionFamily({
        questionText: item.text,
        semanticGroup: item.sg,
      });
      assert.equal(res, null, `Expected null for: "${item.text}"`);
    }
  });

  it("동일한 입력에 대해 항상 동일한 결과를 반환한다 (결정론적)", () => {
    const inputs = [
      { questionText: "오늘 학교에서 제일 기억에 남는 일은 뭐야?", semanticGroup: "SCHOOL_EXPERIENCE" },
      { questionText: "오늘 밥 뭐 먹었어?", semanticGroup: "MEAL_AND_TASTE" },
      { questionText: "오늘 가족과 뭐 했어?", semanticGroup: "FAMILY_RELATIONSHIP" },
      { questionText: "도움이 필요할 때 편하게 말할 수 있는 어른이 있어?", semanticGroup: "SUPPORT_NETWORK" },
      { questionText: "다음 주에 꼭 해보고 싶은 게 있어?", semanticGroup: "FUTURE_HOPE" },
    ];

    for (const input of inputs) {
      const first = classifyQuestionFamily(input);
      for (let i = 0; i < 5; i++) {
        assert.equal(classifyQuestionFamily(input), first);
      }
    }
  });
});
