export type MissionClientScope = {
  actorUserId: string;
  familyId: string;
  childId: string;
  businessDate: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const MISSION_SCOPE_KEY = "k_mission_client_scope";

export async function fetchAuthenticatedChildId(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchImpl("/api/child/me", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`authenticated child ${response.status}`);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || body.id.trim() === "") {
    throw new Error("authenticated child response is invalid");
  }
  return body.id.trim();
}

export function parseMissionClientScope(raw: unknown): MissionClientScope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const context = (raw as Record<string, unknown>).clientContext;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const value = context as Record<string, unknown>;
  if (
    typeof value.actorUserId !== "string"
    || typeof value.familyId !== "string"
    || typeof value.childId !== "string"
    || typeof value.businessDate !== "string"
    || value.actorUserId.trim() === ""
    || value.familyId.trim() === ""
    || value.childId.trim() === ""
    || value.businessDate.trim() === ""
  ) {
    return null;
  }
  return {
    actorUserId: value.actorUserId,
    familyId: value.familyId,
    childId: value.childId,
    businessDate: value.businessDate,
  };
}

export function missionClientScopeKey(scope: MissionClientScope): string {
  return [scope.actorUserId, scope.familyId, scope.childId, scope.businessDate].join(":");
}

export function reconcileMissionClientScope(
  scope: MissionClientScope,
  storage: StorageLike = window.localStorage,
): { changed: boolean; scopeKey: string } {
  const scopeKey = missionClientScopeKey(scope);
  const previousScopeKey = storage.getItem(MISSION_SCOPE_KEY);
  storage.setItem(MISSION_SCOPE_KEY, scopeKey);
  storage.setItem("k_child_id", scope.childId);
  storage.setItem("k_family_id", scope.familyId);
  return { changed: previousScopeKey !== scopeKey, scopeKey };
}
