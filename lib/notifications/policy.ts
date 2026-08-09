import type { PushPermission } from "./usePushSubscription";

export function shouldShowNotificationOnboarding(input: { loading: boolean; dismissed: boolean; permission: PushPermission; onboardingCompleted: boolean }) {
  return !input.loading && !input.dismissed && input.permission === "default" && !input.onboardingCompleted;
}

export function shouldShowNotificationRecovery(input: { loading: boolean; modalVisible: boolean; permission: PushPermission }) {
  return !input.loading && !input.modalVisible && input.permission !== "granted";
}
