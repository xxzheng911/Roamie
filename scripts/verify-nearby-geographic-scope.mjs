import assert from "node:assert/strict";
import {
  createClarificationGeographicScope,
  filterPlacesByNearbyGeographicScope,
  parseAdministrativeAddress,
} from "../src/lib/ai/nearby-geographic-scope.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";

function place(id, address) {
  return {
    id,
    name: id,
    address,
    lat: 0,
    lng: 0,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

const gushan = createClarificationGeographicScope({
  entityType: "district",
  displayLabel: "台灣高雄市鼓山區",
  country: "台灣",
});
assert.equal(resolveDestinationEntity("高雄鼓山").type, "district");
assert.equal(gushan.requestedDistrict, "鼓山區");

// 1-2. Explicit district accepts same district and rejects a neighbouring district.
assert.deepEqual(
  filterPlacesByNearbyGeographicScope(
    [place("gushan", "高雄市鼓山區美術東二路"), place("qianjin", "高雄市前金區中華三路")],
    gushan,
  ).map((item) => item.id),
  ["gushan"],
);

// 3. Unknown candidate district must not auto-match.
assert.deepEqual(filterPlacesByNearbyGeographicScope([place("unknown", null)], gushan), []);

// 4. City-level clarification does not impose district equality.
const kaohsiung = createClarificationGeographicScope({
  entityType: "city",
  displayLabel: "台灣高雄市",
  country: "台灣",
});
assert.equal(filterPlacesByNearbyGeographicScope([place("qianjin", "高雄市前金區中華三路")], kaohsiung).length, 1);

// 5-6. Japanese wards use the same suffix parser, without a place-name exception table.
const shinjuku = createClarificationGeographicScope({
  entityType: "district",
  displayLabel: "日本東京都新宿区",
  country: "日本",
});
assert.equal(parseAdministrativeAddress("東京都新宿区西新宿").district, "新宿区");
assert.deepEqual(
  filterPlacesByNearbyGeographicScope(
    [place("shinjuku", "東京都新宿区西新宿"), place("shibuya", "東京都渋谷区神南")],
    shinjuku,
  ).map((item) => item.id),
  ["shinjuku"],
);

// 7. Scope is serializable and therefore can be retained by the continuation snapshot/session.
assert.equal(JSON.parse(JSON.stringify(gushan)).requestedDistrict, gushan.requestedDistrict);

// 8. No explicit scope preserves generic Nearby candidates.
assert.equal(filterPlacesByNearbyGeographicScope([place("generic", null)], undefined).length, 1);

console.log("nearby geographic scope contract: ok");
