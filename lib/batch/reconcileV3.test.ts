import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previousKstBusinessDate } from "./reconcileV3";

describe("previousKstBusinessDate", () => {
  it("KST 자정 직후에는 직전 달력일을 복구 대상으로 선택한다", () => {
    assert.equal(previousKstBusinessDate(new Date("2026-08-07T15:05:00.000Z")), "2026-08-07");
  });
  it("UTC 날짜가 달라도 KST 달력 경계를 따른다", () => {
    assert.equal(previousKstBusinessDate(new Date("2026-08-08T01:00:00.000Z")), "2026-08-07");
  });
});
