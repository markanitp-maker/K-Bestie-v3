import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLanguageRetryInstruction,
  buildLanguageFailureMessage,
} from "./reportLanguageRetry";

// 1. 두 함수 결과에 path와 kind가 들어간다
test("1. buildLanguageRetryInstruction 및 buildLanguageFailureMessage 결과에 path와 kind가 포함된다", () => {
  const violations = [
    { path: "summary_text", kind: "hiragana" },
    { path: "detail_text.cards[0]", kind: "katakana" },
  ];

  const retryInstruction = buildLanguageRetryInstruction(violations);
  assert.ok(retryInstruction.includes("summary_text"));
  assert.ok(retryInstruction.includes("hiragana"));
  assert.ok(retryInstruction.includes("detail_text.cards[0]"));
  assert.ok(retryInstruction.includes("katakana"));

  const failureMessage = buildLanguageFailureMessage(violations);
  assert.ok(failureMessage.includes("2건"));
  assert.ok(failureMessage.includes("summary_text"));
  assert.ok(failureMessage.includes("hiragana"));
  assert.ok(failureMessage.includes("detail_text.cards[0]"));
  assert.ok(failureMessage.includes("katakana"));
});

// 2. 두 함수 결과에 sample 원문이 절대 들어가지 않는다 (sample을 넘겨도 안 나온다)
test("2. violation 객체에 sample 원문이 포함되어 있어도 두 함수 결과에 sample이 절대 노출되지 않는다", () => {
  const sensitiveSample1 = "아이대화원문_비밀텍스트_の";
  const sensitiveSample2 = "절대노출금지_ゲーム_샘플문자열";
  const violationsWithSample = [
    {
      path: "summary_text",
      kind: "hiragana",
      sample: sensitiveSample1,
    },
    {
      path: "highlights[0]",
      kind: "katakana",
      sample: sensitiveSample2,
    },
  ];

  const retryInstruction = buildLanguageRetryInstruction(violationsWithSample);
  assert.equal(
    retryInstruction.includes(sensitiveSample1),
    false,
    "재시도 지시문에 sensitiveSample1이 노출되어서는 안 됩니다."
  );
  assert.equal(
    retryInstruction.includes(sensitiveSample2),
    false,
    "재시도 지시문에 sensitiveSample2가 노출되어서는 안 됩니다."
  );

  const failureMessage = buildLanguageFailureMessage(violationsWithSample);
  assert.equal(
    failureMessage.includes(sensitiveSample1),
    false,
    "실패 에러 메시지에 sensitiveSample1이 노출되어서는 안 됩니다."
  );
  assert.equal(
    failureMessage.includes(sensitiveSample2),
    false,
    "실패 에러 메시지에 sensitiveSample2가 노출되어서는 안 됩니다."
  );
});

// 3. 위반이 4건 이상이면 path는 최대 3개까지만 나온다
test("3. 위반이 4건 이상일 때 path 목록은 최대 3개까지만 출력되고 전체 건수는 정확히 표시된다", () => {
  const violations = [
    { path: "path1", kind: "hiragana" },
    { path: "path2", kind: "katakana" },
    { path: "path3", kind: "japanese_context" },
    { path: "path4", kind: "hiragana" },
    { path: "path5", kind: "katakana" },
  ];

  const retryInstruction = buildLanguageRetryInstruction(violations);
  assert.ok(retryInstruction.includes("5건"));
  assert.ok(retryInstruction.includes("path1"));
  assert.ok(retryInstruction.includes("path2"));
  assert.ok(retryInstruction.includes("path3"));
  assert.equal(
    retryInstruction.includes("path4"),
    false,
    "4번째 path는 지시문에 포함되지 않아야 합니다."
  );
  assert.equal(
    retryInstruction.includes("path5"),
    false,
    "5번째 path는 지시문에 포함되지 않아야 합니다."
  );

  const failureMessage = buildLanguageFailureMessage(violations);
  assert.ok(failureMessage.includes("5건"));
  assert.ok(failureMessage.includes("path1"));
  assert.ok(failureMessage.includes("path2"));
  assert.ok(failureMessage.includes("path3"));
  assert.equal(
    failureMessage.includes("path4"),
    false,
    "4번째 path는 에러 메시지에 포함되지 않아야 합니다."
  );
  assert.equal(
    failureMessage.includes("path5"),
    false,
    "5번째 path는 에러 메시지에 포함되지 않아야 합니다."
  );
});

// 4. 위반이 0건이어도 크래시하지 않는다
test("4. 위반이 0건이거나 빈 배열이어도 에러 없이 안전하게 동작한다", () => {
  assert.doesNotThrow(() => {
    const emptyInstruction = buildLanguageRetryInstruction([]);
    assert.equal(typeof emptyInstruction, "string");
  });

  assert.doesNotThrow(() => {
    const emptyFailure = buildLanguageFailureMessage([]);
    assert.equal(typeof emptyFailure, "string");
    assert.ok(emptyFailure.includes("0건"));
  });
});
