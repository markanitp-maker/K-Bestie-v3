export type AuthFlowEvent =
  | "landing_start_clicked"
  | "header_login_clicked"
  | "header_signup_clicked"
  | "social_auth_provider_selected"
  | "social_auth_completed"
  | "existing_user_routed_to_login"
  | "new_user_routed_to_signup"
  | "incomplete_user_resumed_signup"
  | "social_auth_failed"
  | "kakao_link_open"
  | "kakao_inapp_detected"
  | "external_browser_cta_view"
  | "external_browser_cta_click"
  | "external_browser_arrived"
  | "pwa_install_offer_view"
  | "pwa_install_click"
  | "pwa_install_dismiss"
  | "pwa_installed"
  | "pwa_first_launch"
  | "notification_onboarding_view"
  | "notification_permission_granted"
  | "notification_permission_denied";

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
