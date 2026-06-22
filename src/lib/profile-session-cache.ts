import type { UserProfile } from "@/lib/profile-storage";

let cachedProfile: UserProfile | null = null;
let cachedUserId: string | null = null;
let inflightProfileFetch: Promise<UserProfile> | null = null;
let inflightProfileUserId: string | null = null;

export function readProfileSessionCache(userId?: string | null): UserProfile | null {
  if (!cachedProfile) return null;
  if (userId && cachedUserId && userId !== cachedUserId) return null;
  return cachedProfile;
}

export function writeProfileSessionCache(profile: UserProfile, userId?: string | null): void {
  cachedProfile = profile;
  if (userId) cachedUserId = userId;
}

export function patchProfileSessionCache(
  patch: Partial<UserProfile>,
  userId?: string | null,
): UserProfile | null {
  if (!cachedProfile) return null;
  if (userId && cachedUserId && userId !== cachedUserId) return null;
  cachedProfile = { ...cachedProfile, ...patch };
  return cachedProfile;
}

export function clearProfileSessionCache(): void {
  cachedProfile = null;
  cachedUserId = null;
  inflightProfileFetch = null;
  inflightProfileUserId = null;
}

export function readInflightProfileFetch(userId: string): Promise<UserProfile> | null {
  if (!inflightProfileFetch || inflightProfileUserId !== userId) return null;
  return inflightProfileFetch;
}

export function trackInflightProfileFetch(
  userId: string,
  promise: Promise<UserProfile>,
): Promise<UserProfile> {
  inflightProfileUserId = userId;
  inflightProfileFetch = promise.finally(() => {
    if (inflightProfileFetch === promise) {
      inflightProfileFetch = null;
      inflightProfileUserId = null;
    }
  });
  return inflightProfileFetch;
}
