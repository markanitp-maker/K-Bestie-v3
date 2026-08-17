"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  PWA_ACTIVATION_DELAY_MS,
  RELOAD_PENDING_MARKER_TTL_MS,
  ReloadPendingMarkerV3,
  canDismissPwaModal,
  pwaUpdateCopy,
  performRegistrationUpdate,
  saveReloadPendingMarker,
  getReloadPendingMarker,
  clearReloadPendingMarker,
  verifyLatestHandshake,
} from "@/lib/pwa/updateFlow";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";
import {
  areLatestVersionMetadataEqual,
  fetchLatestVersionMetadataV1,
  normalizeScriptUrlPath,
  type LatestVersionMetadataV1,
} from "@/lib/pwa/clientVersion";
import {
  createPwaGateHistoryState,
  getDocumentDeploymentMarker,
  isOwnedPwaGateHistoryState,
} from "@/lib/pwa/documentDeployment";
import {
  getRouteReadinessSnapshot,
  isCurrentRouteSafeAndReady,
  isSafeRoutePath,
  normalizeRoutePath,
  subscribeRouteReadiness,
} from "@/lib/pwa/routeReadiness";
import {
  getConversationActivitySnapshot,
  isActivationBarrierActive,
  isConversationActive,
  openActivationBarrier,
  commitActivationBarrier,
  abortActivationBarrier,
  clearActivationBarrier,
} from "@/lib/pwa/conversationActivity";
import {
  evaluateTabVote,
  isPwaTabPrepareRequest,
  isPwaActivationCommittedNotice,
  isPwaActivationAbortedNotice,
  createActivationProposal,
  getOrCreateTabId,
} from "@/lib/pwa/tabUpdateConsensus";
import {
  requestServiceWorkerIdentity,
  requestActivationViaChannel,
  waitForControllerIdentity,
  type ServiceWorkerIdentity,
} from "@/lib/pwa/swProtocol";
import {
  subscribeStaleRecovery,
  StaleRecoverySignal,
  saveExternalControllerPending,
  getExternalControllerPending,
  clearExternalControllerPending,
  ExternalControllerPendingV1,
} from "@/lib/pwa/recoveryCoordinator";

export type PwaState =
  | "idle"
  | "checking"
  | "verifying_latest"
  | "update_available"
  | "deferred_during_session"
  | "activating"
  | "delayed"
  | "offline"
  | "reloading"
  | "up_to_date"
  | "error";

export type SafeCheckTrigger =
  | "mount_ready"
  | "route_ready"
  | "visibility_visible"
  | "online"
  | "periodic_timer"
  | "manual_retry";

const BUILD_ID = BUILD_STAMP;
const PERIODIC_CHECK_INTERVAL_MS = 60 * 60 * 1_000; // 60 minutes
const MIN_CHECK_THROTTLE_MS = 5_000; // 5 seconds between auto checks

function debugLog(event: string, extra?: unknown) {
  if (process.env.NODE_ENV !== "production") {
    if (extra !== undefined) console.info(`[PWA] ${event}`, extra);
    else console.info(`[PWA] ${event}`);
  }
}

