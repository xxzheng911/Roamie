/**
 * Transit stations must not be recommended as sightseeing attractions,
 * unless the user asks about transport or the station is a known scenic landmark.
 */

const TRANSIT_STATION_TYPES = new Set([
  "train_station",
  "transit_station",
  "subway_station",
  "bus_station",
  "light_rail_station",
  "railway_station",
  "metro_station",
]);

/** Famous stations that are legitimate tourist sights (not transfer hubs). */
const SCENIC_STATION_ALLOWLIST = [
  "多良車站",
  "多良车站",
  "九份車站",
  "九份车站",
  "十分車站",
  "十分车站",
  "菁桐車站",
  "菁桐车站",
  "北門驛",
  "北门驿",
  "阿里山車站",
  "阿里山车站",
  "侯硐車站",
  "猴硐車站",
  "美功鐵道市場",
];

const GENERIC_STATION_NAME_RE =
  /(?:鐵路|铁路|高铁|高鐵|火車|火车|捷運|地铁|地鐵|地鐵|地铁|地鐵站|捷運站|地铁站|巴士|公車|公交)?站$|(?:Station|Terminal)$/i;

const TRAVEL_STATION_HUB_RE =
  /^(?:東京|东京|上野|池袋|新宿|澀谷|渋谷|品川|横浜|橫濱|大阪|京都|名古屋|札幌|福岡|博多|首爾|首尔|釜山|台北|臺北|台中|臺中|高雄|台東|臺東|花蓮|鹿野|成功)(?:駅|站|車站|车站)$/;

export function isScenicTouristStation(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return SCENIC_STATION_ALLOWLIST.some(
    (allowed) => n === allowed || n.includes(allowed) || allowed.includes(n),
  );
}

export function isTransitStationType(
  place: { types?: string[] | null; primaryType?: string | null },
): boolean {
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary && TRANSIT_STATION_TYPES.has(primary)) return true;
  return (place.types ?? []).some((t) => TRANSIT_STATION_TYPES.has(t.trim().toLowerCase()));
}

/**
 * True when this place should not be recommended as a tourist attraction.
 * Returns false (allow) when userText clearly asks about transport.
 */
export function isForbiddenTransitAttraction(
  place: {
    name?: string | null;
    placeName?: string | null;
    types?: string[] | null;
    primaryType?: string | null;
  },
  userText?: string,
): boolean {
  if (/(交通|怎麼去|怎么去|怎麼到|怎么到|轉乘|换乘|搭車|搭车|電車|电车|捷運|地鐵|地铁|火車|火车|巴士|公車|公交|train|metro|subway|transit)/i.test(
    userText ?? "",
  )) {
    return false;
  }

  const name = (place.placeName ?? place.name ?? "").trim();
  if (name && isScenicTouristStation(name)) return false;

  if (isTransitStationType(place)) return true;
  if (!name) return false;
  if (TRAVEL_STATION_HUB_RE.test(name)) return true;
  if (GENERIC_STATION_NAME_RE.test(name) && !isScenicTouristStation(name)) return true;
  return false;
}

export function filterOutTransitAttractions<T extends {
  name?: string | null;
  placeName?: string | null;
  types?: string[] | null;
  primaryType?: string | null;
}>(places: T[], userText?: string): T[] {
  return places.filter((p) => !isForbiddenTransitAttraction(p, userText));
}
