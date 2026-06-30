import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";

const SYNC_STATE_PREFIX = "roamie:travel-pref-sync";

export type TravelPrefSyncState = {
  pendingSync: boolean;
  syncedAt: string | null;
  lastAttemptAt: string | null;
  travelStyleName: string | null;
};

let memorySyncState: { userId: string; state: TravelPrefSyncState } | null = null;

const DEFAULT_SYNC_STATE: TravelPrefSyncState = {
  pendingSync: false,
  syncedAt: null,
  lastAttemptAt: null,
  travelStyleName: null,
};

function syncStateKey(userId: string): string {
  return `${SYNC_STATE_PREFIX}:${userId}`;
}

function normalizeSyncState(raw: Partial<TravelPrefSyncState> | null | undefined): TravelPrefSyncState {
  return {
    pendingSync: Boolean(raw?.pendingSync),
    syncedAt: raw?.syncedAt ?? null,
    lastAttemptAt: raw?.lastAttemptAt ?? null,
    travelStyleName: raw?.travelStyleName?.trim() || null,
  };
}

export function readTravelPrefSyncState(userId?: string | null): TravelPrefSyncState {
  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  if (!uid) return { ...DEFAULT_SYNC_STATE };

  if (memorySyncState?.userId === uid) {
    return memorySyncState.state;
  }

  if (typeof window === "undefined") return { ...DEFAULT_SYNC_STATE };

  try {
    const raw = localStorage.getItem(syncStateKey(uid));
    if (!raw) return { ...DEFAULT_SYNC_STATE };
    const parsed = normalizeSyncState(JSON.parse(raw) as Partial<TravelPrefSyncState>);
    memorySyncState = { userId: uid, state: parsed };
    return parsed;
  } catch {
    return { ...DEFAULT_SYNC_STATE };
  }
}

function writeTravelPrefSyncState(userId: string, state: TravelPrefSyncState): void {
  memorySyncState = { userId, state };
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(syncStateKey(userId), JSON.stringify(state));
  } catch {
    // ignore quota errors; memory cache still valid this session
  }
}

export function markTravelPrefPendingSync(
  userId: string,
  travelStyleName?: string | null,
): TravelPrefSyncState {
  const prev = readTravelPrefSyncState(userId);
  const next: TravelPrefSyncState = {
    ...prev,
    pendingSync: true,
    syncedAt: null,
    travelStyleName: travelStyleName?.trim() || prev.travelStyleName,
  };
  writeTravelPrefSyncState(userId, next);
  return next;
}

export function markTravelPrefSyncSuccess(userId: string): TravelPrefSyncState {
  const syncedAt = new Date().toISOString();
  const next: TravelPrefSyncState = {
    ...readTravelPrefSyncState(userId),
    pendingSync: false,
    syncedAt,
    lastAttemptAt: syncedAt,
  };
  writeTravelPrefSyncState(userId, next);
  return next;
}

export function markTravelPrefSyncAttempt(userId: string): TravelPrefSyncState {
  const next: TravelPrefSyncState = {
    ...readTravelPrefSyncState(userId),
    lastAttemptAt: new Date().toISOString(),
  };
  writeTravelPrefSyncState(userId, next);
  return next;
}

export function shouldScheduleTravelPrefSync(userId?: string | null): boolean {
  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  if (!uid) return false;
  const state = readTravelPrefSyncState(uid);
  return state.pendingSync && !state.syncedAt;
}

export function resetTravelPrefSyncMemory(): void {
  memorySyncState = null;
}

export function resetTravelPrefSyncState(userId?: string | null): void {
  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  if (!uid) {
    resetTravelPrefSyncMemory();
    return;
  }
  resetTravelPrefSyncMemory();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(syncStateKey(uid));
  } catch {
    // ignore
  }
}
