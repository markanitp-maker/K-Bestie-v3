// hooks/useInstallPrompt.ts
import { useState, useEffect } from "react";
import { isStandaloneDisplay, isIOSDevice } from "@/lib/pwa/standalone";

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if already installed (standalone 실행 여부)
    setIsStandalone(isStandaloneDisplay(window));

    // Check if iOS
    setIsIOS(isIOSDevice(window.navigator.userAgent, Boolean((window as any).MSStream)));

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async (): Promise<"accepted" | "dismissed" | null> => {
    if (!installPrompt) return null;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // 수락한 경우에만 저장된 이벤트를 비운다(브라우저는 이벤트를 1회만 사용 가능).
    // 거부한 경우 이벤트를 유지해 사용자가 다시 시도할 수 있게 한다.
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
    return outcome;
  };

  return {
    installPrompt,
    isIOS,
    isStandalone,
    handleInstall,
  };
}
