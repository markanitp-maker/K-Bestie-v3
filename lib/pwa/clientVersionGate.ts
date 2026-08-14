import { PWA_CLIENT_VERSION } from "./clientVersion";

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
  reload?: () => void;
  requestServiceWorkerUpdate?: () => Promise<void>;
};

const RELOAD_GUARD_PREFIX = "k_mission_version_reload:";

export function compareMissionBuildIds(
  clientBuildId: string,
  serverBuildId: string,
): "ready" | "mismatch" {
  return clientBuildId === serverBuildId ? "ready" : "mismatch";
}

async function defaultServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  await registration?.update();
}

export async function ensureMissionClientVersion({
  clientBuildId = PWA_CLIENT_VERSION,
  fetchImpl = fetch,
  sessionStorageImpl = window.sessionStorage,
  reload = () => window.location.reload(),
  requestServiceWorkerUpdate = defaultServiceWorkerUpdate,
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

  const body = await response.json().catch(() => null) as ClientVersionResponse | null;
  if (!body || typeof body.buildId !== "string" || body.buildId.trim() === "") {
    console.error("[Mission] client version response is invalid");
    return { status: "unavailable", serverBuildId: null };
  }

  const serverBuildId = body.buildId.trim();
  const guardKey = `${RELOAD_GUARD_PREFIX}${clientBuildId}:${serverBuildId}`;
  if (compareMissionBuildIds(clientBuildId, serverBuildId) === "ready") {
    sessionStorageImpl.removeItem(guardKey);
    return { status: "ready", serverBuildId };
  }

  if (sessionStorageImpl.getItem(guardKey) === "true") {
    console.error("[Mission] client version mismatch remained after reload", {
      clientBuildId,
      serverBuildId,
    });
    return { status: "update_required", serverBuildId };
  }

  sessionStorageImpl.setItem(guardKey, "true");
  try {
    void requestServiceWorkerUpdate().catch((error: unknown) => {
      console.warn("[Mission] service worker update check failed before reload", error);
    });
  } catch (error) {
    console.warn("[Mission] service worker update check failed before reload", error);
  }
  reload();
  return { status: "reload_started", serverBuildId };
}
