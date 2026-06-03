/**
 * Simulates production explore text search post-filter (no exploreMapTextSearch).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = readFileSync(join(root, ".env"), "utf8").match(/^GOOGLE_PLACES_SERVER_API_KEY=(.+)$/m)?.[1]?.trim();
const MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus";

const TRAVEL_FRIENDLY = new Set([
  "tourist_attraction","museum","cafe","coffee_shop","restaurant","park","shopping_mall",
]);

const EXCLUDED = new Set(["train_station","subway_station","transit_station","hotel","lodging"]);

async function textSearch(query, withBias) {
  const body = { textQuery: query, languageCode: "zh-TW", pageSize: 10, regionCode: "TW" };
  if (withBias) {
    body.locationBias = { circle: { center: { latitude: 22.63, longitude: 120.3 }, radius: 15000 } };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return json.places ?? [];
}

function wouldKeep(place) {
  const type = (place.primaryType ?? place.types?.[0] ?? "").toLowerCase();
  const name = place.displayName?.text ?? "";
  if (EXCLUDED.has(type)) return false;
  if (TRAVEL_FRIENDLY.has(type)) return true;
  if (/咖啡|餐廳|景點|鐵塔|車站|starbucks/i.test(name)) return true;
  return false;
}

for (const q of ["高雄車站", "東京鐵塔", "Stellar garden", "Starbucks"]) {
  for (const bias of [true, false]) {
    const raw = await textSearch(q, bias);
    const kept = raw.filter(wouldKeep);
    console.log(q, { bias, raw: raw.length, kept: kept.length, first: raw[0]?.displayName?.text, type: raw[0]?.primaryType });
  }
}
