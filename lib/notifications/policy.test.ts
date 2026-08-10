import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowNotificationOnboarding, shouldShowNotificationRecovery } from "./policy";
import { getPushErrorCode, getPushErrorHeaders, getPushErrorReason, getPushErrorStatus, isPushTimeout } from "./push";

test("first-run default permission shows onboarding once", () => {
  assert.equal(shouldShowNotificationOnboarding({ loading: false, dismissed: false, permission: "default", onboardingCompleted: false }), true);
  assert.equal(shouldShowNotificationOnboarding({ loading: false, dismissed: false, permission: "default", onboardingCompleted: true }), false);
  assert.equal(shouldShowNotificationOnboarding({ loading: false, dismissed: false, permission: "denied", onboardingCompleted: false }), false);
});

test("denied and unsupported states use recovery guidance", () => {
  assert.equal(shouldShowNotificationRecovery({ loading: false, modalVisible: false, permission: "denied" }), true);
  assert.equal(shouldShowNotificationRecovery({ loading: false, modalVisible: false, permission: "unsupported" }), true);
  assert.equal(shouldShowNotificationRecovery({ loading: false, modalVisible: false, permission: "granted" }), false);
});

test("expired push status is observable for subscription cleanup", () => {
  assert.equal(getPushErrorStatus({ statusCode: 410 }), 410);
  assert.equal(getPushErrorStatus(new Error("network")), null);
});

test("push timeout is classified without relying on an HTTP status", () => {
  assert.equal(isPushTimeout({ code: "ETIMEDOUT" }), true);
  assert.equal(isPushTimeout({ message: "Socket timeout" }), true);
  assert.equal(getPushErrorCode({ code: "ETIMEDOUT" }), "PUSH_TIMEOUT");
});

test("push provider reason safely handles Buffer, string, and malformed bodies", () => {
  assert.equal(getPushErrorReason({ body: Buffer.from('{"reason":"VapidPkHashMismatch"}') }), "VapidPkHashMismatch");
  assert.equal(getPushErrorReason({ body: '{"reason":"BadJwtToken"}' }), "BadJwtToken");
  assert.equal(getPushErrorReason({ body: "{invalid" }), null);
});

test("push error response headers are restricted to the diagnostic allowlist", () => {
  assert.deepEqual(
    getPushErrorHeaders({
      headers: {
        "content-type": "application/json",
        "www-authenticate": "vapid error",
        authorization: "Bearer secret",
        cookie: "session=secret",
      },
    }),
    { "content-type": "application/json", "www-authenticate": "vapid error" }
  );
});
