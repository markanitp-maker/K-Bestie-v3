import { isConversationActive, getConversationActivitySnapshot } from "./conversationActivity";

export const SAFE_ROUTE_ALLOWLIST = [
  "/",
  "/child/home",
  "/parent/home",
  "/login",
  "/offline",
] as const;

export type SafeRoutePath = (typeof SAFE_ROUTE_ALLOWLIST)[number];

export interface RouteReadinessSnapshot {
  pathname: string;
  routeRevision: number;
  isNavigationInFlight: boolean;
  isRouteReady: boolean;
  readyToken: string | null;
  readyPath: string | null;
  readyRevision: number | null;
}

let currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
let routeRevision = 0;
let isNavigationInFlight = false;
let readyToken: string | null = null;
let readyPath: string | null = null;
let readyRevision: number | null = null;

const listeners = new Set<(snapshot: RouteReadinessSnapshot) => void>();
let navigationListenersInitialized = false;

let originalPushState: typeof window.history.pushState | null = null;
let originalReplaceState: typeof window.history.replaceState | null = null;

export function normalizeRoutePath(rawPathname: string): string {
  if (typeof rawPathname !== "string") return "";
  const clean = rawPathname.split("?")[0].split("#")[0].trim();
  if (!clean) return "/";
  if (clean.length > 1 && clean.endsWith("/")) {
    return clean.slice(0, -1);
  }
  return clean;
}

export function isSafeRoutePath(pathname: string): boolean {
  const normalized = normalizeRoutePath(pathname);
  return (SAFE_ROUTE_ALLOWLIST as readonly string[]).includes(normalized);
}

function notifyListeners() {
  const snapshot = getRouteReadinessSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[routeReadiness] listener error:", err);
    }
  }
}

export function getRouteReadinessSnapshot(): RouteReadinessSnapshot {
  const isRouteReady =
    readyToken !== null &&
    readyPath !== null &&
    normalizeRoutePath(currentPathname) === normalizeRoutePath(readyPath) &&
    readyRevision === routeRevision &&
    !isNavigationInFlight &&
    isSafeRoutePath(currentPathname);

  return {
    pathname: currentPathname,
    routeRevision,
    isNavigationInFlight,
    isRouteReady,
    readyToken,
    readyPath,
    readyRevision,
  };
}

export function isCurrentRouteSafeAndReady(pathname?: string): boolean {
  const path = pathname !== undefined ? pathname : currentPathname;
  const normalized = normalizeRoutePath(path);

  if (!isSafeRoutePath(normalized)) {
    return false;
  }

  const snapshot = getRouteReadinessSnapshot();
  if (!snapshot.isRouteReady) {
    return false;
  }

  if (snapshot.isNavigationInFlight) {
    return false;
  }

  const activitySnapshot = getConversationActivitySnapshot();
  if (!activitySnapshot.ready || activitySnapshot.isAnyActive || isConversationActive()) {
    return false;
  }

  return true;
}

export function startNavigation(targetPath?: string): number {
  isNavigationInFlight = true;
  routeRevision += 1;
  readyToken = null;
  readyPath = null;
  readyRevision = null;
  if (targetPath) {
    currentPathname = normalizeRoutePath(targetPath);
  }
  notifyListeners();
  return routeRevision;
}

export function setRoutePathname(pathname: string): void {
  const normalized = normalizeRoutePath(pathname);
  if (normalized !== currentPathname) {
    startNavigation(normalized);
  }
}

