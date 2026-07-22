/**
 * Capacitor Preferences mirror for Conversation Workspaces.
 *
 * On iOS 26 device builds, WKWebsiteDataStore.nonPersistent() wipes WebKit
 * localStorage on every cold launch. Preferences (UserDefaults) survive.
 */
import { Preferences } from "@capacitor/preferences";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { detectPlatform } from "@/services/platform";
import type {
  ConversationWorkspace,
  ConversationWorkspaceListItem,
} from "@/lib/conversation-workspace/types";

const NATIVE_BUNDLE_PREFIX = "roamie.conversation-workspaces.bundle";
const NATIVE_ACTIVE_KEY = "roamie.conversation-workspace.active";

export type WorkspaceNativeBundle = {
  list: ConversationWorkspaceListItem[];
  workspaces: Record<string, ConversationWorkspace>;
  activeWorkspaceId?: string | null;
  updatedAt: string;
};

function bundleKey(userId?: string | null): string {
  return userId ? `${NATIVE_BUNDLE_PREFIX}.${userId}` : NATIVE_BUNDLE_PREFIX;
}

async function canUseNative(): Promise<boolean> {
  if (!detectPlatform().isCapacitor) return false;
  return waitForCapacitorBridge(4_000);
}

export async function saveWorkspaceBundleToNative(
  bundle: WorkspaceNativeBundle,
  userId?: string | null,
): Promise<boolean> {
  if (!(await canUseNative())) return false;
  try {
    const payload = JSON.stringify(bundle);
    await Preferences.set({ key: bundleKey(userId), value: payload });
    if (bundle.activeWorkspaceId) {
      await Preferences.set({
        key: NATIVE_ACTIVE_KEY,
        value: bundle.activeWorkspaceId,
      });
    }
    return true;
  } catch (e) {
    console.warn("[WORKSPACE_SAVE_FAILED]", {
      target: "native",
      reason: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function loadWorkspaceBundleFromNative(
  userId?: string | null,
): Promise<WorkspaceNativeBundle | null> {
  if (!(await canUseNative())) return null;
  try {
    const { value } = await Preferences.get({ key: bundleKey(userId) });
    if (!value) {
      // Guest → user migration: try guest bundle when user-scoped is empty
      if (userId) {
        const guest = await Preferences.get({ key: bundleKey(null) });
        if (guest.value) {
          const parsed = JSON.parse(guest.value) as WorkspaceNativeBundle;
          if (parsed?.list?.length || Object.keys(parsed?.workspaces ?? {}).length) {
            console.info("[WORKSPACE_NATIVE_MIGRATE_GUEST]", {
              userId,
              count: parsed.list?.length ?? 0,
            });
            return parsed;
          }
        }
      }
      return null;
    }
    const parsed = JSON.parse(value) as WorkspaceNativeBundle;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.list)) parsed.list = [];
    if (!parsed.workspaces || typeof parsed.workspaces !== "object") {
      parsed.workspaces = {};
    }
    return parsed;
  } catch (e) {
    console.warn("[WORKSPACE_NATIVE_LOAD_FAILED]", {
      reason: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function deleteWorkspaceFromNativeBundle(
  workspaceId: string,
  userId?: string | null,
): Promise<boolean> {
  const existing = await loadWorkspaceBundleFromNative(userId);
  if (!existing) return false;
  const next: WorkspaceNativeBundle = {
    list: existing.list.filter((w) => w.workspaceId !== workspaceId),
    workspaces: { ...existing.workspaces },
    activeWorkspaceId:
      existing.activeWorkspaceId === workspaceId
        ? null
        : existing.activeWorkspaceId,
    updatedAt: new Date().toISOString(),
  };
  delete next.workspaces[workspaceId];
  return saveWorkspaceBundleToNative(next, userId);
}
