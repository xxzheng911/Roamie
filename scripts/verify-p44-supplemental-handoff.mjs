import assert from "node:assert/strict";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import {
  resolvePlanningCandidateContextForGeneration,
  resolvePlanningRequiredAnchorHandoff,
} from "../src/lib/ai/planning-required-anchor-handoff.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const shown = Array.from({ length: 8 }, (_, index) => ({
  id: `ChIJP44Candidate${index}`,
  placeId: `ChIJP44Candidate${index}`,
  googlePlaceId: `ChIJP44Candidate${index}`,
  canonicalId: `ChIJP44Candidate${index}`,
  name: `Candidate ${index}`,
  placeName: `Candidate ${index}`,
  address: `District ${index}`,
  lat: 25.03 + index * 0.001,
  lng: 121.56 + index * 0.001,
  source: "planning_suggestion",
}));

const makeSession = ({ accepted = [], rejected = [], active = shown } = {}) => ({
  ...createEmptySession(),
  workspaceId: "workspace-p44",
  conversationId: "conversation-p44",
  activeShownCandidates: active,
  selectedPlaces: active,
  planningConstraints: {
    acceptedCandidateIds: accepted,
    rejectedCandidateIds: rejected,
    mustIncludePlaces: [],
    excludedPlaces: [],
    clarificationRequired: false,
  },
});

const resolve = (session, selectionMode = false) =>
  resolvePlanningRequiredAnchorHandoff({
    session,
    candidateRequiredPlaces: shown,
    selectionMode,
  });

const none = resolve(makeSession());
assert.equal(none.requiredPlaces.length, 0);
assert.equal(none.supplementalPlaces.length, 8);

const selectedThree = resolve(
  makeSession({ accepted: shown.slice(0, 3).map((place) => place.googlePlaceId) }),
);
assert.equal(selectedThree.requiredPlaces.length, 3);
assert.equal(selectedThree.supplementalPlaces.length, 5);

const remainingIds = shown.slice(1).map((place) => place.googlePlaceId);
const acceptRemaining = resolve(
  makeSession({ accepted: remainingIds, rejected: [shown[0].googlePlaceId] }),
);
assert.equal(acceptRemaining.requiredPlaces.length, 7);
assert.equal(acceptRemaining.excludedPlaceIds.length, 1);
assert.equal(acceptRemaining.supplementalPlaces.length, 0);

const emptyActive = makeSession({ active: [] });
const assistantRecovery = resolvePlanningCandidateContextForGeneration({
  session: emptyActive,
  assistantCandidates: shown,
});
assert.equal(assistantRecovery.source, "assistant_metadata");
assert.equal(assistantRecovery.candidates.length, 8);
assert.equal(assistantRecovery.recoveryUsed, true);

const persistedRecovery = resolvePlanningCandidateContextForGeneration({
  session: emptyActive,
  persistedSession: makeSession(),
});
assert.equal(persistedRecovery.source, "persisted_session");
assert.equal(persistedRecovery.candidates.length, 8);

const workspaceRecovery = resolvePlanningCandidateContextForGeneration({
  session: emptyActive,
  workspace: {
    workspaceId: "workspace-p44",
    conversationId: "conversation-p44",
    planningSession: makeSession(),
  },
});
assert.equal(workspaceRecovery.source, "workspace");
assert.equal(workspaceRecovery.candidates.length, 8);

const staleRecovery = resolvePlanningCandidateContextForGeneration({
  session: {
    ...emptyActive,
    workspaceId: "workspace-new",
    conversationId: "conversation-new",
  },
  persistedSession: makeSession(),
  workspace: {
    workspaceId: "workspace-p44",
    conversationId: "conversation-p44",
    planningSession: makeSession(),
  },
});
assert.equal(staleRecovery.source, "none");
assert.equal(staleRecovery.candidates.length, 0);

const selection = resolve(makeSession(), true);
assert.equal(selection.requiredPlaces.length, 8);
assert.equal(selection.supplementalPlaces.length, 0);

let requestCount = 0;
const generationResult = await createItineraryFromSession({
  session: makeSession(),
  generateInput: {
    destination: "台北",
    days: 2,
    selectedPlaces: shown.map((place) => ({ ...place, isRequiredBySelection: false })),
  },
  generateItineraryFn: async () => {
    requestCount += 1;
    return {
      success: false,
      errorCode: "itinerary_validator_failed",
      failureReason: "fixture_terminal",
      failedRules: ["fixture_terminal"],
    };
  },
});
assert.equal(requestCount, 1, "supplemental-only planner pool continues to generation");
assert.equal(generationResult.ok, false);
assert.notEqual(generationResult.message, "目前找到的合適地點不足以完成這趟行程。請增加景點或縮短天數。");

console.log("P44 supplemental handoff: PASS", {
  noSelection: { required: 0, supplemental: 8, generationContinued: true },
  acceptedThree: { required: 3, supplemental: 5 },
  acceptRemaining: { required: 7, excluded: 1 },
  assistantRecovery: 8,
  persistedRecovery: 8,
  workspaceRecovery: 8,
  staleRecoveryBlocked: true,
  selectionModePreserved: true,
  externalRequestDelta: 0,
});
