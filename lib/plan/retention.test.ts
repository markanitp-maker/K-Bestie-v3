// 유효 보존기간 계산 + 파기 대상 판정 유닛 테스트.
// node --experimental-strip-types --test lib/plan/retention.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffectiveRetention, isPurgeCandidate } from "./retention.ts";

test("Care Start(tier 1)는 항상 6개월 고정", () => {
  assert.deepEqual(getEffectiveRetention(1, 0), { months: 6 });
  assert.deepEqual(getEffectiveRetention(1, 5), { months: 6 });
});

test("Care Insight(tier 2) 확장팩 경계값 검증", () => {
  assert.deepEqual(getEffectiveRetention(2, 0), { months: 36 }); // 3년
  assert.deepEqual(getEffectiveRetention(2, 1), { months: 48 }); // 4년
  assert.deepEqual(getEffectiveRetention(2, 9), { months: 144 }); // 3+9 = 12년
  assert.deepEqual(getEffectiveRetention(2, 10), { months: 144 }); // 상한 9년 클램프
  assert.deepEqual(getEffectiveRetention(2, 100), { months: 144 });
});

test("Care Premium(tier 3)은 1, 3, 5년 중 선택하고 비정상 숫자는 5년으로 폴백", () => {
  assert.deepEqual(getEffectiveRetention(3, 0, 1), { months: 12 });
  assert.deepEqual(getEffectiveRetention(3, 0, 3), { months: 36 });
  assert.deepEqual(getEffectiveRetention(3, 0, 5), { months: 60 });
  assert.deepEqual(getEffectiveRetention(3, 0, 10), { months: 60 }); // 폴백
  assert.deepEqual(getEffectiveRetention(3, 0, -1), { months: 60 }); // 폴백
});

test("Care Premium null/undefined는 무제한이며 어떤 앵커도 파기 대상으로 만들지 않음", () => {
  const nullRetention = getEffectiveRetention(3, 0, null);
  const undefinedRetention = getEffectiveRetention(3, 0, undefined);

  assert.deepEqual(nullRetention, { months: null });
  assert.deepEqual(undefinedRetention, { months: null });
  assert.equal(
    isPurgeCandidate(
      { anchorTs: new Date("1900-01-01T00:00:00Z") },
      new Date("2026-08-11T00:00:00Z"),
      nullRetention
    ),
    false
  );
});

test("Care Start 6개월 경계 전/정각/후", () => {
  const retention = getEffectiveRetention(1, 0);
  const anchorTs = new Date("2026-02-11T00:00:00Z");
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-10T23:59:59Z"), retention), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:00Z"), retention), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:01Z"), retention), true);
});

test("Insight 기본 3년과 2년 연장팩 경계를 각각 적용", () => {
  const anchorTs = new Date("2021-08-11T00:00:00Z");
  const base = getEffectiveRetention(2, 0);
  const extended = getEffectiveRetention(2, 2);

  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2024-08-11T00:00:00Z"), base), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2024-08-11T00:00:01Z"), base), true);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:00Z"), extended), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:01Z"), extended), true);
});

test("Premium 5년 경계와 무제한에서 5년 변경 후 재계산", () => {
  const anchorTs = new Date("2021-08-11T00:00:00Z");
  const unlimited = getEffectiveRetention(3, 0, null);
  const fiveYears = getEffectiveRetention(3, 0, 5);

  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2100-01-01T00:00:00Z"), unlimited), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:00Z"), fiveYears), false);
  assert.equal(isPurgeCandidate({ anchorTs }, new Date("2026-08-11T00:00:01Z"), fiveYears), true);
});

test("isPurgeCandidate: 보존기간 이내는 파기 대상 아님", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  const now = new Date("2026-06-01T00:00:00Z"); // 약 4.5개월 경과
  assert.equal(isPurgeCandidate({ anchorTs }, now, retention), false);
});

test("isPurgeCandidate: 보존기간 초과는 파기 대상", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  const now = new Date("2026-08-01T00:00:00Z"); // 6.5개월 경과
  assert.equal(isPurgeCandidate({ anchorTs }, now, retention), true);
});

test("isPurgeCandidate: KST 자정 경계 — UTC 환산 앵커/now로 정확히 판정", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  const justBefore = new Date("2026-07-14T23:59:59Z");
  const justAfter = new Date("2026-07-15T00:00:01Z");
  assert.equal(isPurgeCandidate({ anchorTs }, justBefore, retention), false);
  assert.equal(isPurgeCandidate({ anchorTs }, justAfter, retention), true);
});

test("다운그레이드로 초과 판정된 앵커가 재상향 후 동일 계산기로는 초과 아님으로 뒤집힘", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const anchorTs = new Date("2026-01-01T00:00:00Z"); // now 기준 5개월 경과

  const afterDowngrade = getEffectiveRetention(1, 0); // Start=6개월 → 아직 미초과
  const afterReupgrade = getEffectiveRetention(2, 0); // Insight=36개월 재상향 → 당연히 미초과

  // 가상의 매우 짧은 보존기간(1개월)으로 테스트
  const veryShort = { months: 1 };
  assert.equal(isPurgeCandidate({ anchorTs }, now, veryShort), true);

  // 재상향 시 초과 아님이어야 함
  assert.equal(isPurgeCandidate({ anchorTs }, now, afterReupgrade), false);
  assert.equal(isPurgeCandidate({ anchorTs }, now, afterDowngrade), false);
});
