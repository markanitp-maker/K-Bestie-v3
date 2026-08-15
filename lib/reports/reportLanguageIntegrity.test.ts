import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectReportText,
  validateReportLanguageIntegrity,
} from "./reportLanguageIntegrity";

// Case A: 정상 한국어
test("A. 정상 한국어 문장은 검증을 통과한다 (ok=true, violations=0)", () => {
  const text = "이번 주 서아는 학교 생활 이야기를 많이 들려줬어요.";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);

  const textInspect = inspectReportText(text);
  assert.deepEqual(textInspect, []);
});

// Case B: 히라가나 혼입
test("B. 히라가나가 혼입된 문장은 검증에 실패한다 (ok=false, kind='hiragana' 포함)", () => {
  const text = "학업 면에서는 영어の実力 향상에 뿌듯함을 느꼈어요.";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, false);
  assert.ok(result.violations.length > 0);

  const hasHiragana = result.violations.some((v) => v.kind === "hiragana");
  assert.equal(hasHiragana, true, "히라가나 위반(の)이 검출되어야 합니다.");

  const hasJapaneseContext = result.violations.some(
    (v) => v.kind === "japanese_context"
  );
  assert.equal(
    hasJapaneseContext,
    true,
    "일본어 문맥 한자(実力) 위반이 검출되어야 합니다."
  );
});

// Case C: 카타카나 혼입
test("C. 카타카나가 혼입된 문장은 검증에 실패한다 (ok=false, kind='katakana' 포함)", () => {
  const text = "친구들과 ゲーム 이야기를 했어요.";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, false);
  assert.ok(result.violations.length > 0);

  const katakanaViolation = result.violations.find((v) => v.kind === "katakana");
  assert.ok(katakanaViolation, "카타카나 위반이 검출되어야 합니다.");
  assert.ok(katakanaViolation?.sample.includes("ゲーム"));
});

// Case D: 영어 및 특수 고유명사 보존
test("D. 영어 고유명사 및 라틴 문자는 위반으로 감지되지 않는다 (ok=true)", () => {
  const text = "로블록스와 Roblox, YouTube, MBTI 이야기를 했어요.";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

// Case E: 중첩 JSON 구조 순회 및 경로 검증
test("E. 중첩 JSON 구조 내 깊숙한 문자열 필드의 위반과 JSON path를 정확히 식별한다", () => {
  const reportPayload = {
    weekly: {
      summary: "정상",
      sections: [{ text: "영어の実力" }],
    },
  };
  const result = validateReportLanguageIntegrity(reportPayload);
  assert.equal(result.ok, false);
  assert.ok(result.violations.length > 0);

  const matched = result.violations.find(
    (v) => v.path === "weekly.sections[0].text"
  );
  assert.ok(
    matched,
    `path가 'weekly.sections[0].text'를 가리켜야 합니다. 실제 paths: ${result.violations.map((v) => v.path).join(", ")}`
  );
});

// Case F: 정상 한자 표현 및 괄호 병기 허용
test("F. 한자가 없는 정상 문장과 한국어식 괄호 한자 병기는 정상 통과한다", () => {
  const textNoHanja = "체육 시간에 줄넘기를 했어요.";
  const resultNoHanja = validateReportLanguageIntegrity(textNoHanja);
  assert.equal(resultNoHanja.ok, true);
  assert.equal(resultNoHanja.violations.length, 0);

  const textWithParentheticalHanja =
    "서아(書兒)는 이번 주에 수학(數學) 공부를 열심히 했습니다.";
  const resultWithHanja = validateReportLanguageIntegrity(
    textWithParentheticalHanja
  );
  assert.equal(resultWithHanja.ok, true);
  assert.equal(resultWithHanja.violations.length, 0);

  const fullWidthParenText = "김서현（金瑞賢） 학생의 활동 보고서입니다.";
  const resultFullWidth = validateReportLanguageIntegrity(fullWidthParenText);
  assert.equal(resultFullWidth.ok, true);
  assert.equal(resultFullWidth.violations.length, 0);
});

// Case G: 빈 값 및 비문자열 처리
test("G. null, undefined, 숫자, 불리언, 빈 객체/배열은 에러 없이 통과한다", () => {
  assert.equal(validateReportLanguageIntegrity(null).ok, true);
  assert.equal(validateReportLanguageIntegrity(undefined).ok, true);
  assert.equal(validateReportLanguageIntegrity(12345).ok, true);
  assert.equal(validateReportLanguageIntegrity(true).ok, true);
  assert.equal(validateReportLanguageIntegrity({}).ok, true);
  assert.equal(validateReportLanguageIntegrity([]).ok, true);
  assert.equal(validateReportLanguageIntegrity({ a: null, b: 10, c: true }).ok, true);
});

// 추가 테스트 1: 순환 참조 객체 방어
test("순환 참조가 있는 객체도 무한 루프 없이 안전하게 검사한다", () => {
  const circularObj: Record<string, unknown> = {
    title: "정상 제목",
  };
  circularObj.self = circularObj;
  circularObj.child = { parent: circularObj, name: "서아" };

  const result = validateReportLanguageIntegrity(circularObj);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

// 추가 테스트 2: 일본 신자체 단독 사용 검출
test("한국 정자가 아닌 일본 전용 신자체/국자는 단독으로도 japanese_context로 검출된다", () => {
  const text = "서아의 気분이 매우 좋아 보였습니다.";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, false);
  const violation = result.violations.find((v) => v.kind === "japanese_context");
  assert.ok(violation, "일본 신자체 '気'가 japanese_context로 검출되어야 합니다.");
});

// 추가 테스트 3: 카타카나 장음 기호(ー) 검출
test("카타카나 장음 기호(ー)는 예외 없이 카타카나 위반으로 검출된다", () => {
  const text = "슈퍼마켓ー 방문";
  const result = validateReportLanguageIntegrity(text);
  assert.equal(result.ok, false);
  const violation = result.violations.find((v) => v.kind === "katakana");
  assert.ok(violation);
});

// 추가 테스트 4: 괄호 안 히라가나/카타카나는 허용되지 않고 검출됨
test("괄호 안에 히라가나/카타카나가 포함되어 있으면 예외 없이 검출된다", () => {
  const textHiragana = "친구(ともだち)와 함께";
  const resultH = validateReportLanguageIntegrity(textHiragana);
  assert.equal(resultH.ok, false);
  assert.ok(resultH.violations.some((v) => v.kind === "hiragana"));

  const textKatakana = "게임(ゲーム)을 즐겼습니다";
  const resultK = validateReportLanguageIntegrity(textKatakana);
  assert.equal(resultK.ok, false);
  assert.ok(resultK.violations.some((v) => v.kind === "katakana"));
});

// 추가 테스트 5: inspectReportText 기본 path 및 sample 길이 검증
test("inspectReportText는 path 기본값으로 '$'를 사용하고 sample 길이를 40자 이하로 제한한다", () => {
  const longText =
    "매우 긴 한국어 문장입니다. 앞부분이 이렇게 길게 나오고 중간에 영어の実力 같은 일본어 혼합 표현이 들어가며 뒷부분도 아주 길게 이어집니다.";
  const violations = inspectReportText(longText);
  assert.ok(violations.length > 0);
  for (const v of violations) {
    assert.equal(v.path, "$");
    assert.ok(v.sample.length <= 40, `sample 길이가 40자를 초과하지 않아야 합니다: ${v.sample.length}`);
  }
});
