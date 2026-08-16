import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  loadRelationshipMemoryPackLimit,
} from "./memoryPackConfig";

test("환경변수가 없거나 빈 문자열이면 기본값(5)을 반환한다", () => {
  assert.equal(
    loadRelationshipMemoryPackLimit({}),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: undefined }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "   " }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
});

test("유효한 양의 정수 문자열이면 해당 숫자를 반환한다", () => {
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "3" }),
    3,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "10" }),
    10,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: " 7 " }),
    7,
  );
});

test("0, 음수, 숫자가 아닌 문자열, 소수점은 기본값(5)으로 fail-safe 복구된다", () => {
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "0" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "-1" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "-100" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "abc" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "2.5" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
  assert.equal(
    loadRelationshipMemoryPackLimit({ RELATIONSHIP_MEMORY_PACK_LIMIT: "NaN" }),
    DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT,
  );
});
