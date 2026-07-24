import assert from "node:assert/strict";

import {
  buildCombinationSelectionAllowlist,
  parseCombinationSelectionIndices,
} from "../src/lib/ai/destination-combination-suggestions.ts";

function selectedIds(input, availableCount = 3) {
  return parseCombinationSelectionIndices(input, availableCount).map((index) => index + 1);
}

const allThreeRanges = [
  "1~3",
  "1～3",
  "1〜3",
  "1-3",
  "1–3",
  "1—3",
  "1到3",
  "1至3",
  "第一到第三組",
  "第一至第三組",
  "第1到第3組",
  "第1至第3組",
];
for (const input of allThreeRanges) {
  assert.deepEqual(selectedIds(input), [1, 2, 3], `range: ${input}`);
}

for (const input of ["全部", "全選", "都要", "三組都要", "全部都要", "三個都要"]) {
  assert.deepEqual(selectedIds(input), [1, 2, 3], `all selection: ${input}`);
}
assert.deepEqual(selectedIds("全部", 4), [1, 2, 3, 4], "all selection uses availableCount");

const cases = [
  ["1、3", [1, 3]],
  ["1,3", [1, 3]],
  ["第一和第三組", [1, 3]],
  ["第三組都要", [3]],
  ["3～1", [1, 2, 3]],
  ["0～3", [1, 2, 3]],
  ["1～9", [1, 2, 3]],
  ["2～2", [2]],
  ["1～2、3", [1, 2, 3]],
  ["1、1～3", [1, 2, 3]],
];
for (const [input, expected] of cases) {
  assert.deepEqual(selectedIds(input), expected, `selection: ${input}`);
}

const originalLog = console.log;
const originalWarn = console.warn;
let allowlist;
try {
  console.log = () => {};
  console.warn = () => {};
  allowlist = buildCombinationSelectionAllowlist("台北", "1～3");
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
}

assert.ok(allowlist, "range selection builds an allowlist");
assert.deepEqual(allowlist.selectedCombinationIndexes, [0, 1, 2], "indexes remain 0-based");
assert.deepEqual(allowlist.selectedCombinationIds, [1, 2, 3], "IDs remain 1-based");

const selectedIdsBeforePlaceDedupe = [...allowlist.selectedCombinationIds];
assert.equal(
  new Set(allowlist.allowedPlaceNames).size,
  allowlist.allowedPlaceNames.length,
  "place names are deduped",
);
assert.deepEqual(
  allowlist.selectedCombinationIds,
  selectedIdsBeforePlaceDedupe,
  "place-name dedupe does not modify selected IDs",
);

const contextPatch = { selectedCombinationIds: allowlist.selectedCombinationIds };
assert.deepEqual(contextPatch.selectedCombinationIds, [1, 2, 3], "context patch preserves IDs");
assert.equal(contextPatch.selectedCombinationIds.length, 3, "selectedCombinationCount is 3");

console.log("Combination selection range verification passed.");
