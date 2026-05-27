import type { LocationSuggestion, TripLocation } from "@/lib/location/types";

type CuratedDestination = {
  id: string;
  aliases: string[];
  location: TripLocation;
};

/** Google API 不可用時的常用目的地（規劃行程目的地／起點） */
const CURATED_DESTINATIONS: CuratedDestination[] = [
  {
    id: "curated:taipei-tw",
    aliases: ["台北", "臺北", "taipei", "taipe"],
    location: {
      placeId: "curated:taipei-tw",
      country: "台灣",
      city: "台北",
      region: "台北市",
      lat: 25.033,
      lng: 121.5654,
      formattedName: "台灣・台北",
      displayLabel: "台灣・台北",
    },
  },
  {
    id: "curated:kaohsiung-tw",
    aliases: ["高雄", "kaohsiung"],
    location: {
      placeId: "curated:kaohsiung-tw",
      country: "台灣",
      city: "高雄",
      region: "高雄市",
      lat: 22.6273,
      lng: 120.3014,
      formattedName: "台灣・高雄",
      displayLabel: "台灣・高雄",
    },
  },
  {
    id: "curated:taichung-tw",
    aliases: ["台中", "臺中", "taichung"],
    location: {
      placeId: "curated:taichung-tw",
      country: "台灣",
      city: "台中",
      region: "台中市",
      lat: 24.1477,
      lng: 120.6736,
      formattedName: "台灣・台中",
      displayLabel: "台灣・台中",
    },
  },
  {
    id: "curated:tainan-tw",
    aliases: ["台南", "臺南", "tainan"],
    location: {
      placeId: "curated:tainan-tw",
      country: "台灣",
      city: "台南",
      region: "台南市",
      lat: 22.9999,
      lng: 120.2269,
      formattedName: "台灣・台南",
      displayLabel: "台灣・台南",
    },
  },
  {
    id: "curated:hsinchu-tw",
    aliases: ["新竹", "hsinchu"],
    location: {
      placeId: "curated:hsinchu-tw",
      country: "台灣",
      city: "新竹",
      lat: 24.8138,
      lng: 120.9675,
      formattedName: "台灣・新竹",
      displayLabel: "台灣・新竹",
    },
  },
  {
    id: "curated:hualien-tw",
    aliases: ["花蓮", "hualien"],
    location: {
      placeId: "curated:hualien-tw",
      country: "台灣",
      city: "花蓮",
      lat: 23.991,
      lng: 121.611,
      formattedName: "台灣・花蓮",
      displayLabel: "台灣・花蓮",
    },
  },
  {
    id: "curated:busan-kr",
    aliases: ["釜山", "busan", "부산"],
    location: {
      placeId: "curated:busan-kr",
      country: "韓國",
      city: "釜山",
      lat: 35.1796,
      lng: 129.0756,
      formattedName: "韓國・釜山",
      displayLabel: "韓國・釜山",
    },
  },
  {
    id: "curated:seoul-kr",
    aliases: ["首爾", "首尔", "seoul", "서울"],
    location: {
      placeId: "curated:seoul-kr",
      country: "韓國",
      city: "首爾",
      lat: 37.5665,
      lng: 126.978,
      formattedName: "韓國・首爾",
      displayLabel: "韓國・首爾",
    },
  },
  {
    id: "curated:tokyo-jp",
    aliases: ["東京", "东京", "tokyo", "とうきょう"],
    location: {
      placeId: "curated:tokyo-jp",
      country: "日本",
      city: "東京",
      lat: 35.6762,
      lng: 139.6503,
      formattedName: "日本・東京",
      displayLabel: "日本・東京",
    },
  },
  {
    id: "curated:osaka-jp",
    aliases: ["大阪", "osaka", "おおさか"],
    location: {
      placeId: "curated:osaka-jp",
      country: "日本",
      city: "大阪",
      lat: 34.6937,
      lng: 135.5023,
      formattedName: "日本・大阪",
      displayLabel: "日本・大阪",
    },
  },
  {
    id: "curated:kyoto-jp",
    aliases: ["京都", "kyoto"],
    location: {
      placeId: "curated:kyoto-jp",
      country: "日本",
      city: "京都",
      lat: 35.0116,
      lng: 135.7681,
      formattedName: "日本・京都",
      displayLabel: "日本・京都",
    },
  },
  {
    id: "curated:hongkong",
    aliases: ["香港", "hong kong", "hongkong"],
    location: {
      placeId: "curated:hongkong",
      country: "香港",
      city: "香港",
      lat: 22.3193,
      lng: 114.1694,
      formattedName: "香港",
      displayLabel: "香港",
    },
  },
  {
    id: "curated:singapore",
    aliases: ["新加坡", "singapore"],
    location: {
      placeId: "curated:singapore",
      country: "新加坡",
      city: "新加坡",
      lat: 1.3521,
      lng: 103.8198,
      formattedName: "新加坡",
      displayLabel: "新加坡",
    },
  },
  {
    id: "curated:bangkok-th",
    aliases: ["曼谷", "bangkok"],
    location: {
      placeId: "curated:bangkok-th",
      country: "泰國",
      city: "曼谷",
      lat: 13.7563,
      lng: 100.5018,
      formattedName: "泰國・曼谷",
      displayLabel: "泰國・曼谷",
    },
  },
];

function normalizeMatchKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s·・,，/]+/g, "");
}

function matchesCuratedQuery(query: string, alias: string): boolean {
  const q = normalizeMatchKey(query);
  const a = normalizeMatchKey(alias);
  if (q.length < 2 || a.length < 2) return false;
  if (q === a) return true;
  if (a.startsWith(q)) return true;
  if (q.startsWith(a) && a.length >= 2) return true;
  return false;
}

export function isCuratedTripLocationId(placeId: string): boolean {
  return placeId.trim().startsWith("curated:");
}

export function searchCuratedTripLocations(query: string): LocationSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const hits: LocationSuggestion[] = [];
  const seen = new Set<string>();

  for (const entry of CURATED_DESTINATIONS) {
    const matched = entry.aliases.some((alias) => matchesCuratedQuery(trimmed, alias));
    if (!matched) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    hits.push({
      placeId: entry.id,
      label: entry.location.displayLabel,
      secondary: entry.location.country,
    });
  }

  if (hits.length > 0) {
    console.info("[TRIP_PLACE_SEARCH] source=curated predictions=", hits.length);
  }
  return hits;
}

export function resolveCuratedTripLocation(placeId: string): TripLocation | null {
  const id = placeId.trim();
  const hit = CURATED_DESTINATIONS.find((e) => e.id === id);
  if (!hit) return null;
  console.info("[TRIP_PLACE_SEARCH] source=curated resolve=", hit.location.displayLabel);
  return { ...hit.location };
}

export function curatedTripLocationToPlaceInput(loc: TripLocation) {
  return {
    name: loc.city || loc.displayLabel,
    placeName: loc.city || loc.displayLabel,
    title: loc.displayLabel,
    address: loc.address ?? loc.displayLabel,
    lat: loc.lat,
    lng: loc.lng,
    googlePlaceId: loc.placeId,
    placeType: loc.city,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`,
  };
}
