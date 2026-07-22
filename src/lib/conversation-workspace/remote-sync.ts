/**
 * Best-effort Supabase backup for Plus Conversation Workspaces.
 * Stored under profiles.ai_preferences.conversation_workspaces (no new table).
 * Native Preferences remains the primary durability path on iOS 26.
 */
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type {
  ConversationWorkspace,
  ConversationWorkspaceListItem,
} from "@/lib/conversation-workspace/types";
import {
  listConversationWorkspaces,
  loadConversationWorkspace,
  saveConversationWorkspace,
} from "@/lib/conversation-workspace/storage";

const REMOTE_KEY = "conversation_workspaces";
/** Soft safety cap for Supabase ai_preferences JSON size — not a UI list limit. */
const MAX_REMOTE_WORKSPACES = 100;
const MAX_MESSAGES_PER_WORKSPACE = 80;

type RemoteBundle = {
  list: ConversationWorkspaceListItem[];
  workspaces: Record<string, ConversationWorkspace>;
  updatedAt: string;
};

function compactWorkspace(ws: ConversationWorkspace): ConversationWorkspace {
  const messages = (ws.messages ?? []).slice(-MAX_MESSAGES_PER_WORKSPACE);
  return {
    ...ws,
    messages,
    // Drop bulky ephemeral recommendation pools from remote backup
    currentRecommendationPool: undefined,
  };
}

export async function pushConversationWorkspacesRemote(
  userId: string,
): Promise<boolean> {
  if (!userId || !isSupabaseConfigured()) return false;
  try {
    const all = listConversationWorkspaces(userId);
    const list = all.slice(0, MAX_REMOTE_WORKSPACES);
    if (all.length > list.length) {
      console.warn("[WORKSPACE_REMOTE_PUSH_TRUNCATED]", {
        totalCount: all.length,
        pushedCount: list.length,
        maxRemote: MAX_REMOTE_WORKSPACES,
      });
    }
    const workspaces: Record<string, ConversationWorkspace> = {};
    for (const item of list) {
      const blob = loadConversationWorkspace(item.workspaceId, userId);
      if (blob) workspaces[item.workspaceId] = compactWorkspace(blob);
    }
    const bundle: RemoteBundle = {
      list,
      workspaces,
      updatedAt: new Date().toISOString(),
    };

    const { data, error: readErr } = await supabase
      .from("profiles")
      .select("ai_preferences")
      .eq("id", userId)
      .maybeSingle();
    if (readErr) {
      console.warn("[WORKSPACE_SAVE_FAILED]", {
        target: "remote",
        reason: readErr.message,
      });
      return false;
    }
    const prefs =
      data?.ai_preferences && typeof data.ai_preferences === "object"
        ? (data.ai_preferences as Record<string, unknown>)
        : {};
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          ai_preferences: {
            ...prefs,
            [REMOTE_KEY]: bundle,
          } as never,
        },
        { onConflict: "id" },
      );
    if (error) {
      console.warn("[WORKSPACE_SAVE_FAILED]", {
        target: "remote",
        reason: error.message,
      });
      return false;
    }
    console.info("[WORKSPACE_SAVE_SUCCESS]", {
      workspaceId: "(bundle)",
      local: true,
      remote: true,
      updatedAt: bundle.updatedAt,
      count: list.length,
    });
    return true;
  } catch (e) {
    console.warn("[WORKSPACE_SAVE_FAILED]", {
      target: "remote",
      reason: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function pullConversationWorkspacesRemote(
  userId: string,
): Promise<RemoteBundle | null> {
  if (!userId || !isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("ai_preferences")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[WORKSPACE_REMOTE_LOAD]", {
        count: 0,
        userId,
        error: error.message,
      });
      return null;
    }
    const prefs =
      data?.ai_preferences && typeof data.ai_preferences === "object"
        ? (data.ai_preferences as Record<string, unknown>)
        : {};
    const raw = prefs[REMOTE_KEY];
    if (!raw || typeof raw !== "object") {
      console.info("[WORKSPACE_REMOTE_LOAD]", { count: 0, userId });
      return null;
    }
    const bundle = raw as RemoteBundle;
    const list = Array.isArray(bundle.list) ? bundle.list : [];
    console.info("[WORKSPACE_REMOTE_LOAD]", {
      count: list.length,
      userId,
      source: "supabase_ai_preferences",
    });
    return {
      list,
      workspaces: bundle.workspaces ?? {},
      updatedAt: bundle.updatedAt ?? new Date().toISOString(),
    };
  } catch (e) {
    console.warn("[WORKSPACE_REMOTE_LOAD]", {
      count: 0,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Merge remote into local without wiping local when remote is empty/failed. */
export async function mergeRemoteConversationWorkspaces(
  userId: string,
): Promise<number> {
  const remote = await pullConversationWorkspacesRemote(userId);
  if (!remote?.list?.length) return 0;
  let merged = 0;
  for (const item of remote.list) {
    const remoteWs = remote.workspaces[item.workspaceId];
    if (!remoteWs) continue;
    const local = loadConversationWorkspace(item.workspaceId, userId);
    if (!local || (remoteWs.updatedAt ?? "") > (local.updatedAt ?? "")) {
      // Preserve remote sort key — do not re-stamp on merge pull
      saveConversationWorkspace(remoteWs, userId, { bumpUpdatedAt: false });
      merged += 1;
    }
  }
  return merged;
}
