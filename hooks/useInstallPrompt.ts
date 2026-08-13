// hooks/useInstallPrompt.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";
import {
  isIOSDevice,
  isStandaloneDisplay,
  resolvePwaBrowserContext,
  type PwaBrowserContext,
} from "@/lib/pwa/standalone";

export interface BeforeInstallPromptChoice {
  outcome: "accepted" | "dismissed";
  platform: string;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
  prompt: () => Promise<void>;
}

export type PwaInstallGuide = "ios" | "in-app" | "unsupported";
export type PwaInstallOutcome = "accepted" | "dismissed" | "guide-opened" | "hidden";
export type PwaInstallGuideContext = Extract<
  PwaBrowserContext,
  { kind: "in-app-browser" | "ios-safari" | "regular-browser-unsupported" }
>;

interface BrowserSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  hasMSStream: boolean;
}

const INITIAL_CONTEXT = {
  kind: "regular-browser-unsupported",
  os: "other",
} satisfies PwaBrowserContext;

function getUnsupportedGuideContext(signals: BrowserSignals | null): PwaInstallGuideContext {
  if (!signals) return INITIAL_CONTEXT;
  if (
    isIOSDevice(
      signals.userAgent,
      signals.hasMSStream,
      signals.platform,
      signals.maxTouchPoints,
    )
  ) {
    return { kind: "regular-browser-unsupported", os: "ios" };
  }
  if (/Android/i.test(signals.userAgent)) {
    return { kind: "regular-browser-unsupported", os: "android" };
  }
  return INITIAL_CONTEXT;
}

function getActiveGuide(context: PwaInstallGuideContext | null): PwaInstallGuide | null {
  if (!context) return null;
  if (context.kind === "in-app-browser") return "in-app";
  if (context.kind === "ios-safari") return "ios";
  return "unsupported";
}

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installRequestPendingRef = useRef(false);
  const installedRef = useRef(false);
  const [signals, setSignals] = useState<BrowserSignals | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [guideContext, setGuideContext] = useState<PwaInstallGuideContext | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standaloneMedia = window.matchMedia?.("(display-mode: standalone)");
    const readStandalone = () => setIsStandalone(isStandaloneDisplay(window));

    setSignals({
      userAgent: window.navigator.userAgent,
      platform: window.navigator.platform,
      maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
      hasMSStream: Boolean((window as unknown as { MSStream?: unknown }).MSStream),
    });
    readStandalone();
    setIsReady(true);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (installedRef.current) return;
      const promptEvent = event as BeforeInstallPromptEvent;
      installPromptRef.current = promptEvent;
      setInstallPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      installedRef.current = true;
      installPromptRef.current = null;
      installRequestPendingRef.current = false;
      setInstallPrompt(null);
      setGuideContext(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    standaloneMedia?.addEventListener?.("change", readStandalone);

    return () => {
      installPromptRef.current = null;
      installRequestPendingRef.current = false;
      installedRef.current = false;
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      standaloneMedia?.removeEventListener?.("change", readStandalone);
    };
  }, []);

  const context = useMemo<PwaBrowserContext>(() => {
    if (!signals) return INITIAL_CONTEXT;
    return resolvePwaBrowserContext({
      ...signals,
      standalone: isStandalone,
      hasInstallPrompt: installPrompt !== null,
    });
  }, [installPrompt, isStandalone, signals]);

  useEffect(() => {
    if (!isReady || typeof window === "undefined") return;

    if (context.kind === "in-app-browser" && context.app === "kakao") {
      const key = "k_kakao_inapp_detected_logged";
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        void logAuthFlowEvent("kakao_link_open");
        void logAuthFlowEvent("kakao_inapp_detected");
      }
      return;
    }

    if (context.kind === "standalone") {
      const key = "k_pwa_first_launch_logged";
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        void logAuthFlowEvent("pwa_first_launch");
      }
    }
  }, [context, isReady]);

  const requestInstall = useCallback(async (): Promise<PwaInstallOutcome> => {
    if (!isReady || installedRef.current || isInstalled || context.kind === "standalone") {
      return "hidden";
    }
    if (installRequestPendingRef.current) return "hidden";

    if (context.kind === "in-app-browser") {
      setGuideContext(context);
      return "guide-opened";
    }

    // The ref is the click-time SSOT. beforeinstallprompt can arrive after the last render,
    // so a stale context must not hide a prompt that is already available to this click.
    const promptEvent = installPromptRef.current;
    if (promptEvent) {
      installRequestPendingRef.current = true;
      // beforeinstallprompt is single-use. Clear it before awaiting so repeated clicks cannot
      // invoke the same event while the browser prompt is still resolving.
      installPromptRef.current = null;
      setInstallPrompt(null);
      setGuideContext(null);
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        return outcome;
      } catch {
        setGuideContext(getUnsupportedGuideContext(signals));
        return "guide-opened";
      } finally {
        installRequestPendingRef.current = false;
      }
    }

    if (context.kind === "ios-safari") {
      setGuideContext(context);
      return "guide-opened";
    }

    setGuideContext(getUnsupportedGuideContext(signals));
    return "guide-opened";
  }, [context, isInstalled, isReady, signals]);

  const closeGuide = useCallback(() => setGuideContext(null), []);

  // Legacy call-site compatibility while parent/child/onboarding/settings migrate to the
  // common controller contract.
  const handleInstall = useCallback(async (): Promise<"accepted" | "dismissed" | null> => {
    const outcome = await requestInstall();
    return outcome === "accepted" || outcome === "dismissed" ? outcome : null;
  }, [requestInstall]);

  const isIOS = signals
    ? isIOSDevice(
        signals.userAgent,
        signals.hasMSStream,
        signals.platform,
        signals.maxTouchPoints,
      )
    : false;

  return {
    context,
    isReady,
    canShowInstallEntry: isReady && !isInstalled && context.kind !== "standalone",
    activeGuide: getActiveGuide(guideContext),
    guideContext,
    requestInstall,
    closeGuide,
    installPrompt,
    isIOS,
    isStandalone: isStandalone || isInstalled,
    isInstalled,
    handleInstall,
  };
}
