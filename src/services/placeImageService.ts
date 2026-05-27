import cafe from "@/assets/scene-cafe.jpg";
import roamieDefaultCover from "@/assets/roamie-default-cover.png";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { ROAMIE_API_FALLBACK, API_CACHE_TTL_MS } from "@/lib/api/constants";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import type { PlaceResult } from "@/lib/place-result";
import { createRequestCache } from "@/services/requestCache";
import { searchUnsplashImage, searchUnsplashWithQueries } from "@/services/unsplashService";

export type ImageSource = "google" | "unsplash" | "upload" | "default" | "roamie";

/** 圖片 API 失敗或無圖時的 Roamie 文案 */
export const ROAMIE_IMAGE_FALLBACK_MESSAGE = ROAMIE_API_FALLBACK.image;

const placeImageRequestCache = createRequestCache({
  prefix: "place-image",
  ttlMs: API_CACHE_TTL_MS.image,
  persist: true,
});

function placeImageCacheKey(input: PlaceImageInput): string {
  return [
    input.name,
    input.photoName ?? "",
    input.categoryId ?? "",
    input.category ?? "",
    input.city ?? "",
    input.primaryType ?? "",
  ]
    .join("|")
    .trim()
    .toLowerCase();
}

function tripCoverCacheKey(trip: TripCoverInput): string {
  return [
    trip.destination ?? "",
    trip.title ?? "",
    trip.mood ?? "",
    trip.moodTag ?? "",
    trip.city ?? "",
    trip.category ?? "",
  ]
    .join("|")
    .trim()
    .toLowerCase();
}

export type PlaceImageInput = {
  name: string;
  photoName?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  categoryId?: string;
  category?: string;
  city?: string | null;
  photoWidth?: number;
};

export type TripCoverInput = {
  destination?: string | null;
  title?: string | null;
  mood?: string | null;
  moodTag?: string | null;
  city?: string | null;
  category?: string | null;
};

const TAIWAN_CITIES = [
  "台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化",
  "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門", "連江",
];

const JP_CITIES = ["東京", "大阪", "京都", "札幌", "福岡", "名古屋", "橫濱", "神戶", "沖繩"];

function extractCity(text: string): string | null {
  const hay = text.trim();
  for (const c of [...TAIWAN_CITIES, ...JP_CITIES]) {
    if (hay.includes(c)) return c;
  }
  const m = hay.match(/([\u4e00-\u9fff]{2,4})(市|縣|區|町|村)/);
  return m?.[1] ?? null;
}

function normalizeCategory(input: PlaceImageInput): string {
  const hay = [
    input.category ?? "",
    input.categoryId ?? "",
    input.primaryType ?? "",
    ...(input.types ?? []),
    input.name,
  ]
    .join(" ")
    .toLowerCase();

  if (/(咖啡|cafe|coffee|貓|cat)/.test(hay)) return "coffee";
  if (/(餐廳|restaurant|美食|food|拉麵|壽司|小吃)/.test(hay)) return "food";
  if (/(公園|park|步道|散步|walking)/.test(hay)) return "park";
  if (/(夜景|night|bar|酒吧)/.test(hay)) return "night";
  if (/(海|beach|沙灘|ocean)/.test(hay)) return "beach";
  if (/(森林|forest|山|mountain|trail)/.test(hay)) return "forest";
  if (/(老街|old street|market|市集)/.test(hay)) return "street";
  return "sight";
}

/** 地點 Unsplash 搜尋 query 列表（依優先順序） */
export function buildPlaceUnsplashQueries(input: PlaceImageInput): string[] {
  const name = input.name.trim();
  const city = input.city?.trim() || extractCity(name) || "";
  const cat = normalizeCategory(input);
  const queries: string[] = [];

  if (cat === "coffee") {
    if (city) queries.push(`${city} cafe`);
    if (/貓|cat/i.test(name)) queries.push("cat cafe");
    queries.push("coffee shop taiwan", "cozy cafe aesthetic");
  } else if (cat === "food") {
    if (city) queries.push(`${city} restaurant`);
    queries.push("restaurant taiwan", "food travel aesthetic");
  } else if (cat === "park") {
    if (city) queries.push(`${city} park`);
    queries.push("park taiwan", "city park soft light");
  } else if (cat === "night") {
    if (city) queries.push(`${city} night city`);
    queries.push("night travel aesthetic", "city lights soft");
  } else if (cat === "beach") {
    queries.push("beach taiwan soft", "coastal travel aesthetic");
  } else if (cat === "forest") {
    queries.push("forest taiwan soft", "nature travel aesthetic");
  } else if (cat === "street") {
    if (city) queries.push(`${city} old street`);
    queries.push("taiwan street travel", "alley aesthetic travel");
  } else {
    if (city) queries.push(`${city} travel`);
    queries.push("taiwan travel aesthetic");
  }

  return [...new Set(queries.filter(Boolean))];
}

