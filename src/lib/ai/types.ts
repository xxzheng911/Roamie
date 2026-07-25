import { z } from "zod";
import type { OutfitAdvicePayload, TripOutfitSuggestionFields } from "@/lib/outfit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import type { TripLocation } from "@/lib/location/types";

/** OpenAI strict schema 要求 recommendations / itinerary 每個 item 欄位齊全；無座標時 lat/lng 填 null */
export const RoamieRecommendationItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  /** Google primaryType retained separately from normalized/display type. */
  primaryType: z.string().nullable().optional(),
  description: z.string(),
  reason: z.string(),
  estimatedTime: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  googleMapsUrl: z.string(),
  placeName: z.string(),
  reasonSource: z.enum(["template", "ai"]),
  googlePlaceId: z.string().optional(),
  photoName: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  userRatingCount: z.number().nullable().optional(),
  businessStatus: z.string().nullable().optional(),
  openStatusLabel: z.string().optional(),
  todayHoursLabel: z.string().optional(),
  closingSoonNote: z.string().optional(),
  nextOpenHint: z.string().optional(),
  /** Google place types retained for category render guards (shopping / cafe). */
  types: z.array(z.string()).optional(),
  /** 1-based combination id this place was sourced from (legacy singular) */
  sourceCombinationId: z.number().optional(),
  /** All combination ids this place covers (union after merge / dedupe) */
  sourceCombinationIds: z.array(z.number()).optional(),
  matchedCombinationIds: z.array(z.number()).optional(),
  matchedSelectedCombinationIds: z.array(z.number()).optional(),
  /** When expanded from a region candidate (e.g. 鎌倉 → 鶴岡八幡宮) */
  sourceRegionCandidate: z.string().optional(),
});

export const RoamieItineraryItemSchema = z.object({
  date: z.string(),
  time: z.string(),
  title: z.string(),
  description: z.string(),
  placeName: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  address: z.string().optional(),
  googlePlaceId: z.string().optional(),
  placeType: z.string().optional(),
  notes: z.string().optional(),
  /** Pre-localization / local-script name (search / nav / match only). */
  originalName: z.string().optional(),
  /** Localized display name — sole UI SoT (kept in sync with placeId / coords). */
  localizedDisplayName: z.string().optional(),
  translationConfidence: z.number().optional(),
  brandNameException: z.boolean().optional(),
  languageCode: z.string().optional(),
  localizationSource: z.string().optional(),
  /** Prefer for Directions when set. */
  navigationLatitude: z.number().nullable().optional(),
  navigationLongitude: z.number().nullable().optional(),
  /**
   * Where lat/lng came from.
   * approx_center / generated / fallback / region_center are not precise nav points.
   */
  coordinateSource: z
    .enum([
      "google_places",
      "place_details",
      "navigation",
      "approx_center",
      "generated",
      "fallback",
      "region_center",
      "geocode",
      "unknown",
    ])
    .optional(),
  /** 0-based day index within trip */
  dayIndex: z.number().optional(),
  /** 0-based order within the day (display / persistence) */
  sortIndex: z.number().optional(),
  order: z.number().optional(),
  /** Combination provenance (multi-select itinerary integrity) */
  sourceCombinationId: z.number().optional(),
  sourceCombinationIds: z.array(z.number()).optional(),
  matchedCombinationIds: z.array(z.number()).optional(),
  matchedSelectedCombinationIds: z.array(z.number()).optional(),
  sourceRegionCandidate: z.string().optional(),
  /** Rich place snapshot for immediate detail render (stale-while-revalidate). */
  photoName: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  userRatingCount: z.number().nullable().optional(),
  businessStatus: z.string().nullable().optional(),
  openStatusLabel: z.string().optional(),
  todayHoursLabel: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  types: z.array(z.string()).optional(),
  placeSnapshotSource: z.enum(["selected_place", "places_details", "handoff"]).optional(),
});

export const RoamieResponseSchema = z.object({
  title: z.string(),
  summary: z.string(),
  moodTag: z.string(),
  recommendations: z.array(RoamieRecommendationItemSchema),
  itinerary: z.array(RoamieItineraryItemSchema),
});

