/** Payload emitted when a sync outcome is persisted with ok === true. */
export interface SyncSuccessPayload {
  source: string;
  outcome: {
    ok: true;
    counts: { inserted: number; updated: number };
    error: null;
    fetched: number | null;
    recordedAt: string;
  };
}

export type SyncSuccessListener = (payload: SyncSuccessPayload) => void;

const listeners = new Set<SyncSuccessListener>();

/** Subscribe to successful sync outcomes. Returns an unsubscribe function. */
export function subscribeSyncSuccess(listener: SyncSuccessListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers; listener failures must not propagate. */
export function dispatchSyncSuccess(payload: SyncSuccessPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // Sync persistence must not depend on export or other side effects.
    }
  }
}

/** Test-only reset. */
export function clearSyncSuccessListeners(): void {
  listeners.clear();
}
