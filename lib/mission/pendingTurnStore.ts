export type PendingMissionTurn = {
  sessionId: string;
  clientTurnId: string;
  questionId: string;
  answerText: string;
  voiceMode: "live" | "stt_tts";
  displaySequence: number;
  createdAt: number;
};

const DATABASE_NAME = "k-bestie-mission-recovery";
const STORE_NAME = "pending-turns";
const KEY = "current";
export const PENDING_TURN_TTL_MS = 15 * 60 * 1000;

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
  await transaction("readwrite", (store) => store.put(turn, KEY));
}

export async function readPendingMissionTurn(): Promise<PendingMissionTurn | null> {
  const turn = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(KEY));
  if (!turn) return null;
  if (Date.now() - turn.createdAt > PENDING_TURN_TTL_MS) {
    await clearPendingMissionTurn(turn.clientTurnId);
    return null;
  }
  return turn;
}

export async function clearPendingMissionTurn(clientTurnId: string): Promise<void> {
  const current = await transaction<PendingMissionTurn | undefined>("readonly", (store) => store.get(KEY));
  if (!current || current.clientTurnId !== clientTurnId) return;
  await transaction("readwrite", (store) => store.delete(KEY));
}
