import { Preferences } from "@capacitor/preferences";
import type { CoreTrip } from "@/lib/trip/core-trip";

const KEY_PREFIX = "roamie.home-trip-summary.";
const SNAPSHOT_VERSION = 1;

export type HomeTripSummarySnapshot = {
  version: 1;
  userScope: string;
  savedAt: string;
  trip: Pick<
    CoreTrip,
    | "id"
    | "title"
    | "customTitle"
    | "isTitleCustomized"
    | "destinationPlace"
    | "startDate"
    | "endDate"
    | "days"
    | "coverImageUrl"
    | "customCoverImageUrl"
    | "aiGeneratedCoverImageUrl"
    | "isCoverCustomized"
    | "createdAt"
    | "updatedAt"
  >;
};

export type HomeTripSnapshotReadResult = {
  trip: CoreTrip | null;
  source: "preferences" | "localStorage" | "none";
};

export type HomeTripSnapshotWriteResult = {
  preferences: boolean;
  localStorage: boolean;
};

function snapshotKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function safePersistentCover(value: string | null): string | null {
  const cover = value?.trim();
  if (!cover || cover.startsWith("blob:") || cover.startsWith("data:")) return null;
  if (cover.includes("?") || cover.includes("/api/place-photo")) return null;
  return cover;
}

export function createHomeTripSummarySnapshot(
  userId: string,
  trip: CoreTrip,
  savedAt = new Date().toISOString(),
): HomeTripSummarySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    userScope: userId,
    savedAt,
    trip: {
      id: trip.id,
      title: trip.title,
      customTitle: trip.customTitle,
      isTitleCustomized: trip.isTitleCustomized,
      destinationPlace: trip.destinationPlace,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: trip.days,
      coverImageUrl: safePersistentCover(trip.coverImageUrl),
      customCoverImageUrl: safePersistentCover(trip.customCoverImageUrl),
      aiGeneratedCoverImageUrl: safePersistentCover(trip.aiGeneratedCoverImageUrl),
      isCoverCustomized: trip.isCoverCustomized,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    },
  };
}

export function restoreHomeTripFromSnapshot(
  value: unknown,
  expectedUserId: string,
): CoreTrip | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<HomeTripSummarySnapshot>;
  const trip = snapshot.trip;
  if (
    snapshot.version !== SNAPSHOT_VERSION ||
    snapshot.userScope !== expectedUserId ||
    !trip ||
    typeof trip.id !== "string" ||
    typeof trip.title !== "string" ||
    typeof trip.days !== "number"
  ) {
    return null;
  }
  return {
    ...trip,
    customTitle: trip.customTitle ?? null,
    isTitleCustomized: trip.isTitleCustomized === true,
    coverImageUrl: trip.coverImageUrl ?? null,
    customCoverImageUrl: trip.customCoverImageUrl ?? null,
    aiGeneratedCoverImageUrl: trip.aiGeneratedCoverImageUrl ?? null,
    isCoverCustomized: trip.isCoverCustomized === true,
    destinationPlace: trip.destinationPlace ?? null,
    originPlace: null,
    startDate: trip.startDate ?? "",
    endDate: trip.endDate ?? trip.startDate ?? "",
    transportMode: "",
    places: [],
    weatherSummary: "",
    outfitSuggestion: "",
    createdAt: trip.createdAt ?? snapshot.savedAt ?? "",
    updatedAt: trip.updatedAt ?? trip.createdAt ?? snapshot.savedAt ?? "",
    isOwner: true,
  };
}

function readWebSnapshot(userId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(snapshotKey(userId)) ?? null;
  } catch {
    return null;
  }
}

function writeWebSnapshot(userId: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(snapshotKey(userId));
    else globalThis.localStorage?.setItem(snapshotKey(userId), value);
  } catch {
    // Storage can be unavailable; Capacitor Preferences remains the durable authority.
  }
}

export async function readHomeTripSummarySnapshotResult(
  userId: string,
): Promise<HomeTripSnapshotReadResult> {
  let raw: string | null = null;
  let source: HomeTripSnapshotReadResult["source"] = "none";
  try {
    raw = (await Preferences.get({ key: snapshotKey(userId) })).value;
    if (raw) {
      source = "preferences";
      writeWebSnapshot(userId, raw);
    }
  } catch {
    // Fall through to the web mirror when the native bridge is unavailable.
  }
  if (!raw) {
    raw = readWebSnapshot(userId);
    if (raw) source = "localStorage";
  }
  if (!raw) return { trip: null, source: "none" };
  try {
    return { trip: restoreHomeTripFromSnapshot(JSON.parse(raw), userId), source };
  } catch {
    return { trip: null, source };
  }
}

export async function readHomeTripSummarySnapshot(userId: string): Promise<CoreTrip | null> {
  return (await readHomeTripSummarySnapshotResult(userId)).trip;
}

export async function writeHomeTripSummarySnapshot(
  userId: string,
  trip: CoreTrip,
): Promise<HomeTripSnapshotWriteResult> {
  const value = JSON.stringify(createHomeTripSummarySnapshot(userId, trip));
  writeWebSnapshot(userId, value);
  const localStorage = readWebSnapshot(userId) === value;
  try {
    await Preferences.set({ key: snapshotKey(userId), value });
    return { preferences: true, localStorage };
  } catch {
    // localStorage remains the web fallback.
    return { preferences: false, localStorage };
  }
}

export async function clearHomeTripSummarySnapshot(userId: string): Promise<void> {
  writeWebSnapshot(userId, null);
  try {
    await Preferences.remove({ key: snapshotKey(userId) });
  } catch {
    // Best-effort cache cleanup; server data is unaffected.
  }
}

export function isHomeTripSummarySnapshotKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}
