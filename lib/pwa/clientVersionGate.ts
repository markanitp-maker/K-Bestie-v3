import { BUILD_STAMP } from "./buildStamp";
import { requestStaleRecovery } from "./recoveryCoordinator";

export type MissionClientVersionGateResult =
  | { status: "ready"; serverBuildId: string }
  | { status: "reload_started"; serverBuildId: string }
  | { status: "update_required"; serverBuildId: string }
  | { status: "unavailable"; serverBuildId: null };

type ClientVersionResponse = {
  buildId?: unknown;
};

type VersionGateOptions = {
  clientBuildId?: string;
  fetchImpl?: typeof fetch;
  sessionStorageImpl?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  requestServiceWorkerUpdate?: () => Promise<void>;
};

export function compareMissionBuildIds(
  clientBuildId: string,
  serverBuildId: string
): "ready" | "mismatch" {
  return clientBuildId === serverBuildId ? "ready" : "mismatch";
}

export async function ensureMissionClientVersion({
  clientBuildId = BUILD_STAMP,
  fetchImpl = fetch,
  requestServiceWorkerUpdate,
}: VersionGateOptions = {}): Promise<MissionClientVersionGateResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/client-version", {
      method: "GET",
      cache: "no-store",
      headers: { "x-k-bestie-client-build": clientBuildId },
    });
  } catch (error) {
    console.error("[Mission] client version check failed", error);
    return { status: "unavailable", serverBuildId: null };
  }

  if (!response.ok) {
    console.error("[Mission] client version endpoint failed", { status: response.status });
    return { status: "unavailable", serverBuildId: null };
  }

  const body = (await response.json().catch(() => null)) as ClientVersionResponse | null;
  if (!body || typeof body.buildId !== "string" || body.buildId.trim() === "") {
    console.error("[Mission] client version response is invalid");
    return { status: "unavailable", serverBuildId: null };
  }

  const serverBuildId = body.buildId.trim();
  if (compareMissionBuildIds(clientBuildId, serverBuildId) === "ready") {
    return { status: "ready", serverBuildId };
  }

  // Version mismatch detected at Mission gate!
  // Delegate update to root orchestrator via recoveryCoordinator signal.
  // 0 direct cache purge, 0 direct reload.
  requestStaleRecovery({
    source: "mission_gate",
    buildId: serverBuildId,
    timestamp: Date.now(),
  });

  if (requestServiceWorkerUpdate) {
    try {
      void requestServiceWorkerUpdate().catch((error: unknown) => {
        console.warn("[Mission] service worker update check failed", error);
      });
    } catch (error) {
      console.warn("[Mission] service worker update check failed", error);
    }
  }

  return { status: "update_required", serverBuildId };
}
