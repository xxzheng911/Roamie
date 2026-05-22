import type { RoamiePayloadV2, RoamieResponse } from "@/lib/ai/types";
import { tagMoodRecommendationPayload } from "@/lib/saved-collection";

const GUEST_KEY = "roamie:recommendations";
const SESSION_LATEST_KEY = "roamie:recommendation-latest";

export type StoredRecommendation = {
  id: string;
  title: string;
  mood: string | null;
  cover_image: string | null;
  created_at: string;
  payload: RoamiePayloadV2;
};

function readGuest(): StoredRecommendation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeGuest(list: StoredRecommendation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

export function toPayloadV2(
  data: RoamieResponse,
  extra?: { destination?: string; days?: number },
): RoamiePayloadV2 {
  return tagMoodRecommendationPayload({
    ...data,
    version: 2,
    generatedAt: new Date().toISOString(),
    itinerary: data.itinerary ?? [],
    ...extra,
  });
}

/**
 * 儲存心情推薦結果（僅本機暫存，不寫入 saved_trips / 收藏頁）。
 */
export async function saveRecommendation(
  data: RoamieResponse,
  extra?: { destination?: string; days?: number; mood?: string },
): Promise<StoredRecommendation> {
  const payload = toPayloadV2(data, extra);
  const record: StoredRecommendation = {
    id: crypto.randomUUID(),
    title: data.title,
    mood: extra?.mood ?? data.moodTag ?? null,
    cover_image: null,
    created_at: new Date().toISOString(),
    payload,
  };

  const list = readGuest();
  list.unshift(record);
  writeGuest(list.slice(0, 50));

  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_LATEST_KEY, JSON.stringify(record));
  }

  return record;
}

export async function getRecommendation(id: string): Promise<StoredRecommendation | null> {
  if (typeof window !== "undefined") {
    const latestRaw = sessionStorage.getItem(SESSION_LATEST_KEY);
    if (latestRaw) {
      try {
        const latest = JSON.parse(latestRaw) as StoredRecommendation;
        if (latest.id === id) return latest;
      } catch {
        /* ignore */
      }
    }
  }
  return readGuest().find((r) => r.id === id) ?? null;
}
