const ATTRIBUTION_COOKIE_DAYS = 30;

function setCookie(name: string, value: string, days: number) {
  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expiresAt.toUTCString()};path=/;secure;samesite=lax`;
}

function getCookie(name: string) {
  const value = document.cookie.match(`(^|;) ?${name}=([^;]*)(;|$)`);
  return value ? value[2] : null;
}

export function captureAttribution(linkId: string | null) {
  if (!linkId || typeof window === "undefined") return;

  let visitorId: string;
  try {
    visitorId = localStorage.getItem("k_visitor_id") ?? "";
    if (!visitorId) {
      visitorId = `v_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
      localStorage.setItem("k_visitor_id", visitorId);
    }
  } catch {
    visitorId = `v_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
  }

  setCookie("k_visitor_id", visitorId, ATTRIBUTION_COOKIE_DAYS);

  if (!getCookie("first_touch_link_id")) {
    setCookie("first_touch_link_id", linkId, ATTRIBUTION_COOKIE_DAYS);
  }
  setCookie("signup_touch_link_id", linkId, ATTRIBUTION_COOKIE_DAYS);

  const landingPath = window.location.pathname + window.location.search;
  const referrer = document.referrer;

  fetch("/api/acquisition/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      link_id: linkId,
      visitor_id: visitorId,
      landing_path: landingPath,
      referrer,
    }),
  }).catch(console.error);

  fetch("/api/acquisition/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "LANDING_PAGE_VIEW",
      visitor_id: visitorId,
      attribution_id: visitorId,
      link_id: linkId,
    }),
  }).catch(console.error);
}
