import { loadEnv } from "vite";
import { executeExploreSearch } from "../src/lib/places.functions.ts";
import {
  STYLE_RECOMMENDATION_FAMILIES,
  createPlanningSelectionSession,
  fetchPlanningSelectionRecommendations,
} from "../src/lib/planning-selection.ts";

const env = loadEnv("development", process.cwd(), "");
const apiKey = env.GOOGLE_MAPS_API_KEY || env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!apiKey) throw new Error("Google Maps API key unavailable");

const contract = STYLE_RECOMMENDATION_FAMILIES["親子同遊"];
const searchPlaces = ({ data }) => executeExploreSearch(data, { apiKey });
const destinations = process.argv.includes("--cross")
  ? [
      { name: "台北", lat: 25.033, lng: 121.5654, administrativeNames: ["台北", "台北市", "臺北市"] },
      { name: "高雄", lat: 22.6273, lng: 120.3014, administrativeNames: ["高雄", "高雄市"] },
      { name: "台中", lat: 24.1477, lng: 120.6736, administrativeNames: ["台中", "台中市", "臺中市"] },
      { name: "東京", lat: 35.6762, lng: 139.6503, administrativeNames: ["東京", "東京都", "Tokyo"] },
    ]
  : [{ name: "屏東", lat: 22.669, lng: 120.489, administrativeNames: ["屏東", "屏東縣", "Pingtung County"] }];

console.log("[FAMILY_CONTRACT]", JSON.stringify(contract));
for (const destination of destinations) {
  let session = {
    phase: "collect",
    recommendedPlaces: [],
    selectedPlaces: [],
    planningSelection: createPlanningSelectionSession({ styles: ["親子同遊"], destination }),
  };
  for (let round = 1; round <= 30; round += 1) {
    const result = await fetchPlanningSelectionRecommendations({ session, searchPlaces, locale: "zh-TW" });
    session = result.session;
    const lane = session.planningSelection.lanes[0];
    console.log("[FAMILY_ROUND]", JSON.stringify({
      destination: destination.name,
      round,
      names: result.places.map((place) => place.name),
      types: result.places.map((place) => place.types),
      addresses: result.places.map((place) => place.address),
      returnedCount: result.places.length,
      shownCount: session.planningSelection.shownPlaceIds.length,
      candidatePoolCount: lane.candidatePool?.length ?? 0,
      searchedQueryIndexes: lane.searchedQueryIndexes ?? [],
      exhausted: lane.exhausted ?? false,
    }));
    if (!result.places.length && lane.exhausted) break;
  }
}