/** 行程封面 Unsplash query */
export function buildTripCoverQuery(trip: TripCoverInput): string {
  const dest = trip.destination?.trim() || trip.city?.trim() || "";
  const city = extractCity(dest) || dest.split(/[,，、\s]/)[0]?.trim() || "";
  const mood = (trip.moodTag ?? trip.mood ?? "").trim();
  const category = trip.category?.trim() || "";

  const parts: string[] = [];
  if (city) parts.push(city);
  if (category) parts.push(category);
  if (mood) parts.push(mood);
  parts.push("旅行");

  return parts.filter(Boolean).join(" ");
}

/** 行程封面多 query fallback */
export function buildTripCoverQueries(trip: TripCoverInput): string[] {
  const dest = trip.destination?.trim() || trip.city?.trim() || "";
  const city = extractCity(dest) || dest.split(/[,，、\s]/)[0]?.trim() || "";
  const mood = (trip.moodTag ?? trip.mood ?? "").trim();
  const title = trip.title?.trim() || "";

  const queries: string[] = [];
  if (city && mood) queries.push(`${city} ${mood} 旅行`);
  if (city) queries.push(`${city} 旅行`);
  if (title && title.length <= 12) queries.push(`${title} travel`);
  if (/咖啡/.test(mood + title + dest)) queries.push(`${city || "taiwan"} coffee travel`);
  if (/散步|老街/.test(mood + title + dest)) queries.push(`${city || "taiwan"} street walk travel`);
  if (/夜景|night/i.test(mood + title + dest)) queries.push(`${city || "city"} night travel aesthetic`);
  if (/森林|放空|forest/i.test(mood + title + dest)) queries.push("forest travel soft aesthetic");
  if (/海|beach/i.test(mood + title + dest)) queries.push("beach travel soft aesthetic");

  const primary = buildTripCoverQuery(trip);
  if (primary) queries.unshift(primary);

  return [...new Set(queries.filter(Boolean))];
}

/** Roamie 預設圖（依分類；行程封面不再使用固定溫泉圖） */
export function getRoamieDefaultImage(category?: string | null): string {
  const hay = `${category ?? ""}`.toLowerCase();
  if (
    hay === "coffee" ||
    hay === "food" ||
    hay === "street" ||
    hay === "sight" ||
    /咖啡|餐廳|美食|café|cafe/.test(hay)
  ) {
    return cafe;
  }
  return roamieDefaultCover;
}

export { searchUnsplashImage };

/** Google 照片 URL（同步） */
export function resolveGooglePlacePhoto(
  photoName: string | null | undefined,
  width = 600,
): string | null {
  if (!photoName) return null;
  return buildPlacePhotoUrl(photoName, width);
}

/** 同步 fallback（Google 或 Roamie 情境圖，不含 Unsplash） */
export function resolvePlaceCoverImageSync(
  place: PlaceResult | PlaceImageInput,
  options?: { categoryId?: string; photoWidth?: number },
): string | null {
  const width = options?.photoWidth ?? 600;
  const photoName = "photoName" in place ? place.photoName : undefined;
  const fromGoogle = resolveGooglePlacePhoto(photoName, width);
  if (fromGoogle) return fromGoogle;
  return null;
}

/** 完整地點圖片解析：Google → Unsplash → Roamie 預設（含 cache + dedup） */
export async function getPlaceImage(
  input: PlaceImageInput,
): Promise<{ url: string; source: ImageSource }> {
  const key = placeImageCacheKey(input);
  return placeImageRequestCache.getOrFetch(key, async () => {
    const width = input.photoWidth ?? 600;
    const fromGoogle = resolveGooglePlacePhoto(input.photoName, width);
    if (fromGoogle) return { url: fromGoogle, source: "google" as const };

    const queries = buildPlaceUnsplashQueries(input);
    const unsplash = await searchUnsplashWithQueries(queries);
    if (unsplash) return { url: unsplash.url, source: "unsplash" as const };

    const cat = normalizeCategory(input);
    return {
      url: pickPlaceSceneFallback(input.name, {
        primaryType: input.primaryType,
        types: input.types,
        categoryId: input.categoryId ?? cat,
      }),
      source: "roamie" as const,
    };
  });
}

/** 行程封面：Unsplash → Roamie 預設（含 cache + dedup） */
export async function getTripCoverImage(
  trip: TripCoverInput,
): Promise<{ url: string; source: ImageSource; query: string | null }> {
  const key = tripCoverCacheKey(trip);
  return placeImageRequestCache.getOrFetch(`trip:${key}`, async () => {
    const queries = buildTripCoverQueries(trip);
    const unsplash = await searchUnsplashWithQueries(queries);
    if (unsplash) {
      return { url: unsplash.url, source: "unsplash" as const, query: unsplash.query };
    }

    return {
      url: roamieDefaultCover,
      source: "roamie" as const,
      query: queries[0] ?? null,
    };
  });
}

/** 從 RoamiePayloadV2 提取封面輸入 */
export function tripCoverInputFromPayload(payload: RoamiePayloadV2): TripCoverInput {
  const firstStop = payload.itinerary?.[0];
  const category = firstStop?.placeType ?? undefined;
  return {
    destination: payload.destination ?? payload.destinationLocation?.displayLabel,
    title: payload.title,
    moodTag: payload.moodTag,
    mood: payload.moodTag,
    city: payload.destinationLocation?.city ?? extractCity(payload.destination ?? ""),
    category,
  };
}
