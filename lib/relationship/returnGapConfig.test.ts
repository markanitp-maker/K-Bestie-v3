import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS,
  loadRelationshipReturnGapDays,
} from "./returnGapConfig";

test("returnGapConfig: 환경변수 미설정 시 기본값(3)을 반환한다", () => {
  assert.equal(loadRelationshipReturnGapDays({}), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
  assert.equal(loadRelationshipReturnGapDays(undefined), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
  assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "" }), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
});

test("returnGapConfig: 정상 정수 문자열 파싱 (5 -> 5, 1 -> 1)", () => {
  assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "5" }), 5);
  assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "1" }), 1);
  assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: " 7 " }), 7);
});

test("returnGapConfig: 잘못된 값(0, 음수, 문자열, 소수)은 기본값으로 복구하고 에러 로깅한다", () => {
  const originalError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "0" }), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
    assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "-1" }), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
    assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "abc" }), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);
    assert.equal(loadRelationshipReturnGapDays({ RELATIONSHIP_RETURN_GAP_DAYS: "3.5" }), DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS);

    assert.equal(loggedErrors.length, 4);
  } finally {
    console.error = originalError;
  }
});
