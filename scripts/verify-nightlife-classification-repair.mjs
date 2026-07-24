import assert from "node:assert/strict";
import { resolveNightlifeClassification } from "../src/lib/ai/nightlife-classification.ts";
import { repairNightlifeTiming } from "../src/lib/ai/itinerary-validator/replan.ts";
import { validateItineraryPlan, shouldBlockItineraryDelivery } from "../src/lib/ai/itinerary-validator/validate.ts";
import { setItineraryValidatorEnabledOverride } from "../src/lib/ai/itinerary-validator/feature-flag.ts";

function place(id, name, primaryType, types = [primaryType]) {
  return { id, name, localizedDisplayName: name, address: "Generic island", lat: 11.96, lng: 121.93,
    rating: 4.5, userRatingCount: 500, photoName: null, primaryType, types,
    businessStatus: null, openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "",
    closingSoonNote: "", nextOpenHint: "" };
}
function entry(time, p) { return { time, label: "景點", name: p.name, place: p }; }

for (const p of [
  place("beach", "夕陽海灘", "beach", ["beach", "tourist_attraction"]),
  place("sunset", "Sunset Viewpoint", "observation_deck", ["observation_deck"]),
  place("coast", "Coastal Promenade", "tourist_attraction", ["tourist_attraction"]),
  place("day-club", "White Beach Club", "beach_club", ["beach_club", "restaurant"]),
]) assert.equal(resolveNightlifeClassification(p).isNightlife, false, p.name);

const nightClub = place("night", "Island Night Club", "night_club", ["night_club", "bar"]);
assert.equal(resolveNightlifeClassification(nightClub).isNightlife, true);
const nightBeachClub = place("night-beach", "Moon Beach Club", "beach_club", ["beach_club", "night_club", "bar"]);
assert.equal(resolveNightlifeClassification(nightBeachClub).nightlifeSubtype, "night_beach_club");

const repaired = repairNightlifeTiming([{ day: 1, entries: [entry("10:00", nightClub), entry("14:00", place("museum", "島嶼博物館", "museum"))] }], 1);
assert.ok(repaired[0].entries.find((e) => e.place.id === "night").time >= "18:00");

setItineraryValidatorEnabledOverride(true);
const sixDays = Array.from({ length: 6 }, (_, index) => ({
  day: index + 1,
  entries: [
    entry("10:00", place(`a${index}`, `海岸景點${index}`, "tourist_attraction")),
    entry("16:30", place(`s${index}`, `夕陽觀景點${index}`, "observation_deck")),
  ],
}));
const validation = validateItineraryPlan({ plans: sixDays, requestedDays: 6, partialDays: [1, 6] });
assert.ok(!validation.failedRules.some((r) => r.code === "nightlife_timing"));
assert.ok(validation.warnings.some((w) => w.code === "day_place_count"));
assert.equal(shouldBlockItineraryDelivery(validation), false, "warning-only six-day itinerary delivers");

console.log("OK sunset/beach/coast/day beach club are not nightlife");
console.log("OK explicit nightclub moved from 10:00 to evening");
console.log("OK six complete days with two stops and warnings remain deliverable");
