import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  disambiguatePlanningDestinationEntity,
  parsePlanningConstraintDelta,
  resolvePlanningContextRequirement,
} from "../src/lib/ai/planning-conversation-constraints.ts";

function classify(text, destination, candidateCount = 0, durationOrDateDetected = true) {
  const parsed = parsePlanningConstraintDelta({ text, shownCandidates: [] });
  const delta = disambiguatePlanningDestinationEntity({ delta: parsed, destination });
  const requirement = resolvePlanningContextRequirement({
    text,
    delta,
    candidateCount,
    destinationDetected: Boolean(destination),
    durationOrDateDetected,
  });
  return { delta, requirement };
}

for (const [text, destination] of [
  ["我要去台北2天", "台北"],
  ["我想去台北兩天", "台北"],
  ["幫我排台北兩天", "台北"],
  ["台北兩天一夜", "台北"],
  ["想去東京3天", "東京"],
  ["下個月大阪4天", "大阪"],
  ["我要安排高雄一日遊", "高雄"],
]) {
  const { delta, requirement } = classify(text, destination);
  assert.equal(delta.mustIncludePlaces?.length ?? 0, 0, `${text}: destination is not a place`);
  assert.equal(delta.unresolvedEntities?.length ?? 0, 0, `${text}: no unresolved place`);
  assert.equal(requirement.requiresCandidateContext, false, `${text}: no candidate context`);
}

const missingDays = classify("我要去大阪", "大阪", 0, false);
assert.equal(missingDays.requirement.requiresCandidateContext, false);
assert.equal(missingDays.delta.unresolvedEntities?.length ?? 0, 0);
const pendingDays = classify("2天", "大阪", 0, true);
assert.equal(pendingDays.requirement.requiresCandidateContext, false);

for (const text of ["改成3天", "不要排太趕", "晚上想吃燒肉", "預算低一點"]) {
  const { requirement } = classify(text, "台北", 0, /3天/.test(text));
  assert.equal(requirement.requiresCandidateContext, false, `${text}: trip-level modification`);
}

for (const [text, reason] of [
  ["第一個不要", "ordinal"],
  ["第二組", "group_reference"],
  ["其他都可以", "accept_remaining"],
  ["剛剛那些保留", "previous_reference"],
  ["這個不要", "previous_reference"],
]) {
  const { requirement } = classify(text, "台北", 0, false);
  assert.equal(requirement.requiresCandidateContext, true, `${text}: candidate reference`);
  assert.equal(requirement.reason, reason, `${text}: reason`);
}

const routeSource = readFileSync("src/routes/_app.chat.tsx", "utf8");
assert.match(routeSource, /logPlanningStateInvariant/);
assert.match(routeSource, /repeatedMissingContextClarification/);
assert.match(routeSource, /repeatedClarificationBlocked/);
assert.match(routeSource, /conversationState:\s*"awaiting_preference"/);

console.log("verify-p246-intent-context-authority: ok");
