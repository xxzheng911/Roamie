/**
 * Place Intelligence Engine (PIE) — public barrel
 *
 * Phase 1：Facade + Detail Gateway。
 * Planner P3：Planner 候選 Search 經 `wrapPlannerPlaceSearchViaGateway`。
 * Chat / Trip-add / Explore / Home 搜尋路徑暫不遷移。
 */

export {
  isPieFacadeEnabled,
  setPieFacadeEnabledOverride,
  setPieFacadeStorageFlag,
  PIE_FACADE_STORAGE_KEY,
} from "@/lib/pie/feature-flag";

export {
  isPiePlannerSearchEnabled,
  setPiePlannerSearchEnabledOverride,
  setPiePlannerSearchStorageFlag,
  PIE_PLANNER_SEARCH_STORAGE_KEY,
} from "@/lib/pie/feature-flag-planner-search";

export { pieFacade, getPieFacade, type PieFacade } from "@/lib/pie/pie-facade";

export {
  wrapPlannerPlaceSearchViaGateway,
  getPlacesGatewayPlannerSearchStats,
  resetPlacesGatewayPlannerSearchStats,
} from "@/lib/pie/planner-search";

export {
  searchAutocompleteViaGateway,
  searchExploreViaGateway,
  getPlaceLiteDetailsViaGateway,
  fetchPlaceDetailsForScreenViaGateway,
  fetchPlaceDetailsForScreenWithKeyViaGateway,
  fetchPlaceDetailsForIntroViaGateway,
  fetchGooglePlaceDetailsForHandoffViaGateway,
  getPlaceDetailsServerFnViaGateway,
  getPlaceImageViaGateway,
  normalizePlaceViaGateway,
  getPlacesGatewayAutocompleteStats,
  getPlacesGatewayDetailLiteStats,
  resetPlacesGatewayAutocompleteStats,
  resetPlacesGatewayDetailLiteStats,
  getPieGatewayLatencyAverages,
  type PlacesGatewayPath,
} from "@/lib/pie/places-gateway";

export {
  getPieMetricsSnapshot,
  resetPieMetrics,
  recordPieMetric,
  averageLatencyMs,
  type PieMetricEvent,
  type PieMetricsSnapshot,
  type PieMetricOp,
} from "@/lib/pie/metrics";

export type {
  PieCapability,
  PlaceLite,
  PlaceResult,
  PlaceDetailsScreenResult,
  Locale,
} from "@/lib/pie/types";
