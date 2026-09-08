import assert from "node:assert/strict";
import { itineraryGeographicScopeDecision } from "../src/lib/itinerary.functions.ts";
import { recoverItineraryGoogleIdentities, itineraryIdentityCounts } from "../src/lib/ai/itinerary-google-identity.ts";
import { parsePlanningConstraintDelta } from "../src/lib/ai/planning-conversation-constraints.ts";

const decision = (destination, address) =>
  itineraryGeographicScopeDecision({ address }, destination).decision;

const matrix = [
  { city: "台北", destinations: ["台北", "臺北", "台北市", "臺北市"], same: ["信義區", "中正區", "萬華區"], cross: "基隆市" },
  { city: "高雄", destinations: ["高雄", "高雄市"], same: ["苓雅區", "鼓山區", "左營區"], cross: "台南市" },
  { city: "東京", destinations: ["Tokyo", "Tokyo-to", "東京", "東京都"], same: ["Shinjuku-ku", "Shibuya-ku", "新宿区"], cross: "横浜市" },
  { city: "京都", destinations: ["Kyoto", "Kyoto-shi", "京都", "京都市"], same: ["京都市中京区", "Higashiyama-ku"], cross: "大阪市" },
  { city: "大阪", destinations: ["Osaka", "Osaka-shi", "大阪", "大阪市"], same: ["Kita-ku, Osaka-shi", "大阪市中央区"], cross: "京都市" },
  { city: "首爾", destinations: ["Seoul", "Seoul Special City", "서울특별시"], same: ["Gangnam-gu", "강남구"], cross: "Incheon" },
  { city: "釜山", destinations: ["Busan", "Busan Metropolitan City", "부산광역시"], same: ["Haeundae-gu", "해운대구"], cross: "Daegu" },
];

for (const fixture of matrix) {
  for (const destination of fixture.destinations) {
    for (const address of fixture.same) {
      assert.equal(decision(destination, address), "in_scope", `${destination}: ${address}`);
    }
    assert.equal(decision(destination, fixture.cross), "out_of_scope", `${destination}: ${fixture.cross}`);
    assert.equal(decision(destination, "unknown locality"), "unknown", `${destination}: unknown`);
  }
}

const fullFixtures = matrix.slice(1);
for (const [fixtureIndex, fixture] of fullFixtures.entries()) {
  const destination = fixture.destinations[0];
  const candidate = (index, address, required) => ({
    name: `${fixture.city} fixture ${index}`,
    placeName: `${fixture.city} fixture ${index}`,
    googlePlaceId: `ChIJP37${fixtureIndex}Identity${index}`,
    address,
    lat: 20 + fixtureIndex + index / 100,
    lng: 120 + fixtureIndex + index / 100,
    type: "tourist_attraction",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    isRequiredBySelection: required,
  });
  const required = [0, 1, 2].map((index) => candidate(index, fixture.same[index % fixture.same.length], true));
  const supplemental = [3, 4, 5].map((index) => candidate(index, fixture.same[index % fixture.same.length], false));
  const cross = candidate(6, fixture.cross, false);
  const unknown = candidate(7, "unknown locality", false);
  const acceptedSupplemental = [...supplemental, cross, unknown].filter(
    (place) => decision(destination, place.address) !== "out_of_scope",
  );
  assert.equal(acceptedSupplemental.includes(cross), false);
  assert.equal(acceptedSupplemental.includes(unknown), true);
  const accepted = [...required, ...acceptedSupplemental];
  assert.equal(accepted.length, 7);
  const stops = accepted.map((place, index) => ({
    date: index < 3 ? "2026-09-07" : "2026-09-08",
    dayIndex: index < 3 ? 0 : 1,
    time: `${String(9 + (index % 4) * 2).padStart(2, "0")}:00`,
    title: place.name,
    placeName: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    placeType: place.type,
    types: place.types,
  }));
  const recovered = recoverItineraryGoogleIdentities({ stops, candidates: accepted });
  assert.equal(recovered.unrecoverableCount, 0, fixture.city);
  assert.equal(itineraryIdentityCounts(recovered.items, accepted).googleIdentityCount, 7, fixture.city);
  assert.deepEqual(recovered.items.slice(0, 3).map((item) => item.googlePlaceId), required.map((place) => place.googlePlaceId));
  assert.equal(recovered.items.some((item) => item.placeName === cross.placeName), false);
}

const shown = (names) => names.map((name, index) => ({
  name,
  placeName: name,
  placeId: `ChIJP37Planning${index}${name.length}`,
  googlePlaceId: `ChIJP37Planning${index}${name.length}`,
}));
const excludedNames = (destination, text, names) => parsePlanningConstraintDelta({
  text,
  shownCandidates: shown(names),
  authoritativeDestination: destination,
}).excludedPlaces.map((place) => place.canonicalName);

assert.deepEqual(excludedNames("台北", "不要101", ["台北101"]), ["台北101"]);
assert.deepEqual(excludedNames("東京", "不要鐵塔", ["東京鐵塔"]), ["東京鐵塔"]);
assert.deepEqual(excludedNames("大阪", "不要城", ["大阪城"]), ["大阪城"]);
assert.deepEqual(excludedNames("大阪", "不要城", ["大阪城", "大阪城公園"]), []);

console.log("P37 administrative geography: PASS", {
  geographicCities: matrix.length,
  fullItineraryCities: fullFixtures.length,
  p36IdentityCities: fullFixtures.length,
  externalRequestDelta: 0,
});
