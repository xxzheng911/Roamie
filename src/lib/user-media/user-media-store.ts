/**
 * Shared UserMediaStore — single source of truth for avatar / cover display URIs.
 * Stale-while-revalidate: disk/memory first, remote validate in background.
 *
 * Avatar presence is tri-state:
 * - unknown: not yet confirmed whether user has a custom avatar
 * - custom: known custom avatar (disk / metadata / remote)
 * - none: confirmed user never set (or removed) a custom avatar
 *
 * Only `none` may render the default Roamie avatar.
 */
import { profileMediaPath } from "@/lib/profile-media-storage";
import {
  readCachedProfile,
  readLastCachedProfileUserId,
  writeCachedProfile,
} from "@/lib/profile-persisted-cache";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  buildUserMediaCacheKey,
  findLatestUserMediaDisk,
  readUserMediaDisk,
  stableMediaUrl,
  writeUserMediaDisk,
  type UserMediaKind,
} from "@/lib/user-media/user-media-disk";
import { displayMaxEdgeForKind, downscaleImageBlob } from "@/lib/user-media/user-media-resize";
import { logUserMedia, resetUserMediaLogOnce } from "@/lib/user-media/user-media-log";

export type AvatarPresence = "unknown" | "custom" | "none";

export type UserMediaSnapshot = {
  userId: string | null;
  avatarUrl: string | null;
  avatarCacheKey: string | null;
  avatarLocalUri: string | null;
  avatarVersion: string | null;
  coverUrl: string | null;
  coverCacheKey: string | null;
  coverLocalUri: string | null;
  coverVersion: string | null;
  /** True when local/remote custom avatar is ready to paint (or known absent). */
  isAvatarReady: boolean;
  isCoverReady: boolean;
  /**
   * Tri-state presence. Prefer `avatarStatus`.
   * true → custom, false → none, null → unknown.
   */
  hasCustomAvatar: boolean | null;
  hasCustomCover: boolean;
  avatarStatus: AvatarPresence;
  lastValidatedAt: number | null;
  /** Wall time when store was seeded / hydrated for first paint metrics. */
  hydratedAt: number | null;
};

type Listener = (snap: UserMediaSnapshot) => void;

const EMPTY: UserMediaSnapshot = {
  userId: null,
  avatarUrl: null,
  avatarCacheKey: null,
  avatarLocalUri: null,
  avatarVersion: null,
  coverUrl: null,
  coverCacheKey: null,
  coverLocalUri: null,
  coverVersion: null,
  isAvatarReady: false,
  isCoverReady: false,
  hasCustomAvatar: null,
  hasCustomCover: false,
  avatarStatus: "unknown",
  lastValidatedAt: null,
  hydratedAt: null,
};

let snapshot: UserMediaSnapshot = { ...EMPTY };
const listeners = new Set<Listener>();
const objectUrls = new Map<string, string>();
const inflightDownload = new Map<string, Promise<string | null>>();
const loadStartedAt = new Map<string, number>();
/** Idempotency key: userId or "__anon__" — prevents render-loop re-seed. */
let syncSeededKey: string | null = null;
let hydrateInflight: { key: string; promise: Promise<UserMediaSnapshot> } | null = null;

