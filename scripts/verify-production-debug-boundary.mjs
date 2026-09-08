import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const flagFiles = [
  "src/lib/recommendation/engine/feature-flag.ts",
  "src/lib/recommendation/engine/feature-flag-r1-1.ts",
  "src/lib/recommendation/engine/feature-flag-r1-2.ts",
  "src/lib/recommendation/engine/feature-flag-planner.ts",
  "src/lib/recommendation/engine/feature-flag-validator.ts",
  "src/lib/ai/candidate-pool/feature-flag.ts",
  "src/lib/ai/itinerary-validator/feature-flag.ts",
  "src/lib/credits/feature-flag.ts",
];
for (const file of flagFiles) {
  const source = read(file);
  assert.match(source, /canUseRuntimeDebugOverrides/);
  assert.match(source, /if \(!canUseRuntimeDebugOverrides\(\)\) return/);
}
assert.match(read("src/lib/runtime-debug-overrides.ts"), /import\.meta\.env\.DEV/);
assert.equal(
  existsSync(new URL("../src/components/profile/ProfilePlanSwitcher.tsx", import.meta.url)),
  false,
);
assert.equal(
  existsSync(new URL("../src/components/settings/SubscriptionTestPanel.tsx", import.meta.url)),
  false,
);
console.log("verify-production-debug-boundary: ok");
