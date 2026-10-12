// Executes the production Chat blocks (extracted verbatim from _app.chat.tsx at test time)
// over the real discovery → selection → generation pipeline. Providers are offline stubs;
// only React state setters / toast / credits settlement / runDirectItineraryRef are spies.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { clearCandidatePoolCache } from "../src/lib/ai/places-cost-cache/candidate-pool-cache.ts";
import {
  clearDiscoveredCombinationsCache,
  ensureDestinationCombinationsReady,
} from "../src/lib/ai/destination-combination-discovery.ts";
import {
  buildCombinationSelectionAllowlist,
  buildOfferedCombinationsForSession,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { prepareDirectItineraryFlow } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { resetPlanningPipelineForRegenerate } from "../src/lib/ai/ai-planning-session.ts";
import {
  createUnselectedOfferExclusion,
  resolveSelectedCombinationAuthority,
} from "../src/lib/ai/selected-combination-authority.ts";
import { chatRuntimeCopy, isChatRuntimeCopyPrefix } from "../src/lib/chat-runtime-copy.ts";
import { logAiPipeline } from "../src/lib/ai/ai-pipeline-log.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

globalThis.fetch = async () => {
  throw Error("NETWORK_DISABLED");
};

// ── Production source blocks ────────────────────────────────────────────────
const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
function blockFrom(startMarker, from = 0) {
  const start = chat.indexOf(startMarker, from);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const open = chat.indexOf("{", start + startMarker.length - 1);
  let depth = 0;
  for (let i = open; i < chat.length; i++) {
    if (chat[i] === "{") depth++;
    else if (chat[i] === "}" && --depth === 0) return chat.slice(start, i + 1);
  }
  throw new Error(`unbalanced block: ${startMarker}`);
}
const regenStart = chat.indexOf("// Regenerate itinerary: always open a NEW planning pipeline");
const regenEnd = chat.indexOf("const tripSession = resolveTripAddPlaceChatSession(session, loadChatSession());", regenStart);
const REGEN_BLOCK = chat.slice(regenStart, regenEnd);
const FAIL_BLOCK = blockFrom(
  "if (!prepared.ok) {",
  chat.indexOf('logTripLifecycle("final_planner_gate", { success: prepared.ok });', chat.indexOf("runDirectItineraryRef.current = async")),
);
const CHIPS_BODY = blockFrom("const actionChips = useMemo(() => {").replace(/^const actionChips = useMemo\(\(\) => /, "");

function runProductionBlock(source, scope) {
  // Wrapped so the production block's own `return` statements stay valid.
  const js = transformSync(`async function __productionBlock() {\n${source}\n}`, { loader: "ts" }).code;
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${js}\nreturn __productionBlock();`)(...names.map((n) => scope[n]));
}

// ── Offline discovery fixture ───────────────────────────────────────────────
const kind = (i) => (i < 6 ? "tourist_attraction" : i < 12 ? "museum" : i < 18 ? "park" : "restaurant");
const names = [
  "Clerigos Tower", "Porto Cathedral", "Bolsa Palace", "Sao Francisco Church", "Fernandina Walls", "Dom Luis Bridge",
  "Serralves Museum", "Soares dos Reis Museum", "Porto Photography Museum", "Romantic Museum", "Tram Museum", "World of Discoveries Museum",
  "Crystal Palace Gardens", "City Park", "Virtudes Garden", "Passeio Alegre Garden", "Botanical Garden", "Covelo Park",
  "Riverside Restaurant", "Garden Restaurant", "Heritage Restaurant", "Central Bistro", "Harbor Restaurant", "Terrace Restaurant",
];
const places = names.map((name, i) => ({
  id: `ChIJChatRegen${i}`, name, lat: 41.15 + i * 0.0003, lng: -8.61, types: [kind(i)], primaryType: kind(i),
  rating: 4.6, userRatingCount: 10000, address: "Porto Portugal", businessStatus: "OPERATIONAL",
}));
const scope = {
  label: "Porto", city: "Porto", country: "PT", countryCode: "PT", type: "city", latitude: 41.15, longitude: -8.61,
  placeId: "ChIJPortoFixtureCity", source: "trip_destination", scopeLocked: false,
};
let run = 0;
let providerCalls = 0;
async function discover(pool) {
  clearDiscoveredCombinationsCache();
  clearCandidatePoolCache();
  const result = await ensureDestinationCombinationsReady({
    destination: "Porto", destinationCountry: "PT", resolvedDestination: scope, locale: "en", days: 4,
    generationRequestId: `chat-regen-${++run}`,
    searchPlaces: async () => ({ places: pool, error: null }),
  });
  assert.equal(result.ok, true, "offline discovery");
  return buildOfferedCombinationsForSession("Porto");
}
const geocodeFn = async () => ({ location: null, error: "offline" });
const failingSearch = async () => { providerCalls++; return { places: [], error: "provider_error" }; };
const workingSearch = async () => { providerCalls++; return { places, error: null }; };

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

// 1–2. Discovery offers combinations; user selects combination 1 (allowlistContextPatch shape).
const offered = await discover(places.slice(0, 18));
const allowlist = buildCombinationSelectionAllowlist("Porto", "1");
const offeredNames = (id) => offered.find((c) => c.id === id).places.map((p) => p.originalName ?? p.name);
const unselectedOnly = offered.filter((c) => c.id !== 1).flatMap((c) => offeredNames(c.id))
  .filter((n) => !offeredNames(1).includes(n));
const selectionCtx = {
  interests: [], destination: "Porto", days: 4, startDate: "2026-11-25", endDate: "2026-11-28",
  selectedTripStyle: allowlist.allowedTitles.join("、"), travelStyle: allowlist.allowedTitles.join("、"),
  selectedCombinationIds: allowlist.selectedCombinationIds,
  selectedCombinationPlaceNames: allowlist.allowedPlaceNames,
  excludedCombinationPlaceNames: allowlist.exclusiveExcludedPlaceNames,
  selectionSource: allowlist.selectionSource,
  offeredCombinations: offered.map((c) => ({ ...c, places: c.places.map((p) => ({ ...p, destination: "Porto",
    isRequiredBySelection: allowlist.selectedCombinationIds.includes(c.id) })) })),
  tripPurpose: "route_combination_selected", conversationState: "ready_for_itinerary",
};
const baseSession = { ...createEmptySession(), tripDays: 4, travelContext: selectionCtx };

// 3. First generation fails (offline provider error) → production failure branch.
let firstPrepared;
let failedSession;
const firstMsgs = [];
const settleCalls = [];
await check("A1 first generation fails offline without real providers", async () => {
  const ctx = { ...selectionCtx, generationRequestId: "gen-first" };
  firstPrepared = await prepareDirectItineraryFlow({
    session: baseSession, context: ctx, locale: "zh-TW", searchPlaces: failingSearch, geocodeFn, msgs: [],
  });
  assert.equal(firstPrepared.ok, false);
});
await check("A2 production failure branch persists FAILED-equivalent state with regenerate option", async () => {
  const persisted = [];
  await runProductionBlock(FAIL_BLOCK, {
    prepared: firstPrepared,
    logTripLifecycle: () => {}, logItineraryFailureReason: () => {},
    settleCreditsOperation: async (handle, success) => { settleCalls.push({ handle, success }); },
    itinCreditsHandle: null,
    setGenerating: () => {}, setStreaming: () => {},
    context: selectionCtx, contextWithRequest: { ...selectionCtx, generationRequestId: "gen-first" },
    generationRequestId: "gen-first",
    lastFailureGenerationRequestIdRef: { current: null },
    setMsgs: (m) => firstMsgs.push(...(typeof m === "function" ? m([]) : m)),
    conversation: [{ role: "user", content: "幫我生成" }],
    chatRuntimeCopy, isChatRuntimeCopyPrefix, locale: "zh-TW",
    persistSession: (s) => persisted.push(s),
  });
  failedSession = persisted.at(-1);
  assert.equal(failedSession.chatPlanningState, "generationFailed");
  assert.ok(failedSession.pendingQuestion.options.includes("重新生成"));
  assert.deepEqual(settleCalls.map((c) => c.success), [false], "credits settled as not consumed");
});
await check("A3 production actionChips offers 重新生成 for the failed session", async () => {
  const chips = await runProductionBlock(CHIPS_BODY.replace(/^\{|\}$/g, ""), { session: failedSession, selectionMode: false });
  assert.ok(chips.includes("重新生成"));
});

// Cache drift: discovery cache rebuilt (re-classified provider results) before the user taps regenerate.
const rebuilt = await discover(
  [...places.slice(12, 18), ...places.slice(6, 12), ...places.slice(0, 6)].map((p, i) => ({ ...p, types: [kind(i)], primaryType: kind(i) })),
);
await check("C0 precondition: rebuilt cache maps id 1 to different places", () => {
  assert.notDeepEqual(rebuilt.find((c) => c.id === 1).places.map((p) => p.name), offeredNames(1));
});

// 4–5. Production regenerate handler.
async function tapRegenerate(session) {
  const captured = { runs: [], msgs: [], persisted: [], toasts: [] };
  await runProductionBlock(REGEN_BLOCK, {
    trimmed: "重新生成", displayMessage: "重新生成", session, msgs: [...firstMsgs],
    markShortcutEngaged: () => {}, toast: { message: (m) => captured.toasts.push(m) }, uiT: (k) => k,
    setMsgs: (m) => captured.msgs.push(m), setText: () => {}, scrollToUserMessage: () => {},
    resolveSelectedCombinationAuthority, logAiPipeline, chatRuntimeCopy, locale: "zh-TW",
    persistSession: (s) => captured.persisted.push(s), resetPlanningPipelineForRegenerate,
    runDirectItineraryRef: { current: async (...args) => { captured.runs.push(args); } },
  });
  return captured;
}
let regen;
await check("A4 production regenerate handler enters runDirectItinerary with entry 'regenerate'", async () => {
  regen = await tapRegenerate(failedSession);
  assert.equal(regen.runs.length, 1);
  assert.equal(regen.runs[0][3], "regenerate");
});
await check("B1 selectedCombinationIds preserved", () => {
  assert.deepEqual(regen.runs[0][1].selectedCombinationIds, [1]);
});
await check("B2 offered place identity preserved (ids and names from the snapshot)", () => {
  const ctx = regen.runs[0][1];
  assert.deepEqual(ctx.selectedCombinationPlaceNames, offeredNames(1));
  assert.deepEqual(
    ctx.offeredCombinations.find((c) => c.id === 1).places.map((p) => p.googlePlaceId),
    offered.find((c) => c.id === 1).places.map((p) => p.googlePlaceId),
  );
});
await check("B3 not re-resolved from style titles", () => {
  const titled = { ...failedSession, travelContext: { ...failedSession.travelContext, selectedTripStyle: "Classic Sights、City Stroll" } };
  return tapRegenerate(titled).then((r) => assert.deepEqual(r.runs[0][1].selectedCombinationPlaceNames, offeredNames(1)));
});
await check("B4 invalid snapshot is rejected safely (no generation, reselect copy)", async () => {
  const broken = { ...failedSession, travelContext: { ...failedSession.travelContext, offeredCombinations: undefined } };
  const r = await tapRegenerate(broken);
  assert.equal(r.runs.length, 0);
  const last = r.msgs.at(-1);
  assert.equal(last.at(-1).content, chatRuntimeCopy("reselectCombination", "zh-TW"));
});

// 10. Second generation (runDirectItinerary merges activeSession.travelContext with the regen ctx).
let second;
await check("C1 second generation succeeds offline after cache rebuild", async () => {
  const [regenSession, regenCtx] = regen.runs[0];
  const context = { ...regenSession.travelContext, ...regenCtx };
  second = await prepareDirectItineraryFlow({
    session: { ...regenSession, travelContext: context }, context, locale: "zh-TW",
    searchPlaces: workingSearch, geocodeFn, msgs: [],
  });
  assert.equal(second.ok, true, second.message ?? second.failureReason);
});
await check("C2 regenerated places exclude unselected combinations and other destinations", () => {
  // Display names are localized (zh-TW), so identity is compared by provider place id.
  const chosen = [...(second.session.selectedPlaces ?? []), ...(second.session.recommendedPlaces ?? [])];
  assert.ok(chosen.length > 0, "places present");
  const chosenIds = chosen.map((p) => p.googlePlaceId ?? p.placeId).filter(Boolean);
  assert.equal(chosenIds.length, chosen.length, "every place carries a provider id");
  const selectedIds = new Set(offered.find((c) => c.id === 1).places.map((p) => p.googlePlaceId));
  const unselectedOnlyIds = new Set(offered.filter((c) => c.id !== 1).flatMap((c) => c.places.map((p) => p.googlePlaceId))
    .filter((id) => !selectedIds.has(id)));
  const leaked = [...new Set(chosenIds.filter((id) => unselectedOnlyIds.has(id)))];
  assert.deepEqual(leaked, [], `unselected-only ids: ${leaked.join(", ")}`);
  const fixtureIds = new Set(places.map((p) => p.id));
  const foreign = [...new Set(chosenIds.filter((id) => !fixtureIds.has(id)))];
  assert.deepEqual(foreign, [], `other-destination ids: ${foreign.join(", ")}`);
});
await check("C3 generation stays scoped to the selected combination ids", () => {
  assert.deepEqual(second.session.travelContext.selectedCombinationIds, [1]);
});

// Exclusion identity rules (offered snapshot + exclusiveExcludedPlaceNames contract).
const identityOffers = [
  { id: 1, title: "Selected", places: [{ name: "Shared Plaza", googlePlaceId: "ChIJShared" }, { name: "Only Mine", googlePlaceId: "ChIJMine" }] },
  { id: 2, title: "Unselected", places: [{ name: "Shared Plaza", googlePlaceId: "ChIJShared" }, { name: "Old Palace", googlePlaceId: "ChIJOldPalace" }] },
];
const exclude = createUnselectedOfferExclusion([1], identityOffers, ["Old Palace"]);
await check("E1 place exclusive to an unselected combination is excluded", () => {
  assert.equal(exclude({ id: "ChIJOldPalace", name: "Old Palace" }), true);
});
await check("E2 place shared by selected and unselected combinations is kept", () => {
  assert.equal(exclude({ id: "ChIJShared", name: "Shared Plaza" }), false);
});
await check("E3 same name, different place id is kept (different place)", () => {
  assert.equal(exclude({ id: "ChIJOtherOldPalace", name: "Old Palace" }), false);
});
await check("E4 different (localized) name, same place id is excluded", () => {
  assert.equal(exclude({ id: "ChIJOldPalace", name: "舊宮殿" }), true);
});
await check("E5 no provider id falls back to the existing name contract", () => {
  assert.equal(exclude({ name: "Old Palace" }), true);
  assert.equal(createUnselectedOfferExclusion([1], undefined, ["Old Palace"])({ name: "Old Palace" }), true);
});
await check("E6 only unselected places available → safe failure, never padded with them", async () => {
  const [regenSession, regenCtx] = regen.runs[0];
  const context = { ...regenSession.travelContext, ...regenCtx, generationRequestId: "gen-insufficient" };
  const selectedIds = new Set(offered.find((c) => c.id === 1).places.map((p) => p.googlePlaceId));
  const unselectedOnlyIds = new Set(offered.filter((c) => c.id !== 1).flatMap((c) => c.places.map((p) => p.googlePlaceId))
    .filter((id) => !selectedIds.has(id)));
  const onlyUnselected = places.filter((p) => unselectedOnlyIds.has(p.id));
  const result = await prepareDirectItineraryFlow({
    session: { ...regenSession, travelContext: context }, context, locale: "zh-TW",
    searchPlaces: async () => { providerCalls++; return { places: onlyUnselected, error: null }; }, geocodeFn, msgs: [],
  });
  const kept = [...(result.session?.selectedPlaces ?? []), ...(result.session?.recommendedPlaces ?? []),
    ...(result.failure?.partialResolvedPlaces ?? [])].map((p) => p.googlePlaceId ?? p.placeId);
  assert.deepEqual(kept.filter((id) => unselectedOnlyIds.has(id)), [], "unselected places used to pad");
  assert.equal(result.ok, false, "insufficient selected places must fail safely");
});

// 11. Owner / snapshot / credits: regenerate reuses runDirectItinerary's existing guards.
await check("D1 regenerate goes through runDirectItinerary guards (no bypass)", () => {
  assert.match(REGEN_BLOCK, /runDirectItineraryRef\.current\(/);
  assert.doesNotMatch(REGEN_BLOCK, /prepareDirectItinerary(?:Session|Flow)\(|handleGenerateItinerary\(|settleCreditsOperation\(/);
  const runDirect = chat.slice(chat.indexOf("runDirectItineraryRef.current = async"));
  assert.match(runDirect, /reason=already_generating/);
  assert.match(runDirect, /isCurrent: \(\) => activeGenerationRequestIdRef\.current === generationRequestId/);
});

console.log(`INFO provider stub calls=${providerCalls}`);
console.log(failures ? `FAIL chat regenerate handler runtime (${failures} failing)` : "PASS chat regenerate handler runtime");
process.exitCode = failures ? 1 : 0;
