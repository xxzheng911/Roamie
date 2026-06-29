import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { inferExploreCityLabel } from "@/lib/explore-recommend-mode";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { openStatusSortRank } from "@/lib/home-nearby-eligibility";
import { distanceMeters } from "@/lib/map-explore";

/** 未來合法 Tabelog API / 授權 ranking cache 的單筆資料（僅供排序，不可顯示於 UI） */
export type TabelogRankingCacheEntry = {
  googlePlaceId?: string | null;
  placeName?: string | null;
  /** Tabelog 排名（數字越小通常越靠前）— 僅排序用 */
  ranking?: number | null;
  /** Tabelog 評分 — 僅排序用，禁止顯示 */
  score?: number | null;
  /** 人氣指標 — 僅排序用 */
  popularity?: number | null;
  updatedAt?: string | null;
};

/** 合法授權來源的 Tabelog ranking cache（目前預設為空，不抓取任何 Tabelog 頁面） */
export type TabelogRankingCache = {
  source: "authorized_api" | "authorized_cache";
  cityLabel?: string | null;
  entries: TabelogRankingCacheEntry[];
};

const JAPAN_CITY_LABELS = new Set([
  "東京",
  "大阪",
  "京都",
  "札幌",
  "沖繩",
  "橫濱",
  "横浜",
  "名古屋",
  "福岡",
  "神戶",
  "神戸",
  "奈良",
  "廣島",
  "广岛",
  "仙台",
  "金澤",
  "金泽",
  "北海道",
  "沖縄",
]);

const TABELOG_ELIGIBLE_TYPES = new Set([
  "restaurant",
  "food",
  "meal_takeaway",
  "food_store",
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "pub",
  "wine_bar",
]);

const JAPAN_FOOD_PRIMARY_TYPES = new Set([
  "restaurant",
  "meal_takeaway",
  "food_store",
  "food",
  "fast_food_restaurant",
]);

const TABELOG_MOBILE_BASE = "https://s.tabelog.com/en";

/** Tabelog 行動版城市 slug（s.tabelog.com/en/{slug}/rstLst/） */
const TABELOG_CITY_SLUGS: Record<string, string> = {
  東京: "tokyo",
  大阪: "osaka",
  京都: "kyoto",
  札幌: "sapporo",
  福岡: "fukuoka",
  名古屋: "nagoya",
  橫濱: "yokohama",
  横浜: "yokohama",
  神戶: "kobe",
  神戸: "kobe",
  奈良: "nara",
  沖繩: "okinawa",
  沖縄: "okinawa",
  廣島: "hiroshima",
  广岛: "hiroshima",
  仙台: "sendai",
  金澤: "kanazawa",
  金泽: "kanazawa",
  北海道: "hokkaido",
};

function resolveTabelogCitySlug(cityLabel?: string | null): string | null {
  const city = normalizeTabelogCityLabel(cityLabel);
  if (city === "日本") return null;
  return TABELOG_CITY_SLUGS[city] ?? null;
}

export function isValidTabelogSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    if (!/(^|\.)tabelog\.com$/i.test(parsed.hostname)) return false;

    const sk = parsed.searchParams.get("sk")?.trim();
    if (!sk) return false;
    if (/^(undefined|null)$/i.test(sk)) return false;

    const rawUrl = url.trim();
    if (rawUrl.includes("undefined") || rawUrl.includes("null")) return false;
    if (!parsed.pathname.includes("rstLst")) return false;

    return true;
  } catch {
    return false;
  }
}

export function isJapanDestinationCountry(country?: string | null): boolean {
  const raw = (country ?? "").trim();
  if (!raw) return false;
  return raw === "日本" || /^japan$/i.test(raw) || /^jp$/i.test(raw);
}

export function resolveExploreJapanContext(options?: {
  country?: string | null;
  cityLabel?: string | null;
  address?: string | null;
}): boolean {
  if (isJapanDestinationCountry(options?.country)) return true;

  const city = normalizeDestinationLabel(options?.cityLabel ?? "");
  if (city && JAPAN_CITY_LABELS.has(city)) return true;

  const blob = `${options?.address ?? ""} ${options?.cityLabel ?? ""}`;
  if (/日本|Japan|東京都|东京都|大阪府|京都府|北海道|沖縄|沖繩|福岡|横浜|横濱/i.test(blob)) {
    return true;
  }

  return false;
}

