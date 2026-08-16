export const EXACT_SAFE_ROUTES = [
  "/",
  "/child/home",
  "/parent",
  "/parent/home",
  "/login",
  "/offline",
] as const;

export type SafeRoutePath = typeof EXACT_SAFE_ROUTES[number];

export function isSafeRoute(pathname: string): boolean {
  if (!pathname || typeof pathname !== "string") return false;
  const cleanPath = pathname.split("?")[0].split("#")[0];
  for (const safePath of EXACT_SAFE_ROUTES) {
    if (cleanPath === safePath) {
      return true;
    }
  }
  return false;
}

export interface RouteReadinessState {
  isReady: boolean;
  pathname: string | null;
  revision: number;
}

export interface NavigationState {
  inFlight: boolean;
}

let readinessState: RouteReadinessState = {
  isReady: false,
  pathname: null,
  revision: 0,
};

let navigationState: NavigationState = {
  inFlight: false,
};

let currentRevision = 0;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error("[routeReadiness] Listener error:", e);
    }
  });
}

export function getRouteRevision(): number {
  return currentRevision;
}

export function incrementRouteRevision(): number {
  currentRevision += 1;
  navigationState.inFlight = true;
  readinessState = {
    isReady: false,
    pathname: null,
    revision: currentRevision,
  };
  notifyListeners();
  return currentRevision;
}

export function setNavigationInFlight(inFlight: boolean): void {
  if (navigationState.inFlight === inFlight) return;
  navigationState.inFlight = inFlight;
  notifyListeners();
}

export function isNavigationInFlight(): boolean {
  return navigationState.inFlight;
}

export function publishRouteReady(pathname: string, revision?: number): void {
  const cleanPath = pathname.split("?")[0].split("#")[0];
  if (!isSafeRoute(cleanPath)) {
    return;
  }

  const targetRevision = revision !== undefined ? revision : currentRevision;
  readinessState = {
    isReady: true,
    pathname: cleanPath,
    revision: targetRevision,
  };
  navigationState.inFlight = false;
  notifyListeners();
}

export function revokeRouteReady(pathname?: string): void {
  if (pathname) {
    const cleanPath = pathname.split("?")[0].split("#")[0];
    if (readinessState.pathname && readinessState.pathname !== cleanPath) {
      return;
    }
  }
  readinessState = {
    isReady: false,
    pathname: null,
    revision: currentRevision,
  };
  setNavigationInFlight(true);
  notifyListeners();
}

export function isExplicitRouteReady(
  pathname: string,
  revision?: number
): boolean {
  const cleanPath = pathname.split("?")[0].split("#")[0];
  if (!isSafeRoute(cleanPath)) {
    return false;
  }
  if (!readinessState.isReady || readinessState.pathname !== cleanPath) {
    return false;
  }
  if (revision !== undefined && readinessState.revision !== revision) {
    return false;
  }
  if (navigationState.inFlight) {
    return false;
  }
  return true;
}

export function getRouteReadinessSnapshot(): {
  readiness: RouteReadinessState;
  navigation: NavigationState;
  revision: number;
} {
  return {
    readiness: { ...readinessState },
    navigation: { ...navigationState },
    revision: currentRevision,
  };
}

export function subscribeRouteReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let windowListenersAttached = false;
if (typeof window !== "undefined" && !windowListenersAttached) {
  windowListenersAttached = true;

  window.addEventListener(
    "click",
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (anchor && anchor.href) {
        try {
          const targetUrl = new URL(anchor.href, window.location.origin);
          if (targetUrl.origin === window.location.origin) {
            setNavigationInFlight(true);
          }
        } catch {}
      }
    },
    true
  );

  window.addEventListener(
    "submit",
    () => {
      setNavigationInFlight(true);
    },
    true
  );

  window.addEventListener("popstate", () => {
    setNavigationInFlight(true);
  });

  window.addEventListener("pagehide", () => {
    setNavigationInFlight(true);
  });
}

export function _resetRouteReadinessStoreForTest(): void {
  readinessState = {
    isReady: false,
    pathname: null,
    revision: 0,
  };
  navigationState = {
    inFlight: false,
  };
  currentRevision = 0;
  listeners.clear();
}