export function PwaServiceWorker() {
  const router = useRouter();
  const [pwaState, setPwaState] = useState<PwaState>("idle");
  const [dismissed, setDismissed] = useState(false);
  const [navigationBlockedNotice, setNavigationBlockedNotice] = useState(false);
  const pathname = usePathname() ?? "";
  const pathnameRef = useRef(pathname);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const activationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadIssuedRef = useRef(false);
  const lastCheckAtRef = useRef(0);
  const checkInFlightRef = useRef(false);
  const manualUpdateInFlightRef = useRef(false);
  const pwaStateRef = useRef<PwaState>("idle");
  const updateReasonRef = useRef<string>("user_update");
  const installedTargetRef = useRef<{
    worker: ServiceWorker;
    identity: ServiceWorkerIdentity;
    targetSnapshot: Readonly<LatestVersionMetadataV1>;
  } | null>(null);
  const modalTargetRef = useRef<Readonly<LatestVersionMetadataV1> | null>(null);
  const reportedSuccessEventIdsRef = useRef<Set<string>>(new Set());

  // Expected activation tracking refs
  const expectedWorkerNonceRef = useRef<string | null>(null);
  const expectedProposalIdRef = useRef<string | null>(null);

  // Component lifecycle abort contract shared across mount & all retries
  const lifecycleAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(false);

  // History lock refs
  const originalUrlRef = useRef<string | null>(null);
  const originalHistoryStateRef = useRef<unknown>(null);
  const activeGateTokenRef = useRef<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    pwaStateRef.current = pwaState;
  }, [pwaState]);

  const clearActivationTimer = useCallback(() => {
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current);
      activationTimerRef.current = null;
    }
  }, []);

  const reloadPageOnce = useCallback(() => {
    if (reloadIssuedRef.current) return;
    reloadIssuedRef.current = true;
    window.location.reload();
  }, []);

  const scheduleDelayedState = useCallback(() => {
    clearActivationTimer();
    activationTimerRef.current = setTimeout(() => {
      activationTimerRef.current = null;
      setPwaState((current) => {
        if (current !== "activating") return current;
        debugLog("activation_delayed");
        return "delayed";
      });
    }, PWA_ACTIVATION_DELAY_MS);
  }, [clearActivationTimer]);

  // -------------------------------------------------------------
  // Post-Reload Latest Verification Handshake
  // -------------------------------------------------------------
  const performPostReloadVerification = useCallback(
    async (
      marker: ReloadPendingMarkerV3,
      options?: { signal?: AbortSignal; isMounted?: () => boolean }
    ) => {
      const signal = options?.signal ?? lifecycleAbortControllerRef.current?.signal;
      const isMountedCheck = options?.isMounted ?? (() => isMountedRef.current);
      const isAborted = () =>
        Boolean(signal?.aborted || !isMountedCheck());

      if (isAborted()) return;

      setPwaState("verifying_latest");
      debugLog("post_reload_verification_started", { marker });

      const latestResult = await fetchLatestVersionMetadataV1();
      if (isAborted()) return;

      if (!latestResult.ok) {
        if (isAborted()) return;
        setPwaState(
          (latestResult.code === "network" || latestResult.code === "timeout") &&
            !navigator.onLine
            ? "offline"
            : "error",
        );
        return;
      }

      const { controller, identity: controllerIdentity } = await waitForControllerIdentity({
        expectedBuildId: marker.target.buildId,
        expectedSwVersion: marker.target.swVersion,
        timeoutMs: 2500,
        signal,
      });

      if (isAborted()) return;

      const handshakeResult = verifyLatestHandshake({
        marker,
        serverMetadata: latestResult.snapshot,
        documentMarker: getDocumentDeploymentMarker(),
        controllerIdentity,
        controllerScriptUrl: controller?.scriptURL,
      });

      debugLog("post_reload_verification_result", handshakeResult);

      if (isAborted()) return;

      if (handshakeResult.ok) {
        // Handshake succeeded! Emit success telemetry using marker's successEventId
        try {
          if (reportedSuccessEventIdsRef.current.has(marker.successEventId)) {
            if (isAborted()) return;
            clearReloadPendingMarker();
            setPwaState("up_to_date");
            return;
          }
          reportedSuccessEventIdsRef.current.add(marker.successEventId);
          const eventType =
            marker.reason === "stale_asset_recovery"
              ? "pwa_stale_client_recovery_success"
              : "pwa_update_success";

          if (isAborted()) return;

          void fetch("/api/analytics/pwa-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event_id: marker.successEventId,
              event_type: eventType,
              correlation_id: marker.proposalId,
              route: pathnameRef.current || "/",
              current_version: BUILD_ID,
              latest_version: marker.target.buildId,
            }),
          }).catch(() => {});
        } catch {}

        if (isAborted()) return;

        // Clear local marker and unlock gate
        clearReloadPendingMarker();
        setPwaState("up_to_date");
      } else {
        if (isAborted()) return;
        // Retain marker & gate; allow retry
        if (handshakeResult.status === "network_error") {
          setPwaState("offline");
        } else {
          setPwaState("error");
        }
      }
    },
    []
  );

  // -------------------------------------------------------------
  // Consume Pending External Controller when Safe & Ready
  // -------------------------------------------------------------
  const consumeExternalControllerPendingIfSafe = useCallback(async (): Promise<boolean> => {
    const pending = getExternalControllerPending();
    if (!pending) return false;

    const currentPath = pathnameRef.current;
    if (
      !isSafeRoutePath(currentPath) ||
      !isCurrentRouteSafeAndReady(currentPath) ||
      isConversationActive() ||
      getConversationActivitySnapshot().hazardsCount > 0
    ) {
      return false;
    }

    debugLog("consuming_external_controller_pending", { pending, currentPath });

    const latestResult = await fetchLatestVersionMetadataV1();

    const controller =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.controller
        : null;

    const controllerIdentity = controller ? await requestServiceWorkerIdentity(controller, 1500).catch(() => null) : null;
    const documentMarker = getDocumentDeploymentMarker();

    try {
      if (!latestResult.ok) {
        debugLog("consume_pending_network_error");
        clearActivationBarrier();
        setPwaState(
          (latestResult.code === "network" || latestResult.code === "timeout") &&
            !navigator.onLine
            ? "offline"
            : "error",
        );
        return true;
      }

      const target = latestResult.snapshot;
      const isExactMatch = Boolean(
        documentMarker &&
          documentMarker.buildId === target.buildId &&
          documentMarker.buildStamp === target.buildStamp &&
          documentMarker.deploymentId === target.deploymentId &&
          controller &&
          controllerIdentity?.protocolVersion === 1 &&
          typeof controllerIdentity.workerNonce === "string" &&
          controllerIdentity.workerNonce.trim() &&
          controllerIdentity.buildId === target.buildId &&
          controllerIdentity.swVersion === target.swVersion &&
          normalizeScriptUrlPath(controller.scriptURL) ===
            target.serviceWorkerScriptUrl,
      );

      if (isExactMatch) {
        debugLog("consume_pending_complete_match");
        clearExternalControllerPending();
        clearActivationBarrier();
        setPwaState("up_to_date");
      } else {
        debugLog("consume_pending_mismatch_opening_modal", {
          documentMarker,
          target,
          controllerIdentity,
        });
        clearActivationBarrier();
        setPwaState("error");
      }
      return true;
    } finally {
      clearActivationBarrier();
    }
  }, []);

  // -------------------------------------------------------------
  // Safe Check Scheduler
  // -------------------------------------------------------------
  const maybeScheduleSafeCheck = useCallback(
    async (trigger: SafeCheckTrigger, routeRevision?: number): Promise<boolean> => {
      const now = Date.now();
      const currentPath = pathnameRef.current;

      // 1. Connectivity check
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        debugLog("safe_check_skipped_offline", { trigger });
        return false;
      }

      // 2. Unsafe route check (unsafe routes make 0 network checks for auto triggers)
      if (!isSafeRoutePath(currentPath)) {
        debugLog("safe_check_skipped_unsafe_route", { trigger, currentPath });
        return false;
      }

      // 3. Route readiness & conversation activity check
      if (!isCurrentRouteSafeAndReady(currentPath)) {
        debugLog("safe_check_skipped_route_not_ready", { trigger, currentPath });
        return false;
      }

      // 4. Barrier active check
      if (isActivationBarrierActive()) {
        debugLog("safe_check_skipped_barrier_active", { trigger });
        return false;
      }

      // 5. Manual update check
      if (manualUpdateInFlightRef.current) {
        debugLog("safe_check_skipped_manual_update", { trigger });
        return false;
      }

      // 6. In-flight check
      if (checkInFlightRef.current) {
        debugLog("safe_check_skipped_in_flight", { trigger });
        return false;
      }

      // 7. Throttle check
      const isThrottledTrigger =
        trigger === "visibility_visible" ||
        trigger === "online" ||
        trigger === "periodic_timer";

      if (isThrottledTrigger && now - lastCheckAtRef.current < MIN_CHECK_THROTTLE_MS) {
        debugLog("safe_check_throttled", { trigger });
        return false;
      }

      // Check for pending external controller change first
      if (getExternalControllerPending()) {
        const consumed = await consumeExternalControllerPendingIfSafe();
        if (consumed) return true;
      }

      const registration = registrationRef.current;
      if (!registration) {
        return false;
      }

      // Pre-check snapshot
      const snapshotBefore = getRouteReadinessSnapshot();
      const checkedRevision = routeRevision !== undefined ? routeRevision : snapshotBefore.routeRevision;
      const checkedPath = currentPath;

      checkInFlightRef.current = true;
      lastCheckAtRef.current = now;
      debugLog("safe_check_started", { trigger, checkedRevision, checkedPath });

      try {
        const latestResult = await fetchLatestVersionMetadataV1();
        if (!latestResult.ok) {
          debugLog("safe_check_latest_failed", latestResult.code);
          setPwaState(
            latestResult.code === "network" || latestResult.code === "timeout"
              ? navigator.onLine
                ? "error"
                : "offline"
              : "error",
          );
          return true;
        }

        const documentMarker = getDocumentDeploymentMarker();
        const activeController = navigator.serviceWorker.controller;
        const activeIdentity = activeController
          ? await requestServiceWorkerIdentity(activeController, 1_500).catch(
              () => null,
            )
          : null;
        const currentDeploymentMatches = Boolean(
          documentMarker &&
            documentMarker.buildId === latestResult.snapshot.buildId &&
            documentMarker.buildStamp === latestResult.snapshot.buildStamp &&
            documentMarker.deploymentId === latestResult.snapshot.deploymentId &&
            activeController &&
            activeIdentity?.protocolVersion === 1 &&
            activeIdentity.buildId === latestResult.snapshot.buildId &&
            activeIdentity.swVersion === latestResult.snapshot.swVersion &&
            normalizeScriptUrlPath(activeController.scriptURL) ===
              latestResult.snapshot.serviceWorkerScriptUrl,
        );
        if (currentDeploymentMatches && !registration.waiting) {
          installedTargetRef.current = null;
          modalTargetRef.current = null;
          setPwaState("idle");
          return true;
        }

        const updateOutcome = await performRegistrationUpdate({
          registration,
          targetSnapshot: latestResult.snapshot,
        });

        // Post-check validation
        const snapshotAfter = getRouteReadinessSnapshot();
        const currentPathAfter = pathnameRef.current;

        if (
          snapshotAfter.routeRevision !== checkedRevision ||
          normalizeRoutePath(currentPathAfter) !== normalizeRoutePath(checkedPath)
        ) {
          debugLog("safe_check_discarded_route_drift", {
            checkedRevision,
            currentRevision: snapshotAfter.routeRevision,
            checkedPath,
            currentPathAfter,
          });
          return false;
        }

        if (!isCurrentRouteSafeAndReady(currentPathAfter)) {
          debugLog("safe_check_discarded_not_ready_after_update");
          return false;
        }

        if (isActivationBarrierActive() || isConversationActive()) {
          debugLog("safe_check_discarded_hazard_active");
          return false;
        }

        if (
          updateOutcome.result === "installed-target" &&
          updateOutcome.worker &&
          updateOutcome.identity &&
          updateOutcome.targetSnapshot
        ) {
          waitingWorkerRef.current = updateOutcome.worker;
          installedTargetRef.current = {
            worker: updateOutcome.worker,
            identity: updateOutcome.identity,
            targetSnapshot: updateOutcome.targetSnapshot,
          };
          modalTargetRef.current = updateOutcome.targetSnapshot;
          setPwaState("update_available");
        } else if (updateOutcome.result === "no-update") {
          installedTargetRef.current = null;
          modalTargetRef.current = null;
          setPwaState("idle");
        } else {
          installedTargetRef.current = null;
          setPwaState(
            updateOutcome.result === "network-error" && !navigator.onLine
              ? "offline"
              : "error",
          );
        }

        return true;
      } catch (err) {
        debugLog("safe_check_failed", err);
        return false;
      } finally {
        checkInFlightRef.current = false;
      }
    },
    [consumeExternalControllerPendingIfSafe]
  );

  // -------------------------------------------------------------
  // Trigger Update / Consensus / Activation Orchestration
  // -------------------------------------------------------------
  const runTriggeredUpdate = useCallback(async () => {
    clearActivationTimer();
    if (!navigator.onLine) {
      setPwaState("offline");
      return;
    }

    const registration =
      registrationRef.current ?? (await navigator.serviceWorker?.getRegistration());
    if (!registration) {
      setPwaState("error");
      return;
    }
    registrationRef.current = registration;

    // Check if there is an unresolved reload pending marker (retry path)
    const existingMarker = getReloadPendingMarker();
    if (existingMarker) {
      await performPostReloadVerification(existingMarker, {
        signal: lifecycleAbortControllerRef.current?.signal,
        isMounted: () => isMountedRef.current,
      });
      return;
    }

    // If external controller pending exists, consume it
    if (getExternalControllerPending()) {
      const consumed = await consumeExternalControllerPendingIfSafe();
      if (consumed && !getExternalControllerPending()) return;
    }

    setPwaState("checking");

    const latestResult = await fetchLatestVersionMetadataV1();
    if (!latestResult.ok) {
      setPwaState(
        (latestResult.code === "network" || latestResult.code === "timeout") &&
          !navigator.onLine
          ? "offline"
          : "error",
      );
      return;
    }

    const clickSnapshot = latestResult.snapshot;
    if (!areLatestVersionMetadataEqual(modalTargetRef.current, clickSnapshot)) {
      installedTargetRef.current = null;
      waitingWorkerRef.current = null;
      modalTargetRef.current = clickSnapshot;
      expectedWorkerNonceRef.current = null;
      expectedProposalIdRef.current = null;
      clearReloadPendingMarker();
    }

    const updateOutcome = await performRegistrationUpdate({
      registration,
      targetSnapshot: clickSnapshot,
    });

    if (updateOutcome.result === "network-error") {
      setPwaState(navigator.onLine ? "error" : "offline");
      return;
    }

    if (
      updateOutcome.result === "install-timeout" ||
      updateOutcome.result === "redundant" ||
      updateOutcome.result === "target-replaced" ||
      updateOutcome.result === "identity-mismatch"
    ) {
      setPwaState("error");
      return;
    }

    if (updateOutcome.result === "no-update") {
      setPwaState("idle");
      return;
    }

    // The exact click snapshot, worker object, script, identity, and nonce are required.
    if (
      updateOutcome.result !== "installed-target" ||
      !updateOutcome.worker ||
      !updateOutcome.identity ||
      typeof updateOutcome.identity.workerNonce !== "string" ||
      !updateOutcome.identity.workerNonce.trim() ||
      !updateOutcome.targetSnapshot ||
      registration.waiting !== updateOutcome.worker ||
      !areLatestVersionMetadataEqual(updateOutcome.targetSnapshot, clickSnapshot)
    ) {
      setPwaState("error");
      return;
    }

    const targetWorker = updateOutcome.worker;
    waitingWorkerRef.current = targetWorker;
    installedTargetRef.current = {
      worker: targetWorker,
      identity: updateOutcome.identity,
      targetSnapshot: updateOutcome.targetSnapshot,
    };
    modalTargetRef.current = updateOutcome.targetSnapshot;
    const currentPath = pathnameRef.current;

    if (!isSafeRoutePath(currentPath) || isConversationActive()) {
      setPwaState("deferred_during_session");
      return;
    }

    const ownerTabId = getOrCreateTabId();
    const targetBuild = updateOutcome.targetSnapshot.buildId;
    const targetSwVersion = updateOutcome.targetSnapshot.swVersion;
    const workerNonce = updateOutcome.identity.workerNonce;

    const proposal = createActivationProposal({
      ownerTabId,
      targetBuild,
      targetSwVersion,
      workerNonce,
      fromBuild: BUILD_ID,
    });

    if (!proposal) {
      setPwaState("error");
      return;
    }

    openActivationBarrier(proposal, "preparing");

    const successEventId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "";
    if (!successEventId) {
      abortActivationBarrier(proposal.proposalId);
      setPwaState("error");
      return;
    }

    const markerStartedAt = Date.now();
    const marker: ReloadPendingMarkerV3 = {
      schemaVersion: 3,
      proposalId: proposal.proposalId,
      target: { ...updateOutcome.targetSnapshot },
      activationWorkerNonce: workerNonce,
      successEventId,
      documentBuildStampBeforeReload: BUILD_STAMP,
      startedAt: markerStartedAt,
      expiresAt: markerStartedAt + RELOAD_PENDING_MARKER_TTL_MS,
      reason: updateReasonRef.current || "user_update",
    };

    const saved = saveReloadPendingMarker(marker);
    const readBackMarker = saved
      ? getReloadPendingMarker(undefined, markerStartedAt)
      : null;
    const markerReadBackMatches = Boolean(
      readBackMarker &&
        readBackMarker.proposalId === marker.proposalId &&
        readBackMarker.activationWorkerNonce === workerNonce &&
        readBackMarker.successEventId === successEventId &&
        areLatestVersionMetadataEqual(readBackMarker.target, clickSnapshot),
    );

    if (!markerReadBackMatches) {
      clearReloadPendingMarker();
      abortActivationBarrier(proposal.proposalId);
      expectedWorkerNonceRef.current = null;
      expectedProposalIdRef.current = null;
      setPwaState("error");
      return;
    }

    expectedWorkerNonceRef.current = workerNonce;
    expectedProposalIdRef.current = proposal.proposalId;
    setPwaState("activating");
    scheduleDelayedState();

    try {
      const activationResult = await requestActivationViaChannel(targetWorker, proposal);

      if (
        activationResult.ok &&
        activationResult.workerNonce === workerNonce
      ) {
        commitActivationBarrier(proposal.proposalId);
        setPwaState("reloading");
        reloadPageOnce();
      } else {
        const currentMarker = getReloadPendingMarker();
        if (currentMarker?.proposalId === proposal.proposalId) {
          clearReloadPendingMarker();
        }
        abortActivationBarrier(proposal.proposalId);
        expectedWorkerNonceRef.current = null;
        expectedProposalIdRef.current = null;
        setPwaState("error");
      }
    } catch {
      const currentMarker = getReloadPendingMarker();
      if (currentMarker?.proposalId === proposal.proposalId) {
        clearReloadPendingMarker();
      }
      abortActivationBarrier(proposal.proposalId);
      expectedWorkerNonceRef.current = null;
      expectedProposalIdRef.current = null;
      setPwaState("error");
    }
  }, [
    clearActivationTimer,
    consumeExternalControllerPendingIfSafe,
    performPostReloadVerification,
    reloadPageOnce,
    scheduleDelayedState,
  ]);

  const triggerUpdate = useCallback(async () => {
    setDismissed(false);
    if (manualUpdateInFlightRef.current) {
      debugLog("manual_update_skipped_in_flight");
      return;
    }

    manualUpdateInFlightRef.current = true;
    try {
      await runTriggeredUpdate();
    } finally {
      manualUpdateInFlightRef.current = false;
    }
  }, [runTriggeredUpdate]);

  // -------------------------------------------------------------
  // History Lock / Sentinel & Capture Navigation Lock for Central Blocking Modal
  // -------------------------------------------------------------
  const isDismissed = dismissed && canDismissPwaModal(pwaState);
  const isModalOpen =
    !isDismissed &&
    [
      "update_available",
      "checking",
      "activating",
      "delayed",
      "offline",
      "error",
      "verifying_latest",
    ].includes(pwaState);

  useEffect(() => {
    if (!isModalOpen || typeof window === "undefined") {
      activeGateTokenRef.current = null;
      originalUrlRef.current = null;
      originalHistoryStateRef.current = null;
      setNavigationBlockedNotice(false);
      return;
    }

    const currentUrl =
      window.location.pathname + window.location.search + window.location.hash;
    originalUrlRef.current = currentUrl;
    originalHistoryStateRef.current = window.history.state;
    const gateToken =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : null;
    if (!gateToken) {
      debugLog("history_gate_uuid_unavailable");
      return;
    }
    const gateState = createPwaGateHistoryState(gateToken, currentUrl);
    if (!gateState) {
      debugLog("history_gate_state_invalid");
      return;
    }
    activeGateTokenRef.current = gateToken;

    try {
      window.history.pushState(gateState, "", currentUrl);
    } catch {}

    const handlePopState = () => {
      if (activeGateTokenRef.current === gateToken) {
        setNavigationBlockedNotice(true);
        try {
          window.history.forward();
        } catch {}
      }
    };

    const handleClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("button")) return;

      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (anchor) {
        e.preventDefault();
        e.stopPropagation();
        setNavigationBlockedNotice(true);
        return;
      }

      if (!target?.closest?.("[data-pwa-modal-card]")) {
        e.preventDefault();
        e.stopPropagation();
        setNavigationBlockedNotice(true);
      }
    };

    const handleSubmitCapture = (e: SubmitEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setNavigationBlockedNotice(true);
    };

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        setNavigationBlockedNotice(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("click", handleClickCapture, true);
    window.addEventListener("submit", handleSubmitCapture, true);
    window.addEventListener("keydown", handleKeyDownCapture, true);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("click", handleClickCapture, true);
      window.removeEventListener("submit", handleSubmitCapture, true);
      window.removeEventListener("keydown", handleKeyDownCapture, true);

      if (isOwnedPwaGateHistoryState(window.history.state, gateToken)) {
        try {
          window.history.replaceState(
            originalHistoryStateRef.current,
            "",
            currentUrl,
          );
        } catch {}
      }
    };
  }, [isModalOpen]);

  // Watch for programmatic route drift while gate modal is active
  useEffect(() => {
    if (!isModalOpen || !originalUrlRef.current) return;
    const expectedPath = originalUrlRef.current.split("?")[0].split("#")[0];
    if (pathname && normalizeRoutePath(pathname) !== normalizeRoutePath(expectedPath)) {
      debugLog("route_drift_detected_during_gate", { pathname, expectedPath });
      setNavigationBlockedNotice(true);
      router.replace(originalUrlRef.current);
    }
  }, [isModalOpen, pathname, router]);

  // -------------------------------------------------------------
  // Service Worker Registration, Messages & Listeners
  // -------------------------------------------------------------
  useEffect(() => {
    isMountedRef.current = true;
    const abortController = new AbortController();
    lifecycleAbortControllerRef.current = abortController;

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return () => {
        isMountedRef.current = false;
        abortController.abort();
        lifecycleAbortControllerRef.current = null;
      };
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    const workerCleanups: Array<() => void> = [];

    // Check if we just booted from a pending reload marker
    const pendingMarker = getReloadPendingMarker();
    if (pendingMarker) {
      void performPostReloadVerification(pendingMarker, {
        signal: abortController.signal,
        isMounted: () => isMountedRef.current,
      });
    }

    const observeWorker = (worker: ServiceWorker) => {
      const handleStateChange = () => {
        if (disposed) return;
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = worker;
        } else if (worker.state === "redundant" && waitingWorkerRef.current === worker) {
          waitingWorkerRef.current = null;
          if (installedTargetRef.current?.worker === worker) {
            installedTargetRef.current = null;
            modalTargetRef.current = null;
          }
        }
      };
      worker.addEventListener("statechange", handleStateChange);
      workerCleanups.push(() => worker.removeEventListener("statechange", handleStateChange));
      handleStateChange();
    };

    const handleUpdateFound = () => {
      if (registration?.installing) observeWorker(registration.installing);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void maybeScheduleSafeCheck("visibility_visible");
      }
    };

    const handleOnline = () => {
      void maybeScheduleSafeCheck("online");
    };

    // ControllerChange Handler: Strict expected vs unexpected handling
    const handleControllerChange = async () => {
      clearActivationTimer();
      waitingWorkerRef.current = null;

      const isExpected =
        expectedWorkerNonceRef.current !== null &&
        expectedProposalIdRef.current !== null;

      const expectedNonce = expectedWorkerNonceRef.current;
      const expectedProposal = expectedProposalIdRef.current;

      expectedWorkerNonceRef.current = null;
      expectedProposalIdRef.current = null;

      if (isExpected) {
        // Expected transition initiated by this tab
        const marker = getReloadPendingMarker();
        if (
          marker &&
          marker.proposalId === expectedProposal &&
          marker.activationWorkerNonce === expectedNonce &&
          areLatestVersionMetadataEqual(marker.target, modalTargetRef.current)
        ) {
          debugLog("expected_controllerchange_reloading", { marker, expectedNonce });
          setPwaState("reloading");
          reloadPageOnce();
          return;
        } else {
          debugLog("expected_controllerchange_marker_missing");
          if (marker?.proposalId === expectedProposal) {
            clearReloadPendingMarker();
          }
          if (expectedProposal) abortActivationBarrier(expectedProposal);
          setPwaState("error");
          return;
        }
      }

      // Unexpected controllerchange!
      debugLog("unexpected_controllerchange_detected");
      const currentPath = pathnameRef.current;
      const isTabUnsafeOrActive =
        !isSafeRoutePath(currentPath) ||
        !isCurrentRouteSafeAndReady(currentPath) ||
        isConversationActive() ||
        getConversationActivitySnapshot().hazardsCount > 0;

      // Asynchronously fetch controller identity without interrupting conversation
      const controller = navigator.serviceWorker.controller;
      const identity = controller
        ? await requestServiceWorkerIdentity(controller, 1000).catch(() => null)
        : null;

      const pending: ExternalControllerPendingV1 = {
        schemaVersion: 1,
        observedAt: Date.now(),
        controllerBuildId: identity?.buildId ?? null,
        controllerSwVersion: identity?.swVersion ?? null,
        controllerScriptUrl: controller?.scriptURL ?? null,
      };

      saveExternalControllerPending(pending);

      if (isTabUnsafeOrActive) {
        // Active/unsafe tab: ZERO reload, ZERO modal, ZERO barrier.
        // Active session / conversation / turn / reward continue uninterrupted!
        debugLog("unexpected_controllerchange_deferred_on_active_session", { pending });
        return;
      }

      // Safe route and ready: consume pending immediately
      void consumeExternalControllerPendingIfSafe();
    };

    // SW Message Listener for cross-tab consensus & barrier synchronization
    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.protocol === 1 && data.type === "PWA_TAB_PREPARE") {
        if (isPwaTabPrepareRequest(data)) {
          // Synchronously open activation barrier before evaluating vote
          openActivationBarrier(data.proposal, "preparing");

          const vote = evaluateTabVote({
            requestNonce: data.requestNonce,
            passId: data.passId,
            voteNonce: data.voteNonce,
            proposal: data.proposal,
            pathname: pathnameRef.current,
            documentBuildId: BUILD_ID,
            isConversationActive: isConversationActive(),
            hazardsCount: getConversationActivitySnapshot().hazardsCount,
          });

          if (event.source && "postMessage" in event.source) {
            (event.source as { postMessage: (msg: unknown) => void }).postMessage(vote);
          }
        }
      } else if (data.protocol === 1 && data.type === "PWA_ACTIVATION_COMMITTED") {
        if (isPwaActivationCommittedNotice(data)) {
          commitActivationBarrier(data.proposalId);
        }
      } else if (data.protocol === 1 && data.type === "PWA_ACTIVATION_ABORTED") {
        if (isPwaActivationAbortedNotice(data)) {
          abortActivationBarrier(data.proposalId);
        }
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Subscribe to stale recovery coordinator
    const unsubscribeStale = subscribeStaleRecovery((signal: StaleRecoverySignal) => {
      debugLog("stale_recovery_signal_received", signal);
      updateReasonRef.current = "stale_asset_recovery";
      const currentPath = pathnameRef.current;
      if (isSafeRoutePath(currentPath) && isCurrentRouteSafeAndReady(currentPath) && !isConversationActive()) {
        void triggerUpdate();
      } else {
        setPwaState("deferred_during_session");
      }
    });

    // 60-minute periodic timer
    const periodicTimer = setInterval(() => {
      void maybeScheduleSafeCheck("periodic_timer");
    }, PERIODIC_CHECK_INTERVAL_MS);

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
        }

        // Mount-ready initial check
        void maybeScheduleSafeCheck("mount_ready");
      })
      .catch(() => {
        debugLog("registration_failed");
      });

    // Subscribe to route readiness transitions
    const unsubscribeRoute = subscribeRouteReadiness((snapshot) => {
      if (manualUpdateInFlightRef.current) {
        debugLog("route_ready_skipped_manual_update", {
          routeRevision: snapshot.routeRevision,
        });
        return;
      }

      if (snapshot.isRouteReady && !snapshot.isNavigationInFlight) {
        const currentPath = pathnameRef.current;
        if (getExternalControllerPending()) {
          void consumeExternalControllerPendingIfSafe();
        } else if (pwaStateRef.current === "deferred_during_session" && isSafeRoutePath(currentPath) && isCurrentRouteSafeAndReady(currentPath)) {
          if (
            installedTargetRef.current &&
            waitingWorkerRef.current === installedTargetRef.current.worker &&
            waitingWorkerRef.current.state === "installed"
          ) {
            setPwaState("update_available");
          } else {
            void maybeScheduleSafeCheck("route_ready", snapshot.routeRevision);
          }
        } else {
          void maybeScheduleSafeCheck("route_ready", snapshot.routeRevision);
        }
      }
    });

    return () => {
      disposed = true;
      isMountedRef.current = false;
      abortController.abort();
      lifecycleAbortControllerRef.current = null;
      clearActivationTimer();
      clearInterval(periodicTimer);
      unsubscribeRoute();
      unsubscribeStale();
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      registration?.removeEventListener("updatefound", handleUpdateFound);
      workerCleanups.forEach((cleanup) => cleanup());
    };
  }, [
    clearActivationTimer,
    consumeExternalControllerPendingIfSafe,
    maybeScheduleSafeCheck,
    performPostReloadVerification,
    reloadPageOnce,
    triggerUpdate,
  ]);

  useEffect(() => {
    if (
      pwaState === "deferred_during_session" &&
      isSafeRoutePath(pathname) &&
      isCurrentRouteSafeAndReady(pathname)
    ) {
      if (getExternalControllerPending()) {
        void consumeExternalControllerPendingIfSafe();
      } else if (
        installedTargetRef.current &&
        waitingWorkerRef.current === installedTargetRef.current.worker &&
        waitingWorkerRef.current.state === "installed"
      ) {
        setPwaState("update_available");
      }
    } else if (
      pwaState === "update_available" &&
      (!isSafeRoutePath(pathname) || !isCurrentRouteSafeAndReady(pathname))
    ) {
      setPwaState("deferred_during_session");
    }
  }, [consumeExternalControllerPendingIfSafe, pathname, pwaState]);

  if (
    (dismissed && canDismissPwaModal(pwaState)) ||
    ["idle", "up_to_date", "deferred_during_session", "reloading"].includes(pwaState)
  ) {
    return null;
  }

  const copyState: "offline" | "delayed" | "error" =
    pwaState === "offline" ? "offline" : pwaState === "delayed" ? "delayed" : "error";
  const copy = pwaUpdateCopy(copyState);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      data-pwa-modal="true"
      className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-center items-center border border-gray-100"
        data-pwa-modal-card="true"
      >
        <div className="w-12 h-12 rounded-full bg-orange-50 text-[var(--color-k-orange)] flex items-center justify-center text-2xl mb-1">
          ✨
        </div>
        <div>
          <div className="text-[var(--color-k-navy)] font-bold text-lg mb-1.5">
            {pwaState === "verifying_latest"
              ? "새 버전 적용을 확인하고 있어요."
              : pwaState === "checking"
              ? "업데이트를 확인하고 있어요."
              : pwaState === "activating"
              ? "새 버전을 적용하고 있어요."
              : pwaState === "update_available"
              ? "새로운 버전이 준비됐어요."
              : copy.title}
          </div>
          <div className="text-gray-600 text-sm break-keep leading-relaxed">
            {pwaState === "verifying_latest"
              ? "잠시만 기다려 주세요. 최신 화면으로 전환됩니다."
              : pwaState === "checking"
              ? "잠시만 기다려 주세요. 안전하게 업데이트할 수 있는지 확인하고 있어요."
              : pwaState === "activating"
              ? "새 버전으로 앱을 전환하고 있어요..."
              : pwaState === "update_available"
              ? "최신 기능과 안정적인 서비스를 이용하려면 앱을 업데이트해 주세요."
              : copy.body}
          </div>
        </div>

        {navigationBlockedNotice && (
          <div className="w-full bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 text-xs font-semibold animate-pulse">
            업데이트를 진행해 주세요.
          </div>
        )}

        <div className="w-full mt-2 flex flex-col gap-2">
          <button
            onClick={triggerUpdate}
            disabled={
              pwaState === "checking" ||
              pwaState === "activating" ||
              pwaState === "verifying_latest"
            }
            className="w-full py-3.5 px-5 bg-[var(--color-k-orange)] text-white text-base font-bold rounded-xl active:scale-[0.98] transition-transform shadow-md disabled:opacity-60 cursor-pointer"
          >
            {pwaState === "update_available"
              ? "업데이트"
              : pwaState === "checking"
              ? "확인 중..."
              : "다시 업데이트"}
          </button>
          {canDismissPwaModal(pwaState) && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="w-full py-2.5 px-4 text-sm text-gray-500 hover:text-gray-700 font-medium cursor-pointer transition-colors"
            >
              계속 사용하기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
