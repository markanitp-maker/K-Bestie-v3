import type { PendingMissionTurn } from "./pendingTurnStore";
import type { MissionTurnRecoveryState } from "./serverTurnReconciliation";
import { postMissionTurnWithRetry } from "./turnRequest";

export type PendingTurnCommitStatus = "committed" | "not_committed" | "unknown";

type ReconciliationResponse = {
  status?: unknown;
  recoveryState?: unknown;
};

export type PendingTurnReconciliationResult = {
  status: PendingTurnCommitStatus;
  replayAttempted: boolean;
  recoveryState: MissionTurnRecoveryState | null;
};

type ReconcileOptions = {
  pending: PendingMissionTurn;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function parseStatus(value: unknown): PendingTurnCommitStatus {
  return value === "committed" || value === "not_committed" ? value : "unknown";
}

function parseRecoveryState(value: unknown): MissionTurnRecoveryState | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as MissionTurnRecoveryState
    : null;
}

async function fetchServerStatus(
  pending: PendingMissionTurn,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ status: PendingTurnCommitStatus; recoveryState: MissionTurnRecoveryState | null }> {
  try {
    const query = new URLSearchParams({
      sessionId: pending.sessionId,
      clientTurnId: pending.clientTurnId,
      questionId: pending.questionId,
    });
    const response = await fetchImpl(`/api/mission/turn?${query.toString()}`, {
      method: "GET",
      signal,
    });
    if (!response.ok) return { status: "unknown", recoveryState: null };
    const body = await response.json() as ReconciliationResponse;
    return {
      status: parseStatus(body.status),
      recoveryState: parseRecoveryState(body.recoveryState),
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    return { status: "unknown", recoveryState: null };
  }
}

export async function reconcilePendingMissionTurn({
  pending,
  signal,
  fetchImpl = fetch,
}: ReconcileOptions): Promise<PendingTurnReconciliationResult> {
  const initialSnapshot = await fetchServerStatus(pending, signal, fetchImpl);
  if (initialSnapshot.status !== "unknown") {
    return { ...initialSnapshot, replayAttempted: false };
  }

  try {
    await postMissionTurnWithRetry({
      body: { action: "start", ...pending },
      signal,
      maxAttempts: 1,
      maxConflictAttempts: 1,
      fetchImpl,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  }

  const replayedSnapshot = await fetchServerStatus(pending, signal, fetchImpl);
  return { ...replayedSnapshot, replayAttempted: true };
}