export type RoamieRecommendationItem = z.infer<typeof RoamieRecommendationItemSchema>;
export type RoamieItineraryItem = z.infer<typeof RoamieItineraryItemSchema>;
export type RoamieResponse = z.infer<typeof RoamieResponseSchema>;

export type TripTransportMode = "walk" | "scooter" | "drive" | "transit";

export type TripPlanSettings = {
  startTime?: string;
  /** 整趟旅程開始／結束（ISO YYYY-MM-DD） */
  tripStartDate?: string;
  tripEndDate?: string;
  transport?: TripTransportMode;
  /** 整趟預設交通方式顯示標籤（步行、大眾運輸等） */
  defaultTransportLabel?: string;
  /** 各站點停留時間（分） */
  legMinutes?: Record<string, number>;
  /** 各站點交通方式標籤（可自訂，如捷運、Uber）— single-leg override */
  legTransport?: Record<string, string>;
  /** 各天預設交通方式標籤（key = dateKey） */
  dayTransportLabels?: Record<string, string>;
  /** 點對點智慧交通建議，key: `A→B` */
  transitLegs?: Record<string, TransitLegAdvice>;
  transportTips?: string;
  /** 自訂封面裁切構圖（僅 upload 封面） */
  coverImageScale?: number;
  coverImagePositionX?: number;
  coverImagePositionY?: number;
};

/** New-format payload stored in saved_trips.payload */
export type RoamiePayloadV2 = RoamieResponse &
  TripOutfitSuggestionFields & {
    version: 2;
    destination?: string;
    /** 目的地（城市／區域）結構化資料 */
    destinationLocation?: TripLocation | null;
    /** 出發地 */
    originLocation?: TripLocation | null;
    days?: number;
    generatedAt?: string;
    tripSettings?: TripPlanSettings;
    /** AI 每日穿搭建議（整合天氣預報） */
    outfitAdvice?: OutfitAdvicePayload;
    weatherSummary?: string;
    outfitSuggestion?: string;
    coreTrip?: Record<string, unknown>;
    /** true = 使用者已確認儲存至收藏 */
    userSaved?: boolean;
    source?: "chat" | "plan" | "mood_recommendation";
    savedAt?: string;
  };

export function isRoamiePayloadV2(payload: unknown): payload is RoamiePayloadV2 {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p.version === 2 || Array.isArray(p.recommendations);
}

/** 補齊舊資料或手動組裝的推薦項目，避免缺欄位 */
export function normalizeItineraryItem(
  raw: Partial<RoamieItineraryItem> & { placeName: string; title: string },
): RoamieItineraryItem {
  return {
    date: raw.date ?? "",
    time: raw.time ?? "",
    title: raw.title,
    description: raw.description ?? "",
    placeName: raw.placeName,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    address: raw.address,
    googlePlaceId: raw.googlePlaceId,
    placeType: raw.placeType,
    notes: raw.notes,
    originalName: raw.originalName,
    localizedDisplayName: raw.localizedDisplayName,
    languageCode: raw.languageCode,
    localizationSource: raw.localizationSource,
    navigationLatitude: raw.navigationLatitude,
    navigationLongitude: raw.navigationLongitude,
    coordinateSource: raw.coordinateSource,
    dayIndex: raw.dayIndex,
    sortIndex: raw.sortIndex,
    order: raw.order,
    sourceCombinationId: raw.sourceCombinationId,
    sourceCombinationIds: raw.sourceCombinationIds,
    matchedCombinationIds: raw.matchedCombinationIds,
    matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
    sourceRegionCandidate: raw.sourceRegionCandidate,
    photoName: raw.photoName,
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    businessStatus: raw.businessStatus,
    openStatusLabel: raw.openStatusLabel,
    todayHoursLabel: raw.todayHoursLabel,
    website: raw.website,
    phone: raw.phone,
    types: raw.types,
    placeSnapshotSource: raw.placeSnapshotSource,
  };
}