function emit(): void {
  const snap = snapshot;
  for (const listener of listeners) {
    try {
      listener(snap);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function setSnapshot(patch: Partial<UserMediaSnapshot>): void {
  const next = { ...snapshot, ...patch };
  // Keep hasCustomAvatar ↔ avatarStatus in sync when either is patched.
  if (patch.avatarStatus != null && patch.hasCustomAvatar === undefined) {
    next.hasCustomAvatar =
      patch.avatarStatus === "custom" ? true : patch.avatarStatus === "none" ? false : null;
  } else if (patch.hasCustomAvatar !== undefined && patch.avatarStatus === undefined) {
    next.avatarStatus =
      patch.hasCustomAvatar === true
        ? "custom"
        : patch.hasCustomAvatar === false
          ? "none"
          : "unknown";
  }
  // Skip no-op emits — avoids subscribe → re-render → seed loops.
  const keys = Object.keys(next) as (keyof UserMediaSnapshot)[];
  const changed = keys.some((k) => next[k] !== snapshot[k]);
  if (!changed) return;
  snapshot = next;
  emit();
}

function revokeUri(uri: string | null | undefined): void {
  if (!uri?.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    /* noop */
  }
}

function rememberObjectUrl(cacheKey: string, blob: Blob): string {
  const prev = objectUrls.get(cacheKey);
  if (prev) revokeUri(prev);
  const uri = URL.createObjectURL(blob);
  objectUrls.set(cacheKey, uri);
  return uri;
}

function getMemoryUri(cacheKey: string): string | null {
  return objectUrls.get(cacheKey) ?? null;
}

export function getUserMediaSnapshot(): UserMediaSnapshot {
  return snapshot;
}

export function subscribeUserMedia(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

function versionOf(updatedAt: string | null | undefined): string {
  if (!updatedAt?.trim()) return "0";
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) ? String(ms) : updatedAt.trim();
}

function avatarCacheKeyFor(userId: string, version: string): string {
  return buildUserMediaCacheKey({
    userId,
    kind: "avatar",
    pathOrId: profileMediaPath(userId, "avatar"),
    version,
  });
}

function coverCacheKeyFor(userId: string, version: string): string {
  return buildUserMediaCacheKey({
    userId,
    kind: "cover",
    pathOrId: profileMediaPath(userId, "cover"),
    version,
  });
}

async function hydrateFromDisk(
  userId: string,
  kind: "avatar" | "cover",
  preferredKey?: string | null,
): Promise<{ uri: string; cacheKey: string; remoteUrl: string; version: string } | null> {
  const entry = preferredKey
    ? await readUserMediaDisk(preferredKey)
    : await findLatestUserMediaDisk({ userId, kind });
  if (!entry?.blob) return null;
  const uri = rememberObjectUrl(entry.cacheKey, entry.blob);
  return {
    uri,
    cacheKey: entry.cacheKey,
    remoteUrl: entry.remoteUrl,
    version: entry.version,
  };
}

/**
 * Sync cold-boot seed from localStorage metadata — once per userId.
 * Safe to call repeatedly (idempotent); never call from React render bodies.
 * Never marks status=none without evidence.
 */
export function seedUserMediaFromPersistedSync(userId?: string | null): UserMediaSnapshot {
  if (typeof window === "undefined") return snapshot;

  const resolved =
    userId?.trim() ||
    readCachedAuthenticatedUserIdSync() ||
    readLastCachedProfileUserId() ||
    null;
  const seedKey = resolved ?? "__anon__";

  // Already seeded for this identity — do not setSnapshot / log again.
  if (syncSeededKey === seedKey) {
    return snapshot;
  }

  // Do not wipe a same-user in-memory custom avatar during late seed.
  if (
    resolved &&
    snapshot.userId === resolved &&
    (snapshot.avatarLocalUri || snapshot.avatarStatus === "custom")
  ) {
    syncSeededKey = seedKey;
    return snapshot;
  }

  if (!resolved) {
    setSnapshot({
      ...EMPTY,
      avatarStatus: "unknown",
      hasCustomAvatar: null,
      isAvatarReady: false,
      isCoverReady: false,
      hydratedAt: snapshot.hydratedAt ?? performance.now(),
    });
    syncSeededKey = seedKey;
    return snapshot;
  }

  const persisted = readCachedProfile(resolved, { quiet: true });
  const avatarUrl = stableMediaUrl(persisted?.avatarUrl);
  const coverUrl = stableMediaUrl(persisted?.coverImageUrl);
  const knownCustom =
    persisted?.hasCustomAvatar === true || Boolean(avatarUrl);
  const knownNone = persisted?.hasCustomAvatar === false && !avatarUrl;
  const avatarVersion = versionOf(persisted?.avatarUpdatedAt ?? persisted?.profileUpdatedAt);
  const coverVersion = versionOf(persisted?.profileUpdatedAt ?? persisted?.avatarUpdatedAt);

  const avatarStatus: AvatarPresence = knownCustom ? "custom" : knownNone ? "none" : "unknown";

  setSnapshot({
    userId: resolved,
    avatarUrl,
    avatarCacheKey: avatarUrl ? avatarCacheKeyFor(resolved, avatarVersion) : null,
    avatarLocalUri: snapshot.userId === resolved ? snapshot.avatarLocalUri : null,
    avatarVersion: avatarUrl ? avatarVersion : null,
    coverUrl,
    coverCacheKey: coverUrl ? coverCacheKeyFor(resolved, coverVersion) : null,
    coverLocalUri: snapshot.userId === resolved ? snapshot.coverLocalUri : null,
    coverVersion: coverUrl ? coverVersion : null,
    avatarStatus,
    hasCustomAvatar: avatarStatus === "custom" ? true : avatarStatus === "none" ? false : null,
    hasCustomCover: Boolean(coverUrl || persisted?.hasCustomCover),
    // Custom known without local blob → pending placeholder (not default).
    // None confirmed → ready for default. Unknown → not ready.
    isAvatarReady:
      avatarStatus === "none" ||
      (snapshot.userId === resolved && Boolean(snapshot.avatarLocalUri)),
    isCoverReady: !coverUrl || (snapshot.userId === resolved && Boolean(snapshot.coverLocalUri)),
    lastValidatedAt: null,
    hydratedAt: snapshot.hydratedAt ?? performance.now(),
  });

  syncSeededKey = seedKey;
  // No console on metadata seed — Cap bridge floods if seed is retriggered.
  return snapshot;
}

/**
 * Cold-boot hydrate: paint from IndexedDB + persisted metadata without waiting for profile API.
 */
export async function hydrateUserMediaFromCache(userId?: string | null): Promise<UserMediaSnapshot> {
  seedUserMediaFromPersistedSync(userId);

  const resolved =
    userId?.trim() ||
    readCachedAuthenticatedUserIdSync() ||
    readLastCachedProfileUserId() ||
    snapshot.userId ||
    null;
  const hydrateKey = resolved ?? "__anon__";
  if (hydrateInflight?.key === hydrateKey) {
    return hydrateInflight.promise;
  }

  const promise = runHydrateUserMediaFromCache(resolved);
  hydrateInflight = { key: hydrateKey, promise };
  try {
    return await promise;
  } finally {
    if (hydrateInflight?.promise === promise) hydrateInflight = null;
  }
}

async function runHydrateUserMediaFromCache(
  resolved: string | null,
): Promise<UserMediaSnapshot> {
  const t0 = performance.now();
  if (!resolved) {
    // Stay unknown — never show default while session user is unresolved.
    setSnapshot({
      avatarStatus: "unknown",
      hasCustomAvatar: null,
      isAvatarReady: false,
      isCoverReady: false,
    });
    return snapshot;
  }

  // Same-user hydrate must never clear a good memory/disk paint first.
  const keepLocalAvatar =
    snapshot.userId === resolved && Boolean(snapshot.avatarLocalUri);

  const persisted = readCachedProfile(resolved, { quiet: true });
  const avatarUrl = stableMediaUrl(persisted?.avatarUrl) ?? snapshot.avatarUrl;
  const coverUrl = stableMediaUrl(persisted?.coverImageUrl) ?? snapshot.coverUrl;
  const avatarVersion = versionOf(
    persisted?.avatarUpdatedAt ?? persisted?.profileUpdatedAt ?? snapshot.avatarVersion,
  );
  const coverVersion = versionOf(
    persisted?.profileUpdatedAt ?? persisted?.avatarUpdatedAt ?? snapshot.coverVersion,
  );

  logUserMedia("USER_MEDIA_LOAD_START", {
    userId: resolved,
    avatarCache: Boolean(avatarUrl),
    coverCache: Boolean(coverUrl),
  });
  loadStartedAt.set(resolved, t0);

  const preferredAvatarKey = avatarUrl
    ? avatarCacheKeyFor(resolved, avatarVersion)
    : snapshot.avatarCacheKey;
  const preferredCoverKey = coverUrl
    ? coverCacheKeyFor(resolved, coverVersion)
    : snapshot.coverCacheKey;

  // Always probe disk — even when metadata lacks avatarUrl (disk-only warm boot).
  const [avatarDisk, coverDisk] = await Promise.all([
    hydrateFromDisk(resolved, "avatar", preferredAvatarKey),
    coverUrl || preferredCoverKey
      ? hydrateFromDisk(resolved, "cover", preferredCoverKey)
      : hydrateFromDisk(resolved, "cover"),
  ]);

  const avatarFallback = !avatarDisk ? await hydrateFromDisk(resolved, "avatar") : null;
  const coverFallback = !coverDisk ? await hydrateFromDisk(resolved, "cover") : null;

  const avatarHit = avatarDisk ?? avatarFallback;
  const coverHit = coverDisk ?? coverFallback;
  const elapsed = Math.round(performance.now() - t0);

  if (avatarHit) {
    logUserMedia("USER_AVATAR_CACHE_RENDERED", { elapsedMs: elapsed });
    logUserMedia("USER_AVATAR_READY", { source: "disk", elapsedMs: elapsed });
  }
  if (coverHit) {
    logUserMedia("USER_COVER_CACHE_RENDERED", { elapsedMs: elapsed });
    logUserMedia("USER_COVER_READY", { source: "disk", elapsedMs: elapsed });
  }

  const hasCustom =
    Boolean(avatarUrl || avatarHit || persisted?.hasCustomAvatar === true) ||
    (keepLocalAvatar && snapshot.avatarStatus === "custom");
  const confirmedNone =
    !hasCustom &&
    persisted?.hasCustomAvatar === false &&
    !avatarUrl &&
    !avatarHit;

  const avatarStatus: AvatarPresence = hasCustom
    ? "custom"
    : confirmedNone
      ? "none"
      : snapshot.avatarStatus === "custom"
        ? "custom"
        : "unknown";

  const nextLocalUri =
    avatarHit?.uri ?? (keepLocalAvatar ? snapshot.avatarLocalUri : null);

  setSnapshot({
    userId: resolved,
    avatarUrl: avatarHit?.remoteUrl ?? avatarUrl ?? (keepLocalAvatar ? snapshot.avatarUrl : null),
    avatarCacheKey:
      avatarHit?.cacheKey ?? preferredAvatarKey ?? (keepLocalAvatar ? snapshot.avatarCacheKey : null),
    avatarLocalUri: nextLocalUri,
    avatarVersion:
      avatarHit?.version ?? (avatarUrl ? avatarVersion : keepLocalAvatar ? snapshot.avatarVersion : null),
    coverUrl: coverHit?.remoteUrl ?? coverUrl,
    coverCacheKey: coverHit?.cacheKey ?? preferredCoverKey,
    coverLocalUri: coverHit?.uri ?? null,
    coverVersion: coverHit?.version ?? (coverUrl ? coverVersion : null),
    avatarStatus,
    hasCustomAvatar: avatarStatus === "custom" ? true : avatarStatus === "none" ? false : null,
    hasCustomCover: Boolean(coverUrl || coverHit),
    // Ready for default only when confirmed none. Custom without blob stays not-default.
    isAvatarReady: avatarStatus === "none" || Boolean(nextLocalUri) || Boolean(avatarUrl && avatarStatus === "custom"),
    isCoverReady: Boolean(coverHit) || !coverUrl,
    lastValidatedAt: null,
    hydratedAt: snapshot.hydratedAt ?? t0,
  });

  writeCachedProfile({
    userId: resolved,
    avatarUrl: snapshot.avatarUrl,
    coverImageUrl: snapshot.coverUrl,
    hasCustomAvatar: avatarStatus === "custom" ? true : avatarStatus === "none" ? false : null,
    hasCustomCover: Boolean(coverUrl || coverHit),
    avatarUpdatedAt: persisted?.avatarUpdatedAt ?? null,
    profileUpdatedAt: persisted?.profileUpdatedAt ?? null,
  });

  logUserMedia(
    "USER_MEDIA_HYDRATED",
    {
      userId: resolved,
      hasCustomAvatar: avatarStatus === "custom",
      hasCachedAvatar: Boolean(nextLocalUri),
      avatarStatus,
      elapsedMs: elapsed,
    },
    { onceKey: `disk:${resolved}` },
  );

  // Background warm decode if we only have remote URL (no disk yet).
  if (avatarUrl && !avatarHit && !nextLocalUri) {
    void ensureRemoteMediaCached({
      userId: resolved,
      kind: "avatar",
      remoteUrl: avatarUrl,
      version: avatarVersion,
    });
  }
  if (coverUrl && !coverHit) {
    void ensureRemoteMediaCached({
      userId: resolved,
      kind: "cover",
      remoteUrl: coverUrl,
      version: coverVersion,
    });
  }

  return snapshot;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.blob();
}

/**
 * Download (deduped) → downscale → disk → memory object URL.
 */
export async function ensureRemoteMediaCached(params: {
  userId: string;
  kind: "avatar" | "cover" | "trip-cover";
  remoteUrl: string;
  version: string;
  pathOrId?: string;
}): Promise<string | null> {
  const stable = stableMediaUrl(params.remoteUrl);
  if (!stable) return null;

  const pathOrId =
    params.pathOrId ??
    (params.kind === "avatar" || params.kind === "cover"
      ? profileMediaPath(params.userId, params.kind)
      : stable);

  const cacheKey = buildUserMediaCacheKey({
    userId: params.userId,
    kind: params.kind,
    pathOrId,
    version: params.version,
  });

  const mem = getMemoryUri(cacheKey);
  if (mem) {
    logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "same_version" });
    return mem;
  }

  const disk = await readUserMediaDisk(cacheKey);
  if (disk?.blob) {
    const uri = rememberObjectUrl(cacheKey, disk.blob);
    applyKindReady(params.kind, {
      cacheKey,
      uri,
      remoteUrl: stable,
      version: params.version,
      userId: params.userId,
      source: "disk",
    });
    return uri;
  }

  const existing = inflightDownload.get(cacheKey);
  if (existing) {
    logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "in_flight" });
    return existing;
  }

  const t0 = performance.now();
  logUserMedia(
    params.kind === "cover" || params.kind === "trip-cover"
      ? "USER_COVER_DOWNLOAD_START"
      : "USER_AVATAR_DOWNLOAD_START",
    { cacheKey },
  );

  const task = (async () => {
    try {
      const raw = await fetchBlob(stable);
      const display = await downscaleImageBlob(
        raw,
        displayMaxEdgeForKind(params.kind),
      );
      await writeUserMediaDisk({
        cacheKey,
        userId: params.userId,
        kind: params.kind as UserMediaKind,
        remoteUrl: stable,
        version: params.version,
        mimeType: display.type || "image/jpeg",
        blob: display,
      });
      const uri = rememberObjectUrl(cacheKey, display);
      const elapsed = Math.round(performance.now() - t0);
      applyKindReady(params.kind, {
        cacheKey,
        uri,
        remoteUrl: stable,
        version: params.version,
        userId: params.userId,
        source: "remote",
        elapsedMs: elapsed,
      });
      return uri;
    } catch {
      logUserMedia("USER_MEDIA_REFRESH_FAILED", {
        type: params.kind === "avatar" ? "avatar" : "cover",
        keptCachedImage: Boolean(
          params.kind === "avatar" ? snapshot.avatarLocalUri : snapshot.coverLocalUri,
        ),
      });
      return null;
    } finally {
      inflightDownload.delete(cacheKey);
    }
  })();

  inflightDownload.set(cacheKey, task);
  return task;
}

