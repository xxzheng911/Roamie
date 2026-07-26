import type { PlaceHoursData, PlaceOpenStatus } from "@/lib/filter-available-places";
import type { NormalizedOpeningStatusValue } from "@/lib/normalized-opening-status";
import type { NormalizedOpeningSource } from "@/lib/normalized-opening-status";

/** 探索 / 地圖推薦地點（client-safe，不含 server 依賴） */
export type PlaceResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  primaryType: string | null;
  /** Google Places types（含 primaryType 以外的次要類型） */
  types?: string[] | null;
  businessStatus: string | null;
  openStatus: PlaceOpenStatus;
  openStatusLabel: string;
  todayHoursLabel: string;
  closingSoonNote: string;
  nextOpenHint: string;
  /** Google currentOpeningHours.nextCloseTime → HH:mm（詳情頁營業至） */
  openUntilTime?: string;
  /** Google currentOpeningHours.openNow（列表／詳情共用） */
  openNow?: boolean | null;
  normalizedOpeningStatus?: NormalizedOpeningStatusValue;
  normalizedOpeningLabel?: string;
  normalizedOpeningSource?: NormalizedOpeningSource;
  /** 非 Google 封面（Unsplash / Roamie fallback） */
  coverImageUrl?: string | null;
  generatedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
  /** 探索地圖分層品質（1=營業中, 2=待確認, 3=休息中） */
  exploreQualityTier?: 1 | 2 | 3 | null;
  /** Google regularOpeningHours（行程排程營業時間驗證用） */
  regularOpeningHours?: PlaceHoursData["regularOpeningHours"];
  utcOffsetMinutes?: number | null;
  /** Primary destination vs user-requested nearby extension (箱根／橫濱…) */
  destinationScope?: "primary" | "nearby_extension";
  /** Normalized nearby city when destinationScope = nearby_extension */
  extensionDestination?: string;
  /** Region-expansion origin retained as a secondary nearby provenance signal. */
  sourceRegionCandidate?: string;
  /** Pre-localization / local-script name */
  originalName?: string | null;
  /** App-locale display name (UI should prefer this) */
  localizedDisplayName?: string | null;
  languageCode?: string | null;
  localizationSource?: string | null;
  translationConfidence?: number | null;
  brandNameException?: boolean | null;
  /** Prefer for Directions when set (entrance / roadside). */
  navigationLatitude?: number | null;
  navigationLongitude?: number | null;
  /**
   * Where lat/lng came from.
   * approx_center / generated / fallback / region_center must not be used as precise nav points.
   */
  coordinateSource?:
    | "google_places"
    | "place_details"
    | "navigation"
    | "approx_center"
    | "generated"
    | "fallback"
    | "region_center"
    | "geocode"
    | "unknown"
    | null;
};
