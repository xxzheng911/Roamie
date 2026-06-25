import assert from "node:assert/strict";
import {
  filterChatDestinationPlaces,
  isSubPlaceOfDestination,
  CHAT_DESTINATION_MIN_COUNT,
} from "../src/lib/ai/chat-destination-place-filter.ts";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";
import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
} from "../src/lib/is-recommendable-place.ts";

function place(
  overrides: Partial<{
    id: string;
    name: string;
    rating: number | null;
    userRatingCount: number | null;
    primaryType: string;
    types: string[];
    businessStatus: string;
    openStatus: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "台東海濱公園",
    address: "",
    lat: 22.76,
    lng: 121.14,
    rating: overrides.rating ?? 4.5,
    userRatingCount: overrides.userRatingCount ?? 1200,
    photoName: null,
    primaryType: overrides.primaryType ?? "tourist_attraction",
    types: overrides.types ?? ["tourist_attraction", "park"],
    businessStatus: overrides.businessStatus ?? "OPERATIONAL",
    openStatus: overrides.openStatus ?? "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

const taitungCenter = resolveDestinationApproxCenter("台東");
assert(Math.abs(taitungCenter.lat - 22.758) < 0.01, "台東 approx center lat");
assert(Math.abs(taitungCenter.lng - 121.144) < 0.01, "台東 approx center lng");

const tokyoCenter = resolveDestinationApproxCenter("東京");
assert(Math.abs(tokyoCenter.lat - 35.676) < 0.01, "東京 approx center not Taiwan default");
assert(Math.abs(tokyoCenter.lng - 139.65) < 0.01, "東京 approx center lng");

const mixed = [
  place({ id: "a", name: "國立臺東美術館", rating: 4.6, userRatingCount: 800, primaryType: "museum", types: ["museum", "art_gallery"] }),
  place({ id: "b", name: "台東觀光夜市", rating: 4.0, userRatingCount: 5344, primaryType: "market", types: ["market", "tourist_attraction"], openStatus: "closed_now" }),
  place({ id: "c", name: "鯉魚山觀景台", rating: 4.8, userRatingCount: 44, primaryType: "tourist_attraction" }),
  place({ id: "d", name: "台東市立體育場", rating: 4.2, userRatingCount: 200, primaryType: "secondary_school", types: ["secondary_school", "school"] }),
  place({ id: "e", name: "小野柳", rating: 4.4, userRatingCount: 2100, primaryType: "tourist_attraction" }),
  place({ id: "f", name: "初鹿牧場", rating: 4.3, userRatingCount: 15000, primaryType: "tourist_attraction" }),
];

const filtered = filterChatDestinationPlaces(mixed, { destination: "台東" });
assert(filtered.length >= CHAT_DESTINATION_MIN_COUNT, "layered filter keeps at least 3 Taitung places");
assert(!filtered.some((p) => p.name.includes("體育場")), "school excluded");
assert(filtered.some((p) => p.name.includes("夜市")), "night market kept despite closed_now");

const chatRec = isRecommendablePlace(
  placeResultToRecommendableInput(place({ name: "鯉魚山觀景台", rating: 4.8, userRatingCount: 5 })),
  "chat_destination_recommend",
);
assert(chatRec.ok, "chat_destination_recommend permissive on server");

const exploreStrict = isRecommendablePlace(
  placeResultToRecommendableInput(place({ name: "鯉魚山觀景台", rating: 4.8, userRatingCount: 5 })),
  "explore_map",
);
assert(!exploreStrict.ok, "explore_map still strict");

assert(
  isSubPlaceOfDestination(
    place({ name: "富士山五合目賣店", primaryType: "store", types: ["store"] }),
    "富士山",
    { kind: "landmark", label: "富士山", parentLandmark: "富士山", nearestCity: undefined },
  ),
  "sub-place of landmark excluded",
);

console.log("verify-chat-destination-places: ok");
