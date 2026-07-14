import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import type { TripLocation } from "@/lib/location/types";
import type { PlaceResult } from "@/lib/place-result";
import {
  isKnownScenicLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import { isCountryLevelDestination } from "@/lib/ai/destination-scope";
import { normalizePlaceName, type PlaceLike } from "@/lib/place-planning-memory";
import type { WeatherScene } from "@/lib/weather-scene";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";

export type DestinationPlaceSearchKind = "city" | "landmark";

export type DestinationPlaceSearchProfile = {
  kind: DestinationPlaceSearchKind;
  label: string;
  parentLandmark?: string;
  nearestCity?: string;
  nearestRegion?: string;
};

const LANDMARK_HINT_RE =
  /(山|嶺|峰|寺|神社|神宮|大社|城|塔|宮|園|影城|樂園|迪士尼|環球|环球|水族館|瀑布|峽谷|湖|潭|礁|岩|關|堡|修道院|大教堂|歌劇院|競技場|金字塔|大橋|吊橋|溫泉谷|國家公園|森林遊樂區|風景區|天空之鏡|天空橋|天空塔|晴空塔|晴空塔|鐵塔|摩天輪|101|晴空|哈利波特|迪士尼|環球影城|清水寺|淺草|金閣|銀閣|愛河|駁二|十分|九份)/i;

const INTERNAL_FACILITY_MARKERS = [
  "步道",
  "棧道",
  "登山口",
  "車站",
  "火車站",
  "火车站",
  "火车站",
  "捷運站",
  "地鐵站",
  "地铁站",
  "纜車站",
  "索道",
  "遊客中心",
  "游客中心",
  "visitor center",
  "觀景台",
  "观景台",
  "展望台",
  "觀景平台",
  "觀景",
  "平台",
  "廣場",
  "广场",
  "停車場",
  "停车场",
  "parking",
  "入口",
  "出口",
  "售票",
  "服務站",
  "服务站",
  "資訊中心",
  "信息中心",
  "information",
  "管理處",
  "管理站",
  "休息站",
  "休息區",
  "五合目",
  "四合目",
  "三合目",
  "二合目",
  "一合目",
  "登山口",
  "trailhead",
  "trail",
  "lookout",
  "observation deck",
  "observatory",
  "station",
  "月台",
  "站台",
  "轉運站",
  "轉乘",
  "森林鐵路",
  "森林铁路",
  "林鐵",
  "林铁",
  "號亭",
  "号亭",
  "涼亭",
  "凉亭",
  "涼亭區",
];

const INTERNAL_FACILITY_TYPES = new Set([
  "parking",
  "parking_lot",
  "gas_station",
  "rest_stop",
  "rest_area",
  "transit_station",
  "train_station",
  "subway_station",
  "bus_station",
  "light_rail_station",
  "travel_agency",
  "route",
  "intersection",
  "administrative_area",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "neighborhood",
  "sublocality",
  "sublocality_level_1",
]);

function normalizeMatchText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "");
}

function placeTypes(place: PlaceLike & { types?: string[] | null; primaryType?: string | null }): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

export function isExcludedInternalFacilityType(
  place: PlaceLike & { types?: string[] | null; primaryType?: string | null },
): boolean {
  const types = placeTypes(place);
  if (!types.length) return false;
  if (types.some((t) => INTERNAL_FACILITY_TYPES.has(t))) return true;
  if (types.length === 1 && types[0] === "establishment") return true;
  return false;
}

/** 是否為「大地標」而非城市層級目的地 */
export function isLikelyLandmarkDestination(
  destination: string,
  geocoded?: TripLocation | null,
): boolean {
  const label = normalizeDestinationLabel(destination);
  if (!label) return false;

  if (isKnownScenicLabel(label)) return true;
  if (isKnownTouristCityLabel(label) && !isKnownScenicLabel(label)) return false;

  if (/101|影城|迪士尼|環球|环球|樂園|乐园|tower|temple|shrine|castle|cathedral/i.test(label)) {
    return true;
  }

  if (LANDMARK_HINT_RE.test(label) && label.length <= 16) {
    if (!isKnownTouristCityLabel(label)) return true;
  }

  const geoCity = geocoded?.city?.trim();
  const geoLabel = geocoded?.displayLabel?.trim() ?? geocoded?.formattedName?.trim();
  if (geoCity && geoLabel) {
    const cityNorm = normalizeMatchText(geoCity);
    const labelNorm = normalizeMatchText(label);
    const geoNorm = normalizeMatchText(geoLabel);
    if (
      labelNorm.length >= 2 &&
      !geoNorm.includes(labelNorm) &&
      !cityNorm.includes(labelNorm) &&
      !labelNorm.includes(cityNorm)
    ) {
      return true;
    }
  }

  return false;
}