function applyKindReady(
  kind: "avatar" | "cover" | "trip-cover",
  params: {
    cacheKey: string;
    uri: string;
    remoteUrl: string;
    version: string;
    userId: string;
    source: "memory" | "disk" | "remote";
    elapsedMs?: number;
  },
): void {
  const started = loadStartedAt.get(params.userId);
  const elapsed =
    params.elapsedMs ??
    (started != null ? Math.round(performance.now() - started) : undefined);

  if (kind === "avatar") {
    const prevKey = snapshot.avatarCacheKey;
    const sameVersion = prevKey === params.cacheKey;
    logUserMedia("USER_AVATAR_READY", {
      source: params.source,
      elapsedMs: elapsed ?? null,
    });
    if (params.source === "remote" && snapshot.avatarLocalUri && prevKey) {
      logUserMedia("HOME_AVATAR_REPLACED", {
        from: "cache",
        to: "remote",
        sameVersion,
      });
    }
    if (snapshot.userId === params.userId || !snapshot.userId) {
      setSnapshot({
        userId: params.userId,
        avatarUrl: params.remoteUrl,
        avatarCacheKey: params.cacheKey,
        avatarLocalUri: params.uri,
        avatarVersion: params.version,
        avatarStatus: "custom",
        hasCustomAvatar: true,
        isAvatarReady: true,
      });
      writeCachedProfile({
        userId: params.userId,
        avatarUrl: params.remoteUrl,
        hasCustomAvatar: true,
        avatarUpdatedAt: new Date(Number(params.version) || Date.now()).toISOString(),
      });
    }
    return;
  }

  if (kind === "cover") {
    logUserMedia("USER_COVER_READY", {
      source: params.source,
      elapsedMs: elapsed ?? null,
    });
    if (snapshot.userId === params.userId || !snapshot.userId) {
      setSnapshot({
        userId: params.userId,
        coverUrl: params.remoteUrl,
        coverCacheKey: params.cacheKey,
        coverLocalUri: params.uri,
        coverVersion: params.version,
        hasCustomCover: true,
        isCoverReady: true,
      });
    }
  }
}

