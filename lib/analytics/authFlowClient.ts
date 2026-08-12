export type AuthFlowEvent =
  | "landing_start_clicked"
  | "landing_view"
  | "hero_beta_cta_click"
  | "hero_report_cta_click"
  | "landing_video_dad_play"
  | "landing_video_mom_play"
  | "landing_video_complete"
  | "landing_video_signup_click"
  | "daily_report_view"
  | "daily_beta_cta_click"
  | "weekly_report_view"
  | "trust_section_view"
  | "beta_cta_click"
  | "faq_open"
  | "final_beta_cta_click"
  | "signup_start"
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

export interface LandingAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  item?: string;
}

type AuthFlowProperties = LandingAttribution & {
  provider?: "google" | "kakao";
};

export function logAuthFlowEvent(
  eventName: AuthFlowEvent,
  properties?: AuthFlowProperties
): Promise<void> {
  const normalizedProperties = properties
    ? Object.fromEntries(
        Object.entries(properties)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value.slice(0, 120)])
      )
    : undefined;

  return fetch("/api/analytics/auth-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, properties: normalizedProperties }),
    keepalive: true,
  }).then(() => undefined).catch(() => undefined);
}
