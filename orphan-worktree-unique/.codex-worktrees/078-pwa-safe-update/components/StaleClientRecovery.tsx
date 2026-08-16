"use client";

import { useEffect, useRef } from "react";
import {
  isStaleClientAssetError,
  recoverStaleClient,
  mapStaleRecoveryErrorCode,
} from "../lib/pwa/staleClientRecovery";
import {
  validateStaleAssetEnvelope,
  isPwaIdentityResponse,
  PwaIdentityResponse,
} from "../lib/pwa/tabUpdateConsensus";
import { sendPwaUpdateTelemetry } from "../lib/pwa/updateTelemetry";
import { performClientVersionCheck } from "../lib/pwa/updateGate";
import {
  evaluatePostReloadHandshake,
  getReloadPendingMarker,
  setReloadPendingMarker,
  clearReloadPendingMarker,
} from "../lib/pwa/updateFlow";
import { BUILD_STAMP } from "../lib/pwa/buildStamp";

const STALE_RECOVERY_PENDING_KEY = "pwa_stale_recovery_pending";

function requestSwIdentity(
  worker: ServiceWorker,
  timeoutMs = 3000
): Promise<PwaIdentityResponse | null> {
  return new Promise((resolve) => {
    if (!worker) return resolve(null);
    const requestNonce =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : String(Math.random());
    const channel = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      channel.port1.close();
      resolve(null);
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      channel.port1.close();
      if (isPwaIdentityResponse(event.data, requestNonce)) {
        resolve(event.data);
      } else {
        resolve(null);
      }
    };

    try {
      worker.postMessage(
        {
          protocol: 1,
          type: "PWA_GET_IDENTITY",
          requestNonce,
        },
        [channel.port2]
      );
    } catch {
      if (timer !== null) {
        clearTimeout(timer);
      }
      channel.port1.close();
      resolve(null);
    }
  });
}

/**
 * 2026-08-14 Production 장애 대응 — 배포 교체로 청크를 못 받은 클라이언트를
 * 사용자 조작 없이 스스로 복구시킨다.
 */
export function StaleClientRecovery() {
  const recoveringRef = useRef(false);

  // 1. Check pending recovery marker on mount after a recovery reload
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;

    try {
      const pending = sessionStorage.getItem(STALE_RECOVERY_PENDING_KEY);
      if (pending) {
        sessionStorage.removeItem(STALE_RECOVERY_PENDING_KEY);
        const marker = getReloadPendingMarker();

        void (async () => {
          const serverCheck = await performClientVersionCheck({ currentVersion: BUILD_STAMP });
          const controller =
            typeof navigator !== "undefined" && "serviceWorker" in navigator
              ? navigator.serviceWorker.controller
              : null;
          let controllerBuildId: string | null = null;
          if (controller) {
            const identity = await requestSwIdentity(controller);
            if (identity) {
              controllerBuildId = identity.buildId;
            }
          }

          const handshake = evaluatePostReloadHandshake({
            serverMetadata: serverCheck.metadata || null,
            documentBuildStamp: BUILD_STAMP,
            controllerBuildId,
            reloadPendingMarker: marker,
          });

          if (handshake.success) {
            clearReloadPendingMarker();
            sendPwaUpdateTelemetry({
              eventType: "pwa_stale_client_recovery_success",
              currentVersion: BUILD_STAMP,
              latestVersion: handshake.buildId,
            });
          } else {
            sendPwaUpdateTelemetry({
              eventType: "pwa_stale_client_recovery_failed",
              currentVersion: BUILD_STAMP,
              errorCode: mapStaleRecoveryErrorCode(handshake.reason),
            });
          }
        })();
      }
    } catch {}
  }, []);

  // 2. Listen for stale chunk / SW 404 errors
  useEffect(() => {
    let disposed = false;

    const recoverWithMarker = (targetBuild: string) => {
      if (disposed || recoveringRef.current) return;
      recoveringRef.current = true;

      sendPwaUpdateTelemetry({
        eventType: "pwa_stale_client_detected",
        currentVersion: BUILD_STAMP,
      });

      sendPwaUpdateTelemetry({
        eventType: "pwa_stale_client_recovery_started",
        currentVersion: BUILD_STAMP,
      });

      const proposalId = `stale_${
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : String(Date.now())
      }`;
      setReloadPendingMarker({
        proposalId,
        targetBuild,
        startedAt: Date.now(),
      });

      try {
        sessionStorage.setItem(STALE_RECOVERY_PENDING_KEY, "true");
      } catch {}

      void recoverStaleClient()
        .then((result) => {
          if (result !== "reloading") {
            try {
              sessionStorage.removeItem(STALE_RECOVERY_PENDING_KEY);
            } catch {}
            sendPwaUpdateTelemetry({
              eventType: "pwa_stale_client_recovery_failed",
              currentVersion: BUILD_STAMP,
              errorCode: mapStaleRecoveryErrorCode(result),
            });
            recoveringRef.current = false;
          }
        })
        .catch((err) => {
          try {
            sessionStorage.removeItem(STALE_RECOVERY_PENDING_KEY);
          } catch {}
          sendPwaUpdateTelemetry({
            eventType: "pwa_stale_client_recovery_failed",
            currentVersion: BUILD_STAMP,
            errorCode: mapStaleRecoveryErrorCode(err),
          });
          recoveringRef.current = false;
        });
    };

    const handleError = (event: ErrorEvent) => {
      if (!isStaleClientAssetError(event.error) && !isStaleClientAssetError(event.message)) {
        return;
      }
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;

      void (async () => {
        const identity = await requestSwIdentity(controller);
        if (!identity) {
          sendPwaUpdateTelemetry({
            eventType: "pwa_stale_client_recovery_failed",
            currentVersion: BUILD_STAMP,
            errorCode: mapStaleRecoveryErrorCode("CONTROLLER_MISMATCH"),
          });
          return;
        }
        recoverWithMarker(identity.buildId);
      })();
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!isStaleClientAssetError(event.reason)) return;
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;

      void (async () => {
        const identity = await requestSwIdentity(controller);
        if (!identity) {
          sendPwaUpdateTelemetry({
            eventType: "pwa_stale_client_recovery_failed",
            currentVersion: BUILD_STAMP,
            errorCode: mapStaleRecoveryErrorCode("CONTROLLER_MISMATCH"),
          });
          return;
        }
        recoverWithMarker(identity.buildId);
      })();
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

      // 1. MUST accept K_STALE_ASSET only from current controller
      if (event.source !== navigator.serviceWorker.controller) {
        return;
      }

      const controller = navigator.serviceWorker.controller;
      if (!controller) return;

      void (async () => {
        // 2. Perform identity handshake with controller
        const identity = await requestSwIdentity(controller);
        if (!identity) {
          sendPwaUpdateTelemetry({
            eventType: "pwa_stale_client_recovery_failed",
            currentVersion: BUILD_STAMP,
            errorCode: mapStaleRecoveryErrorCode("CONTROLLER_MISMATCH"),
          });
          return;
        }

        // 3. Strict envelope validation
        const validEnvelope = validateStaleAssetEnvelope(event.data, {
          controllerBuildId: identity.buildId,
          controllerNonce: identity.workerNonce,
        });

        if (!validEnvelope) {
          sendPwaUpdateTelemetry({
            eventType: "pwa_stale_client_recovery_failed",
            currentVersion: BUILD_STAMP,
            errorCode: mapStaleRecoveryErrorCode("INVALID_ENVELOPE"),
          });
          return;
        }

        recoverWithMarker(identity.buildId);
      })();
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
