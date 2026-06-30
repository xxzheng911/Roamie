const MEDIA_KEY = "roamie:profile-media-persisted";

type PersistedProfileMedia = {
  userId: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  updatedAt: number;
};

function readRaw(): PersistedProfileMedia | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MEDIA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProfileMedia;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readPersistedAvatarUrl(userId?: string | null): string | null {
  const row = readRaw();
  if (!row?.avatarUrl) return null;
  if (userId && row.userId !== userId) return null;
  return row.avatarUrl;
}

export function readPersistedCoverUrl(userId?: string | null): string | null {
  const row = readRaw();
  if (!row?.coverImageUrl) return null;
  if (userId && row.userId !== userId) return null;
  return row.coverImageUrl;
}

export function writePersistedProfileMedia(
  userId: string,
  patch: { avatarUrl?: string | null; coverImageUrl?: string | null },
): void {
  if (typeof window === "undefined" || !userId) return;
  const prev = readRaw();
  const next: PersistedProfileMedia = {
    userId,
    avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : (prev?.avatarUrl ?? null),
    coverImageUrl:
      patch.coverImageUrl !== undefined ? patch.coverImageUrl : (prev?.coverImageUrl ?? null),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}
