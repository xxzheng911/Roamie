export type GuardBucket = {
  key: string;
  limit: number;
  delta: number;
  reason: string;
  retryAt: number;
};

export type GuardCommand =
  | { action: "charge"; operationId: string; buckets: GuardBucket[] }
  | { action: "release"; operationId: string };

export type StoredCharge = {
  ok: true;
  reason: "allowed";
  retryAt: 0;
  released: boolean;
  deltas: Array<{ key: string; delta: number }>;
};

export type GuardResult = {
  ok: boolean;
  reason: string;
  retryAt: number;
  replay: boolean;
};

export type CounterStore = {
  get(key: string): number;
  set(key: string, value: number): void;
  getOperation(id: string): StoredCharge | undefined;
  putOperation(id: string, value: StoredCharge): void;
};

/**
 * Synchronous read-modify-write. Callers must serialize access
 * (Durable Object transactionSync, or the in-memory mutex).
 * Denies are not stored, so a later window can accept a retried operation id.
 * Allows are stored until released, so the same paid operation is not counted twice.
 */
export function applyGuardCommand(store: CounterStore, command: GuardCommand): GuardResult {
  if (!command.operationId) return { ok: false, reason: "guard_unavailable", retryAt: 0, replay: false };
  if (command.action === "release") {
    const existing = store.getOperation(command.operationId);
    if (!existing || existing.released) return { ok: true, reason: "released", retryAt: 0, replay: true };
    for (const delta of existing.deltas) {
      store.set(delta.key, Math.max(0, store.get(delta.key) - delta.delta));
    }
    store.putOperation(command.operationId, { ...existing, released: true });
    return { ok: true, reason: "released", retryAt: 0, replay: false };
  }

  const existing = store.getOperation(command.operationId);
  if (existing && !existing.released) {
    return { ok: true, reason: "allowed", retryAt: 0, replay: true };
  }
  if (command.buckets.length === 0) return { ok: false, reason: "guard_unavailable", retryAt: 0, replay: false };

  for (const bucket of command.buckets) {
    if (!Number.isFinite(bucket.limit) || !Number.isFinite(bucket.delta) || bucket.delta <= 0 || bucket.limit < 0) {
      return { ok: false, reason: "guard_unavailable", retryAt: 0, replay: false };
    }
    if (store.get(bucket.key) + bucket.delta > bucket.limit) {
      return { ok: false, reason: bucket.reason, retryAt: bucket.retryAt, replay: false };
    }
  }

  const deltas = command.buckets.map((bucket) => ({ key: bucket.key, delta: bucket.delta }));
  for (const delta of deltas) store.set(delta.key, store.get(delta.key) + delta.delta);
  store.putOperation(command.operationId, {
    ok: true,
    reason: "allowed",
    retryAt: 0,
    released: false,
    deltas,
  });
  return { ok: true, reason: "allowed", retryAt: 0, replay: false };
}
