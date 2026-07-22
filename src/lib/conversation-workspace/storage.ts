import type {
  ConversationWorkspace,
  ConversationWorkspaceListItem,
} from "@/lib/conversation-workspace/types";
import { CONVERSATION_WORKSPACE_SCHEMA_VERSION } from "@/lib/conversation-workspace/types";
import {
  deleteWorkspaceFromNativeBundle,
  loadWorkspaceBundleFromNative,
  saveWorkspaceBundleToNative,
  type WorkspaceNativeBundle,
} from "@/lib/conversation-workspace/native-persist";

const LIST_KEY = "roamie:conversation-workspaces";
const ACTIVE_KEY = "roamie:conversation-workspace:active";
const EPHEMERAL_KEY = "roamie:conversation-workspace:ephemeral";

export type WorkspaceLoadState = "idle" | "loading" | "loaded" | "error";

let workspaceLoadState: WorkspaceLoadState = "idle";
/** In-memory mirror after hydrate — undefined means not loaded yet */
let memoryListByUser = new Map<string, ConversationWorkspaceListItem[]>();
let memoryBlobByKey = new Map<string, ConversationWorkspace>();
let hydratePromise: Promise<void> | null = null;

function userScopeKey(userId?: string | null): string {
  return userId?.trim() || "__guest__";
}

function listStorageKey(userId?: string | null): string {
  return userId ? `${LIST_KEY}:${userId}` : LIST_KEY;
}

function workspaceKey(workspaceId: string, userId?: string | null): string {
  return userId
    ? `roamie:conversation-workspace:${userId}:${workspaceId}`
    : `roamie:conversation-workspace:${workspaceId}`;
}

