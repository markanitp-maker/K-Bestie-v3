"use client";

import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isRouteReady,
  performClientVersionCheck,
  canReleaseGateOnNoUpdate,
  UPDATE_CHECK_INTERVAL_MS,
} from "../lib/pwa/updateGate";
import {
  isSafeRoute,
  isExplicitRouteReady,
  isNavigationInFlight,
  subscribeRouteReadiness,
  revokeRouteReady,
  getRouteRevision,
} from "../lib/pwa/routeReadiness";
import {
  subscribeConversationActivity,
  getConversationActivitySnapshot,
  isConversationActive,
  isActivationBarrierActive,
  openActivationBarrier,
  commitActivationBarrier,
  clearActivationBarrier,
} from "../lib/pwa/conversationActivity";
import { sendPwaUpdateTelemetry } from "../lib/pwa/updateTelemetry";
import {
  updateFlowReducer,
  UpdateGateState,
  waitForInstallingWorker,
  getReloadPendingMarker,
  setReloadPendingMarker,
  clearReloadPendingMarker,
  evaluatePostReloadHandshake,
  PWA_ACTIVATION_DELAY_MS,
  ReloadPendingMarker,
} from "../lib/pwa/updateFlow";
import {
  createActivationProposal,
  getOrCreateTabId,
  broadcastProposalHint,
  subscribeProposalHint,
  getActivationProposal,
  isPwaIdentityResponse,
  isPwaTabPrepareRequest,
  evaluateTabVote,
  PwaIdentityResponse,
  ActivationProposal,
  PWA_ACTIVATION_PROPOSAL_STORAGE_KEY,
} from "../lib/pwa/tabUpdateConsensus";
import { BUILD_STAMP } from "../lib/pwa/buildStamp";
import { PwaUpdateGateModal } from "./PwaUpdateGateModal";

const BUILD_ID = BUILD_STAMP;
const RELOAD_GUARD_KEY = `pwa_sw_reloaded_${BUILD_ID}`;
const LAST_CHECKED_KEY = "k_pwa_last_checked";
const CLIENT_LOADED_KEY = "k_pwa_client_loaded";

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

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function useSafePathname() {
  try {
    return usePathname() ?? "/";
  } catch {
    return "/";
  }
}

