import test from "node:test";
import assert from "node:assert/strict";
import {
  PWA_ACTIVATION_DELAY_MS,
  PWA_DISMISS_COOLDOWN_MS,
  decideUpdateWorkerAction,
  isPwaDismissCooldownActive,
  pwaUpdateCopy,
} from "./updateFlow.js";

test("3초는 hard error가 아니고 activation 지연 기준은 8초다", () => {
  assert.equal(PWA_ACTIVATION_DELAY_MS, 8_000);
});

test("실제 waiting worker만 SKIP_WAITING 메시지 대상으로 선택한다", () => {
  assert.equal(decideUpdateWorkerAction({ waitingState: "installed" }), "message_waiting");
  assert.equal(decideUpdateWorkerAction({ rememberedState: "installed" }), "message_waiting");
});

test("installing/activating worker에는 SKIP_WAITING을 반복하지 않는다", () => {
  assert.equal(decideUpdateWorkerAction({ installingState: "installing" }), "wait_for_transition");
  assert.equal(decideUpdateWorkerAction({ rememberedState: "activating" }), "wait_for_transition");
});

test("activated/redundant stale 참조는 registration 재확인 대상으로 돌린다", () => {
  assert.equal(decideUpdateWorkerAction({ rememberedState: "activated" }), "refresh_registration");
  assert.equal(decideUpdateWorkerAction({ rememberedState: "redundant" }), "refresh_registration");
});

test("동일 build dismiss는 10분 동안만 유효하다", () => {
  const now = 1_000_000;
  assert.equal(isPwaDismissCooldownActive(now - PWA_DISMISS_COOLDOWN_MS + 1, now), true);
  assert.equal(isPwaDismissCooldownActive(now - PWA_DISMISS_COOLDOWN_MS, now), false);
});

test("offline·activation 지연·update 실패 문구를 구분하고 현재 버전 사용 가능을 알린다", () => {
  assert.match(pwaUpdateCopy("offline").title, /인터넷 연결/);
  assert.match(pwaUpdateCopy("delayed").title, /조금 늦어지고/);
  assert.match(pwaUpdateCopy("error").title, /확인하지 못했/);
  for (const state of ["offline", "delayed", "error"] as const) {
    assert.match(pwaUpdateCopy(state).body, /현재 버전은 계속 사용할 수/);
  }
});