export function publishRouteReady(expectedPath: string, revision: number): string | null {
  const normalized = normalizeRoutePath(expectedPath);
  if (!isSafeRoutePath(normalized)) {
    return null;
  }

  // Only allow publishing for the current revision and matching pathname
  if (revision !== routeRevision) {
    return null;
  }

  currentPathname = normalized;
  isNavigationInFlight = false;
  readyToken = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ready_${Date.now()}_${Math.random()}`;
  readyPath = normalized;
  readyRevision = revision;

  notifyListeners();
  return readyToken;
}

export function revokeRouteReady(token?: string): void {
  if (token && readyToken !== token) {
    // Do not revoke a different token
    return;
  }

  readyToken = null;
  readyPath = null;
  readyRevision = null;
  notifyListeners();
}

export function subscribeRouteReadiness(
  listener: (snapshot: RouteReadinessSnapshot) => void
): () => void {
  listeners.add(listener);
  initNavigationListeners();
  try {
    listener(getRouteReadinessSnapshot());
  } catch (err) {
    console.error("[routeReadiness] immediate listener error:", err);
  }

  return () => {
    listeners.delete(listener);
  };
}

export function initNavigationListeners(): void {
  if (navigationListenersInitialized || typeof window === "undefined") return;
  navigationListenersInitialized = true;

  // Intercept history.pushState and history.replaceState for programmatic route changes
  if (typeof window.history !== "undefined") {
    if (!originalPushState) {
      originalPushState = window.history.pushState.bind(window.history);
      window.history.pushState = function (data: any, unused: string, url?: string | URL | null) {
        if (url && (!data || !data.pwaGateToken)) {
          try {
            const parsed = new URL(url.toString(), window.location.href);
            if (parsed.origin === window.location.origin) {
              const newPath = normalizeRoutePath(parsed.pathname);
              if (
                newPath !== currentPathname ||
                parsed.search !== window.location.search ||
                parsed.hash !== window.location.hash
              ) {
                startNavigation(newPath);
              }
            }
          } catch {}
        }
        return originalPushState!.apply(this, [data, unused, url]);
      };
    }

    if (!originalReplaceState) {
      originalReplaceState = window.history.replaceState.bind(window.history);
      window.history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
        if (url && (!data || !data.pwaGateToken)) {
          try {
            const parsed = new URL(url.toString(), window.location.href);
            if (parsed.origin === window.location.origin) {
              const newPath = normalizeRoutePath(parsed.pathname);
              if (
                newPath !== currentPathname ||
                parsed.search !== window.location.search ||
                parsed.hash !== window.location.hash
              ) {
                startNavigation(newPath);
              }
            }
          } catch {}
        }
        return originalReplaceState!.apply(this, [data, unused, url]);
      };
    }
  }

  // Capture link clicks
  window.addEventListener(
    "click",
    (event: MouseEvent) => {
      // Find closest anchor tag
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;

      // Ignore external or new-tab links
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin === window.location.origin) {
          const newPath = normalizeRoutePath(url.pathname);
          if (newPath !== currentPathname || url.search !== window.location.search || url.hash !== window.location.hash) {
            startNavigation(newPath);
          }
        }
      } catch {}
    },
    true // Capture phase
  );

  // Capture form submissions
  window.addEventListener(
    "submit",
    (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;
      try {
        const action = form.action ? new URL(form.action, window.location.href) : window.location;
        if (action.origin === window.location.origin) {
          startNavigation(normalizeRoutePath(action.pathname));
        }
      } catch {}
    },
    true
  );

  // Popstate (back / forward)
  window.addEventListener("popstate", () => {
    startNavigation(normalizeRoutePath(window.location.pathname));
  });

  // Pagehide / beforeunload
  window.addEventListener("pagehide", () => {
    startNavigation();
  });
}

export function resetRouteReadinessForTest(): void {
  if (typeof window !== "undefined" && typeof window.history !== "undefined") {
    if (originalPushState) {
      window.history.pushState = originalPushState;
      originalPushState = null;
    }
    if (originalReplaceState) {
      window.history.replaceState = originalReplaceState;
      originalReplaceState = null;
    }
  }
  currentPathname = "/";
  routeRevision = 0;
  isNavigationInFlight = false;
  readyToken = null;
  readyPath = null;
  readyRevision = null;
  navigationListenersInitialized = false;
  listeners.clear();
}