/**
 * After profile metadata arrives — validate version; download only when changed.
 * Never clears a same-user cached custom avatar just because remote URL is momentarily null.
 */
export async function validateUserMediaRemote(params: {
  userId: string;
  avatarUrl: string | null | undefined;
  coverUrl: string | null | undefined;
  avatarUpdatedAt?: string | null;
  profileUpdatedAt?: string | null;
  /** Explicit avatar removal (user cleared avatar). */
  confirmAvatarRemoved?: boolean;
}): Promise<void> {
  const t0 = performance.now();
  const avatarUrl = stableMediaUrl(params.avatarUrl);
  const coverUrl = stableMediaUrl(params.coverUrl);
  const avatarVersion = versionOf(params.avatarUpdatedAt ?? params.profileUpdatedAt);
  const coverVersion = versionOf(params.profileUpdatedAt ?? params.avatarUpdatedAt);

  const nextAvatarKey = avatarUrl
    ? avatarCacheKeyFor(params.userId, avatarVersion)
    : null;
  const nextCoverKey = coverUrl
    ? coverCacheKeyFor(params.userId, coverVersion)
    : null;

  // Skip duplicate validate bursts (AvatarProvider + CoverProvider both refresh).
  if (
    snapshot.userId === params.userId &&
    snapshot.lastValidatedAt &&
    Date.now() - snapshot.lastValidatedAt < 2_500 &&
    snapshot.avatarCacheKey === nextAvatarKey &&
    snapshot.coverCacheKey === nextCoverKey &&
    (Boolean(snapshot.avatarLocalUri) || !avatarUrl) &&
    (Boolean(snapshot.coverLocalUri) || !coverUrl)
  ) {
    logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "fresh_cache" });
    return;
  }

  const hadCustom =
    snapshot.avatarStatus === "custom" ||
    Boolean(snapshot.avatarLocalUri) ||
    Boolean(snapshot.avatarUrl) ||
    Boolean(readCachedProfile(params.userId, { quiet: true })?.hasCustomAvatar);

  writeCachedProfile({
    userId: params.userId,
    avatarUrl: avatarUrl ?? (hadCustom && !params.confirmAvatarRemoved ? snapshot.avatarUrl : null),
    coverImageUrl: coverUrl,
    avatarUpdatedAt: params.avatarUpdatedAt ?? null,
    profileUpdatedAt: params.profileUpdatedAt ?? null,
    hasCustomAvatar: avatarUrl
      ? true
      : params.confirmAvatarRemoved
        ? false
        : hadCustom
          ? true
          : false,
  });

  const avatarSame =
    Boolean(avatarUrl) &&
    snapshot.avatarCacheKey === nextAvatarKey &&
    Boolean(snapshot.avatarLocalUri);
  const coverSame =
    Boolean(coverUrl) &&
    snapshot.coverCacheKey === nextCoverKey &&
    Boolean(snapshot.coverLocalUri);

  if (!avatarUrl) {
    if (params.confirmAvatarRemoved || (!hadCustom && !snapshot.avatarLocalUri)) {
      setSnapshot({
        userId: params.userId,
        avatarUrl: null,
        avatarLocalUri: null,
        avatarCacheKey: null,
        avatarVersion: null,
        avatarStatus: "none",
        hasCustomAvatar: false,
        isAvatarReady: true,
        coverUrl: coverUrl,
        hasCustomCover: Boolean(coverUrl) || snapshot.hasCustomCover,
        lastValidatedAt: Date.now(),
      });
    } else {
      // Keep cached custom while remote URL is missing — do not flash default.
      setSnapshot({
        userId: params.userId,
        avatarStatus: "custom",
        hasCustomAvatar: true,
        isAvatarReady: Boolean(snapshot.avatarLocalUri),
        coverUrl: coverUrl,
        lastValidatedAt: Date.now(),
      });
    }
  } else {
    setSnapshot({
      userId: params.userId,
      avatarUrl,
      coverUrl,
      avatarStatus: "custom",
      hasCustomAvatar: true,
      hasCustomCover: Boolean(coverUrl) || snapshot.hasCustomCover,
      // Keep painting previous local uri while validating — never drop to default.
      isAvatarReady: Boolean(snapshot.avatarLocalUri) || avatarSame || Boolean(snapshot.avatarUrl),
      isCoverReady: !coverUrl
        ? true
        : Boolean(snapshot.coverLocalUri) || coverSame || Boolean(snapshot.coverUrl),
      lastValidatedAt: Date.now(),
    });

    if (avatarSame) {
      logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "same_version" });
      logUserMedia("HOME_AVATAR_REMOTE_VALIDATED", {
        sameVersion: true,
        elapsedMs: Math.round(performance.now() - t0),
      });
    } else if (snapshot.avatarCacheKey === nextAvatarKey && snapshot.avatarLocalUri) {
      logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "fresh_cache" });
      logUserMedia("HOME_AVATAR_REMOTE_VALIDATED", {
        sameVersion: true,
        elapsedMs: Math.round(performance.now() - t0),
      });
    } else {
      await ensureRemoteMediaCached({
        userId: params.userId,
        kind: "avatar",
        remoteUrl: avatarUrl,
        version: avatarVersion,
      });
      logUserMedia("HOME_AVATAR_REMOTE_VALIDATED", {
        sameVersion: false,
        elapsedMs: Math.round(performance.now() - t0),
      });
    }
  }

  if (!coverUrl) {
    setSnapshot({
      coverUrl: null,
      coverLocalUri: null,
      coverCacheKey: null,
      coverVersion: null,
      hasCustomCover: false,
      isCoverReady: true,
    });
  } else if (coverSame) {
    logUserMedia("USER_MEDIA_REQUEST_SKIPPED", { reason: "same_version" });
  } else {
    await ensureRemoteMediaCached({
      userId: params.userId,
      kind: "cover",
      remoteUrl: coverUrl,
      version: coverVersion,
    });
  }

  // If still no uri but has custom, keep previous local uri (network failure path).
  setSnapshot({
    isAvatarReady:
      snapshot.avatarStatus === "none" ||
      Boolean(snapshot.avatarLocalUri) ||
      Boolean(snapshot.avatarUrl),
    isCoverReady: true,
    lastValidatedAt: Date.now(),
  });

  logUserMedia("USER_MEDIA_REMOTE_VALIDATE", {
    elapsedMs: Math.round(performance.now() - t0),
  });
}

