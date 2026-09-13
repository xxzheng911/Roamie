import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveHomePersonalizationVariant } from "../src/lib/home-personalization-visibility.ts";

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
  const free = card.indexOf("讓 Roamie 更懂你");
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
  assert.equal((card.match(/buildHomePlusInsight\(/g) ?? []).length, 1);
  assert.match(card, /if \(variant === "plus"\)[\s\S]*\{plusInsight\}/);
});
