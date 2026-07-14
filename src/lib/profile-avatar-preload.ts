import {
  ensureRemoteMediaCached,
  hydrateUserMediaFromCache,
} from "@/lib/user-media/user-media-store";

function versionOf(updatedAt: string | null | undefined): string {
  if (!updatedAt?.trim()) return "0";
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) ? String(ms) : updatedAt.trim();
}

export function preloadAvatarImage(
  userId: string | null | undefined,
  avatarUrl: string | null | undefined,
  avatarUpdatedAt?: string | null,
): void {
  if (!userId || !avatarUrl?.trim() || typeof window === "undefined") return;
  void hydrateUserMediaFromCache(userId).then(() =>
    ensureRemoteMediaCached({
      userId,
      kind: "avatar",
      remoteUrl: avatarUrl,
      version: versionOf(avatarUpdatedAt),
    }),
  );
}

export function readPreloadedAvatarSrc(
  _userId: string | null | undefined,
  avatarUrl: string | null | undefined,
  _avatarUpdatedAt?: string | null,
): string | null {
  return avatarUrl?.trim() || null;
}
