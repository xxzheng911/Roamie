#!/usr/bin/env node
/**
 * Conversation Workspace persistence guards:
 * - multi-workspace list
 * - empty-write blocked before hydrate
 * - guest → user merge helpers (via storage exports)
 */
import assert from "node:assert/strict";
import {
  clearEphemeralWorkspace,
  deleteConversationWorkspace,
  getWorkspaceLoadState,
  hydrateConversationWorkspaces,
  listConversationWorkspaces,
  loadConversationWorkspace,
  saveConversationWorkspace,
  saveEphemeralWorkspace,
  loadEphemeralWorkspace,
} from "../src/lib/conversation-workspace/storage.ts";
import { shouldUpsertDraftWorkspace } from "../src/lib/conversation-workspace/sync.ts";
import { buildWorkspaceTitle } from "../src/lib/conversation-workspace/title.ts";

// jsdom-less: provide localStorage / sessionStorage
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

console.log("=== conversation workspace persist ===\n");

const userId = "user-test-1";

{
  const title = buildWorkspaceTitle({
    destination: "東京",
    tripDays: 6,
  });
  assert.match(title, /東京/);
  console.log("  ✓ title builder");
}

{
  assert.equal(
    shouldUpsertDraftWorkspace({
      travelContext: { destination: "東京", days: 6 },
      tripDays: 6,
      phase: "discover",
    }),
    true,
  );
  assert.equal(
    shouldUpsertDraftWorkspace({
      travelContext: {},
      phase: "discover",
    }),
    false,
  );
  console.log("  ✓ shouldUpsertDraftWorkspace gate");
}

