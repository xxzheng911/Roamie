import { supabase } from "@/lib/supabase";
import { requireAuthenticatedUser } from "@/lib/auth-session";
import { commitAvatarAuthority, readAvatarAuthority, withAvatarMutation } from "@/lib/avatar-authority";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { writeCachedProfile } from "@/lib/profile-persisted-cache";
import { clearRemovedAvatarMedia } from "@/lib/user-media/user-media-store";

type AvatarRow = { avatar_url: string | null; updated_at: string | null };
type RemovalDependencies = {
  userId: () => Promise<string>;
  read: (userId: string) => Promise<AvatarRow>;
  clear: (userId: string, previous: AvatarRow) => Promise<AvatarRow | null>;
  publicUrl: (path: string) => string;
  remove: (path: string) => Promise<void>;
  clearLocal: (userId: string) => Promise<void>;
};

/** Exact canonical URL comparison validates project, bucket, owner and avatar object.
 * Provider/external URLs, encoded alternate paths and another user's media are never deleted.
 */
export function isOwnedAvatarObject(url: string | null, canonicalUrl: string): boolean {
  if (!url) return false;
  try {
    const actual = new URL(url);
    const expected = new URL(canonicalUrl);
    return !actual.username && !actual.password && actual.origin === expected.origin &&
      actual.pathname === expected.pathname && /^https?:$/.test(actual.protocol);
  } catch { return false; }
}

export function isMissingAvatarObject(error: unknown): boolean {
  const value = error as { statusCode?: string | number; status?: number; message?: string };
  return Number(value?.statusCode ?? value?.status) === 404 ||
    /^(object not found|the resource was not found)$/i.test(value?.message ?? "");
}

const production: RemovalDependencies = {
  userId: async () => (await requireAuthenticatedUser()).id,
  read: async (id) => {
    const { data, error } = await supabase.from("profiles")
      .select("avatar_url, updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("avatar_profile_missing");
    return data;
  },
  clear: async (id) => {
    const { data, error } = await supabase.from("profiles")
      .update({ avatar_url: null }).eq("id", id)
      .select("avatar_url, updated_at").maybeSingle();
    if (error) throw error;
    return data;
  },
  publicUrl: (path) => supabase.storage.from("profile-media").getPublicUrl(path).data.publicUrl,
  remove: async (path) => {
    const { error } = await supabase.storage.from("profile-media").remove([path]);
    if (error) throw error;
  },
  clearLocal: clearRemovedAvatarMedia,
};

/** DB-first. Cleanup completes under the same lock as uploads; failures are recorded, never retried blindly. */
export async function removeProfileAvatar(deps: RemovalDependencies = production) {
  const userId = await deps.userId();
  return withAvatarMutation(userId, async () => {
    if (await deps.userId() !== userId) throw new Error("avatar_identity_changed");
    const previous = await deps.read(userId);
    if (await deps.userId() !== userId) throw new Error("avatar_identity_changed");
    const updated = await deps.clear(userId, previous);
    if (!updated || updated.avatar_url !== null) throw new Error("avatar_update_not_confirmed");

    const authority = commitAvatarAuthority(userId, null, updated.updated_at);
    writeCachedProfile({
      userId,
      avatarUrl: null,
      hasCustomAvatar: false,
      avatarUpdatedAt: updated.updated_at,
    });
    broadcastAvatarUpdate(null, Number(authority.version), userId);
    const issues: string[] = [];
    try { await deps.clearLocal(userId); } catch { issues.push("local_cache_cleanup"); }

    const path = `${userId}/avatar.jpg`;
    if (isOwnedAvatarObject(previous.avatar_url, deps.publicUrl(path))) {
      try {
        // Re-check identity, mutation token, and DB null. The public URL is stable across
        // replacements, so a later upload must not be deleted by this cleanup.
        if (await deps.userId() !== userId || readAvatarAuthority(userId)?.token !== authority.token) {
          issues.push("cleanup_superseded");
        } else {
          const latest = await deps.read(userId);
          if (latest.avatar_url !== null || readAvatarAuthority(userId)?.token !== authority.token) {
            issues.push("cleanup_superseded");
          } else {
            await deps.remove(path);
          }
        }
      } catch (error) {
        if (!isMissingAvatarObject(error)) issues.push("storage_cleanup");
      }
    }
    if (issues.length) {
      const signal = { userId, mutation: authority.token, path, issues, at: Date.now(), automaticRetry: false };
      console.warn("[AVATAR_REMOVE_CLEANUP_PENDING]", signal);
      try { localStorage.setItem(`roamie:avatar-cleanup:${userId}`, JSON.stringify(signal)); } catch { /* log remains */ }
    }
    return { userId, removed: true as const, cleanupPending: issues.length > 0 };
  });
}