export function isExploreJapanFoodContext(options?: {
  country?: string | null;
  cityLabel?: string | null;
  address?: string | null;
  categoryId?: string | null;
}): boolean {
  const categoryId = (options?.categoryId ?? "").trim();
  if (categoryId && categoryId !== "food") return false;
  return resolveExploreJapanContext(options);
}

type PlaceTypeLike = {
  primaryType?: string | null;
  types?: string[] | null;
  name?: string | null;
};

export function isTabelogEligiblePlace(place: PlaceTypeLike): boolean {
  const types = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) types.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) types.add(n);
  }

  if ([...types].some((t) => TABELOG_ELIGIBLE_TYPES.has(t))) return true;

  const name = (place.name ?? "").trim();
  return /居酒|izakaya/i.test(name);
}

export function isTabelogFoodCategory(categoryId: string): boolean {
  return categoryId === "food";
}

/**
 * 預留：僅在已有合法授權 cache / API 時回傳資料。
 * 目前永遠回傳 null，不進行任何 Tabelog 抓取。
 */
export function loadAuthorizedTabelogRankingCache(
  _cityLabel?: string | null,
): TabelogRankingCache | null {
  return null;
}

export function lookupTabelogRankingEntry(
  place: { id?: string | null; name?: string | null },
  cache: TabelogRankingCache | null | undefined,
): TabelogRankingCacheEntry | null {
  if (!cache?.entries.length) return null;

  const placeId = (place.id ?? "").trim();
  if (placeId) {
    const byId = cache.entries.find((e) => e.googlePlaceId === placeId);
    if (byId) return byId;
  }

  const name = (place.name ?? "").trim().toLowerCase();
  if (!name) return null;
  return (
    cache.entries.find((e) => (e.placeName ?? "").trim().toLowerCase() === name) ?? null
  );
}

function tabelogSortBoost(entry: TabelogRankingCacheEntry | null): number {
  if (!entry) return 0;
  let boost = 0;
  if (entry.ranking != null && entry.ranking > 0) {
    boost += Math.max(0, 500 - entry.ranking);
  }
  if (entry.score != null && entry.score > 0) {
    boost += entry.score * 10;
  }
  if (entry.popularity != null && entry.popularity > 0) {
    boost += Math.min(entry.popularity, 100);
  }
  return boost;
}

function japanFoodTypeRank(place: PlaceTypeLike): number {
  const types = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) types.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) types.add(n);
  }

  if ([...types].some((t) => JAPAN_FOOD_PRIMARY_TYPES.has(t))) return 2;
  if (/居酒|拉[面麵]|ramen|壽司|寿司|sushi|焼肉|燒肉|izakaya/i.test(place.name ?? "")) {
    return 2;
  }
  if ([...types].some((t) => t === "cafe" || t === "bakery" || t === "bar")) return 1;
  return 0;
}

function hasPlacePhoto(place: { photoName?: string | null }): boolean {
  return Boolean((place.photoName ?? "").trim());
}

type JapanFoodSortable = PlaceTypeLike & {
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
  openStatus?: PlaceOpenStatus | null;
  photoName?: string | null;
  id?: string | null;
};

export function compareJapanFoodPlaces(
  a: JapanFoodSortable,
  b: JapanFoodSortable,
  origin?: { lat: number; lng: number },
  tabelogCache?: TabelogRankingCache | null,
): number {
  const ratingA = a.rating ?? 0;
  const ratingB = b.rating ?? 0;
  if (ratingA !== ratingB) return ratingB - ratingA;

  const countA = a.userRatingCount ?? 0;
  const countB = b.userRatingCount ?? 0;
  if (countA !== countB) return countB - countA;

  const typeA = japanFoodTypeRank(a);
  const typeB = japanFoodTypeRank(b);
  if (typeA !== typeB) return typeB - typeA;

  const openA = openStatusSortRank(a.openStatus);
  const openB = openStatusSortRank(b.openStatus);
  if (openA !== openB) return openA - openB;

  const photoA = hasPlacePhoto(a) ? 1 : 0;
  const photoB = hasPlacePhoto(b) ? 1 : 0;
  if (photoA !== photoB) return photoB - photoA;

  if (tabelogCache) {
    const boostA = tabelogSortBoost(lookupTabelogRankingEntry(a, tabelogCache));
    const boostB = tabelogSortBoost(lookupTabelogRankingEntry(b, tabelogCache));
    if (boostA !== boostB) return boostB - boostA;
  }

  if (origin) {
    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    return distA - distB;
  }

  return 0;
}

