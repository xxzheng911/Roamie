import assert from "node:assert/strict";
import fs from "node:fs";
import { inventoryChineseLiterals } from "./audit-ui-chinese-leakage.mjs";
const audit = JSON.parse(fs.readFileSync("docs/audits/phase2-reachability.json", "utf8"));
const current = inventoryChineseLiterals();
const ids = new Set(current.map((r) => r.id));
const unresolved = audit.items.filter((r) => ["A", "B"].includes(r.category) && ids.has(r.id));
const manual = audit.items.filter((r) => r.category === "G" && ids.has(r.id));
for (const row of audit.items) {
  assert.ok(row.reason?.length > 20, `Missing evidence: ${row.id}`);
  if (["A", "B"].includes(row.category))
    assert.ok(row.importPath.length > 0, `Missing router path: ${row.id}`);
}
const known = new Set(audit.items.map((r) => r.id));
const unclassified = current.filter((r) => r.classification !== "allowed" && !known.has(r.id));
console.log(
  JSON.stringify(
    {
      remainingProductionLiteralOccurrences: unresolved.length,
      manualReviewBacklogNonBlocking: manual.length,
      confirmedFiles: Object.fromEntries([...new Set(unresolved.map((r) => r.file))].map((file) => [file, unresolved.filter((r) => r.file === file).length])),
      newUnclassifiedLiteralOccurrences: unclassified.length,
      ignoredCategories: [
        "C: verified unused import tree",
        "D: admin/debug boundary",
        "E: per-literal internal use",
        "F: factual place identity fields",
      ],
    },
    null,
    2,
  ),
);
assert.equal(unresolved.length, 0, "Production-reachable copy still lacks canonical localization");
// Phase 3 gate: the separately reported manual-review backlog is not confirmed UI leakage.
assert.equal(unclassified.length, 0, "New literals need per-occurrence review");
const { execFileSync } = await import("node:child_process");
execFileSync("./node_modules/.bin/vite-node", ["--config", "scripts/vite.verify.config.mjs", "scripts/verify-generated-locale-contract.mjs"], { stdio: "inherit" });
console.log("PASS: confirmed production UI and generated display completeness (manual-review backlog excluded)");
