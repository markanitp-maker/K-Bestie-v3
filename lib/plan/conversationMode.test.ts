import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConversationMode,
  toModeBucket,
  ALL_MODE_BUCKETS,
  MODE_LABELS,
  UNCLASSIFIED_MODE,
} from "./conversationMode";

test("normalizeConversationMode: 유효 A~F는 대문자로 정규화", () => {
  assert.equal(normalizeConversationMode("A"), "A");
  assert.equal(normalizeConversationMode("e"), "E");
  assert.equal(normalizeConversationMode(" c "), "C");
  assert.equal(normalizeConversationMode("f"), "F");
});

test("normalizeConversationMode: 유효하지 않으면 null(=미분류 저장)", () => {
  assert.equal(normalizeConversationMode("G"), null);
  assert.equal(normalizeConversationMode(""), null);
  assert.equal(normalizeConversationMode(undefined), null);
  assert.equal(normalizeConversationMode(null), null);
  assert.equal(normalizeConversationMode(123), null);
  assert.equal(normalizeConversationMode("unclassified"), null);
});

test("toModeBucket: NULL/미지정은 unclassified 버킷", () => {
  assert.equal(toModeBucket(null), UNCLASSIFIED_MODE);
  assert.equal(toModeBucket(undefined), UNCLASSIFIED_MODE);
  assert.equal(toModeBucket("Z"), UNCLASSIFIED_MODE);
  assert.equal(toModeBucket("B"), "B");
});

test("ALL_MODE_BUCKETS: A~F + unclassified 7개, 라벨 모두 존재", () => {
  assert.deepEqual(ALL_MODE_BUCKETS, ["A", "B", "C", "D", "E", "F", "unclassified"]);
  for (const b of ALL_MODE_BUCKETS) {
    assert.ok(MODE_LABELS[b] && MODE_LABELS[b].length > 0);
  }
});
