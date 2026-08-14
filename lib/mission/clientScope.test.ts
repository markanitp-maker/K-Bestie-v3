import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAuthenticatedChildId,
  missionClientScopeKey,
  parseMissionClientScope,
  reconcileMissionClientScope,
} from "./clientScope.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const scope = {
  actorUserId: "user-a",
  familyId: "family-a",
  childId: "child-a",
  businessDate: "2026-08-14",
};

test("서버 clientContext만 Mission local scope로 사용한다", () => {
  assert.deepEqual(parseMissionClientScope({ clientContext: scope }), scope);
  assert.equal(parseMissionClientScope({ clientContext: { ...scope, childId: null } }), null);
});

test("현재 로그인한 아이 ID는 서버 /child/me 응답으로 확정한다", async () => {
  const childId = await fetchAuthenticatedChildId(
    (async () => Response.json({ id: "server-child" })) as typeof fetch,
  );
  assert.equal(childId, "server-child");
});

test("현재 로그인한 아이 조회 실패를 로컬 ID로 대체하지 않는다", async () => {
  await assert.rejects(
    fetchAuthenticatedChildId(
      (async () => new Response(null, { status: 401 })) as typeof fetch,
    ),
    /authenticated child 401/,
  );
});

test("동일 계정·아이·날짜는 같은 scope다", () => {
  const storage = memoryStorage();
  assert.equal(reconcileMissionClientScope(scope, storage).changed, true);
  assert.equal(reconcileMissionClientScope(scope, storage).changed, false);
  assert.equal(storage.getItem("k_child_id"), "child-a");
});

test("계정이나 아이가 바뀌면 scope 변경을 감지한다", () => {
  const storage = memoryStorage();
  reconcileMissionClientScope(scope, storage);
  const changed = reconcileMissionClientScope({ ...scope, actorUserId: "user-b", childId: "child-b" }, storage);
  assert.equal(changed.changed, true);
  assert.notEqual(changed.scopeKey, missionClientScopeKey(scope));
});
