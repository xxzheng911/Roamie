import type { Itinerary } from "@/lib/itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";

export type TripSaveSource = "chat" | "plan" | "mood_recommendation";

export type TripCollectionMeta = {
  /** 使用者已確認儲存到收藏 */
  userSaved?: boolean;
  source?: TripSaveSource;
  savedAt?: string;
};

export function tagUserSavedTrip<T extends Itinerary | RoamiePayloadV2>(
  trip: T,
  source: Exclude<TripSaveSource, "mood_recommendation"> = "chat",
): T & TripCollectionMeta {
  return {
    ...trip,
    userSaved: true,
    source,
    savedAt: new Date().toISOString(),
  };
}

export function tagMoodRecommendationPayload(data: RoamiePayloadV2): RoamiePayloadV2 {
  return {
    ...data,
    userSaved: false,
    source: "mood_recommendation",
    itinerary: data.itinerary ?? [],
  };
}

/** 收藏頁行程分頁：僅顯示使用者確認儲存的行程 */
export function isSavedCollectionTrip(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as TripCollectionMeta & { itinerary?: unknown[] };

  if (p.source === "mood_recommendation") return false;
  if (p.userSaved === true) return true;

  const itin = Array.isArray(p.itinerary) ? p.itinerary : [];
  if (itin.length > 0) return true;

  return false;
}
