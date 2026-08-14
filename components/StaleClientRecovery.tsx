"use client";

import { useEffect, useRef } from "react";
import { isStaleClientAssetError } from "@/lib/pwa/staleClientRecovery";
import { requestStaleRecovery } from "@/lib/pwa/recoveryCoordinator";
import {
  validateStaleAssetEnvelope,
  isLegacyStaleAssetMessage,
  requestServiceWorkerIdentity,
  isValidStaleAssetPath,
} from "@/lib/pwa/swProtocol";

/**
 * 2026-08-14 Production 장애 대응 — 배포 교체로 청크를 못 받은 클라이언트를
 * 사용자 조작 없이 스스로 복구시킨다.
 *
 * StaleClientRecovery는 독자적 reload/cache purge를 수행하지 않고,
 * 유효한 stale asset 신호와 controller 메시지를 엄격히 검증한 뒤
 * recoveryCoordinator를 통해 PwaServiceWorker 단일 오케스트레이터로 위임한다.
 */
export function StaleClientRecovery() {
  const recoveringRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const triggerRecovery = (
      source: "chunk_error" | "sw_message" | "unhandled_rejection",
      pathname?: string,
      buildId?: string,
      workerNonce?: string
    ) => {
      if (disposed || recoveringRef.current) return;
      recoveringRef.current = true;
      requestStaleRecovery({
        source,
        pathname,
        buildId,
        workerNonce,
        timestamp: Date.now(),
      });
      // Throttle rapid repeated triggers within the same page lifecycle
      setTimeout(() => {
        if (!disposed) recoveringRef.current = false;
      }, 5_000);
    };

    const handleError = (event: ErrorEvent) => {
      if (isStaleClientAssetError(event.error) || isStaleClientAssetError(event.message)) {
        triggerRecovery("chunk_error");
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isStaleClientAssetError(event.reason)) {
        triggerRecovery("unhandled_rejection");
      }
    };

    // 서비스워커 메시지 처리
    const handleServiceWorkerMessage = async (event: MessageEvent) => {
      if (disposed) return;
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

      // 1. Source verification: MUST be from current active controller!
      const currentController = navigator.serviceWorker.controller;
      if (!currentController || event.source !== currentController) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object") return;

      // 2. Strict v1 Stale Asset Envelope
      if (data.protocol === 1 && data.type === "K_STALE_ASSET") {
        // Query fresh controller identity
        const identity = await requestServiceWorkerIdentity(currentController, 1500).catch(() => null);
        if (!identity || identity.protocolVersion !== 1 || !identity.workerNonce || !identity.buildId) {
          return;
        }

        const validated = validateStaleAssetEnvelope(data, {
          controllerBuildId: identity.buildId,
          controllerNonce: identity.workerNonce,
        });

        if (validated && validated.status === 404 && isValidStaleAssetPath(validated.pathname)) {
          triggerRecovery("sw_message", validated.pathname, validated.buildId, validated.workerNonce);
        }
        return;
      }

      // 3. Legacy v0 { type: "K_STALE_ASSET" } backwards compatibility
      if (isLegacyStaleAssetMessage(data)) {
        // Bounded legacy identity check to validate read-only identity before accepting
        const identity = await requestServiceWorkerIdentity(currentController, 1500).catch(() => null);
        if (identity && identity.buildId) {
          // v0 only signals coordinator; it NEVER initiates proposal, SKIP_WAITING, reload, or success telemetry directly!
          triggerRecovery("sw_message", undefined, identity.buildId);
        }
        return;
      }

      // Any other unknown/forged message produces 0 coordinator calls
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    }

    return () => {
      disposed = true;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      }
    };
  }, []);

  return null;
}
