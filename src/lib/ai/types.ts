import { z } from "zod";
import type { OutfitAdvicePayload, TripOutfitSuggestionFields } from "@/lib/outfit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import type { TripLocation } from "@/lib/location/types";

/** OpenAI strict schema 要求 recommendations / itinerary 每個 item 欄位齊全；無座標時 lat/lng 填 null */
export const RoamieRecommendationItemSchema = z.object({
  name: z.string(),
  type: z.string(),
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
  openStatusLabel: z.string().optional(),
  todayHoursLabel: z.string().optional(),
  closingSoonNote: z.string().optional(),
  nextOpenHint: z.string().optional(),
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
  /** 明確的每日 ISO 日期（含無地點的空白天） */
  tripDayDates?: string[];
  transport?: TripTransportMode;
  /** 各站點停留時間（分） */
  legMinutes?: Record<string, number>;
  /** 各站點交通方式標籤（可自訂，如捷運、Uber） */
  legTransport?: Record<string, string>;
  /** 點對點智慧交通建議，key: `A→B` */
  transitLegs?: Record<string, TransitLegAdvice>;
  transportTips?: string;
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
        normalizeItineraryItem(i as Partial<RoamieItineraryItem> & { placeName: string; title: string }),
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
  raw: Partial<RoamieRecommendationItem> & { name: string },
): RoamieRecommendationItem {
  return {
    name: raw.name,
    type: raw.type ?? "地點",
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: raw.placeName ?? raw.name,
    reasonSource: raw.reasonSource ?? "template",
    googlePlaceId: raw.googlePlaceId,
    photoName: raw.photoName ?? null,
    rating: raw.rating ?? null,
    userRatingCount: raw.userRatingCount ?? null,
    openStatusLabel: raw.openStatusLabel,
    todayHoursLabel: raw.todayHoursLabel,
    closingSoonNote: raw.closingSoonNote,
    nextOpenHint: raw.nextOpenHint,
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