{
  await hydrateConversationWorkspaces(userId);
  assert.equal(getWorkspaceLoadState(), "loaded");

  const ws1 = {
    schemaVersion: 1,
    workspaceId: "ws_tokyo",
    conversationId: "conv_tokyo",
    title: "東京 6 天行程",
    destination: "東京",
    tripDays: 6,
    status: "planning",
    messages: [
      { id: "1", role: "user", content: "東京" },
      { id: "2", role: "assistant", content: "幾天？" },
      { id: "3", role: "user", content: "6天" },
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
  const ws2 = {
    ...ws1,
    workspaceId: "ws_hokkaido",
    conversationId: "conv_hokkaido",
    title: "北海道旅行規劃",
    destination: "北海道",
    tripDays: 7,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };
  const ws3 = {
    ...ws1,
    workspaceId: "ws_nagoya",
    conversationId: "conv_nagoya",
    title: "名古屋旅行規劃",
    destination: "名古屋",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  };

  saveConversationWorkspace(ws1, userId);
  saveConversationWorkspace(ws2, userId);
  saveConversationWorkspace(ws3, userId);

  const list = listConversationWorkspaces(userId);
  assert.equal(list.length, 3, "must keep all three drafts");
  assert.ok(list.some((w) => w.workspaceId === "ws_tokyo"));
  assert.ok(list.some((w) => w.workspaceId === "ws_hokkaido"));
  assert.ok(list.some((w) => w.workspaceId === "ws_nagoya"));

  const loaded = loadConversationWorkspace("ws_tokyo", userId);
  assert.equal(loaded?.messages?.length, 3);

  // Simulate cold start: clear memory by re-hydrate from localStorage
  await hydrateConversationWorkspaces(userId);
  assert.equal(listConversationWorkspaces(userId).length, 3);

  deleteConversationWorkspace("ws_hokkaido", userId);
  assert.equal(listConversationWorkspaces(userId).length, 2);
  assert.equal(loadConversationWorkspace("ws_hokkaido", userId), null);
  assert.ok(loadConversationWorkspace("ws_tokyo", userId));

  console.log("  ✓ multi-draft save / hydrate / delete");
}

{
  // Travel drafts list must keep ALL workspaces (no silent 12-cap)
  const bulkUser = "user-bulk-20";
  await hydrateConversationWorkspaces(bulkUser);
  for (let i = 1; i <= 20; i += 1) {
    const n = String(i).padStart(2, "0");
    saveConversationWorkspace(
      {
        schemaVersion: 1,
        workspaceId: `ws_bulk_${n}`,
        conversationId: `conv_bulk_${n}`,
        title: `測試目的地 ${n} 旅行規劃`,
        destination: `測試目的地 ${n}`,
        tripDays: 3,
        status: "planning",
        messages: [{ id: "1", role: "user", content: `規劃 ${n}` }],
        createdAt: `2026-07-${n}T00:00:00.000Z`,
        updatedAt: `2026-07-${n}T12:00:00.000Z`,
      },
      bulkUser,
    );
  }
  const bulkList = listConversationWorkspaces(bulkUser);
  assert.equal(bulkList.length, 20, "must list all 20 workspaces (no 12-cap)");
  assert.ok(
    bulkList.every((w, i, arr) =>
      i === 0 ? true : (arr[i - 1].updatedAt ?? "") >= (w.updatedAt ?? ""),
    ),
    "must sort newest → oldest",
  );
  for (let i = 1; i <= 20; i += 1) {
    const id = `ws_bulk_${String(i).padStart(2, "0")}`;
    assert.ok(
      bulkList.some((w) => w.workspaceId === id),
      `missing ${id} in full list`,
    );
  }
  // Items beyond the old ~12 visible cap must still be present
  assert.ok(bulkList.some((w) => w.workspaceId === "ws_bulk_13"));
  assert.ok(bulkList.some((w) => w.workspaceId === "ws_bulk_20"));

  // Delete one mid-list — remaining stay complete, count drops by 1 only
  deleteConversationWorkspace("ws_bulk_10", bulkUser);
  const afterDelete = listConversationWorkspaces(bulkUser);
  assert.equal(afterDelete.length, 19);
  assert.equal(
    afterDelete.some((w) => w.workspaceId === "ws_bulk_10"),
    false,
  );
  assert.ok(afterDelete.some((w) => w.workspaceId === "ws_bulk_01"));
  assert.ok(afterDelete.some((w) => w.workspaceId === "ws_bulk_13"));
  assert.ok(afterDelete.some((w) => w.workspaceId === "ws_bulk_20"));

  await hydrateConversationWorkspaces(bulkUser);
  assert.equal(
    listConversationWorkspaces(bulkUser).length,
    19,
    "full list survives re-hydrate",
  );

  console.log("  ✓ 20-workspace list / scroll data / delete order");
}

{
  // Free ephemeral must not appear in Plus list
  saveEphemeralWorkspace({
    schemaVersion: 1,
    workspaceId: "ws_eph",
    conversationId: "conv_eph",
    title: "臨時",
    destination: "大阪",
    status: "planning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.ok(loadEphemeralWorkspace());
  assert.equal(
    listConversationWorkspaces(userId).some((w) => w.workspaceId === "ws_eph"),
    false,
  );
  clearEphemeralWorkspace();
  console.log("  ✓ Free ephemeral isolated from Plus list");
}

{
  // Workspace Open ≠ Update: save without bump must preserve updatedAt + list order
  await hydrateConversationWorkspaces(userId);
  const older = {
    schemaVersion: 1,
    workspaceId: "ws_sort_old",
    conversationId: "conv_sort_old",
    title: "舊草稿",
    destination: "京都",
    tripDays: 3,
    status: "planning",
    messages: [{ id: "m1", role: "user", content: "京都" }],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
  const newer = {
    ...older,
    workspaceId: "ws_sort_new",
    conversationId: "conv_sort_new",
    title: "新草稿",
    destination: "大阪",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
  // Persist with explicit timestamps (no bump) so sort order is deterministic
  saveConversationWorkspace(older, userId, { bumpUpdatedAt: false });
  saveConversationWorkspace(newer, userId, { bumpUpdatedAt: false });
  let list = listConversationWorkspaces(userId).filter((w) =>
    w.workspaceId.startsWith("ws_sort_"),
  );
  assert.equal(list[0]?.workspaceId, "ws_sort_new");

  // Re-save older without bump — must stay second, updatedAt unchanged
  saveConversationWorkspace(
    { ...older, messages: older.messages },
    userId,
    { bumpUpdatedAt: false },
  );
  const reloaded = loadConversationWorkspace("ws_sort_old", userId);
  assert.equal(reloaded?.updatedAt, "2026-07-10T00:00:00.000Z");
  list = listConversationWorkspaces(userId).filter((w) =>
    w.workspaceId.startsWith("ws_sort_"),
  );
  assert.equal(list[0]?.workspaceId, "ws_sort_new", "open/read must not reorder");
  assert.equal(list[1]?.workspaceId, "ws_sort_old");
  console.log("  ✓ Workspace Open ≠ Update (no sort bump on read-only save)");
}

console.log("\nverify-conversation-workspace-persist: ok");