function readListRaw(userId?: string | null): ConversationWorkspaceListItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(listStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConversationWorkspaceListItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeListRaw(
  items: ConversationWorkspaceListItem[],
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  // Never persist "empty because not loaded" over durable data
  if (workspaceLoadState !== "loaded" && items.length === 0) {
    const existing = readListRaw(userId);
    if (existing.length > 0) {
      console.warn("[WORKSPACE_EMPTY_WRITE_BLOCKED]", {
        reason: "not_loaded_yet",
        loadState: workspaceLoadState,
        existingCount: existing.length,
      });
      return;
    }
  }
  localStorage.setItem(listStorageKey(userId), JSON.stringify(items));
}

function readBlobRaw(
  workspaceId: string,
  userId?: string | null,
): ConversationWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(workspaceKey(workspaceId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConversationWorkspace;
    if (!parsed?.workspaceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildNativeBundle(userId?: string | null): WorkspaceNativeBundle {
  const list = readListRaw(userId);
  const workspaces: Record<string, ConversationWorkspace> = {};
  for (const item of list) {
    const blob = readBlobRaw(item.workspaceId, userId);
    if (blob) workspaces[item.workspaceId] = blob;
  }
  return {
    list,
    workspaces,
    activeWorkspaceId: getActiveWorkspaceId(),
    updatedAt: new Date().toISOString(),
  };
}

function applyBundleToLocal(
  bundle: WorkspaceNativeBundle,
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  for (const [id, ws] of Object.entries(bundle.workspaces ?? {})) {
    try {
      localStorage.setItem(workspaceKey(id, userId), JSON.stringify(ws));
      memoryBlobByKey.set(workspaceKey(id, userId), ws);
    } catch {
      /* quota */
    }
  }
  writeListRaw(bundle.list ?? [], userId);
  memoryListByUser.set(userScopeKey(userId), bundle.list ?? []);
  if (bundle.activeWorkspaceId) {
    localStorage.setItem(ACTIVE_KEY, bundle.activeWorkspaceId);
  }
}

function mergeWorkspaceLists(
  a: ConversationWorkspaceListItem[],
  b: ConversationWorkspaceListItem[],
): ConversationWorkspaceListItem[] {
  const map = new Map<string, ConversationWorkspaceListItem>();
  for (const item of [...a, ...b]) {
    const prev = map.get(item.workspaceId);
    if (!prev || (item.updatedAt ?? "") > (prev.updatedAt ?? "")) {
      map.set(item.workspaceId, item);
    }
  }
  return [...map.values()].sort((x, y) =>
    (x.updatedAt ?? "") < (y.updatedAt ?? "") ? 1 : -1,
  );
}

function mergeBlobs(
  local: ConversationWorkspace | null,
  remote: ConversationWorkspace | null,
): ConversationWorkspace | null {
  if (!local) return remote;
  if (!remote) return local;
  return (remote.updatedAt ?? "") > (local.updatedAt ?? "") ? remote : local;
}

/** Migrate guest-scoped keys into user-scoped when auth resolves. */
function migrateGuestToUser(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  const guestList = readListRaw(null);
  if (!guestList.length) return;
  const userList = readListRaw(userId);
  const mergedList = mergeWorkspaceLists(guestList, userList);
  for (const item of guestList) {
    const guestBlob = readBlobRaw(item.workspaceId, null);
    const userBlob = readBlobRaw(item.workspaceId, userId);
    const best = mergeBlobs(userBlob, guestBlob);
    if (best) {
      try {
        localStorage.setItem(
          workspaceKey(item.workspaceId, userId),
          JSON.stringify(best),
        );
      } catch {
        /* ignore */
      }
    }
  }
  writeListRaw(mergedList, userId);
  console.info("[WORKSPACE_MIGRATE_GUEST_TO_USER]", {
    userId,
    guestCount: guestList.length,
    mergedCount: mergedList.length,
  });
}

export function getWorkspaceLoadState(): WorkspaceLoadState {
  return workspaceLoadState;
}

/**
 * Cold-start hydrate: Preferences → localStorage merge.
 * Safe to call multiple times; concurrent callers share one promise.
 */
export async function hydrateConversationWorkspaces(
  userId?: string | null,
): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    workspaceLoadState = "loading";
    console.info("[WORKSPACE_BOOTSTRAP_START]", {
      userId: userId ?? "(guest)",
      authReady: Boolean(userId),
    });
    try {
      if (userId) migrateGuestToUser(userId);

      const localList = readListRaw(userId);
      const guestList = userId ? readListRaw(null) : [];
      console.info("[WORKSPACE_LOCAL_LOAD]", {
        count: localList.length,
        keys: localList.map((w) => w.workspaceId).slice(0, 12),
      });

      const native = await loadWorkspaceBundleFromNative(userId);
      const nativeList = native?.list ?? [];
      console.info("[WORKSPACE_REMOTE_LOAD]", {
        // "remote" here = durable native Preferences (survives WK nonPersistent)
        count: nativeList.length,
        userId: userId ?? "(guest)",
        source: "capacitor_preferences",
      });

      const mergedList = mergeWorkspaceLists(
        mergeWorkspaceLists(localList, guestList),
        nativeList,
      );

      // Restore blobs: prefer newer updatedAt
      for (const item of mergedList) {
        const localBlob = readBlobRaw(item.workspaceId, userId);
        const guestBlob = userId ? readBlobRaw(item.workspaceId, null) : null;
        const nativeBlob = native?.workspaces?.[item.workspaceId] ?? null;
        const best =
          mergeBlobs(mergeBlobs(localBlob, guestBlob), nativeBlob) ?? null;
        if (best) {
          try {
            localStorage.setItem(
              workspaceKey(item.workspaceId, userId),
              JSON.stringify(best),
            );
            memoryBlobByKey.set(workspaceKey(item.workspaceId, userId), best);
          } catch {
            /* ignore */
          }
        }
      }

      // Mark loaded BEFORE write so empty is allowed only when truly empty
      workspaceLoadState = "loaded";
      writeListRaw(mergedList, userId);
      memoryListByUser.set(userScopeKey(userId), mergedList);

      // Mirror durable bundle (even if localStorage will be wiped next cold start)
      const bundle = buildNativeBundle(userId);
      await saveWorkspaceBundleToNative(bundle, userId);

      console.info("[WORKSPACE_MERGE_RESULT]", {
        localCount: localList.length,
        remoteCount: nativeList.length,
        mergedCount: mergedList.length,
      });
      console.info("[WORKSPACE_STORE_READY]", {
        count: mergedList.length,
        loadState: workspaceLoadState,
      });
    } catch (e) {
      workspaceLoadState = "error";
      console.warn("[WORKSPACE_BOOTSTRAP_FAILED]", {
        reason: e instanceof Error ? e.message : String(e),
      });
      // Still allow reads from whatever localStorage has
      workspaceLoadState = "loaded";
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

async function mirrorSaveToNative(
  workspace: ConversationWorkspace,
  userId?: string | null,
): Promise<void> {
  const list = readListRaw(userId);
  const workspaces: Record<string, ConversationWorkspace> = {};
  for (const item of list) {
    const blob =
      item.workspaceId === workspace.workspaceId
        ? workspace
        : readBlobRaw(item.workspaceId, userId);
    if (blob) workspaces[item.workspaceId] = blob;
  }
  workspaces[workspace.workspaceId] = workspace;
  const ok = await saveWorkspaceBundleToNative(
    {
      list,
      workspaces,
      activeWorkspaceId: workspace.workspaceId,
      updatedAt: workspace.updatedAt,
    },
    userId,
  );
  if (ok) {
    console.info("[WORKSPACE_SAVE_SUCCESS]", {
      workspaceId: workspace.workspaceId,
      local: true,
      remote: true,
      updatedAt: workspace.updatedAt,
    });
  }
}

export function listConversationWorkspaces(
  userId?: string | null,
): ConversationWorkspaceListItem[] {
  const sortNewestFirst = (items: ConversationWorkspaceListItem[]) =>
    [...items].sort((a, b) => ((a.updatedAt ?? "") < (b.updatedAt ?? "") ? 1 : -1));

  const mem = memoryListByUser.get(userScopeKey(userId));
  if (mem) return sortNewestFirst(mem);
  // Also try guest keys if user list empty (pre-migrate race)
  const primary = readListRaw(userId);
  if (primary.length || !userId) {
    return sortNewestFirst(primary);
  }
  const guest = readListRaw(null);
  return sortNewestFirst(guest);
}

export function loadConversationWorkspace(
  workspaceId: string,
  userId?: string | null,
): ConversationWorkspace | null {
  const key = workspaceKey(workspaceId, userId);
  const mem = memoryBlobByKey.get(key);
  if (mem) return mem;
  const primary = readBlobRaw(workspaceId, userId);
  if (primary) return primary;
  if (userId) return readBlobRaw(workspaceId, null);
  return null;
}

export function saveConversationWorkspace(
  workspace: ConversationWorkspace,
  userId?: string | null,
  options?: { bumpUpdatedAt?: boolean },
): void {
  if (typeof window === "undefined") return;
  const bumpUpdatedAt = options?.bumpUpdatedAt !== false;
  const existing = bumpUpdatedAt
    ? null
    : loadConversationWorkspace(workspace.workspaceId, userId);
  const updatedAt = bumpUpdatedAt
    ? new Date().toISOString()
    : (workspace.updatedAt?.trim() ||
        existing?.updatedAt ||
        new Date().toISOString());
  const next: ConversationWorkspace = {
    ...workspace,
    schemaVersion: CONVERSATION_WORKSPACE_SCHEMA_VERSION,
    updatedAt,
  };

  console.info("[WORKSPACE_SAVE_START]", {
    workspaceId: next.workspaceId,
    userId: userId ?? "(guest)",
    messageCount: next.messages?.length ?? 0,
    status: next.status,
    bumpUpdatedAt,
    storageTargets: "local,native",
  });

  try {
    localStorage.setItem(workspaceKey(next.workspaceId, userId), JSON.stringify(next));
    memoryBlobByKey.set(workspaceKey(next.workspaceId, userId), next);
  } catch (e) {
    console.warn("[WORKSPACE_SAVE_FAILED]", {
      workspaceId: next.workspaceId,
      target: "local",
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  const prevList = readListRaw(userId);
  const prevIdx = prevList.findIndex((w) => w.workspaceId === next.workspaceId);
  const list = prevList.filter((w) => w.workspaceId !== next.workspaceId);
  const listItem = {
    workspaceId: next.workspaceId,
    title: next.title,
    destination: next.destination,
    tripDays: next.tripDays,
    startDate: next.travelDates?.start,
    endDate: next.travelDates?.end,
    status: next.status,
    updatedAt: next.updatedAt,
    createdAt: next.createdAt,
    messageCount: next.messages?.length ?? 0,
    itineraryId: next.itineraryId,
    currentIntent: next.currentIntent,
  };
  // Workspace Open ≠ Update: preserve list position when not bumping sort key
  if (bumpUpdatedAt || prevIdx < 0) {
    list.unshift(listItem);
  } else {
    list.splice(Math.min(prevIdx, list.length), 0, listItem);
  }
  // Ensure loadState allows writes of real data
  if (workspaceLoadState === "idle") workspaceLoadState = "loaded";
  writeListRaw(list, userId);
  memoryListByUser.set(userScopeKey(userId), list);
  try {
    localStorage.setItem(ACTIVE_KEY, next.workspaceId);
  } catch {
    /* ignore */
  }

  void mirrorSaveToNative(next, userId);
}

export function deleteConversationWorkspace(
  workspaceId: string,
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(workspaceKey(workspaceId, userId));
  if (userId) localStorage.removeItem(workspaceKey(workspaceId, null));
  memoryBlobByKey.delete(workspaceKey(workspaceId, userId));
  const nextList = readListRaw(userId).filter((w) => w.workspaceId !== workspaceId);
  writeListRaw(nextList, userId);
  memoryListByUser.set(userScopeKey(userId), nextList);
  if (localStorage.getItem(ACTIVE_KEY) === workspaceId) {
    localStorage.removeItem(ACTIVE_KEY);
  }
  void deleteWorkspaceFromNativeBundle(workspaceId, userId).then((remoteDeleted) => {
    console.info("[WORKSPACE_DELETE]", {
      workspaceId,
      localDeleted: true,
      remoteDeleted,
    });
  });
}

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  if (typeof window === "undefined") return;
  if (!workspaceId) {
    localStorage.removeItem(ACTIVE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_KEY, workspaceId);
}

/** Free: ephemeral only (sessionStorage), never listed on profile. */
export function saveEphemeralWorkspace(workspace: ConversationWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(EPHEMERAL_KEY, JSON.stringify(workspace));
  } catch {
    /* ignore quota */
  }
}

export function loadEphemeralWorkspace(): ConversationWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(EPHEMERAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConversationWorkspace;
  } catch {
    return null;
  }
}

export function clearEphemeralWorkspace(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(EPHEMERAL_KEY);
}

/** Flush current local bundle to native (call on app background). */
export async function flushConversationWorkspacesToNative(
  userId?: string | null,
): Promise<void> {
  if (workspaceLoadState !== "loaded" && listConversationWorkspaces(userId).length === 0) {
    console.warn("[WORKSPACE_EMPTY_WRITE_BLOCKED]", { reason: "flush_not_loaded" });
    return;
  }
  const bundle = buildNativeBundle(userId);
  await saveWorkspaceBundleToNative(bundle, userId);
}
