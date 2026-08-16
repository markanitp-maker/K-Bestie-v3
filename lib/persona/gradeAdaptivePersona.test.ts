import assert from "node:assert/strict";
import test from "node:test";
import {
  GRADE_ADAPTIVE_PERSONAS,
  buildGradeAdaptivePersonaFragment,
  resolveGradeAdaptivePersona,
} from "./gradeAdaptivePersona";

test("초1~6은 서로 독립된 11개 persona 속성과 확정 관계 역할을 가진다", () => {
  const expectedRoles = [
    "놀이 친구",
    "학교 친구",
    "친한 친구",
    "마음 터놓는 친구",
    "존중하는 친구",
    "판단 없는 친구",
  ];

  for (let grade = 1; grade <= 6; grade += 1) {
    const persona = GRADE_ADAPTIVE_PERSONAS[grade as 1 | 2 | 3 | 4 | 5 | 6];
    assert.equal(persona.relationshipRole, expectedRoles[grade - 1]);
    for (const value of [
      persona.tone,
      persona.vocabularyLevel,
      persona.questionStyle,
      persona.emotionDepth,
      persona.humorLevel,
      persona.memoryUsageDepth,
      persona.empathyStyle,
      persona.privacySensitivity,
      persona.conversationLeadRatio,
      persona.playRatio,
      persona.autonomyLevel,
    ]) {
      assert.ok(value.length > 0);
    }
  }
});

test("DB 학년 형식을 해석하고 범위 밖 값은 안전하게 처리한다", () => {
  assert.equal(resolveGradeAdaptivePersona("1학년")?.grade, 1);
  assert.equal(resolveGradeAdaptivePersona("6")?.grade, 6);
  assert.equal(resolveGradeAdaptivePersona("중학교 1학년")?.grade, 6);
  assert.equal(resolveGradeAdaptivePersona("고1"), null);
  assert.equal(resolveGradeAdaptivePersona(null), null);
});

test("persona fragment는 11개 필드와 Memory/Relationship 유지 규칙을 포함한다", () => {
  const fragment = buildGradeAdaptivePersonaFragment(GRADE_ADAPTIVE_PERSONAS[4]);
  for (const field of [
    "tone",
    "vocabulary_level",
    "question_style",
    "emotion_depth",
    "humor_level",
    "memory_usage_depth",
    "empathy_style",
    "privacy_sensitivity",
    "conversation_lead_ratio",
    "play_ratio",
    "autonomy_level",
  ]) {
    assert.match(fragment, new RegExp(`${field}:`));
  }
  assert.match(fragment, /기존 Memory Fact와 Relationship History는 유지/);
  assert.match(fragment, /보호자 질문·안전 규칙이 .* 우선/);
});

test("저학년과 고학년 persona는 실제 표현 경계와 전략 방향성이 다르다", () => {
  const grade1 = buildGradeAdaptivePersonaFragment(GRADE_ADAPTIVE_PERSONAS[1]);
  const grade6 = buildGradeAdaptivePersonaFragment(GRADE_ADAPTIVE_PERSONAS[6]);
  assert.match(grade1, /놀이 친구/);
  assert.match(grade1, /의성어·의태어/);
  assert.match(grade1, /conversation_lead_ratio: 매우 높음/);
  assert.match(grade1, /play_ratio: 매우 높음/);
  assert.match(grade1, /autonomy_level: 기초/);

  assert.match(grade6, /판단 없는 친구/);
  assert.match(grade6, /평가·충고 없이/);
  assert.match(grade6, /conversation_lead_ratio: 매우 낮음/);
  assert.match(grade6, /play_ratio: 매우 낮음/);
  assert.match(grade6, /autonomy_level: 최상/);

  assert.notEqual(grade1, grade6);
});

test("학년이 올라갈수록 conversation lead와 play는 낮아지고 autonomy는 높아진다", () => {
  const g1 = GRADE_ADAPTIVE_PERSONAS[1];
  const g2 = GRADE_ADAPTIVE_PERSONAS[2];
  const g3 = GRADE_ADAPTIVE_PERSONAS[3];
  const g4 = GRADE_ADAPTIVE_PERSONAS[4];
  const g5 = GRADE_ADAPTIVE_PERSONAS[5];
  const g6 = GRADE_ADAPTIVE_PERSONAS[6];

  // Lead ratio 방향성: 저학년은 높고 고학년은 낮음
  assert.match(g1.conversationLeadRatio, /매우 높음/);
  assert.match(g2.conversationLeadRatio, /높음/);
  assert.match(g3.conversationLeadRatio, /중간/);
  assert.match(g4.conversationLeadRatio, /중간~낮음/);
  assert.match(g5.conversationLeadRatio, /낮음/);
  assert.match(g6.conversationLeadRatio, /매우 낮음/);

  // Play ratio 방향성: 저학년은 높고 고학년은 낮음
  assert.match(g1.playRatio, /매우 높음/);
  assert.match(g2.playRatio, /높음/);
  assert.match(g3.playRatio, /중간/);
  assert.match(g4.playRatio, /중간~낮음/);
  assert.match(g5.playRatio, /낮음/);
  assert.match(g6.playRatio, /매우 낮음/);

  // Autonomy level 방향성: 저학년은 기초/낮음, 고학년은 높음/최상
  assert.match(g1.autonomyLevel, /기초/);
  assert.match(g2.autonomyLevel, /낮음~중간/);
  assert.match(g3.autonomyLevel, /중간/);
  assert.match(g4.autonomyLevel, /중상/);
  assert.match(g5.autonomyLevel, /높음/);
  assert.match(g6.autonomyLevel, /최상/);
});
