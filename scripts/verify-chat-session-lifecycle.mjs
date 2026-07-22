#!/usr/bin/env node
/**
 * Conversation Session ↔ Workspace decoupling guards.
 *
 * - Fresh /chat must not inherit pendingQuestion / combination await
 * - Workspace restore only when workspaceId is explicit
 * - Upsert must not rebind via getActiveWorkspaceId()
 */
import assert from "node:assert/strict";

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

globalThis.window = globalThis;
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

const {
  beginNewChatSession,
  shouldStartFreshChatSession,
  hasConversationFlowState,
  describeConversationStage,
} = await import("../src/lib/chat-session-lifecycle.ts");
const {
  saveChatSession,
  loadChatSession,
  createEmptySession,
} = await import("../src/lib/chat-session.ts");
const {
  upsertDraftWorkspaceFromSession,
  shouldUpsertDraftWorkspace,
} = await import("../src/lib/conversation-workspace/sync.ts");
const {
  saveConversationWorkspace,
  loadConversationWorkspace,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  hydrateConversationWorkspaces,
} = await import("../src/lib/conversation-workspace/storage.ts");

console.log("=== chat session lifecycle / no state leak ===\n");

{
  assert.equal(shouldStartFreshChatSession({}), true);
  assert.equal(shouldStartFreshChatSession({ from: "mood" }), false);
  assert.equal(shouldStartFreshChatSession({ workspaceId: "ws_1" }), false);
  assert.equal(shouldStartFreshChatSession({ mood: "relax" }), false);
  console.log("  ✓ shouldStartFreshChatSession gates");
}

{
  const stale = {
    ...createEmptySession(),
    conversationId: "conv_old",
    pendingQuestion: {
      type: "combination_choice",
      options: ["1", "2", "3"],
      baseDestination: "東京",
    },
    travelContext: {
      interests: [],
      destination: "東京",
      conversationState: "awaiting_combination_selection",
      offeredCombinations: [{ id: "a" }],
    },
    chatPlanningState: "waitingTripDays",
    tripDays: 5,
  };
  saveChatSession(stale);
  setActiveWorkspaceId("ws_stale");

  assert.equal(describeConversationStage(stale), "AWAITING_COMBINATION_SELECTION");
  assert.equal(hasConversationFlowState(stale), true);

  const logs = [];
  const origWarn = console.warn;
  const origInfo = console.info;
  console.warn = (...args) => logs.push(args.join(" "));
  console.info = (...args) => logs.push(args.join(" "));

  const fresh = beginNewChatSession({
    reason: "chat_page_open",
    previous: stale,
    hasPlusAccess: false,
  });

  console.warn = origWarn;
  console.info = origInfo;

  assert.equal(fresh.pendingQuestion, undefined);
  assert.equal(fresh.travelContext, undefined);
  assert.equal(fresh.tripDays, undefined);
  assert.equal(fresh.chatPlanningState, "idle");
  assert.equal(fresh.workspaceId, undefined);
  assert.ok(fresh.conversationId && fresh.conversationId !== "conv_old");
  assert.equal(getActiveWorkspaceId(), null);
  assert.equal(describeConversationStage(fresh), "INITIAL");

  const leakLog = logs.find((l) => l.includes("[CONVERSATION_STATE_LEAK]"));
  assert.ok(leakLog, "expected CONVERSATION_STATE_LEAK log");
  assert.ok(logs.some((l) => l.includes("[CHAT_SESSION_CREATED]")));
  assert.ok(logs.some((l) => l.includes("[CHAT_SESSION_RESET]")));
  assert.ok(logs.some((l) => l.includes("[WORKSPACE_NOT_RESTORED]")));

  const loaded = loadChatSession();
  assert.equal(loaded.pendingQuestion, undefined);
  assert.equal(loaded.conversationId, fresh.conversationId);
  console.log("  ✓ beginNewChatSession clears combination await + logs");
}

{
  const userId = "user-lifecycle-1";
  await hydrateConversationWorkspaces(userId);

  const ws = {
    schemaVersion: 1,
    workspaceId: "ws_tokyo_old",
    conversationId: "conv_tokyo_old",
    title: "東京 5 日",
    destination: "東京",
    tripDays: 5,
    planningSession: {
      ...createEmptySession(),
      workspaceId: "ws_tokyo_old",
      conversationId: "conv_tokyo_old",
      pendingQuestion: {
        type: "combination_choice",
        options: ["1", "2"],
        baseDestination: "東京",
      },
      travelContext: { interests: [], destination: "東京" },
      tripDays: 5,
    },
    messages: [{ role: "user", content: "東京" }],
    status: "planning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveConversationWorkspace(ws, userId);
  assert.equal(getActiveWorkspaceId(), "ws_tokyo_old");

  // New chat session must not reuse active workspace id when upserting a new destination.
  const newLive = {
    ...createEmptySession(),
    conversationId: "conv_new",
    travelContext: { interests: ["food"], destination: "大阪", days: 3 },
    tripDays: 3,
    phase: "recommend",
  };
  assert.equal(shouldUpsertDraftWorkspace(newLive), true);
  const created = upsertDraftWorkspaceFromSession({
    session: newLive,
    messages: [{ role: "user", content: "大阪" }],
    hasPlusAccess: true,
    userId,
  });
  assert.ok(created);
  assert.notEqual(created.workspaceId, "ws_tokyo_old");
  assert.equal(created.destination, "大阪");

  // Explicit restore still loads pending combination state.
  const restored = loadConversationWorkspace("ws_tokyo_old", userId);
  assert.equal(restored?.planningSession?.pendingQuestion?.type, "combination_choice");
  console.log("  ✓ upsert does not inherit active workspace; restore keeps snapshot");
}

console.log("\nAll chat-session-lifecycle checks passed.");
