import type { RoamiePayloadV2, RoamieResponse } from "@/lib/ai/types";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import {
  readOwnedPersonalizedCache,
  wrapPersonalizedCache,
} from "@/lib/personalized-cache-envelope";
import { tagMoodRecommendationPayload } from "@/lib/saved-collection";

const GUEST_KEY = "roamie:recommendations";
const SESSION_LATEST_KEY = "roamie:recommendation-latest";
const memoryRecommendations = new Map<string, StoredRecommendation[]>();

export type StoredRecommendation = {
  id: string;
  title: string;
  mood: string | null;
  cover_image: string | null;
  created_at: string;
  payload: RoamiePayloadV2;
};

function readGuest(userId: string): StoredRecommendation[] {
  if (typeof window === "undefined") return [];
  try {
    const persisted =
      readOwnedPersonalizedCache<StoredRecommendation[]>(localStorage.getItem(GUEST_KEY), userId) ??
      [];
    return persisted.length ? persisted : (memoryRecommendations.get(userId) ?? []);
  } catch {
    return memoryRecommendations.get(userId) ?? [];
  }
}

function writeGuest(userId: string, list: StoredRecommendation[]) {
  if (typeof window === "undefined") return;
  memoryRecommendations.set(userId, list);
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(wrapPersonalizedCache(userId, list)));
  } catch (error) {
    console.warn("[RECOMMENDATION_STORAGE_FALLBACK]", {
      reason: error instanceof Error ? error.name : "storage_error",
      fallback: "memory",
    });
  }
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
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const payload = toPayloadV2(data, extra);
  const record: StoredRecommendation = {
    id: crypto.randomUUID(),
    title: data.title,
    mood: extra?.mood ?? data.moodTag ?? null,
    cover_image: null,
    created_at: new Date().toISOString(),
    payload,
  };

  const list = readGuest(userId);
  list.unshift(record);
  writeGuest(userId, list.slice(0, 50));

  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(
        SESSION_LATEST_KEY,
        JSON.stringify(wrapPersonalizedCache(userId, record)),
      );
    } catch {
      // readGuest retains the current-session in-memory authority.
    }
  }

  return record;
}

export async function getRecommendation(id: string): Promise<StoredRecommendation | null> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return null;
  if (typeof window !== "undefined") {
    const latestRaw = sessionStorage.getItem(SESSION_LATEST_KEY);
    if (latestRaw) {
      try {
        const latest = readOwnedPersonalizedCache<StoredRecommendation>(latestRaw, userId);
        if (latest?.id === id) return latest;
      } catch {
        /* ignore */
      }
    }
  }
  return readGuest(userId).find((r) => r.id === id) ?? null;
}
