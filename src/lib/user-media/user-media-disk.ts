/**
 * User media (avatar / cover / trip cover) disk + memory cache.
 * IndexedDB stores image bytes; display uses blob: object URLs.
 * Cache keys are storage-path + version — never signed/query-busting URLs alone.
 */

const DB_NAME = "roamie-user-media";
const DB_VERSION = 1;
const STORE = "blobs";

export type UserMediaKind = "avatar" | "cover" | "trip-cover";

export type UserMediaDiskEntry = {
  cacheKey: string;
  userId: string;
  kind: UserMediaKind;
  /** Stable public URL without cache-bust query */
  remoteUrl: string;
  /** Version / updatedAt ISO or timestamp string */
  version: string;
  mimeType: string;
  blob: Blob;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
}

export function buildUserMediaCacheKey(params: {
  userId: string;
  kind: UserMediaKind;
  /** Storage path or stable identifier (e.g. tripId) */
  pathOrId: string;
  version: string;
}): string {
  return [
    params.userId.trim(),
    params.kind,
    params.pathOrId.trim(),
    params.version.trim() || "0",
  ].join("|");
}

/** Strip ?v= / token query so remote URL comparison is stable. */
export function stableMediaUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.searchParams.delete("v");
    u.searchParams.delete("token");
    return u.toString();
  } catch {
    return raw.split("?")[0] || raw;
  }
}

export async function readUserMediaDisk(
  cacheKey: string,
): Promise<UserMediaDiskEntry | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(cacheKey);
      req.onsuccess = () => resolve((req.result as UserMediaDiskEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Find any disk entry for userId+kind (any version) — for cold boot render. */
export async function findLatestUserMediaDisk(params: {
  userId: string;
  kind: UserMediaKind;
}): Promise<UserMediaDiskEntry | null> {
  try {
    const db = await openDb();
    const prefix = `${params.userId.trim()}|${params.kind}|`;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as UserMediaDiskEntry[]) ?? [];
        const matched = rows
          .filter((r) => r.cacheKey.startsWith(prefix))
          .sort((a, b) => b.savedAt - a.savedAt);
        resolve(matched[0] ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function writeUserMediaDisk(
  entry: Omit<UserMediaDiskEntry, "savedAt"> & { savedAt?: number },
): Promise<void> {
  try {
    const db = await openDb();
    const row: UserMediaDiskEntry = {
      ...entry,
      savedAt: entry.savedAt ?? Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* quota / private mode */
  }
}

export async function deleteUserMediaDisk(cacheKey: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
