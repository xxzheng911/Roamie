import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveHomePersonalizationVariant } from "../src/lib/home-personalization-visibility.ts";
import {
  buildHomePlusInsight,
  resolveHomeSessionPlusInsight,
} from "../src/lib/home-personalization-insight.ts";

const access = fs.readFileSync("src/hooks/use-access.tsx", "utf8");
const card = fs.readFileSync("src/components/home/HomePersonalizationCard.tsx", "utf8");

test("display stability is identity-bound and waits for both entitlement sources", () => {
  assert.match(access, /canonicalUserId === userId/);
  assert.match(access, /base\.subscriptionHydrated === true/);
  assert.match(access, /!revenueCatLoading/);
  assert.match(access, /if \(revenueCatLoading\) return;[\s\S]*hydrateFromSupabase\(userId\)/);
});

test("Home renders skeleton until entitlement display state is stable", () => {
  assert.match(card, /if \(variant === "skeleton"\)/);
  const skeleton = card.indexOf('if (variant === "skeleton")');
  const plus = card.indexOf('if (variant === "plus")');
  const free = card.indexOf("uiCoverage.plusTitle");
  assert.ok(skeleton >= 0 && plus > skeleton && free > plus);
});

test("Plus cold start never selects the Free card", () => {
  const variants = [
    resolveHomePersonalizationVariant(false, false),
    resolveHomePersonalizationVariant(false, true),
    resolveHomePersonalizationVariant(true, true),
  ];
  assert.deepEqual(variants, ["skeleton", "skeleton", "plus"]);
  assert.equal(variants.includes("free"), false);
});

test("Free cold start settles from skeleton to Free", () => {
  assert.deepEqual(
    [
      resolveHomePersonalizationVariant(false, false),
      resolveHomePersonalizationVariant(true, false),
    ],
    ["skeleton", "free"],
  );
});

test("returning Plus remains on the Plus variant", () => {
  assert.deepEqual(
    [resolveHomePersonalizationVariant(true, true), resolveHomePersonalizationVariant(true, true)],
    ["plus", "plus"],
  );
});

test("Plus personalization data changes copy without selecting a different card branch", () => {
  assert.match(card, /resolveHomeSessionPlusInsight\(/);
  assert.match(card, /if \(variant === "plus"\)[\s\S]*\{plusInsight\}/);
});

test("late nearby, weather, and trip hydration cannot replace a displayed session insight", () => {
  const sessionKey = `stable-${crypto.randomUUID()}`;
  const savedFirst = resolveHomeSessionPlusInsight(sessionKey, true, {
    savedPlaces: [
      {
        id: "saved-1",
        name: "M",
        category: "mountain_peak",
        address: null,
        city: null,
        lat: null,
        lng: null,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: { primaryType: "mountain_peak", types: ["mountain_peak"] },
        created_at: "2026-09-14T00:00:00Z",
      },
    ],
  });
  const hydratedLater = resolveHomeSessionPlusInsight(sessionKey, true, {
    savedPlaces: [],
    nearbyPicks: [{ id: "cafe", name: "Cafe", primaryType: "cafe" }],
    weather: { available: true, condition: "雨" },
    latestTripTitle: "高雄散步",
  });
  assert.equal(hydratedLater, savedFirst);
});

test("raw Google taxonomy never reaches rendered insight copy", () => {
  const insight = buildHomePlusInsight({
    savedPlaces: ["mountain_peak", "amusement_center", "ramen_restaurant"].map(
      (category, index) => ({
        id: `saved-${index}`,
        name: `Place ${index}`,
        category,
        address: null,
        city: null,
        lat: null,
        lng: null,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: { primaryType: category, types: [category] },
        created_at: "2026-09-14T00:00:00Z",
      }),
    ),
  });
  assert.doesNotMatch(
    insight,
    /mountain_peak|amusement_center|ramen_restaurant|tourist_attraction/,
  );
});