export function normalizeRoamieResponse(raw: Record<string, unknown>): RoamieResponse {
  const recs = Array.isArray(raw.recommendations)
    ? raw.recommendations.map((r) =>
        normalizeRecommendationItem(r as Partial<RoamieRecommendationItem> & { name: string }),
      )
    : [];
  const itin = Array.isArray(raw.itinerary)
    ? raw.itinerary.map((i) =>
        normalizeItineraryItem(
          i as Partial<RoamieItineraryItem> & { placeName: string; title: string },
        ),
      )
    : [];
  return RoamieResponseSchema.parse({
    title: raw.title ?? "",
    summary: raw.summary ?? "",
    moodTag: raw.moodTag ?? "",
    recommendations: recs,
    itinerary: itin,
  });
}

export function normalizeRecommendationItem(
  raw: Partial<RoamieRecommendationItem> & { name: string } & {
    localizedDisplayName?: string;
    originalName?: string;
    languageCode?: string;
    localizationSource?: string;
  },
): RoamieRecommendationItem & {
  localizedDisplayName?: string;
  originalName?: string;
  languageCode?: string;
  localizationSource?: string;
} {
  const localized =
    (raw.localizedDisplayName ?? "").trim() || (raw.placeName ?? "").trim() || raw.name;
  return {
    name: localized,
    type: raw.type ?? "地點",
    primaryType: raw.primaryType ?? raw.type ?? null,
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: localized,
    reasonSource: raw.reasonSource ?? "template",
    googlePlaceId: raw.googlePlaceId,
    photoName: raw.photoName ?? null,
    rating: raw.rating ?? null,
    userRatingCount: raw.userRatingCount ?? null,
    businessStatus: raw.businessStatus ?? null,
    openStatusLabel: raw.openStatusLabel,
    todayHoursLabel: raw.todayHoursLabel,
    closingSoonNote: raw.closingSoonNote,
    nextOpenHint: raw.nextOpenHint,
    types: raw.types,
    sourceCombinationId: raw.sourceCombinationId,
    sourceCombinationIds: raw.sourceCombinationIds,
    matchedCombinationIds: raw.matchedCombinationIds,
    matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
    sourceRegionCandidate: raw.sourceRegionCandidate,
    localizedDisplayName: raw.localizedDisplayName ?? localized,
    originalName: raw.originalName,
    languageCode: raw.languageCode,
    localizationSource: raw.localizationSource,
  };
}

const RECOMMENDATION_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    type: { type: "string", description: "e.g. 咖啡、書店、公園" },
    description: { type: "string" },
    reason: { type: "string" },
    estimatedTime: { type: "string", description: "e.g. 1-2 小時" },
    address: { type: "string" },
    lat: { type: ["number", "null"], description: "緯度；未知則 null" },
    lng: { type: ["number", "null"], description: "經度；未知則 null" },
    googleMapsUrl: { type: "string", description: "Google Maps 連結；無則空字串" },
    placeName: { type: "string", description: "顯示名稱，通常與 name 相同" },
    reasonSource: { type: "string", enum: ["template", "ai"] },
  },
  required: [
    "name",
    "type",
    "description",
    "reason",
    "estimatedTime",
    "address",
    "lat",
    "lng",
    "googleMapsUrl",
    "placeName",
    "reasonSource",
  ],
} as const;

const ITINERARY_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: "string", description: "YYYY-MM-DD，聊天/推薦可填今日或空字串" },
    time: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    placeName: { type: "string" },
    lat: { type: ["number", "null"], description: "緯度；未知則 null" },
    lng: { type: ["number", "null"], description: "經度；未知則 null" },
  },
  required: ["date", "time", "title", "description", "placeName", "lat", "lng"],
} as const;

export const ROAMIE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short poetic title in Traditional Chinese" },
    summary: { type: "string", description: "Warm 2-4 sentence reply in Traditional Chinese" },
    moodTag: { type: "string", description: "Mood tag in Traditional Chinese" },
    recommendations: {
      type: "array",
      items: RECOMMENDATION_ITEM_SCHEMA,
    },
    itinerary: {
      type: "array",
      items: ITINERARY_ITEM_SCHEMA,
    },
  },
  required: ["title", "summary", "moodTag", "recommendations", "itinerary"],
} as const;
