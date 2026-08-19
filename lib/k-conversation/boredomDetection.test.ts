import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessBoredom,
  buildBoredomUtterances,
  resolveBoredomAssessment,
} from "./boredomDetection";
import { normalizeSameSessionText } from "./memory/sameSession";

test("현재 발화 비교 시 공백을 정규화해 같은 턴을 중복 집계하지 않는다", () => {
  const utterances = buildBoredomUtterances(["몰라 그냥"], "몰라   그냥", true);

  assert.deepEqual(utterances, ["몰라 그냥"]);
});

test("현재 발화 비교 시 160자 절단을 동일하게 적용해 같은 턴을 중복 집계하지 않는다", () => {
  const currentUtterance = `${"가".repeat(160)}뒤쪽 원문`;
  const storedUtterance = normalizeSameSessionText(currentUtterance);
  const utterances = buildBoredomUtterances([storedUtterance], currentUtterance, true);

  assert.deepEqual(utterances, [storedUtterance]);
});

test("현재 발화가 저장된 마지막 요소와 다르면 pop하지 않고 정규화해 append한다", () => {
  const utterances = buildBoredomUtterances(["다른 말"], "질문   그만", true);

  assert.deepEqual(utterances, ["다른 말", "질문 그만"]);
});

test("엔진 boredom이 있으면 독립 계산보다 우선한다", async () => {
  const engineBoredom = assessBoredom(["오늘 학교에서 축구했어"]);
  let independentlyComputed = false;

  const resolved = await resolveBoredomAssessment(engineBoredom, async () => {
    independentlyComputed = true;
    return assessBoredom(["몰라", "그냥", "응"]);
  });

  assert.equal(resolved, engineBoredom);
  assert.equal(independentlyComputed, false);
});

test("엔진 조기 반환으로 boredom이 없으면 독립 계산으로 조기 종료를 판정한다", async () => {
  const resolved = await resolveBoredomAssessment(undefined, async () => (
    assessBoredom(["몰라", "그냥", "응"])
  ));

  assert.equal(resolved.level, "high");
  assert.equal(resolved.suggestedAdjustment?.allowEarlyFinish, true);
});

test("귀찮아, 그만할래가 비협조 신호로 잡힌다", () => {
  const assessment = assessBoredom(["귀찮아", "그만할래"]);
  assert.equal(assessment.signalCount, 2);
  assert.equal(assessment.level, "rising");
});

test("수학이 싫어는 비협조 신호로 잡히지 않는다 (정상 감정 발화)", () => {
  const assessment = assessBoredom(["수학이 싫어"]);
  assert.equal(assessment.signalCount, 0);
  assert.equal(assessment.level, "none");
  assert.equal(assessment.explicitRefusalThisTurn, false);
});

test("하기 싫어는 비협조 신호 및 명시적 거부로 잡힌다", () => {
  const assessment = assessBoredom(["하기 싫어"]);
  assert.equal(assessment.signalCount, 1);
  assert.equal(assessment.explicitRefusalThisTurn, true);
});

test("explicitRefusalThisTurn 판정: 그만할래 → true, 몰라 → false, 응 → false", () => {
  const refusal = assessBoredom(["그만할래"]);
  assert.equal(refusal.explicitRefusalThisTurn, true);

  const uncooperative = assessBoredom(["몰라"]);
  assert.equal(uncooperative.explicitRefusalThisTurn, false);

  const filler = assessBoredom(["응"]);
  assert.equal(filler.explicitRefusalThisTurn, false);
});

test("단발 거부 하나로는 level이 여전히 none이다 (누적 판정 유지 확인)", () => {
  const singleRefusal = assessBoredom(["그만할래"]);
  assert.equal(singleRefusal.signalCount, 1);
  assert.equal(singleRefusal.level, "none");
  assert.equal(singleRefusal.explicitRefusalThisTurn, true);
  assert.equal(singleRefusal.suggestedAdjustment, null);
});
