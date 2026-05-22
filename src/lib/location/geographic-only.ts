/** 規劃表單：僅國家 / 城市 / 行政區，排除店家與 POI */

export const TRIP_LOCATION_PRIMARY_TYPES = [
  "country",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
] as const;

const ALLOWED_GEO_TYPES = new Set([
  "country",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "political",
  "colloquial_area",
  "archipelago",
]);

const REJECTED_POI_TYPES = new Set([
  "establishment",
  "point_of_interest",
  "store",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "food",
  "shopping_mall",
  "department_store",
  "supermarket",
  "convenience_store",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "amusement_park",
  "lodging",
  "hotel",
  "gas_station",
  "transit_station",
  "subway_station",
  "bus_station",
  "airport",
  "train_station",
  "parking",
  "hospital",
  "school",
  "university",
  "church",
  "place_of_worship",
  "street_address",
  "premise",
  "subpremise",
  "route",
  "intersection",
  "postal_code",
  "plus_code",
  "geocode",
  "floor",
  "room",
]);

export function isGeographicPlaceTypes(types: string[] | undefined): boolean {
  if (!types?.length) return true;
  if (types.some((t) => REJECTED_POI_TYPES.has(t))) return false;
  return types.some((t) => ALLOWED_GEO_TYPES.has(t));
}

export function isRejectedTripLocationLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (/\d+\s*號|\d+-\d+|^\d+/.test(t)) return true;
  if (/(餐廳|咖啡|咖啡廳|飯店|旅館|民宿|超商|便利商店|百貨|商場|書店|藥局|醫院|學校|站|機場|港口|碼頭|寺|廟|宮|神社|博物館|美術館|樂園|夜市|店$|館$)/.test(t)) {
    return true;
  }
  return false;
}

/** 建議列表顯示：國家・城市（例：日本・大阪） */
export function formatGeographicSuggestionLabel(main: string, secondary?: string): string {
  const m = main.trim();
  const s = secondary?.trim();
  if (!m) return "";
  if (!s || m === s) return m;
  if (m.includes("・")) return m;
  if (s.includes("・") && s.includes(m)) return s;
  return `${s}・${m}`;
}

export function buildFormattedName(country: string, city: string, rawName: string): string {
  if (!country && !city) return rawName;
  if (!city || city === country) return country || city || rawName;
  if (rawName.includes("・")) return rawName;
  if (city.includes(country)) return city;
  return `${country}・${city}`;
}