export function sortJapanFoodPlaces<T extends JapanFoodSortable>(
  places: T[],
  origin: { lat: number; lng: number },
  tabelogCache?: TabelogRankingCache | null,
): T[] {
  return [...places].sort((a, b) => compareJapanFoodPlaces(a, b, origin, tabelogCache));
}

export function buildTabelogSearchUrl(
  query: string,
  cityLabel?: string | null,
): string | null {
  const q = query.trim();
  if (!q) return null;

  const encoded = encodeURIComponent(q);
  const slug = resolveTabelogCitySlug(cityLabel);
  if (slug) {
    return `${TABELOG_MOBILE_BASE}/${slug}/rstLst/?sk=${encoded}`;
  }
  return `${TABELOG_MOBILE_BASE}/rstLst/?sk=${encoded}`;
}

export function inferTabelogCuisineFromPlace(place: PlaceTypeLike): string | undefined {
  const blob = `${place.name ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`;
  const patterns: Array<[RegExp, string]> = [
    [/拉[面麵]|ramen/i, "拉麵"],
    [/壽司|寿司|sushi/i, "壽司"],
    [/居酒|izakaya/i, "居酒屋"],
    [/燒肉|焼肉|yakiniku/i, "燒肉"],
    [/天婦羅|天ぷら|tempura/i, "天婦羅"],
    [/烏龍|乌龙|udon/i, "烏龍麵"],
    [/soba|蕎麦|蕎麥/i, "蕎麥麵"],
    [/咖喱|カレー|curry/i, "咖喱"],
    [/咖啡|cafe|coffee/i, "咖啡"],
    [/bakery|麵包|パン/i, "麵包"],
    [/bar|酒吧/i, "酒吧"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(blob)) return label;
  }
  return undefined;
}

function normalizeTabelogCityLabel(cityLabel?: string | null): string {
  const city = normalizeDestinationLabel((cityLabel ?? "").trim());
  if (!city) return "日本";
  return city
    .replace(/^东京都$|^東京都$/, "東京")
    .replace(/^大阪府$|^大阪市$/, "大阪")
    .replace(/^京都府$/, "京都");
}

function compactJapanAddressForTabelog(address: string): string {
  return address
    .replace(/^日本[、,\s]*/u, "")
    .replace(/^Japan[,\s]*/i, "")
    .replace(/^〒?\d{3}-?\d{4}\s*/u, "")
    .trim();
}

/** 從日本地址擷取區域名（例：渋谷区、北区） */
function extractJapanDistrictFromAddress(address: string): string | null {
  const ward = address.match(/([^\s,、，\d]{1,12}[区區])/u);
  if (ward?.[1]) return ward[1];
  const cityWard = address.match(/([^\s,、，\d]{1,12}市[^\s,、，\d]{1,12}[区區])/u);
  return cityWard?.[1] ?? null;
}

function hasJapanLocalityHint(cityName: string, address: string): boolean {
  if (cityName && cityName !== "日本") return true;
  return /[都道府県市区町村]|Japan|日本|〒/u.test(address);
}

/** 組合 Tabelog 官方搜尋 query：餐廳名 + 城市 + 地址（或區域） */
export function buildTabelogPlaceSearchQuery(options: {
  placeName: string;
  cityLabel?: string | null;
  address?: string | null;
  place?: PlaceTypeLike;
}): string | null {
  const name = options.placeName.trim();
  if (name.length < 2) return null;

  const city = normalizeTabelogCityLabel(options.cityLabel);
  const cityName = city !== "日本" ? city : "";
  const addressRaw = (options.address ?? "").trim();
  const address = addressRaw ? compactJapanAddressForTabelog(addressRaw) : "";
  const district = address ? extractJapanDistrictFromAddress(address) : null;
  const cuisine = options.place ? inferTabelogCuisineFromPlace(options.place) : undefined;

  const parts: string[] = [name];
  if (cityName) parts.push(cityName);
  if (address.length >= 4) {
    parts.push(address);
  } else if (district) {
    parts.push(district);
  }

  if (cuisine && !name.includes(cuisine)) {
    parts.push(cuisine);
  }

  const query = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (query.length < 4) return null;
  if (!hasJapanLocalityHint(cityName, address)) return null;

  return query;
}

