export type PendingMissionTurn = {
  sessionId: string;
  clientTurnId: string;
  questionId: string;
  answerText: string;
  voiceMode: "live" | "stt_tts";
  displaySequence: number;
  createdAt: number;
  scopeKey?: string;
};

const DATABASE_NAME = "k-bestie-mission-recovery";
const STORE_NAME = "pending-turns";
const KEY = "current";
export const PENDING_TURN_TTL_MS = 5 * 60 * 1000;

export function pendingMissionTurnStorageKey(scopeKey?: string): string {
  return scopeKey ? `scope:${scopeKey}` : KEY;
}

export function isPendingMissionTurnExpired(
  turn: PendingMissionTurn,
  now: number = Date.now(),
): boolean {
  return now - turn.createdAt > PENDING_TURN_TTL_MS;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const request = operation(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB operation failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export async function savePendingMissionTurn(turn: PendingMissionTurn): Promise<void> {
  await transaction("readwrite", (store) => store.put(turn, pendingMissionTurnStorageKey(turn.scopeKey)));
}

export async function readPendingMissionTurn(
  scopeKey?: string,
  expectedSessionId?: string,
): Promise<PendingMissionTurn | null> {
  const key = pendingMissionTurnStorageKey(scopeKey);
  const scoped = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(key));
  if (scoped) return scoped;
  if (!scopeKey || !expectedSessionId) return null;

  // Legacy v1 storage used one global key. It may only be adopted when the server-issued
  // current session matches; a pending turn from another account is preserved and ignored.
  const legacy = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(KEY));
  return legacy?.sessionId === expectedSessionId ? legacy : null;
}

export async function clearPendingMissionTurn(clientTurnId: string, scopeKey?: string): Promise<void> {
  const key = pendingMissionTurnStorageKey(scopeKey);
  const current = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(key));
  if (current?.clientTurnId === clientTurnId) {
    await transaction("readwrite", (store) => store.delete(key));
    return;
  }
  if (!scopeKey) return;

  const legacy = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(KEY));
  if (legacy?.clientTurnId === clientTurnId) {
    await transaction("readwrite", (store) => store.delete(KEY));
  }
}
