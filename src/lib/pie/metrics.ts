/**
 * PIE Metrics（Phase 1 Step B）
 *
 * 追蹤經 places-gateway 的呼叫，方便確認是否真正經過 PIE，
 * 以及 ON/OFF 路徑、latency、cache、fallback。
 *
 * 不改變 Places 商業邏輯；不主動發起 HTTP。
 * HTTP 次數為「推斷」：detail/search 在 cache miss 時 +1（與既有行為對齊的觀測值）。
 */

import type { PlacesGatewayPath } from "@/lib/pie/types";

export type PieMetricOp = "search" | "detail" | "image" | "normalize";

export type PieMetricOutcome = "ok" | "empty" | "error" | "fallback";

export type PieCacheSignal = "hit" | "miss" | "unknown";

export type PieMetricEvent = {
  op: PieMetricOp;
  path: PlacesGatewayPath;
  latencyMs: number;
  outcome: PieMetricOutcome;
  cache: PieCacheSignal;
  /** 推斷的 Places HTTP 次數（0 或 1）；不代表真實網路層封包數 */
  httpInferred: number;
  caller?: string;
  at: number;
};

export type PieMetricsSnapshot = {
  totals: {
    search: number;
    detail: number;
    image: number;
    normalize: number;
    cacheHit: number;
    cacheMiss: number;
    httpInferred: number;
    fallback: number;
    error: number;
  };
  byPath: {
    legacy: number;
    pie: number;
  };
  latencyMs: {
    searchSum: number;
    detailSum: number;
    searchCount: number;
    detailCount: number;
  };
  lastEvent: PieMetricEvent | null;
  recent: PieMetricEvent[];
};

const MAX_RECENT = 50;

const snapshot: PieMetricsSnapshot = {
  totals: {
    search: 0,
    detail: 0,
    image: 0,
    normalize: 0,
    cacheHit: 0,
    cacheMiss: 0,
    httpInferred: 0,
    fallback: 0,
    error: 0,
  },
  byPath: { legacy: 0, pie: 0 },
  latencyMs: {
    searchSum: 0,
    detailSum: 0,
    searchCount: 0,
    detailCount: 0,
  },
  lastEvent: null,
  recent: [],
};

export function recordPieMetric(event: Omit<PieMetricEvent, "at"> & { at?: number }): void {
  const full: PieMetricEvent = {
    ...event,
    at: event.at ?? Date.now(),
  };

  snapshot.totals[full.op] += 1;
  snapshot.byPath[full.path] += 1;

  if (full.cache === "hit") snapshot.totals.cacheHit += 1;
  if (full.cache === "miss") snapshot.totals.cacheMiss += 1;
  snapshot.totals.httpInferred += full.httpInferred;
  if (full.outcome === "fallback") snapshot.totals.fallback += 1;
  if (full.outcome === "error") snapshot.totals.error += 1;

  if (full.op === "search") {
    snapshot.latencyMs.searchSum += full.latencyMs;
    snapshot.latencyMs.searchCount += 1;
  }
  if (full.op === "detail") {
    snapshot.latencyMs.detailSum += full.latencyMs;
    snapshot.latencyMs.detailCount += 1;
  }

  snapshot.lastEvent = full;
  snapshot.recent.push(full);
  if (snapshot.recent.length > MAX_RECENT) {
    snapshot.recent.shift();
  }
}

export function getPieMetricsSnapshot(): Readonly<PieMetricsSnapshot> {
  return {
    totals: { ...snapshot.totals },
    byPath: { ...snapshot.byPath },
    latencyMs: { ...snapshot.latencyMs },
    lastEvent: snapshot.lastEvent ? { ...snapshot.lastEvent } : null,
    recent: snapshot.recent.map((e) => ({ ...e })),
  };
}

export function resetPieMetrics(): void {
  snapshot.totals.search = 0;
  snapshot.totals.detail = 0;
  snapshot.totals.image = 0;
  snapshot.totals.normalize = 0;
  snapshot.totals.cacheHit = 0;
  snapshot.totals.cacheMiss = 0;
  snapshot.totals.httpInferred = 0;
  snapshot.totals.fallback = 0;
  snapshot.totals.error = 0;
  snapshot.byPath.legacy = 0;
  snapshot.byPath.pie = 0;
  snapshot.latencyMs.searchSum = 0;
  snapshot.latencyMs.detailSum = 0;
  snapshot.latencyMs.searchCount = 0;
  snapshot.latencyMs.detailCount = 0;
  snapshot.lastEvent = null;
  snapshot.recent.length = 0;
}

export function averageLatencyMs(op: "search" | "detail"): number | null {
  if (op === "search") {
    if (snapshot.latencyMs.searchCount === 0) return null;
    return snapshot.latencyMs.searchSum / snapshot.latencyMs.searchCount;
  }
  if (snapshot.latencyMs.detailCount === 0) return null;
  return snapshot.latencyMs.detailSum / snapshot.latencyMs.detailCount;
}

/** 計時 helper */
export function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
