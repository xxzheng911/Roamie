import { withCacheBust } from "@/lib/media-display-url";

export type TripMemberProfileFields = {
  display_name?: string | null;
  avatar_url?: string | null;
  photo_url?: string | null;
  email?: string | null;
  full_name?: string | null;
  username?: string | null;
  profile_updated_at?: string | null;
};

function isDataUrl(url: string): boolean {
  return url.startsWith("data:");
}

export function sanitizeCollaboratorAvatarUrl(url: string | null | undefined): string | null {
  if (!url?.trim() || isDataUrl(url)) return null;
  return url.trim();
}

/** 從 profile 欄位解析顯示名稱；profile 為 null 時回傳 null（由 caller 決定 fallback） */
export function resolveCollaboratorDisplayName(
  profile: TripMemberProfileFields | null | undefined,
): string | null {
  if (!profile) return null;

  const displayName = profile.display_name?.trim();
  if (displayName) return displayName;

  const fullName = profile.full_name?.trim();
  if (fullName) return fullName;

  const username = profile.username?.trim();
  if (username) return username;

  const email = profile.email?.trim();
  if (email) {
    const prefix = email.split("@")[0]?.trim();
    if (prefix) return prefix;
  }

  return null;
}

export function resolveCollaboratorAvatarUrl(
  profile: TripMemberProfileFields | null | undefined,
): string | null {
  const raw =
    sanitizeCollaboratorAvatarUrl(profile?.avatar_url) ??
    sanitizeCollaboratorAvatarUrl(profile?.photo_url);
  if (!raw) return null;

  const revision = profile?.profile_updated_at
    ? Date.parse(profile.profile_updated_at)
    : undefined;
  return withCacheBust(raw, Number.isFinite(revision) ? revision : undefined) ?? raw;
}

export function collaboratorInitial(
  profile: TripMemberProfileFields | null | undefined,
  displayName?: string | null,
): string {
  const name = displayName ?? resolveCollaboratorDisplayName(profile);
  if (name?.trim()) return name.trim().slice(0, 1).toUpperCase();
  return "?";
}

/** profile 不存在時的顯示名稱 fallback */
export const COLLABORATOR_MISSING_PROFILE_NAME = "旅伴";
