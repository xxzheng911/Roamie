/**
 * Recommendation Engine Metrics（R0）
 * 純記憶體計數；不寫入使用者資料。
 */

import type { RecommendationSurface } from "@/lib/recommendation/engine/types";

export type RecEnginePath =
  | "legacy"
  | "engine"
  | "engine_r1_1"
  | "engine_r1_2"
  | "engine_planner_p1"
  | "engine_planner_p2";

export type RecEngineMetricEvent = {
  surface: RecommendationSurface;
  path: RecEnginePath;
  candidateCount: number;
  resultCount: number;
  excludedCount: number;
  latencyMs: number;
  at: number;
};

type RecEngineMetricsState = {
  events: RecEngineMetricEvent[];
  byPath: {
    legacy: number;
    engine: number;
    engine_r1_1: number;
    engine_r1_2: number;
    engine_planner_p1: number;
    engine_planner_p2: number;
  };
  lastPath: RecEnginePath | null;
  lastSurface: RecommendationSurface | null;
};

const state: RecEngineMetricsState = {
  events: [],
  byPath: {
    legacy: 0,
    engine: 0,
    engine_r1_1: 0,
    engine_r1_2: 0,
    engine_planner_p1: 0,
    engine_planner_p2: 0,
  },
  lastPath: null,
  lastSurface: null,
};

const MAX_EVENTS = 50;

export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function recordRecEngineMetric(
  event: Omit<RecEngineMetricEvent, "at"> & { at?: number },
): void {
  const full: RecEngineMetricEvent = {
    ...event,
    at: event.at ?? Date.now(),
  };
  state.events.push(full);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  state.byPath[full.path] += 1;
  state.lastPath = full.path;
  state.lastSurface = full.surface;
}

export function getRecEngineMetrics(): Readonly<{
  byPath: {
    legacy: number;
    engine: number;
    engine_r1_1: number;
    engine_r1_2: number;
    engine_planner_p1: number;
    engine_planner_p2: number;
  };
  lastPath: RecEnginePath | null;
  lastSurface: RecommendationSurface | null;
  recent: readonly RecEngineMetricEvent[];
}> {
  return {
    byPath: { ...state.byPath },
    lastPath: state.lastPath,
    lastSurface: state.lastSurface,
    recent: [...state.events],
  };
}

export function resetRecEngineMetrics(): void {
  state.events.length = 0;
  state.byPath.legacy = 0;
  state.byPath.engine = 0;
  state.byPath.engine_r1_1 = 0;
  state.byPath.engine_r1_2 = 0;
  state.byPath.engine_planner_p1 = 0;
  state.byPath.engine_planner_p2 = 0;
  state.lastPath = null;
  state.lastSurface = null;
}
