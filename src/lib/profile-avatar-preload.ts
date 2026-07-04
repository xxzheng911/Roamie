import { cacheKey, getCachedImage, setCachedImage } from "@/services/image-cache";
import { resolveAvatarDisplayUrl } from "@/lib/profile-persisted-cache";

const preloaded = new Set<string>();

export function preloadAvatarImage(
  userId: string | null | undefined,
  avatarUrl: string | null | undefined,
  avatarUpdatedAt?: string | null,
): void {
  const displayUrl = resolveAvatarDisplayUrl(avatarUrl, avatarUpdatedAt);
  if (!displayUrl || typeof window === "undefined") return;

  const persisted = userId ? getCachedImage(cacheKey("avatar", userId)) : null;
  const src = persisted && persisted === displayUrl ? persisted : displayUrl;
  if (preloaded.has(src)) return;

  console.info("[AVATAR_IMAGE_PRELOAD_START]", { userId: userId ?? null });
  preloaded.add(src);

  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    if (userId) setCachedImage(cacheKey("avatar", userId), src);
    console.info("[AVATAR_IMAGE_PRELOAD_SUCCESS]", { userId: userId ?? null });
  };
  img.onerror = () => {
    preloaded.delete(src);
  };
  img.src = src;
}

export function readPreloadedAvatarSrc(
  userId: string | null | undefined,
  avatarUrl: string | null | undefined,
  avatarUpdatedAt?: string | null,
): string | null {
  const displayUrl = resolveAvatarDisplayUrl(avatarUrl, avatarUpdatedAt);
  if (!displayUrl) return null;
  if (userId) {
    const cached = getCachedImage(cacheKey("avatar", userId));
    if (cached) return cached;
  }
  return displayUrl;
}
