import { test } from "node:test";
import assert from "node:assert/strict";
import { getKstBusinessDate } from "./kstBusinessDate";

test("KST 00:00 직후 — UTC 전날 15:00은 KST 00:00", () => {
  assert.equal(getKstBusinessDate(new Date("2026-08-03T15:00:00Z")), "2026-08-04");
});

test("KST 23:59 근처 — UTC 14:59는 KST 23:59", () => {
  assert.equal(getKstBusinessDate(new Date("2026-08-03T14:59:00Z")), "2026-08-03");
});

test("UTC 날짜와 KST 날짜가 다른 시간대 — UTC 16:00은 다음날 KST 01:00", () => {
  assert.equal(getKstBusinessDate(new Date("2026-08-03T16:00:00Z")), "2026-08-04");
});

test("UTC 정오는 KST와 같은 날 21시", () => {
  assert.equal(getKstBusinessDate(new Date("2026-08-03T12:00:00Z")), "2026-08-03");
});