function resolveNearestCityForLandmark(
  label: string,
  geocoded?: TripLocation | null,
): string | undefined {
  const city = geocoded?.city?.trim();
  const region = geocoded?.region?.trim();
  const normalizedLabel = normalizeDestinationLabel(label);

  if (city && normalizeMatchText(city) !== normalizeMatchText(normalizedLabel)) {
    return city;
  }
  if (region && normalizeMatchText(region) !== normalizeMatchText(normalizedLabel)) {
    return region;
  }
  return city || region || undefined;
}

export function classifyDestinationForPlaceSearch(
  destination: string,
  geocoded?: TripLocation | null,
): DestinationPlaceSearchProfile {
  const label = normalizeDestinationLabel(destination);

  if (isLikelyLandmarkDestination(label, geocoded)) {
    return {
      kind: "landmark",
      label,
      parentLandmark: label,
      nearestCity: resolveNearestCityForLandmark(label, geocoded),
      nearestRegion: geocoded?.region,
    };
  }

  // Do not treat countries as cities for Places radius search.
  if (isCountryLevelDestination(label)) {
    return {
      kind: "city",
      label,
      nearestCity: undefined,
      nearestRegion: label,
    };
  }

  return {
    kind: "city",
    label,
    nearestCity: geocoded?.city?.trim() || label,
    nearestRegion: geocoded?.region,
  };
}

/** 地標內部設施或同名變體 — 不應作為「可搭配」推薦 */
export function isInternalSubPlaceOfLandmark(placeName: string, parentLandmark: string): boolean {
  const place = placeName.trim();
  const parent = parentLandmark.trim();
  if (!place || !parent) return false;

  const placeNorm = normalizeMatchText(place);
  const parentNorm = normalizeMatchText(parent);
  const placeCore = normalizePlaceName(place) || placeNorm;
  const parentCore = normalizePlaceName(parent) || parentNorm;

  if (placeCore && parentCore && placeCore === parentCore) return true;
  if (placeNorm === parentNorm) return true;

  const containsParent =
    place.includes(parent) ||
    placeNorm.includes(parentNorm) ||
    (parentCore.length >= 2 && placeNorm.includes(parentCore));

  if (!containsParent) return false;

  if (INTERNAL_FACILITY_MARKERS.some((m) => place.includes(m) || placeNorm.includes(normalizeMatchText(m)))) {
    return true;
  }

  if (/國家森林遊樂區|國家風景區|森林遊樂區|國家公園|自然風景區|national park|forest recreation/i.test(place)) {
    return true;
  }

  if (placeNorm.length > parentNorm.length && placeNorm.startsWith(parentNorm)) {
    return true;
  }

  return false;
}

