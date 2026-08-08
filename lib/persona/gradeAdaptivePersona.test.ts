import assert from "node:assert/strict";
import test from "node:test";
import {
  GRADE_ADAPTIVE_PERSONAS,
  buildGradeAdaptivePersonaFragment,
  resolveGradeAdaptivePersona,
} from "./gradeAdaptivePersona";

test("초1~6은 서로 독립된 8개 persona 속성과 확정 관계 역할을 가진다", () => {
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

test("persona fragment는 8개 필드와 Memory/Relationship 유지 규칙을 포함한다", () => {
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
  ]) {
    assert.match(fragment, new RegExp(`${field}:`));
  }
  assert.match(fragment, /기존 Memory Fact와 Relationship History는 유지/);
  assert.match(fragment, /보호자 질문·안전 규칙이 .* 우선/);
});

test("저학년과 고학년 persona는 실제 표현 경계가 다르다", () => {
  const grade1 = buildGradeAdaptivePersonaFragment(GRADE_ADAPTIVE_PERSONAS[1]);
  const grade6 = buildGradeAdaptivePersonaFragment(GRADE_ADAPTIVE_PERSONAS[6]);
  assert.match(grade1, /놀이 친구/);
  assert.match(grade1, /의성어·의태어/);
  assert.match(grade6, /판단 없는 친구/);
  assert.match(grade6, /평가·충고 없이/);
  assert.notEqual(grade1, grade6);
});
