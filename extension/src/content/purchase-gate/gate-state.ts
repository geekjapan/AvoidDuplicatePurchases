import type { InterventionSource } from "@adp/shared";

const STORAGE_PREFIX = "adp.confirmed_duplicate_cids.";

export type GateStateStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function defaultStore(): GateStateStore | null {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return null;
    return storage;
  } catch {
    // Private mode / blocked storage
    return null;
  }
}

function keyFor(source: InterventionSource): string {
  return STORAGE_PREFIX + source;
}

/** Persist confirmed-duplicate cart cids for purchase-progression surfaces. */
export function writeConfirmedDuplicateCids(
  source: InterventionSource,
  cids: string[],
  store: GateStateStore | null = defaultStore(),
): void {
  if (!store) return;
  const key = keyFor(source);
  const unique = [...new Set(cids.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) {
    try {
      store.removeItem(key);
    } catch {
      // ignore storage failures
    }
    return;
  }
  try {
    store.setItem(key, JSON.stringify(unique));
  } catch {
    // ignore quota / security errors
  }
}

export function readConfirmedDuplicateCids(
  source: InterventionSource,
  store: GateStateStore | null = defaultStore(),
): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(source));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function clearConfirmedDuplicateCids(
  source: InterventionSource,
  store: GateStateStore | null = defaultStore(),
): void {
  writeConfirmedDuplicateCids(source, [], store);
}