/**
 * Upload success / local picker: write blob to disk immediately and update all subscribers.
 */
export async function applyLocalUserMediaBlob(params: {
  userId: string;
  kind: "avatar" | "cover";
  blob: Blob;
  remoteUrl: string;
  version?: string;
}): Promise<string> {
  const version = params.version ?? String(Date.now());
  const stable = stableMediaUrl(params.remoteUrl) ?? params.remoteUrl;
  const display = await downscaleImageBlob(
    params.blob,
    displayMaxEdgeForKind(params.kind),
  );
  const cacheKey = buildUserMediaCacheKey({
    userId: params.userId,
    kind: params.kind,
    pathOrId: profileMediaPath(params.userId, params.kind),
    version,
  });
  await writeUserMediaDisk({
    cacheKey,
    userId: params.userId,
    kind: params.kind,
    remoteUrl: stable,
    version,
    mimeType: display.type || "image/jpeg",
    blob: display,
  });
  const uri = rememberObjectUrl(cacheKey, display);

  writeCachedProfile({
    userId: params.userId,
    ...(params.kind === "avatar"
      ? {
          avatarUrl: stable,
          avatarUpdatedAt: new Date(Number(version) || Date.now()).toISOString(),
          hasCustomAvatar: true,
        }
      : {
          coverImageUrl: stable,
          profileUpdatedAt: new Date(Number(version) || Date.now()).toISOString(),
          hasCustomCover: true,
        }),
  });

  applyKindReady(params.kind, {
    cacheKey,
    uri,
    remoteUrl: stable,
    version,
    userId: params.userId,
    source: "memory",
  });

  return uri;
}

/** Prefer local blob URI for <img src>; fall back to stable remote URL. */
export function resolveUserMediaDisplaySrc(
  kind: "avatar" | "cover",
  fallbackRemote?: string | null,
): string | null {
  if (kind === "avatar") {
    return snapshot.avatarLocalUri ?? stableMediaUrl(fallbackRemote ?? snapshot.avatarUrl);
  }
  return snapshot.coverLocalUri ?? stableMediaUrl(fallbackRemote ?? snapshot.coverUrl);
}

/**
 * Trip cover: shared download/dedupe into the same disk store.
 */
export async function ensureTripCoverCached(params: {
  userId: string;
  tripId: string;
  remoteUrl: string;
  version: string;
}): Promise<string | null> {
  return ensureRemoteMediaCached({
    userId: params.userId,
    kind: "trip-cover",
    remoteUrl: params.remoteUrl,
    version: params.version,
    pathOrId: params.tripId,
  });
}

export function resetUserMediaStore(): void {
  for (const uri of objectUrls.values()) revokeUri(uri);
  objectUrls.clear();
  inflightDownload.clear();
  syncSeededKey = null;
  hydrateInflight = null;
  resetUserMediaLogOnce();
  snapshot = { ...EMPTY };
  emit();
}
