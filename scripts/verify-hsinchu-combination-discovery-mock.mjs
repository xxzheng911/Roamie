/**
 * Mock Places discovery for 新竹 — ensures real places, no placeholders.
 */
import {
  discoverDestinationCombinations,
  clearDiscoveredCombinationsCache,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { buildDestinationCombinationSuggestionsReply } from "../src/lib/ai/destination-combination-suggestions.ts";

clearDiscoveredCombinationsCache();

const mockPlaces = [
  { id: "ChIJ1", name: "新竹都城隍廟", lat: 24.8045, lng: 120.9686, types: ["place_of_worship"], primaryType: "place_of_worship", rating: 4.5, address: "新竹市北區" },
  { id: "ChIJ2", name: "新竹州廳", lat: 24.806, lng: 120.968, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.4, address: "新竹市" },
  { id: "ChIJ3", name: "東門市場", lat: 24.803, lng: 120.973, types: ["market"], primaryType: "market", rating: 4.2, address: "新竹市東區" },
  { id: "ChIJ4", name: "新竹公園", lat: 24.802, lng: 120.975, types: ["park"], primaryType: "park", rating: 4.3, address: "新竹市" },
  { id: "ChIJ5", name: "新竹市立動物園", lat: 24.8, lng: 120.978, types: ["zoo"], primaryType: "zoo", rating: 4.1, address: "新竹市" },
  { id: "ChIJ6", name: "麗池公園", lat: 24.801, lng: 120.977, types: ["park"], primaryType: "park", rating: 4.0, address: "新竹市" },
  { id: "ChIJ7", name: "南寮漁港", lat: 24.848, lng: 120.929, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.4, address: "新竹市北區南寮" },
  { id: "ChIJ8", name: "香山濕地", lat: 24.76, lng: 120.91, types: ["natural_feature", "park"], primaryType: "park", rating: 4.3, address: "新竹市香山區" },
  { id: "ChIJ9", name: "魚鱗天梯", lat: 24.75, lng: 120.9, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.2, address: "新竹市香山區" },
  { id: "ChIJ10", name: "青青草原", lat: 24.77, lng: 121.01, types: ["park"], primaryType: "park", rating: 4.5, address: "新竹縣" },
  { id: "ChIJ11", name: "十八尖山", lat: 24.79, lng: 120.99, types: ["natural_feature"], primaryType: "natural_feature", rating: 4.3, address: "新竹市" },
  { id: "ChIJ12", name: "北埔老街", lat: 24.7, lng: 121.06, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.2, address: "新竹縣北埔" },
  { id: "ChIJ13", name: "新竹玻璃工藝博物館", lat: 24.8, lng: 120.96, types: ["museum"], primaryType: "museum", rating: 4.4, address: "新竹市" },
  { id: "bad", name: "新竹人氣景點", lat: 24.81, lng: 120.96, types: ["tourist_attraction"], rating: 5, address: "新竹市" },
];

const searchPlaces = async () => ({ places: mockPlaces, error: null });

const result = await discoverDestinationCombinations({
  destination: "新竹",
  searchPlaces,
});

if (!result || result.length < 3) {
  console.error("FAIL discovery produced <3 combinations", result?.length);
  process.exit(1);
}

const placeBlob = result.flatMap((c) => c.placeCandidates.map((p) => p.name)).join("、");
const banned = [
  "新竹人氣景點",
  "新竹必去地標",
  "新竹特色商圈",
  "新竹夜市或市集",
  "新竹公園綠地",
  "新竹博物館",
];

if (banned.some((b) => placeBlob.includes(b))) {
  console.error("FAIL banned placeholder leaked into discovery", placeBlob);
  process.exit(1);
}

const reply = buildDestinationCombinationSuggestionsReply("新竹", 4, {
  startDate: "2026-09-01",
});
if (!reply) {
  console.error("FAIL no reply after discovery");
  process.exit(1);
}
if (banned.some((b) => reply.includes(b))) {
  console.error("FAIL banned in reply");
  process.exit(1);
}

console.log("OK discovery combinations:");
for (const c of result) {
  console.log(`- ${c.title}: ${c.placeCandidates.map((p) => p.name).join("、")}`);
}
console.log("\n---REPLY---\n" + reply);
console.log("\nAll mock discovery checks passed.");
