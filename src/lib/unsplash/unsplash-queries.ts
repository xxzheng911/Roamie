import type { PlaceImageInput, TripCoverInput } from "@/lib/place-image/place-image-types";
import { normalizeCategoryFromPlace } from "@/lib/place-image/place-category";
import { extractPrimaryDestinationLabel } from "@/lib/destination/normalize-destination-key";

const TAIWAN_CITIES = [
  "台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化",
  "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門", "連江",
];

const JP_CITIES = ["東京", "大阪", "京都", "札幌", "福岡", "名古屋", "橫濱", "神戶", "沖繩"];

export function extractCityFromText(text: string): string | null {
  const hay = text.trim();
  for (const c of [...TAIWAN_CITIES, ...JP_CITIES]) {
    if (hay.includes(c)) return c;
  }
  const m = hay.match(/([\u4e00-\u9fff]{2,4})(市|縣|區|町|村)/);
  return m?.[1] ?? null;
}

/** 地點 Unsplash 搜尋 query 列表（依優先順序） */
export function buildPlaceUnsplashQueries(input: PlaceImageInput): string[] {
  const name = input.name.trim();
  const city = input.city?.trim() || extractCityFromText(name) || "";
  const cat = normalizeCategoryFromPlace(input);
  const queries: string[] = [];

  if (cat === "museum") {
    if (city) queries.push(`${city} museum`, `${city} cultural center`);
    queries.push("history museum interior", "city museum architecture");
  } else if (cat === "bookstore") {
    if (city) queries.push(`${city} bookstore`);
    queries.push("bookstore interior aesthetic", "library reading space");
  } else if (cat === "coffee") {
    if (city) queries.push(`${city} cafe`);
    if (/貓|cat/i.test(name)) queries.push("cat cafe");
    queries.push("coffee shop cozy", "cafe aesthetic interior");
  } else if (cat === "food") {
    if (city) queries.push(`${city} restaurant`);
    queries.push("restaurant dining aesthetic", "local food travel");
  } else if (cat === "park") {
    if (city) queries.push(`${city} park`);
    queries.push("city park walk", "green park path");
  } else if (cat === "night") {
    if (city) queries.push(`${city} night city`);
    queries.push("city night lights aesthetic", "urban nightscape");
  } else if (cat === "beach") {
    if (city) queries.push(`${city} beach`);
    queries.push("coastal walk aesthetic", "seaside travel");
  } else if (cat === "forest") {
    queries.push("forest trail nature", "woodland path travel");
  } else if (cat === "street") {
    if (city) queries.push(`${city} old street`);
    queries.push("street market travel", "historic alley aesthetic");
  } else {
    if (city) queries.push(`${city} ${name}`, `${city} travel`);
    if (name.length <= 24) queries.push(`${name} travel`);
    queries.push("travel destination aesthetic");
  }

  return [...new Set(queries.filter(Boolean))];
}

export function buildTripCoverQuery(trip: TripCoverInput): string {
  const dest = extractPrimaryDestinationLabel(
    trip.destination?.trim() || trip.city?.trim() || "",
  );
  const city = extractCityFromText(dest) || dest.split(/[,，、\s]/)[0]?.trim() || "";
  const mood = (trip.moodTag ?? trip.mood ?? "").trim();
  const parts: string[] = [];
  if (city) parts.push(city);
  if (mood) parts.push(mood);
  parts.push("travel");
  return parts.filter(Boolean).join(" ");
}

/** 行程封面 Unsplash query 列表 */
export function buildTripCoverQueries(trip: TripCoverInput): string[] {
  const dest = extractPrimaryDestinationLabel(
    trip.destination?.trim() || trip.city?.trim() || "",
  );
  const city = extractCityFromText(dest) || dest.split(/[,，、\s]/)[0]?.trim() || "";
  const mood = (trip.moodTag ?? trip.mood ?? "").trim();
  const title = trip.title?.trim() || "";

  const queries: string[] = [];
  if (city && mood) queries.push(`${city} ${mood} travel`);
  if (city) queries.push(`${city} travel`, `${city} cityscape travel`);
  if (title && title.length <= 12) queries.push(`${title} travel`);
  if (/咖啡/.test(mood + title + dest)) queries.push(`${city || "city"} cafe travel`);
  if (/散步|老街/.test(mood + title + dest)) queries.push(`${city || "city"} street travel`);
  if (/夜景|night/i.test(mood + title + dest)) queries.push(`${city || "city"} night travel`);
  if (/海|beach/i.test(mood + title + dest)) queries.push(`${city || "coast"} beach travel`);

  const primary = buildTripCoverQuery(trip);
  if (primary) queries.unshift(primary);

  return [...new Set(queries.filter(Boolean))];
}
