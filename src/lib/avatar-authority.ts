/** Avatar-only mutation authority. Kept across logout; account deletion clears user-owned keys. */
export type AvatarAuthority = {
  token: string;
  url: string | null;
  version: string;
  serverUpdatedAt: string | null;
};

const memory = new Map<string, AvatarAuthority>();
const listeners = new Set<(userId: string, authority: AvatarAuthority) => void>();
const mutations = new Map<string, Promise<unknown>>();
const keyFor = (userId: string) => `roamie:avatar-authority:${userId}`;

export function readAvatarAuthority(userId?: string | null): AvatarAuthority | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw) {
      const row = JSON.parse(raw) as AvatarAuthority;
      if (row.token && row.version && (row.url === null || typeof row.url === "string")) {
        memory.set(userId, row);
        return row;
      }
    }
  } catch { /* memory remains authoritative when storage is unavailable */ }
  return memory.get(userId) ?? null;
}

export function commitAvatarAuthority(userId: string, url: string | null, serverUpdatedAt: string | null) {
  const previous = readAvatarAuthority(userId);
  const row: AvatarAuthority = {
    token: crypto.randomUUID(),
    url,
    version: String(Math.max(Date.now(), Number(previous?.version ?? 0) + 1)),
    serverUpdatedAt,
  };
  memory.set(userId, row);
  try { localStorage.setItem(keyFor(userId), JSON.stringify(row)); } catch { /* memory fallback */ }
  for (const listener of listeners) listener(userId, row);
  return row;
}

export function subscribeAvatarAuthority(listener: (userId: string, authority: AvatarAuthority) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Only a later confirmed DB read may supersede a local mutation, never a pre-mutation fetch. */
export function acceptAvatarProfileRead(userId: string, startedToken: string | undefined,
  url: string | null, updatedAt: string | null) {
  const current = readAvatarAuthority(userId);
  if (current && current.token === startedToken && current.serverUpdatedAt && updatedAt &&
      Date.parse(updatedAt) > Date.parse(current.serverUpdatedAt)) {
    commitAvatarAuthority(userId, url, updatedAt);
  }
}

export function withAvatarProfileAuthority<T extends { avatarUrl?: string | null }>(userId: string | null | undefined, value: T): T {
  const authority = readAvatarAuthority(userId);
  return authority ? { ...value, avatarUrl: authority.url } : value;
}

export function isAvatarMediaCurrent(userId: string, version: string, url?: string | null): boolean {
  const authority = readAvatarAuthority(userId);
  return !authority || (authority.url !== null && authority.version === version &&
    (url === undefined || authority.url === url));
}

/** Canonical custom-avatar presence: mutation authority wins over persisted metadata / display src. */
export function hasCanonicalCustomAvatar(userId?: string | null, persistedUrl?: string | null): boolean {
  if (!userId) return false;
  const authority = readAvatarAuthority(userId);
  if (authority) return Boolean(authority.url?.trim());
  return Boolean(persistedUrl?.trim());
}

export function clearAvatarAuthority(userId: string) {
  memory.delete(userId);
  try { localStorage.removeItem(keyFor(userId)); } catch { /* memory already cleared */ }
}

/** Serializes delete cleanup and replacement, including other tabs supporting Web Locks.
 * No deferred Storage delete is scheduled: a failed cleanup cannot later delete a replacement.
 */
export function withAvatarMutation<T>(userId: string, action: () => Promise<T>): Promise<T> {
  const previous = mutations.get(userId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`roamie-avatar:${userId}`, action)
      : action(),
  );
  mutations.set(userId, task);
  void task.finally(() => { if (mutations.get(userId) === task) mutations.delete(userId); }).catch(() => {});
  return task;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith("roamie:avatar-authority:") || !event.newValue) return;
    const userId = event.key.slice("roamie:avatar-authority:".length);
    const authority = readAvatarAuthority(userId);
    if (authority) for (const listener of listeners) listener(userId, authority);
  });
}
