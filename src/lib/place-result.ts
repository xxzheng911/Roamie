import type { PlaceOpenStatus } from "@/lib/filter-available-places";
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
};
