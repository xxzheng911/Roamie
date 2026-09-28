import assert from "node:assert/strict";
import fs from "node:fs";
import { googleRestRequest } from "../src/lib/google-rest-contract.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { GOOGLE_PLACES_MAX_RADIUS_METERS as max } from "../src/lib/google-maps-api.ts";
const circle = (r) => ({ circle: { center: { latitude: 0, longitude: 0 }, radius: r } });
const rectangle = {
  rectangle: { low: { latitude: 0, longitude: 0 }, high: { latitude: 1, longitude: 1 } },
};
const request = (op, body) => ({
  url: "https://places.googleapis.com/v1/places:" + op,
  method: "POST",
  body,
});
const text = request("searchText", { textQuery: "Tokyo", pageSize: 1 });
const nearby = request("searchNearby", { locationRestriction: circle(1000), maxResultCount: 20 });
const auto = request("autocomplete", { input: "Tokyo" });
const details = {
  url: "https://places.googleapis.com/v1/places/synthetic?languageCode=ja",
  method: "GET",
  fieldMask: "id,location,addressComponents",
};
for (const radius of [0, 1000, max]) {
  assert.equal(
    googleRestRequest({ ...auto, body: { ...auto.body, locationBias: circle(radius) } }).body
      .locationBias.circle.radius,
    radius,
  );
}
for (const fixture of [
  text,
  nearby,
  auto,
  details,
  { ...text, body: { textQuery: "Tokyo", locationRestriction: rectangle } },
  {
    ...auto,
    body: {
      input: "Tokyo",
      sessionToken: "synthetic-session",
      includedPrimaryTypes: ["(regions)"],
      languageCode: "zh-TW",
    },
  },
])
  assert.equal(googleRestRequest(fixture).family, "places");
const bad = [];
for (const [base, fields] of [
  [
    text,
    {
      includedTypes: ["cafe"],
      excludedTypes: ["bar"],
      includedPrimaryTypes: ["cafe"],
      excludedPrimaryTypes: ["bar"],
      rankPreference: "POPULARITY",
      locationRestriction: circle(1000),
    },
  ],
  [
    nearby,
    {
      textQuery: "Tokyo",
      includedType: "cafe",
      pageToken: "x",
      pageSize: 1,
      locationBias: circle(1000),
      locationRestriction: rectangle,
      rankPreference: "RELEVANCE",
      openNow: true,
      minRating: 4,
      strictTypeFiltering: true,
    },
  ],
  [auto, { textQuery: "Tokyo", pageSize: 1, includedTypes: ["cafe"] }],
])
  for (const [k, v] of Object.entries(fields))
    bad.push({ ...base, body: { ...base.body, [k]: v } });
for (const base of [text, nearby, auto])
  bad.push({ ...base, body: { ...base.body, unknown: "deny" } });
for (const radius of [-1, 50001, 80000, Infinity, NaN])
  bad.push({ ...auto, body: { input: "Tokyo", locationBias: circle(radius) } });
for (const value of [
  { circle: { radius: 100 } },
  { circle: { center: { latitude: 91, longitude: 0 }, radius: 1 } },
  { circle: { center: { latitude: 0, longitude: 0 }, radius: 1, unknown: 1 } },
  { circle: { center: { latitude: 0, longitude: 0 }, radius: "1000" } },
])
  bad.push({ ...auto, body: { input: "Tokyo", locationBias: value } });
for (const base of [text, auto])
  bad.push({
    ...base,
    body: {
      ...base.body,
      locationBias: circle(100),
      locationRestriction: base === text ? rectangle : circle(100),
    },
  });
bad.push(
  { ...nearby, body: { maxResultCount: 1 } },
  { ...text, body: { pageSize: 1 } },
  { ...auto, body: { input: "Tokyo", locationRestriction: circle(0) } },
);
for (const n of [0, 21, 100, 1.5]) {
  bad.push({ ...text, body: { textQuery: "Tokyo", pageSize: n } });
  bad.push({ ...nearby, body: { ...nearby.body, maxResultCount: n } });
}
for (const fieldMask of ["*", "places.id,", "places.id, id", "id", "places.id\n", "places.unknown"])
  bad.push({ ...text, fieldMask });
bad.push(
  { ...details, url: details.url + "&pageSize=1" },
  { ...details, body: { input: "Tokyo" } },
  { ...details, fieldMask: "places.id" },
);
let outbound = 0;
for (const fixture of bad) {
  assert.throws(() => googleRestRequest(fixture));
  const r = await fetchGoogleRestProvider(fixture, {}, async () => {
    outbound++;
    throw Error("must not reach provider");
  });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "invalid_google_request" });
}
assert.equal(outbound, 0);
const caller = fs.readFileSync("src/lib/location.functions.ts", "utf8");
assert.ok(caller.includes("radius: GOOGLE_PLACES_MAX_RADIUS_METERS"));
assert.ok(!caller.includes("radius: 80_000"));
console.log(
  `PASS four independent Places contracts; radius 0/1000/50000; ${bad.length} negative controls; rejected requests never reach provider`,
);