export function PwaServiceWorker() {
  const router = useSafeRouter();
  const pathname = useSafePathname();

  const [gateState, dispatchGateState] = useReducer(updateFlowReducer, "BOOTING");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [navWarning, setNavWarning] = useState<string | null>(null);
  const [modalCopyState, setModalCopyState] = useState<
    "idle" | "mismatch" | "delayed" | "error" | "offline" | "reloading"
  >("mismatch");

  const pathnameRef = useRef(pathname);
  const checkedRouteRevisionRef = useRef(0);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const activationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerChangeHandledRef = useRef(false);
  const hasConfirmedMismatchRef = useRef(false);
  const targetBuildIdRef = useRef<string>(BUILD_ID);
  const activeProposalRef = useRef<ActivationProposal | null>(null);
  const pendingControllerChangeReloadRef = useRef<boolean>(false);
  const initialCheckStartedRef = useRef<boolean>(false);

  const sentinelTokenRef = useRef<string | null>(null);
  const sentinelPushedRef = useRef<boolean>(false);
  const originalUrlRef = useRef<string>("");

  const clientLoadedAtRef = useRef<number>(Date.now());
  const lastCheckedAtRef = useRef<number | null>(null);
  const inFlightCheckRef = useRef<boolean>(false);
  const scheduledCheckTriggersRef = useRef<Set<string>>(new Set());

  const [conversationSnapshot, setConversationSnapshot] = useState(() =>
    getConversationActivitySnapshot()
  );
  const conversationSnapshotRef = useRef(conversationSnapshot);

  const isGateActive =
    isModalOpen ||
    gateState === "UPDATE_BLOCKING" ||
    gateState === "UPDATE_BLOCKING_ERROR" ||
    gateState === "VERIFYING_LATEST" ||
    gateState === "VERIFYING_ERROR" ||
    gateState === "CONSENSUS_PREPARING" ||
    gateState === "ACTIVATING";

  useEffect(() => {
    conversationSnapshotRef.current = conversationSnapshot;
  }, [conversationSnapshot]);

  // Subscribe to SSOT conversation activity
  useEffect(() => {
    return subscribeConversationActivity((snapshot) => {
      setConversationSnapshot(snapshot);
      conversationSnapshotRef.current = snapshot;

      if (!snapshot.isAnyActive && pendingControllerChangeReloadRef.current) {
        const currentPath = pathnameRef.current;
        const currentRev = getRouteRevision();

        if (
          isRouteReady({
            pathname: currentPath,
            checkedRevision: checkedRouteRevisionRef.current,
            currentRevision: currentRev,
            isReactReady: isExplicitRouteReady(currentPath, currentRev),
            isActivityReady: snapshot.ready,
            isNavigationInFlight: isNavigationInFlight(),
          })
        ) {
          pendingControllerChangeReloadRef.current = false;
          const proposalId = activeProposalRef.current?.proposalId || `prop_${Date.now()}`;
          commitActivationBarrier(proposalId);
          setReloadPendingMarker({
            proposalId,
            targetBuild: targetBuildIdRef.current,
            startedAt: Date.now(),
          });
          dispatchGateState({ type: "PREPARE_RELOAD" });
          try {
            sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
          } catch {}
          window.location.reload();
        }
      }
    });
  }, []);

  useEffect(() => {
    if (pathname !== pathnameRef.current) {
      pathnameRef.current = pathname;
      setNavWarning(null);
    }
  }, [pathname]);

  // Sync state machine decision to modal visibility
  const syncModalVisibility = useCallback(
    (currentState: UpdateGateState, route: string) => {
      const isBlockingState =
        currentState === "UPDATE_BLOCKING" ||
        currentState === "UPDATE_BLOCKING_ERROR" ||
        currentState === "VERIFYING_LATEST" ||
        currentState === "VERIFYING_ERROR" ||
        currentState === "CONSENSUS_PREPARING" ||
        currentState === "ACTIVATING";

      if (isBlockingState) {
        if (!isModalOpen) {
          setIsModalOpen(true);
          sendPwaUpdateTelemetry({
            eventType: "pwa_update_modal_shown",
            route,
            currentVersion: BUILD_ID,
            latestVersion: targetBuildIdRef.current,
          });
        }
      } else if (
        currentState === "CURRENT" ||
        currentState === "UPDATE_DEFERRED" ||
        currentState === "CHECK_NETWORK_ERROR" ||
        currentState === "BOOTING"
      ) {
        if (isModalOpen) {
          setIsModalOpen(false);
        }
      }
    },
    [isModalOpen]
  );

  useEffect(() => {
    syncModalVisibility(gateState, pathnameRef.current);
  }, [gateState, syncModalVisibility]);

  const clearActivationTimer = useCallback(() => {
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current);
      activationTimerRef.current = null;
    }
  }, []);

  // Centralized safe check scheduler with strict pre/post validation
  const maybeScheduleSafeCheck = useCallback(
    async (trigger: string, targetRevision?: number) => {
      const currentPath = pathnameRef.current;
      const currentRev = targetRevision ?? getRouteRevision();
      const triggerKey = `${trigger}:${currentRev}`;

      if (scheduledCheckTriggersRef.current.has(triggerKey)) {
        return;
      }
      scheduledCheckTriggersRef.current.add(triggerKey);
      queueMicrotask(() => {
        scheduledCheckTriggersRef.current.delete(triggerKey);
      });

      // Pre-validation BEFORE fetch
      if (!isSafeRoute(currentPath)) return;
      if (!isExplicitRouteReady(currentPath, currentRev)) return;
      if (!conversationSnapshotRef.current.ready) return;
      if (conversationSnapshotRef.current.isAnyActive) return;
      if (isNavigationInFlight()) return;
      if (isActivationBarrierActive()) return;
      if (inFlightCheckRef.current) return;

      const now = Date.now();
      if (
        trigger !== "manual" &&
        trigger !== "mount-ready" &&
        trigger !== "route-ready"
      ) {
        if (
          lastCheckedAtRef.current !== null &&
          now - lastCheckedAtRef.current < UPDATE_CHECK_INTERVAL_MS
        ) {
          return;
        }
      }

      inFlightCheckRef.current = true;
      try {
        // Re-validate immediately before network fetch
        if (
          !isSafeRoute(pathnameRef.current) ||
          !isExplicitRouteReady(pathnameRef.current, currentRev) ||
          isActivationBarrierActive()
        ) {
          return;
        }

        sendPwaUpdateTelemetry({
          eventType: "pwa_update_check_started",
          route: currentPath,
          currentVersion: BUILD_ID,
        });

        checkedRouteRevisionRef.current = currentRev;
        const result = await performClientVersionCheck({ currentVersion: BUILD_ID });

        // Post-validation AFTER network fetch
        if (
          !isSafeRoute(pathnameRef.current) ||
          getRouteRevision() !== currentRev ||
          !isExplicitRouteReady(pathnameRef.current, currentRev) ||
          isActivationBarrierActive() ||
          isConversationActive() ||
          isNavigationInFlight()
        ) {
          return;
        }

        // Only valid safe checks that return no-update or mismatch update the throttle timestamp
        if (result.status === "no-update" || result.status === "mismatch") {
          lastCheckedAtRef.current = now;
          try {
            sessionStorage.setItem(LAST_CHECKED_KEY, String(now));
          } catch {}
        }

        const hasWorker =
          !canReleaseGateOnNoUpdate(registrationRef.current) || !!waitingWorkerRef.current;

        const isSafeAndReady =
          isRouteReady({
            pathname: currentPath,
            checkedRevision: checkedRouteRevisionRef.current,
            currentRevision: getRouteRevision(),
            isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
            isActivityReady: conversationSnapshotRef.current.ready,
            isNavigationInFlight: isNavigationInFlight(),
          }) && !conversationSnapshotRef.current.isAnyActive;

        if (result.status === "no-update") {
          sendPwaUpdateTelemetry({
            eventType: "pwa_update_check_no_update",
            route: currentPath,
            currentVersion: BUILD_ID,
            latestVersion: result.latestVersion ?? BUILD_ID,
          });

          dispatchGateState({
            type: "CHECK_RESULT",
            status: "no-update",
            hasWorker,
            isSafeAndReady,
          });

          if (!hasWorker) {
            hasConfirmedMismatchRef.current = false;
            setModalCopyState("idle");
          }
          return;
        }

        if (result.status === "network-failure" || result.status === "invalid-response") {
          sendPwaUpdateTelemetry({
            eventType: "pwa_update_failed",
            route: currentPath,
            currentVersion: BUILD_ID,
            errorCode: result.error || "NETWORK_FAILURE",
          });

          dispatchGateState({
            type: "CHECK_RESULT",
            status: result.status,
          });
          return;
        }

        if (result.status === "mismatch") {
          hasConfirmedMismatchRef.current = true;
          targetBuildIdRef.current = result.metadata?.buildId || result.latestVersion || BUILD_ID;
          setModalCopyState("mismatch");

          sendPwaUpdateTelemetry({
            eventType: "pwa_update_available",
            route: currentPath,
            currentVersion: BUILD_ID,
            latestVersion: targetBuildIdRef.current,
          });

          dispatchGateState({
            type: "CHECK_RESULT",
            status: "mismatch",
            isSafeAndReady,
          });
        }
      } finally {
        inFlightCheckRef.current = false;
      }
    },
    []
  );

  // 1. Post-reload Latest Verification
  const runLatestVerification = useCallback(async (marker: ReloadPendingMarker) => {
    dispatchGateState({ type: "VERIFY_LATEST_START" });
    setModalCopyState("mismatch");

    const serverCheck = await performClientVersionCheck({ currentVersion: BUILD_ID });
    if (
      serverCheck.status === "network-failure" ||
      serverCheck.status === "invalid-response" ||
      !serverCheck.metadata
    ) {
      dispatchGateState({ type: "VERIFY_LATEST_RESULT", success: false });
      setModalCopyState("error");
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
        errorCode: serverCheck.error || "VERIFY_SERVER_CHECK_FAILED",
      });
      return;
    }

    const controller =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.controller
        : null;
    if (!controller) {
      dispatchGateState({ type: "VERIFY_LATEST_RESULT", success: false });
      setModalCopyState("error");
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
        errorCode: "CONTROLLER_MISSING",
      });
      return;
    }

    const identity = await requestSwIdentity(controller);
    if (!identity) {
      dispatchGateState({ type: "VERIFY_LATEST_RESULT", success: false });
      setModalCopyState("error");
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
        errorCode: "TRIPLE_MISMATCH",
      });
      return;
    }

    const handshake = evaluatePostReloadHandshake({
      serverMetadata: serverCheck.metadata,
      documentBuildStamp: BUILD_ID,
      controllerBuildId: identity.buildId,
      reloadPendingMarker: marker,
    });

    if (handshake.success) {
      clearReloadPendingMarker();
      dispatchGateState({ type: "VERIFY_LATEST_RESULT", success: true });
      setModalCopyState("idle");

      sendPwaUpdateTelemetry({
        eventType: "pwa_update_success",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
        latestVersion: handshake.buildId,
      });
    } else {
      dispatchGateState({ type: "VERIFY_LATEST_RESULT", success: false });
      setModalCopyState("error");

      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
        errorCode: handshake.reason,
      });
    }
  }, []);

  // Load client timestamps & Check initial proposal / reload marker on mount
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;

    try {
      const storedLoaded = sessionStorage.getItem(CLIENT_LOADED_KEY);
      if (storedLoaded) {
        clientLoadedAtRef.current = Number(storedLoaded);
      } else {
        sessionStorage.setItem(CLIENT_LOADED_KEY, String(clientLoadedAtRef.current));
      }

      const storedChecked = sessionStorage.getItem(LAST_CHECKED_KEY);
      if (storedChecked) {
        lastCheckedAtRef.current = Number(storedChecked);
      }
    } catch {}

    // Restore live activation proposal barrier on mount if valid
    const existingProposal = getActivationProposal();
    if (existingProposal) {
      openActivationBarrier({
        proposalId: existingProposal.proposalId,
        targetBuild: existingProposal.targetBuild,
        expiresAt: existingProposal.expiresAt,
        phase: "preparing",
      });
    }

    const pendingMarker = getReloadPendingMarker();
    if (pendingMarker) {
      void runLatestVerification(pendingMarker);
    } else {
      if (!initialCheckStartedRef.current) {
        initialCheckStartedRef.current = true;
        void maybeScheduleSafeCheck("mount-ready");
      }
    }
  }, [maybeScheduleSafeCheck, runLatestVerification]);

  // Subscribe to explicit route readiness changes
  useEffect(() => {
    return subscribeRouteReadiness(() => {
      const currentPath = pathnameRef.current;
      const currentRev = getRouteRevision();
      if (isExplicitRouteReady(currentPath, currentRev)) {
        void maybeScheduleSafeCheck("route-ready", currentRev);

        if (
          pendingControllerChangeReloadRef.current &&
          !conversationSnapshotRef.current.isAnyActive
        ) {
          pendingControllerChangeReloadRef.current = false;
          const proposalId = activeProposalRef.current?.proposalId || `prop_${Date.now()}`;
          commitActivationBarrier(proposalId);
          setReloadPendingMarker({
            proposalId,
            targetBuild: targetBuildIdRef.current,
            startedAt: Date.now(),
          });
          dispatchGateState({ type: "PREPARE_RELOAD" });
          try {
            sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
          } catch {}
          window.location.reload();
        }
      }
    });
  }, [maybeScheduleSafeCheck]);

  // Evaluate deferred state on route change / conversation activity change
  useEffect(() => {
    const currentPath = pathname;
    const isSafeAndReady =
      isRouteReady({
        pathname: currentPath,
        checkedRevision: checkedRouteRevisionRef.current,
        currentRevision: getRouteRevision(),
        isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
        isActivityReady: conversationSnapshot.ready,
        isNavigationInFlight: isNavigationInFlight(),
      }) && !conversationSnapshot.isAnyActive;

    if (gateState === "UPDATE_DEFERRED" && isSafeAndReady) {
      dispatchGateState({ type: "EVALUATE_DEFERRED", isSafeAndReady: true });
    }

    if (pendingControllerChangeReloadRef.current && isSafeAndReady) {
      pendingControllerChangeReloadRef.current = false;
      const proposalId = activeProposalRef.current?.proposalId || `prop_${Date.now()}`;
      commitActivationBarrier(proposalId);
      setReloadPendingMarker({
        proposalId,
        targetBuild: targetBuildIdRef.current,
        startedAt: Date.now(),
      });
      dispatchGateState({ type: "PREPARE_RELOAD" });
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
      } catch {}
      window.location.reload();
    }
  }, [pathname, conversationSnapshot, gateState]);

  // Periodic 60-min check & visibility / online handlers
  useEffect(() => {
    const checkInterval = setInterval(() => {
      void maybeScheduleSafeCheck("60-min-timer");
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void maybeScheduleSafeCheck("visibilitychange");
      }
    };

    const handleOnline = () => {
      void maybeScheduleSafeCheck("online");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(checkInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [maybeScheduleSafeCheck]);

  // Service Worker Registration & Worker Lifecycle Listeners
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    const workerCleanups: Array<() => void> = [];

    const observeWorker = (worker: ServiceWorker) => {
      const handleStateChange = () => {
        if (disposed) return;
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = worker;
          hasConfirmedMismatchRef.current = true;
          const currentPath = pathnameRef.current;

          sendPwaUpdateTelemetry({
            eventType: "pwa_update_available",
            route: currentPath,
            currentVersion: BUILD_ID,
          });

          const isSafeAndReady =
            isRouteReady({
              pathname: currentPath,
              checkedRevision: checkedRouteRevisionRef.current,
              currentRevision: getRouteRevision(),
              isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
              isActivityReady: conversationSnapshotRef.current.ready,
              isNavigationInFlight: isNavigationInFlight(),
            }) && !conversationSnapshotRef.current.isAnyActive;

          dispatchGateState({
            type: "CHECK_RESULT",
            status: "mismatch",
            isSafeAndReady,
          });
        } else if (worker.state === "redundant" && waitingWorkerRef.current === worker) {
          waitingWorkerRef.current = null;
        }
      };

      worker.addEventListener("statechange", handleStateChange);
      workerCleanups.push(() => worker.removeEventListener("statechange", handleStateChange));
      handleStateChange();
    };

    const handleUpdateFound = () => {
      if (registration?.installing) observeWorker(registration.installing);
    };

    // controllerchange is NEVER success. Check hazards & reload safely once.
    const handleControllerChange = () => {
      if (controllerChangeHandledRef.current) return;
      controllerChangeHandledRef.current = true;
      clearActivationTimer();
      waitingWorkerRef.current = null;

      dispatchGateState({ type: "CONTROLLER_CHANGE_RECEIVED" });

      const currentPath = pathnameRef.current;
      const isSafeAndReady =
        isRouteReady({
          pathname: currentPath,
          checkedRevision: checkedRouteRevisionRef.current,
          currentRevision: getRouteRevision(),
          isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
          isActivityReady: conversationSnapshotRef.current.ready,
          isNavigationInFlight: isNavigationInFlight(),
        }) && !conversationSnapshotRef.current.isAnyActive;

      if (isSafeAndReady) {
        const proposalId = activeProposalRef.current?.proposalId || `prop_${Date.now()}`;
        commitActivationBarrier(proposalId);
        setReloadPendingMarker({
          proposalId,
          targetBuild: targetBuildIdRef.current,
          startedAt: Date.now(),
        });
        dispatchGateState({ type: "PREPARE_RELOAD" });
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
        } catch {}
        window.location.reload();
      } else {
        pendingControllerChangeReloadRef.current = true;
        dispatchGateState({ type: "EVALUATE_DEFERRED", isSafeAndReady: false });
      }
    };

    // Tab vote handler for SW PWA_TAB_PREPARE request
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (isPwaTabPrepareRequest(event.data)) {
        const { requestNonce, proposal } = event.data;
        const currentPath = pathnameRef.current;

        // Open barrier synchronously before evaluating vote
        openActivationBarrier({
          proposalId: proposal.proposalId,
          targetBuild: proposal.targetBuild,
          expiresAt: proposal.expiresAt,
          phase: "preparing",
        });

        const vote = evaluateTabVote({
          clientId: getOrCreateTabId(),
          requestNonce,
          proposal,
          pathname: currentPath,
          isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
          isActivityReady: conversationSnapshotRef.current.ready,
          isNavigationInFlight: isNavigationInFlight(),
          isConversationActive: conversationSnapshotRef.current.isAnyActive,
          documentBuildId: BUILD_ID,
          activeProposalId: activeProposalRef.current?.proposalId,
        });

        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage(vote);
        } else if (event.source && typeof (event.source as ServiceWorker).postMessage === "function") {
          (event.source as ServiceWorker).postMessage(vote);
        }
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

    // Cross-tab proposal hint & storage barrier listener
    const unsubHint = subscribeProposalHint((proposal) => {
      openActivationBarrier({
        proposalId: proposal.proposalId,
        targetBuild: proposal.targetBuild,
        expiresAt: proposal.expiresAt,
        phase: "preparing",
      });
      if (!activeProposalRef.current) {
        activeProposalRef.current = proposal;
      }
    });

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === PWA_ACTIVATION_PROPOSAL_STORAGE_KEY) {
        if (e.newValue) {
          const prop = getActivationProposal();
          if (prop) {
            openActivationBarrier({
              proposalId: prop.proposalId,
              targetBuild: prop.targetBuild,
              expiresAt: prop.expiresAt,
              phase: "preparing",
            });
          }
        } else if (e.oldValue && !e.newValue) {
          // Storage removal clears matching proposal
          try {
            const oldProp = JSON.parse(e.oldValue) as Partial<ActivationProposal>;
            if (oldProp.proposalId) {
              clearActivationBarrier(oldProp.proposalId, "storage_removed");
            }
          } catch {}
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        registrationRef.current = nextRegistration;
        registration.addEventListener("updatefound", handleUpdateFound);

        if (registration.installing) observeWorker(registration.installing);
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = registration.waiting;
          hasConfirmedMismatchRef.current = true;
          const currentPath = pathnameRef.current;

          const isSafeAndReady =
            isRouteReady({
              pathname: currentPath,
              checkedRevision: checkedRouteRevisionRef.current,
              currentRevision: getRouteRevision(),
              isReactReady: isExplicitRouteReady(currentPath, getRouteRevision()),
              isActivityReady: conversationSnapshotRef.current.ready,
              isNavigationInFlight: isNavigationInFlight(),
            }) && !conversationSnapshotRef.current.isAnyActive;

          dispatchGateState({
            type: "CHECK_RESULT",
            status: "mismatch",
            isSafeAndReady,
          });
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      clearActivationTimer();
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      window.removeEventListener("storage", handleStorageChange);
      unsubHint();
      registration?.removeEventListener("updatefound", handleUpdateFound);
      workerCleanups.forEach((cleanup) => cleanup());
    };
  }, [clearActivationTimer]);

  // 6. Gate History Sentinel with Exact Original URL Restoration
  useEffect(() => {
    if (!isGateActive) {
      if (sentinelPushedRef.current) {
        sentinelPushedRef.current = false;
        sentinelTokenRef.current = null;
      }
      return;
    }

    if (typeof window !== "undefined") {
      const currentFullUrl =
        window.location.pathname + window.location.search + window.location.hash;

      if (!sentinelPushedRef.current) {
        const token =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `gate_${Date.now()}`;
        sentinelTokenRef.current = token;
        originalUrlRef.current = currentFullUrl;
        try {
          window.history.pushState(
            { pwaGateSentinelToken: token, originalUrl: currentFullUrl },
            "",
            currentFullUrl
          );
          sentinelPushedRef.current = true;
        } catch {}
      }

      // Check if location changed away from originalUrl while gate is active
      if (currentFullUrl !== originalUrlRef.current && originalUrlRef.current) {
        revokeRouteReady();
        if (router) {
          try {
            router.replace(originalUrlRef.current);
          } catch {
            window.location.replace(originalUrlRef.current);
          }
        } else {
          window.location.replace(originalUrlRef.current);
        }
        return;
      }
    }

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      // Restore sentinel using forward() without pushing previous URL
      try {
        window.history.forward();
      } catch {
        try {
          window.history.pushState(
            { pwaGateSentinelToken: sentinelTokenRef.current, originalUrl: originalUrlRef.current },
            "",
            originalUrlRef.current
          );
        } catch {}
      }

      setNavWarning("업데이트를 진행해 주세요.");
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_gate_blocked_navigation",
        route: pathnameRef.current,
        currentVersion: BUILD_ID,
      });
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isUpdating || gateState === "VERIFYING_LATEST") {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isGateActive, isModalOpen, gateState, isUpdating, router]);

  const handleBlockedNavigation = useCallback(() => {
    setNavWarning("업데이트를 진행해 주세요.");
    sendPwaUpdateTelemetry({
      eventType: "pwa_update_gate_blocked_navigation",
      route: pathnameRef.current,
      currentVersion: BUILD_ID,
    });
  }, []);

  // Handle '업데이트' or '다시 시도' button click
  const handleUpdateAction = useCallback(async () => {
    if (isUpdating) return;
    clearActivationTimer();

    const currentPath = pathnameRef.current;

    // Retry verify on post-reload error
    if (gateState === "VERIFYING_ERROR") {
      dispatchGateState({ type: "USER_CLICK_RETRY_VERIFY" });
      const marker = getReloadPendingMarker();
      if (marker) {
        void runLatestVerification(marker);
      } else {
        void runLatestVerification({
          proposalId: `verify_${Date.now()}`,
          targetBuild: BUILD_ID,
          startedAt: Date.now(),
        });
      }
      return;
    }

    setIsUpdating(true);

    sendPwaUpdateTelemetry({
      eventType: "pwa_update_clicked",
      route: currentPath,
      currentVersion: BUILD_ID,
    });

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setModalCopyState("offline");
      setIsUpdating(false);
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: currentPath,
        currentVersion: BUILD_ID,
        errorCode: "OFFLINE",
      });
      return;
    }

    dispatchGateState({ type: "USER_CLICK_UPDATE" });

    // Step 2.1: Recheck version via API
    const reCheck = await performClientVersionCheck({ currentVersion: BUILD_ID });

    if (reCheck.status === "network-failure" || reCheck.status === "invalid-response") {
      dispatchGateState({ type: "RECHECK_RESULT", status: reCheck.status });
      setModalCopyState("error");
      setIsUpdating(false);
      sendPwaUpdateTelemetry({
        eventType: "pwa_update_failed",
        route: currentPath,
        currentVersion: BUILD_ID,
        errorCode: reCheck.error || "RECHECK_FAILED",
      });
      return;
    }

    if (reCheck.status === "no-update") {
      const releaseAllowed = canReleaseGateOnNoUpdate(registrationRef.current);
      dispatchGateState({
        type: "RECHECK_RESULT",
        status: "no-update",
        hasWorker: !releaseAllowed,
      });

      if (releaseAllowed) {
        setIsModalOpen(false);
        setIsUpdating(false);
        setModalCopyState("idle");
        hasConfirmedMismatchRef.current = false;
        return;
      }
    }

    const targetBuild = reCheck.metadata?.buildId || reCheck.latestVersion || BUILD_ID;
    targetBuildIdRef.current = targetBuild;

    dispatchGateState({ type: "RECHECK_RESULT", status: "mismatch" });

    sendPwaUpdateTelemetry({
      eventType: "pwa_update_activation_started",
      route: currentPath,
      currentVersion: BUILD_ID,
      latestVersion: targetBuild,
    });

    let registration = registrationRef.current;
    if (!registration && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      registration = (await navigator.serviceWorker.getRegistration()) || null;
    }

    if (registration) {
      try {
        await registration.update();
      } catch {}
    }

    let waitingWorker = registration?.waiting || waitingWorkerRef.current;

    // Step 2.2: Wait boundedly for installing worker if not yet waiting
    if (!waitingWorker && registration) {
      dispatchGateState({ type: "WORKER_FOUND_INSTALLING" });
      const installWait = await waitForInstallingWorker(registration, {
        targetBuildId: targetBuild,
        timeoutMs: 10_000,
        getWorkerBuildId: async (worker) => {
          const identity = await requestSwIdentity(worker);
          return identity?.buildId || null;
        },
      });

      if (installWait.success) {
        waitingWorker = installWait.worker;
        waitingWorkerRef.current = installWait.worker;
        dispatchGateState({ type: "INSTALL_SUCCESS" });
      } else {
        dispatchGateState({ type: "INSTALL_FAILED", reason: installWait.reason });
        setModalCopyState("error");
        setIsUpdating(false);
        sendPwaUpdateTelemetry({
          eventType: "pwa_update_failed",
          route: currentPath,
          currentVersion: BUILD_ID,
          errorCode: `INSTALL_${installWait.reason.toUpperCase()}`,
        });
        return;
      }
    } else if (waitingWorker) {
      dispatchGateState({ type: "WORKER_ALREADY_WAITING" });
    }

    // Step 2.3: Identity Handshake & Create Proposal
    if (waitingWorker) {
      const identity = await requestSwIdentity(waitingWorker);
      if (!identity) {
        dispatchGateState({ type: "ACTIVATION_FAILED", reason: "identity_failed" });
        setModalCopyState("error");
        setIsUpdating(false);
        sendPwaUpdateTelemetry({
          eventType: "pwa_update_failed",
          route: currentPath,
          currentVersion: BUILD_ID,
          errorCode: "IDENTITY_HANDSHAKE_FAILED",
        });
        return;
      }

      const tabId = getOrCreateTabId();
      const proposal = createActivationProposal({
        ownerTabId: tabId,
        targetBuild: identity.buildId,
        workerNonce: identity.workerNonce,
        fromBuild: BUILD_ID,
      });

      if (proposal) {
        activeProposalRef.current = proposal;
        broadcastProposalHint(proposal, tabId);
        dispatchGateState({ type: "START_CONSENSUS" });

        // Set activation timeout (8 seconds)
        activationTimerRef.current = setTimeout(() => {
          if (!controllerChangeHandledRef.current) {
            clearActivationBarrier(proposal.proposalId, "activation_timeout");
            dispatchGateState({ type: "ACTIVATION_FAILED", reason: "timeout" });
            setModalCopyState("delayed");
            setIsUpdating(false);
            sendPwaUpdateTelemetry({
              eventType: "pwa_update_failed",
              route: currentPath,
              currentVersion: BUILD_ID,
              errorCode: "ACTIVATION_TIMEOUT",
            });
          }
        }, PWA_ACTIVATION_DELAY_MS);

        try {
          waitingWorker.postMessage({
            protocol: 1,
            type: "PWA_PREPARE_ACTIVATION",
            requestNonce: crypto.randomUUID(),
            proposal,
          });
        } catch {
          clearActivationTimer();
          clearActivationBarrier(proposal.proposalId, "post_message_error");
          dispatchGateState({ type: "ACTIVATION_FAILED", reason: "post_message_error" });
          setModalCopyState("error");
          setIsUpdating(false);
          sendPwaUpdateTelemetry({
            eventType: "pwa_update_failed",
            route: currentPath,
            currentVersion: BUILD_ID,
            errorCode: "POST_MESSAGE_ERROR",
          });
        }
      } else {
        dispatchGateState({ type: "ACTIVATION_FAILED", reason: "proposal_creation_failed" });
        setModalCopyState("error");
        setIsUpdating(false);
      }
    } else if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      // SW is not controlling the page, perform direct safe hard reload after marker set
      const proposalId = `direct_${Date.now()}`;
      commitActivationBarrier(proposalId);
      setReloadPendingMarker({
        proposalId,
        targetBuild,
        startedAt: Date.now(),
      });
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
      } catch {}
      window.location.reload();
    }
  }, [clearActivationTimer, gateState, isUpdating, runLatestVerification]);

  return (
    <PwaUpdateGateModal
      isOpen={isModalOpen}
      isUpdating={isUpdating}
      updateState={modalCopyState}
      onUpdate={handleTriggerUpdate}
      onBlockedNavigation={handleBlockedNavigation}
      navigationWarning={navWarning}
    />
  );

  function handleTriggerUpdate() {
    void handleUpdateAction();
  }
}
