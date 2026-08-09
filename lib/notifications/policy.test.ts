import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowNotificationOnboarding, shouldShowNotificationRecovery } from "./policy";
import { getPushErrorStatus } from "./push";

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
