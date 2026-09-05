import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePlanDepartureState } from "../src/lib/plan-departure-authority.ts";
import { preparePlanTripSession } from "../src/lib/plan-trip-handoff.ts";
import { buildPlanFormTripPayload } from "../src/lib/plan-form-trip-payload.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.info(`PASS ${name}`);
};
const destination = {
  placeId: "ChIJTaipeiDestination",
  displayLabel: "台北市",
  formattedName: "台北市",
  city: "台北市",
  country: "台灣",
  address: "台北市",
  lat: 25.0375,
  lng: 121.5637,
};
const departure = {
  placeId: "ChIJTaipeiStation",
  displayLabel: "台北車站",
  formattedName: "台北車站",
  city: "台北市",
  country: "台灣",
  address: "台北市中正區",
  lat: 25.0478,
  lng: 121.517,
};
const form = {
  destination,
  origin: null,
  days: 2,
  mood: "",
  styles: ["城市漫遊", "藝術展覽"],
  startDate: "2026-09-10",
  endDate: "2026-09-11",
  departureTime: "",
  travelers: 1,
  transport: "大眾運輸",
  budgetMode: "standard",
};
const bundle = { weather: null };

test("destination valid plus blank departure is omitted", () =>
  assert.equal(resolvePlanDepartureState("", null), "omitted"));
test("whitespace departure is omitted", () =>
  assert.equal(resolvePlanDepartureState("   ", null), "omitted"));
test("undefined departure is omitted", () =>
  assert.equal(resolvePlanDepartureState(undefined, undefined), "omitted"));
test("null departure is omitted", () =>
  assert.equal(resolvePlanDepartureState(null, null), "omitted"));
test("empty visible text overrides stale selected departure", () =>
  assert.equal(resolvePlanDepartureState("", departure), "omitted"));
test("typed but unselected departure is unresolved", () =>
  assert.equal(resolvePlanDepartureState("台北車站", null), "text_unresolved"));
test("selected departure is authoritative", () =>
  assert.equal(resolvePlanDepartureState("台北車站", departure), "selected"));

test("chat planning handoff accepts absent departure", () => {
  const session = preparePlanTripSession(form, bundle, undefined, { planAiMode: false });
  assert.equal(session.tripOrigin, undefined);
  assert.doesNotMatch(session.initialChatContext, /tripOrigin：/);
});

test("Selection handoff accepts absent departure", () => {
  const session = preparePlanTripSession(form, bundle, undefined, {
    planAiMode: true,
    localeStyleOptions: form.styles,
  });
  assert.equal(session.tripOrigin, undefined);
  assert.ok(session.planningSelection);
});

test("direct trip payload omits origin instead of fabricating it", () => {
  const payload = buildPlanFormTripPayload(form);
  assert.equal(payload.originLocation, undefined);
  assert.doesNotMatch(payload.summary, /出發：/);
});

test("selected departure remains preserved", () => {
  const session = preparePlanTripSession({ ...form, origin: departure }, bundle);
  assert.equal(session.tripOrigin?.placeId, departure.placeId);
});

test("both submit buttons share one resolver", () => {
  const source = readFileSync("src/routes/_app.plan.tsx", "utf8");
  assert.match(source, /handleCreateTripDirect[\s\S]*resolvePlanFormForSubmit\(\)/);
  assert.match(source, /startPlanChat[\s\S]*resolvePlanFormForSubmit\(handoffTrace/);
});

test("clearing field text clears selected authority", () => {
  const source = readFileSync("src/components/LocationSearchField.tsx", "utf8");
  assert.match(source, /if \(!next\.trim\(\)\)[\s\S]*?onChange\(null\)/);
});

test("external clear synchronizes query authority and invalidates stale async work", () => {
  const source = readFileSync("src/components/LocationSearchField.tsx", "utf8");
  assert.match(source, /else if \(!focused\)[\s\S]*?onQueryChange\?\.\(""\)/);
  assert.match(source, /interactionGenRef\.current \+= 1/);
});

test("destination remains required", () => {
  assert.throws(() =>
    preparePlanTripSession(
      { ...form, destination: { ...destination, placeId: "", lat: NaN } },
      bundle,
    ),
  );
});

console.info(`P23 optional departure: ${passed}/15 passed`);
