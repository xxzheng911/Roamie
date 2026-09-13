import { Preferences } from "@capacitor/preferences";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import type { SavedPlace } from "@/lib/places-storage";
import type { CoreTrip } from "@/lib/trip/core-trip";

const KEY_PREFIX = "roamie:saved-list-snapshot:";
const SCHEMA_VERSION = 1;

type SnapshotPayload = {
  version: 1;
  ownerUserId: string;
  updatedAt: string;
  places: SavedPlace[];
  trips: CoreTrip[];
};

export type SavedListSnapshotResult = {
  places: SavedPlace[];
  trips: CoreTrip[];
  source: "preferences" | "localStorage" | "none";
};

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function safeImage(value: string | null): string | null {
  const image = value?.trim();
  if (!image || image.startsWith("blob:") || image.startsWith("data:")) return null;
  if (image.includes("/api/place-photo") || image.includes("?sig=")) return null;
  return image;
}

function safePlaces(places: SavedPlace[]): SavedPlace[] {
  return places.map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    address: place.address,
    city: place.city,
    lat: place.lat,
    lng: place.lng,
    notes: null,
    mood_tag: place.mood_tag,
    cover_image: safeImage(place.cover_image),
    image_url: safeImage(place.image_url),
    image_source: place.image_source,
    metadata: {
      placeId: place.metadata?.placeId,
      googlePlaceId: place.metadata?.googlePlaceId,
      photoName: place.metadata?.photoName,
      types: place.metadata?.types,
      primaryType: place.metadata?.primaryType,
      rating: place.metadata?.rating,
      userRatingCount: place.metadata?.userRatingCount,
      businessStatus: place.metadata?.businessStatus,
    },
    created_at: place.created_at,
  }));
}

function safeTrips(trips: CoreTrip[]): CoreTrip[] {
  return trips.map((trip) => ({
    id: trip.id,
    title: trip.title,
    customTitle: trip.customTitle,
    isTitleCustomized: trip.isTitleCustomized,
    coverImageUrl: safeImage(trip.coverImageUrl),
    customCoverImageUrl: safeImage(trip.customCoverImageUrl),
    aiGeneratedCoverImageUrl: safeImage(trip.aiGeneratedCoverImageUrl),
    isCoverCustomized: trip.isCoverCustomized,
    destinationPlace: trip.destinationPlace,
    originPlace: null,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days: trip.days,
    transportMode: trip.transportMode,
    places: [],
    weatherSummary: "",
    outfitSuggestion: "",
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    isOwner: trip.isOwner,
  }));
}

function parse(raw: string | null, userId: string): SnapshotPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SnapshotPayload>;
    if (
      value.version !== SCHEMA_VERSION ||
      value.ownerUserId !== userId ||
      !Array.isArray(value.places) ||
      !Array.isArray(value.trips)
    ) return null;
    return value as SnapshotPayload;
  } catch {
    return null;
  }
}

function readWeb(userId: string): SnapshotPayload | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parse(localStorage.getItem(key(userId)), userId);
  } catch {
    return null;
  }
}

function writeWeb(userId: string, value: string): void {
  try {
    localStorage.setItem(key(userId), value);
  } catch {
    // Capacitor Preferences remains the durable native authority.
  }
}

function currentUserId(explicit?: string | null): string | null {
  return explicit ?? readCachedAuthenticatedUserIdSync() ?? null;
}

function writeSnapshot(userId: string, places: SavedPlace[], trips: CoreTrip[]): void {
  const value = JSON.stringify({
    version: SCHEMA_VERSION,
    ownerUserId: userId,
    updatedAt: new Date().toISOString(),
    places: safePlaces(places),
    trips: safeTrips(trips),
  } satisfies SnapshotPayload);
  writeWeb(userId, value);
  void Preferences.set({ key: key(userId), value }).catch(() => undefined);
}

export function readSavedPlacesSnapshot(userId?: string | null): SavedPlace[] {
  const owner = currentUserId(userId);
  return owner ? (readWeb(owner)?.places ?? []) : [];
}

export function writeSavedPlacesSnapshot(places: SavedPlace[], userId?: string | null): void {
  const owner = currentUserId(userId);
  if (!owner) return;
  writeSnapshot(owner, places, readWeb(owner)?.trips ?? []);
}

export function readSavedTripsSnapshot(userId?: string | null): CoreTrip[] {
  const owner = currentUserId(userId);
  return owner ? (readWeb(owner)?.trips ?? []) : [];
}

export function writeSavedTripsSnapshot(trips: CoreTrip[], userId?: string | null): void {
  const owner = currentUserId(userId);
  if (!owner) return;
  writeSnapshot(owner, readWeb(owner)?.places ?? [], trips);
}

export async function hydrateSavedListSnapshot(userId: string): Promise<SavedListSnapshotResult> {
  try {
    const native = parse((await Preferences.get({ key: key(userId) })).value, userId);
    if (native) {
      writeWeb(userId, JSON.stringify(native));
      return { places: native.places, trips: native.trips, source: "preferences" };
    }
  } catch {
    // Fall through to the web mirror.
  }
  const web = readWeb(userId);
  return web
    ? { places: web.places, trips: web.trips, source: "localStorage" }
    : { places: [], trips: [], source: "none" };
}

export function patchSavedTripInSnapshot(tripId: string, patch: Partial<CoreTrip>): void {
  const userId = currentUserId();
  if (!userId) return;
  const trips = readSavedTripsSnapshot(userId);
  const index = trips.findIndex((trip) => trip.id === tripId);
  if (index < 0) return;
  const next = [...trips];
  next[index] = { ...next[index]!, ...patch };
  writeSavedTripsSnapshot(next, userId);
}

export function isSavedListSnapshotKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}