export function hasSufficientTabelogPlaceContext(options: {
  country?: string | null;
  cityLabel?: string | null;
  address?: string | null;
  place: PlaceTypeLike & { name?: string | null };
}): boolean {
  if (!resolveExploreJapanContext(options)) return false;
  if (!isTabelogEligiblePlace(options.place)) return false;
  const name = (options.place.name ?? "").trim();
  if (name.length < 2) return false;

  const city = normalizeTabelogCityLabel(options.cityLabel);
  const cityName = city !== "日本" ? city : "";
  const address = compactJapanAddressForTabelog((options.address ?? "").trim());

  if (cityName) return true;
  if (address.length >= 8 && hasJapanLocalityHint("", address)) return true;

  return false;
}

export function buildTabelogPlaceSearchUrl(options: {
  cityLabel?: string | null;
  placeName: string;
  address?: string | null;
  place?: PlaceTypeLike;
}): string | null {
  const query = buildTabelogPlaceSearchQuery({
    placeName: options.placeName,
    cityLabel: options.cityLabel,
    address: options.address,
    place: options.place,
  });
  if (!query) return null;
  return buildTabelogSearchUrl(query, options.cityLabel);
}

export function buildTabelogFoodCategorySearchUrl(
  cityLabel?: string | null,
): string | null {
  const city = normalizeTabelogCityLabel(cityLabel);
  return buildTabelogSearchUrl(`${city} 美食`, cityLabel);
}

export function resolveTabelogPlaceExternalUrl(options: {
  country?: string | null;
  cityLabel?: string | null;
  address?: string | null;
  place: PlaceTypeLike & { name?: string | null };
}): string | null {
  if (!hasSufficientTabelogPlaceContext(options)) return null;

  const name = (options.place.name ?? "").trim();
  const url = buildTabelogPlaceSearchUrl({
    cityLabel: options.cityLabel,
    placeName: name,
    address: options.address,
    place: options.place,
  });
  return url && isValidTabelogSearchUrl(url) ? url : null;
}

export function resolveTabelogFoodListExternalUrl(options: {
  country?: string | null;
  cityLabel?: string | null;
  categoryId: string;
}): string | null {
  if (!isTabelogFoodCategory(options.categoryId)) return null;
  if (!resolveExploreJapanContext(options)) return null;
  const url = buildTabelogFoodCategorySearchUrl(options.cityLabel);
  return url && isValidTabelogSearchUrl(url) ? url : null;
}

export function resolveExploreMapFoodSortContext(
  categoryId: string,
  origin: { lat: number; lng: number },
  cityLabel?: string | null,
): { cityLabel?: string | null; tabelogCache?: TabelogRankingCache | null } | undefined {
  if (categoryId !== "food") return undefined;
  const label = normalizeTabelogCityLabel(
    cityLabel?.trim() ||
      inferExploreCityLabel(origin.lat, origin.lng, cityLabel ?? undefined),
  );
  if (!resolveExploreJapanContext({ cityLabel: label })) return undefined;
  return {
    cityLabel: label,
    tabelogCache: loadAuthorizedTabelogRankingCache(label),
  };
}

export function japanFoodQualityScore(
  place: JapanFoodSortable,
  origin: { lat: number; lng: number },
  tabelogCache?: TabelogRankingCache | null,
): number {
  let score = (place.rating ?? 0) * 1000;
  score += Math.min(place.userRatingCount ?? 0, 5000);
  score += japanFoodTypeRank(place) * 200;
  score += (4 - openStatusSortRank(place.openStatus)) * 50;
  if (hasPlacePhoto(place)) score += 40;

  if (tabelogCache) {
    score += tabelogSortBoost(lookupTabelogRankingEntry(place, tabelogCache));
  }

  if (place.lat != null && place.lng != null) {
    const dist = distanceMeters(origin, { lat: place.lat, lng: place.lng });
    score += Math.max(0, 120 - dist / 250);
  }

  return score;
}
