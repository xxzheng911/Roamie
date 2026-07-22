/**
 * PIE 公開型別：優先 re-export 既有型別，避免 Step A 引入平行模型。
 * 完整 Domain Place Model（RAOS Ch.17）留待後續 Phase。
 */

export type { PlaceLite } from "@/services/placesService";
export type { PlaceResult } from "@/lib/place-result";
export type { PlaceDetailsScreenResult, RawPlaceHours } from "@/lib/places.functions";
export type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";
export type {
  PlaceDetailViewModel,
  PlaceDetailSearch,
  PlaceImageSources,
} from "@/lib/place-detail-resolve";
export type { ImageSource, PlaceImageInput, TripCoverInput } from "@/services/placeImageService";
export type {
  UnifiedPlaceCacheScope,
  UnifiedPlaceDetailsCacheEntry,
  UnifiedPlaceSearchCacheEntry,
} from "@/lib/unified-place-cache";
export type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
export type { Locale } from "@/lib/i18n/types";

/** Facade 能力區塊（文件／驗證用） */
export type PieCapability = "search" | "detail" | "cache" | "image" | "normalize";

/** Gateway 路由路徑 */
export type PlacesGatewayPath = "legacy" | "pie";