export function buildCityAttractionSearchAttempts(city: string): SearchAttempt[] {
  const label = city.trim();
  if (!label) return [];
  return [
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 人氣景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 美食商圈`, mode: "text", includedTypes: ["restaurant", "shopping_mall"] },
    { query: `${label} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall"] },
    { query: `${label} 夜市`, mode: "text", includedTypes: ["tourist_attraction", "market"] },
    { query: `${label} 美術館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
    { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "tourist_attraction"] },
    { query: `${label} popular attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
  ];
}

export function buildLandmarkCompanionSearchAttempts(
  profile: DestinationPlaceSearchProfile,
): SearchAttempt[] {
  const landmark = profile.label.trim();
  const city = profile.nearestCity?.trim();
  const attempts: SearchAttempt[] = [
    { query: `${landmark} 周邊景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${landmark} 附近景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `attractions near ${landmark}`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${landmark} nearby attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    {
      query: `${landmark} day trip`,
      mode: "text",
      includedTypes: ["tourist_attraction", "museum", "shopping_mall"],
    },
  ];

  if (city && normalizeMatchText(city) !== normalizeMatchText(landmark)) {
    attempts.push(...buildCityAttractionSearchAttempts(city));
  }

  return attempts;
}

export function buildDestinationPlaceSearchAttempts(params: {
  profile: DestinationPlaceSearchProfile;
  weatherAwareAttempts?: SearchAttempt[];
  templateAttempts?: SearchAttempt[];
  textOnlyFallback?: SearchAttempt[];
}): SearchAttempt[] {
  const { profile, weatherAwareAttempts = [], templateAttempts = [], textOnlyFallback = [] } = params;

  if (profile.kind === "landmark") {
    return [
      ...buildLandmarkCompanionSearchAttempts(profile),
      ...weatherAwareAttempts,
      ...templateAttempts,
      ...textOnlyFallback,
    ];
  }

  return [
    ...buildCityAttractionSearchAttempts(profile.nearestCity ?? profile.label),
    ...weatherAwareAttempts,
    ...templateAttempts,
    ...textOnlyFallback,
  ];
}

export function buildLandmarkCompanionIntro(
  profile: DestinationPlaceSearchProfile,
  scene?: WeatherScene,
  weatherAvailable?: boolean,
): string {
  const landmark = profile.label;
  const city = profile.nearestCity?.trim();

  if (city && normalizeMatchText(city) !== normalizeMatchText(landmark)) {
    if (scene === "rainy") {
      return weatherAvailable
        ? `我看你選的時間${landmark}可能有雨，先幫你找${landmark}周邊和${city}可順路安排、比較不怕雨的點。`
        : `我幫你找${landmark}周邊和${city}可順路安排的人氣地點，會優先挑室內或短停留路線。`;
    }
    return `我幫你找${landmark}周邊和${city}可順路安排的人氣地點。`;
  }

  return `我幫你找${landmark}周邊可搭配的人氣地點。`;
}

export function filterPlacesForLandmarkCompanionRecommendation<T extends PlaceLike>(
  places: T[],
  opts: {
    profile?: DestinationPlaceSearchProfile;
    parentLandmark?: string;
    allowParks?: boolean;
    blockedCoreNames?: string[];
    blockedPlaceIds?: string[];
  },
): T[] {
  const parent = opts.parentLandmark ?? opts.profile?.parentLandmark;
  const blockedCores = new Set(
    [
      ...(opts.blockedCoreNames ?? []),
      ...(parent ? [parent, normalizePlaceName(parent)] : []),
    ]
      .map((n) => normalizePlaceName(n))
      .filter(Boolean),
  );
  const blockedIds = new Set(opts.blockedPlaceIds ?? []);
  const seen = new Set<string>();
  const out: T[] = [];

  for (const place of places) {
    const name = (place.placeName ?? place.name ?? "").trim();
    if (!name) continue;

    const id = (place.placeId ?? "").trim();
    if (id && blockedIds.has(id)) continue;

    if (parent && isInternalSubPlaceOfLandmark(name, parent)) continue;
    if (isExcludedInternalFacilityType(place)) continue;
    if (isForbiddenTransitAttraction(place)) continue;

    const core = normalizePlaceName(name);
    if (core && blockedCores.has(core)) continue;
    if (core && seen.has(core)) continue;

    seen.add(core || name);
    out.push(place);
  }

  return out;
}

export function rankLandmarkCompanionPlaces(
  places: PlaceResult[],
  profile: DestinationPlaceSearchProfile,
): PlaceResult[] {
  if (profile.kind !== "landmark" || !profile.parentLandmark) return places;

  const parent = profile.parentLandmark;
  return [...places].sort((a, b) => {
    const aInternal = isInternalSubPlaceOfLandmark(a.name, parent) ? 1 : 0;
    const bInternal = isInternalSubPlaceOfLandmark(b.name, parent) ? 1 : 0;
    if (aInternal !== bInternal) return aInternal - bInternal;

    const aContains = normalizeMatchText(a.name).includes(normalizeMatchText(parent)) ? 1 : 0;
    const bContains = normalizeMatchText(b.name).includes(normalizeMatchText(parent)) ? 1 : 0;
    if (aContains !== bContains) return aContains - bContains;

    const ratingA = (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10);
    const ratingB = (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10);
    return ratingB - ratingA;
  });
}
