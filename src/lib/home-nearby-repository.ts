/**
 * 首頁／探索共用附近地點 repository（stale-while-revalidate）。
 * 各頁面不各自持有請求狀態；讀寫經由此模組。
 */
import type { HomeNearbyPick } from "@/lib/home-nearby-search";
import { sanitizeHomeNearbyPicksForDisplay } from "@/lib/home-nearby-display";
import {
  readHomeSessionNearbyMeta,
  writeHomeSessionNearbyPicks,
} from "@/lib/home-session-cache";
import {
  readHomeNearbyResultsCacheMeta,
  writeHomeNearbyResultsCache,
} from "@/lib/home-nearby-picks-policy";

export type HomeNearbyLoadFlags = {
  loadingInitial: boolean;
  refreshingInBackground: boolean;
  hasCachedResults: boolean;
  isEmpty: boolean;
  refreshFailed: boolean;
};

export type HomeNearbyRepositorySnapshot = {
  picks: HomeNearbyPick[];
  loadKey: string | null;
  requestKey: string | null;
  flags: HomeNearbyLoadFlags;
  updatedAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: HomeNearbyRepositorySnapshot = (() => {
  const meta = readHomeSessionNearbyMeta();
  const picks = sanitizeHomeNearbyPicksForDisplay(meta.picks, { logDrop: false });
  return {
    picks,
    loadKey: meta.loadKey,
    requestKey: meta.loadKey,
    flags: {
      loadingInitial: picks.length === 0,
      refreshingInBackground: false,
      hasCachedResults: picks.length > 0,
      isEmpty: picks.length === 0,
      refreshFailed: false,
    },
    updatedAt: Date.now(),
  };
})();

function notify(): void {
  for (const listener of listeners) listener();
}

function deriveFlags(
  picks: HomeNearbyPick[],
  patch: Partial<HomeNearbyLoadFlags>,
): HomeNearbyLoadFlags {
  const hasCachedResults = picks.length > 0;
  return {
    loadingInitial: patch.loadingInitial ?? (hasCachedResults ? false : state.flags.loadingInitial),
    refreshingInBackground: patch.refreshingInBackground ?? state.flags.refreshingInBackground,
    hasCachedResults,
    isEmpty: !hasCachedResults && (patch.isEmpty ?? state.flags.isEmpty),
    refreshFailed: patch.refreshFailed ?? false,
  };
}

export function subscribeHomeNearbyRepository(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHomeNearbyRepositorySnapshot(): HomeNearbyRepositorySnapshot {
  return state;
}

/** 探索頁／其他畫面可讀取目前附近結果，避免同定位重複搜尋 */
export function readSharedNearbyPlaces(options?: {
  loadKey?: string | null;
  maxAgeMs?: number;
}): HomeNearbyPick[] | null {
  const maxAgeMs = options?.maxAgeMs ?? 10 * 60 * 1000;
  if (options?.loadKey) {
    const moduleMeta = readHomeNearbyResultsCacheMeta<HomeNearbyPick>(options.loadKey);
    if (moduleMeta && moduleMeta.picks.length > 0) {
      return sanitizeHomeNearbyPicksForDisplay(moduleMeta.picks, { logDrop: false });
    }
  }
  if (state.picks.length === 0) return null;
  if (Date.now() - state.updatedAt > maxAgeMs) return null;
  if (options?.loadKey && state.loadKey && options.loadKey !== state.loadKey) {
    return null;
  }
  return sanitizeHomeNearbyPicksForDisplay(state.picks, { logDrop: false });
}

export function publishHomeNearbyCache(
  picks: HomeNearbyPick[],
  loadKey: string | null,
  coords?: { lat: number; lng: number } | null,
): void {
  const sanitized = sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false });
  if (sanitized.length === 0) return;
  state = {
    picks: sanitized,
    loadKey,
    requestKey: loadKey,
    flags: deriveFlags(sanitized, {
      loadingInitial: false,
      refreshingInBackground: state.flags.refreshingInBackground,
      isEmpty: false,
      refreshFailed: false,
    }),
    updatedAt: Date.now(),
  };
  if (loadKey) writeHomeNearbyResultsCache(loadKey, sanitized);
  writeHomeSessionNearbyPicks(sanitized, loadKey, coords);
  notify();
}

export function publishHomeNearbyFresh(
  picks: HomeNearbyPick[],
  loadKey: string | null,
  coords?: { lat: number; lng: number } | null,
): void {
  const sanitized = sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false });
  if (sanitized.length === 0) {
    if (!state.flags.hasCachedResults) {
      state = {
        ...state,
        picks: [],
        flags: {
          loadingInitial: false,
          refreshingInBackground: false,
          hasCachedResults: false,
          isEmpty: true,
          refreshFailed: false,
        },
        updatedAt: Date.now(),
      };
      notify();
    }
    return;
  }
  state = {
    picks: sanitized,
    loadKey,
    requestKey: loadKey,
    flags: {
      loadingInitial: false,
      refreshingInBackground: false,
      hasCachedResults: true,
      isEmpty: false,
      refreshFailed: false,
    },
    updatedAt: Date.now(),
  };
  if (loadKey) writeHomeNearbyResultsCache(loadKey, sanitized);
  writeHomeSessionNearbyPicks(sanitized, loadKey, coords);
  notify();
}

export function markHomeNearbyLoadingInitial(): void {
  if (state.flags.hasCachedResults) return;
  state = {
    ...state,
    flags: {
      ...state.flags,
      loadingInitial: true,
      isEmpty: false,
      refreshFailed: false,
    },
  };
  notify();
}

export function markHomeNearbyRefreshing(): void {
  state = {
    ...state,
    flags: {
      ...state.flags,
      refreshingInBackground: true,
      refreshFailed: false,
      loadingInitial: state.flags.hasCachedResults ? false : state.flags.loadingInitial,
    },
  };
  notify();
}

export function markHomeNearbyRefreshDone(): void {
  state = {
    ...state,
    flags: {
      ...state.flags,
      refreshingInBackground: false,
      loadingInitial: false,
    },
  };
  notify();
}

/** 刷新失敗：保留舊卡，絕不清空 */
export function markHomeNearbyRefreshFailed(): void {
  state = {
    ...state,
    flags: {
      loadingInitial: false,
      refreshingInBackground: false,
      hasCachedResults: state.picks.length > 0,
      isEmpty: state.picks.length === 0,
      refreshFailed: true,
    },
  };
  notify();
}

export function markHomeNearbyEmpty(): void {
  if (state.picks.length > 0) return;
  state = {
    ...state,
    picks: [],
    flags: {
      loadingInitial: false,
      refreshingInBackground: false,
      hasCachedResults: false,
      isEmpty: true,
      refreshFailed: false,
    },
    updatedAt: Date.now(),
  };
  notify();
}
