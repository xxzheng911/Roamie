import { loadEnv } from "vite";
import { executeExploreSearch } from "../src/lib/places.functions.ts";

const env = loadEnv("development", process.cwd(), "");
const apiKey = env.GOOGLE_MAPS_API_KEY || env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!apiKey) throw new Error("Google Maps API key unavailable");

const center = { lat: 24.8138, lng: 120.9675 };
const attempts = [
  ["A", "新竹 露營區", false],
  ["B", "新竹縣 露營區", false],
  ["C", "新竹 尖石 露營區", false],
  ["D", "新竹 五峰 露營區", false],
  ["E", "campground near Hsinchu", false],
  ["F", "露營區", false],
];

if (!process.argv.includes("--cross-only")) for (const [label, query, skipLocationBias] of attempts) {
  const result = await executeExploreSearch(
    {
      ...center,
      radius: 50_000,
      query,
      mode: "text",
      includedTypes: ["campground", "rv_park"],
      locale: "zh-TW",
      categoryId: "camping",
      placesCaller: "planning_selection_lane",
      placesScreen: "chat",
      destinationName: "新竹",
      searchMode: "destination",
      intentCategory: "camping",
      planningSelectionStyle: "露營野遊",
      skipLocationBias,
    },
    { apiKey },
  );
  console.log(JSON.stringify({
    label,
    query,
    locationBias: skipLocationBias ? "none" : { ...center, radius: 50_000 },
    count: result.places.length,
    error: result.error,
    places: result.places.map((place) => ({
      name: place.name,
      types: place.types,
      lat: place.lat,
      lng: place.lng,
      address: place.address,
    })),
  }, null, 2));
}

const crossDestinationChecks = [
  ["台北", 25.033, 121.5654],
  ["高雄", 22.6273, 120.3014],
  ["東京", 35.6762, 139.6503],
];
for (const [destinationName, lat, lng] of crossDestinationChecks) {
  const result = await executeExploreSearch(
    {
      lat,
      lng,
      radius: 50_000,
      query: `${destinationName} 露營區`,
      mode: "text",
      locale: "zh-TW",
      categoryId: "camping",
      placesCaller: "planning_selection_lane",
      placesScreen: "chat",
      destinationName,
      searchMode: "destination",
      intentCategory: "camping",
      planningSelectionStyle: "露營野遊",
    },
    { apiKey },
  );
  console.log(JSON.stringify({
    destinationCheck: destinationName,
    count: result.places.length,
    error: result.error,
    sample: result.places.slice(0, 5).map((place) => ({
      name: place.name,
      types: place.types,
      address: place.address,
    })),
  }, null, 2));
}
