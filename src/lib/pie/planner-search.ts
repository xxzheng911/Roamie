/**
 * PIE Planner Search Gateway（Planner Integration P3.1）
 *
 * 目標管線：
 *   Places → PIE → Recommendation Engine → Recommendation Validator → Planner → Itinerary Validator
 *
 * P3.1 範圍：
 * - Planner 候選 fetch 入口統一經此 wrap（不改 Chat / Trip-add / Explore / Home）
 * - Flag OFF → 直呼注入的 PlaceSearchFn（legacy；保留 unified client fallback）
 * - Flag ON  → 經 Gateway 標記 path=pie；IO 仍委派同一注入函式（行為對齊，可回退）
 *
 * 不做：排序、行程組裝、Recommendation 權重擴充、PIE Quality 新邏輯。
 */

import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import { isPiePlannerSearchEnabled } from "@/lib/pie/feature-flag-planner-search";
import {
  nowMs,
  recordPieMetric,
  type PieMetricOutcome,
} from "@/lib/pie/metrics";
import type { PlacesGatewayPath } from "@/lib/pie/types";

const WRAPPED_MARK = "__roamiePiePlannerSearchWrapped";

type GatewayCallStats = {
  plannerSearch: { legacy: number; pie: number };
  lastPlannerSearchPath: PlacesGatewayPath | null;
};

const gatewayCallStats: GatewayCallStats = {
  plannerSearch: { legacy: 0, pie: 0 },
  lastPlannerSearchPath: null,
};

export function getPlacesGatewayPlannerSearchStats(): Readonly<{
  plannerSearch: { legacy: number; pie: number };
  lastPlannerSearchPath: PlacesGatewayPath | null;
}> {
  return {
    plannerSearch: { ...gatewayCallStats.plannerSearch },
    lastPlannerSearchPath: gatewayCallStats.lastPlannerSearchPath,
  };
}

export function resetPlacesGatewayPlannerSearchStats(): void {
  gatewayCallStats.plannerSearch.legacy = 0;
  gatewayCallStats.plannerSearch.pie = 0;
  gatewayCallStats.lastPlannerSearchPath = null;
}

function isAlreadyWrapped(fn: PlaceSearchFn): boolean {
  return Boolean((fn as PlaceSearchFn & { [WRAPPED_MARK]?: boolean })[WRAPPED_MARK]);
}

function markWrapped(fn: PlaceSearchFn): void {
  Object.defineProperty(fn, WRAPPED_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function searchOutcome(result: {
  places?: unknown[] | null;
  error?: string | null;
}): PieMetricOutcome {
  const empty = !result.places?.length;
  if (result.error) return empty ? "error" : "ok";
  return empty ? "empty" : "ok";
}

/**
 * Planner 候選搜尋唯一 Gateway 入口。
 * 在 `fetchItineraryPlaces` / `prepareDirectItinerarySession` / `generateTripPlanFromStyle`
 * 入口呼叫一次即可；重複 wrap 為 idempotent。
 */
export function wrapPlannerPlaceSearchViaGateway(
  legacySearch: PlaceSearchFn,
): PlaceSearchFn {
  if (isAlreadyWrapped(legacySearch)) return legacySearch;

  const wrapped: PlaceSearchFn = async (args) => {
    const path: PlacesGatewayPath = isPiePlannerSearchEnabled() ? "pie" : "legacy";
    const started = nowMs();

    if (path === "pie") {
      gatewayCallStats.plannerSearch.pie += 1;
      gatewayCallStats.lastPlannerSearchPath = "pie";
    } else {
      gatewayCallStats.plannerSearch.legacy += 1;
      gatewayCallStats.lastPlannerSearchPath = "legacy";
    }

    // P3.1：IO 委派注入的 PlaceSearchFn，保留 Chat 端 createUnifiedSearchPlacesFn 行為。
    // path=pie 僅表示「經 PIE Planner Search Gateway」；後續可在此插入 PIE Search 邏輯。
    const result = await legacySearch(args);

    recordPieMetric({
      op: "search",
      path,
      latencyMs: nowMs() - started,
      outcome: searchOutcome(result),
      cache: "unknown",
      httpInferred: result.places?.length ? 1 : 0,
      caller: "wrapPlannerPlaceSearchViaGateway",
    });

    return result;
  };

  markWrapped(wrapped);
  return wrapped;
}
