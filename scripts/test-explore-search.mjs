import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const key = env.match(/^GOOGLE_PLACES_SERVER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error("missing GOOGLE_PLACES_SERVER_API_KEY");
  process.exit(1);
}

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos,places.primaryType,places.types,places.businessStatus,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes";

async function searchText(query, mapTextSearch) {
  const body = {
    textQuery: query,
    languageCode: "zh-TW",
    pageSize: 10,
  };
  if (!mapTextSearch) {
    body.locationBias = {
      circle: {
        center: { latitude: 22.63, longitude: 120.3 },
        radius: 15000,
      },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, count: json.places?.length ?? 0, json };
}

for (const q of ["高雄車站", "Stellar garden", "Starbucks"]) {
  const withBias = await searchText(q, false);
  const noBias = await searchText(q, true);
  console.log(q, {
    withBias: { status: withBias.status, count: withBias.count },
    noBias: { status: noBias.status, count: noBias.count },
    firstNoBias: noBias.json.places?.[0]?.displayName?.text,
  });
}

const prod = await fetch("https://roamie.tw/api/places-search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "capacitor://localhost",
  },
  body: JSON.stringify({
    query: "高雄車站",
    lat: 22.63,
    lng: 120.3,
    radius: 15000,
    mode: "text",
    locale: "zh-TW",
    availabilityContext: "lenient",
    telemetrySurface: "map",
    exploreMapTextSearch: true,
  }),
});
console.log("roamie.tw api", prod.status, await prod.text());
