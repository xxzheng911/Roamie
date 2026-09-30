// Inspect real canonical artifacts. No writes, Wrangler calls, or network.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { verifyReleaseArtifacts } from "./verify-release-artifacts.mjs";
const root = resolve(import.meta.dirname, "..");
verifyReleaseArtifacts(root); // Includes the central client deny contract; do not duplicate it here.
function javascript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const path = join(directory, item.name);
    return item.isDirectory() ? javascript(path) : item.name.endsWith(".js") ? [readFileSync(path, "utf8")] : [];
  }).join("\n");
}
const server = javascript(join(root, "dist/server"));
for (const marker of ["timeline_normalization_failures", "failed_entry_time", "candidate_slots_evaluated", "rejected_order", "rejected_used", "rejected_closed", "rejected_window"]) {
  assert.ok(server.includes(marker), "server diagnostic missing: " + marker);
}
console.log("PASS: central client leakage contract and server diagnostic schema presence");
