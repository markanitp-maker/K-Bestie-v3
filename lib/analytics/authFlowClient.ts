export type AuthFlowEvent =
  | "landing_start_clicked"
  | "header_login_clicked"
  | "header_signup_clicked"
  | "social_auth_provider_selected"
  | "social_auth_completed"
  | "existing_user_routed_to_login"
  | "new_user_routed_to_signup"
  | "incomplete_user_resumed_signup"
  | "social_auth_failed";

export function logAuthFlowEvent(
  eventName: AuthFlowEvent,
  properties?: { provider?: "google" | "kakao" }
): Promise<void> {
  return fetch("/api/analytics/auth-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, properties }),
    keepalive: true,
  }).then(() => undefined).catch(() => undefined);
}
