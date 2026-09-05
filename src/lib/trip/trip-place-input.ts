import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import { readSavedPlaceMetadata } from "@/lib/saved-place-utils";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import { isGooglePlaceId } from "@/lib/place-detail-handoff";
import {
  logItineraryReasonPersistence,
  logRecommendationReasonHandoff,
} from "@/lib/trip/recommendation-reason-persistence-log";

export type AddToTripSurface =
  | "explore"
  | "map"
  | "place_detail"
  | "chat"
  | "home"
  | "selection"
  | "favorites"
  | "unknown";

/** 可加入行程的地點（探索、聊天、收藏、手動搜尋） */
export type TripPlaceInput = {
  name: string;
  placeName: string;
  title: string;
  address: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId?: string;
  canonicalPlaceId?: string;
  placeType?: string;
  description?: string;
  googleMapsUrl?: string;
  photoName?: string | null;
  rating?: number | null;
  localizedDisplayName?: string;
  navigationLatitude?: number | null;
  navigationLongitude?: number | null;
  coordinateSource?: RoamieItineraryItem["coordinateSource"];
  recommendationReason?: string;
  recommendationReasonSource?: RoamieItineraryItem["recommendationReasonSource"];
  recommendationSource?: AddToTripSurface;
  recommendationReasonVersion?: 1;
};

const GENERIC_REASONS = new Set([
  "依地點資料提供你參考。",
  "先依地點資料提供你參考。",
]);

function normalizedRecommendationReason(value: unknown): string | undefined {
  const reason = normalizedText(value);
  return reason && !GENERIC_REASONS.has(reason) ? reason : undefined;
}

export class InvalidTripPlaceInputError extends Error {
  readonly code = "invalid_trip_place_input";
  constructor(
    readonly failureField: string,
    readonly failureReason: string,
  ) {
    super("無法加入這個地點，請稍後再試");
    this.name = "InvalidTripPlaceInputError";
  }
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Only accepts strings or the documented Google/localized text shapes. */
function normalizedText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { text?: unknown; value?: unknown };
  if (typeof record.text === "string") return record.text.trim() || undefined;
  if (typeof record.value === "string") return record.value.trim() || undefined;
  return undefined;
}

function normalizedCoordinate(value: unknown, axis: "lat" | "lng"): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidTripPlaceInputError(axis, "invalid_coordinate_type");
  }
  const limit = axis === "lat" ? 90 : 180;
  if (Math.abs(value) > limit) {
    throw new InvalidTripPlaceInputError(axis, "coordinate_out_of_range");
  }
  return value;
}

export function normalizeTripPlaceInput(value: unknown): TripPlaceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidTripPlaceInputError("input", "not_an_object");
  }
  const input = value as Record<string, unknown>;
  const name =
    normalizedText(input.localizedDisplayName) ??
    normalizedText(input.placeName) ??
    normalizedText(input.name) ??
    normalizedText(input.title);
  if (!name) throw new InvalidTripPlaceInputError("name", "missing_or_invalid_text");

  const lat = normalizedCoordinate(input.lat, "lat");
  const lng = normalizedCoordinate(input.lng, "lng");
  if ((lat == null) !== (lng == null)) {
    throw new InvalidTripPlaceInputError("coordinates", "incomplete_coordinate_pair");
  }

  const rawGoogleId = normalizedText(input.googlePlaceId);
  const canonicalPlaceId =
    normalizedText(input.canonicalPlaceId) ??
    normalizedText(input.placeId) ??
    normalizedText(input.id) ??
    rawGoogleId;
  const googlePlaceId = rawGoogleId && isGooglePlaceId(rawGoogleId) ? rawGoogleId :
    canonicalPlaceId && isGooglePlaceId(canonicalPlaceId) ? canonicalPlaceId : undefined;
  const address = normalizedText(input.address) ?? "";
  const placeType =
    normalizedText(input.placeType) ??
    normalizedText(input.primaryType) ??
    normalizedText(input.category) ??
    normalizedText(input.type);
  const description = normalizedText(input.description) ?? normalizedText(input.reason) ?? "";
  const googleMapsUrl = normalizedText(input.googleMapsUrl);
  const recommendationReason = normalizedRecommendationReason(
    input.recommendationReason ?? input.reason,
  );

  const deterministicId = `trip-place:${name.trim().toLocaleLowerCase().replace(/\s+/g, "-")}:${lat ?? "na"}:${lng ?? "na"}`;
  return {
    name,
    placeName: normalizedText(input.placeName) ?? name,
    title: normalizedText(input.title) ?? name,
    address,
    lat,
    lng,
    googlePlaceId,
    canonicalPlaceId: canonicalPlaceId ?? googlePlaceId ?? deterministicId,
    placeType,
    description,
    googleMapsUrl:
      googleMapsUrl ?? (lat != null && lng != null ? buildPlaceMapsUrl(lat, lng, name, googlePlaceId) : undefined),
    photoName: normalizedText(input.photoName) ?? null,
    rating:
      typeof input.rating === "number" && Number.isFinite(input.rating) ? input.rating : null,
    localizedDisplayName: normalizedText(input.localizedDisplayName),
    navigationLatitude: normalizedCoordinate(input.navigationLatitude, "lat"),
    navigationLongitude: normalizedCoordinate(input.navigationLongitude, "lng"),
    coordinateSource: input.coordinateSource as TripPlaceInput["coordinateSource"],
    recommendationReason,
    recommendationReasonSource: recommendationReason
      ? input.recommendationReasonSource as TripPlaceInput["recommendationReasonSource"]
      : undefined,
    recommendationSource: recommendationReason
      ? input.recommendationSource as AddToTripSurface
      : undefined,
    recommendationReasonVersion: recommendationReason ? 1 : undefined,
  };
}

export function logAddToTripInputNormalization(input: {
  surface: AddToTripSurface;
  raw: unknown;
  normalized?: TripPlaceInput;
  error?: InvalidTripPlaceInputError;
}): void {
  const raw = input.raw && typeof input.raw === "object" ? input.raw as Record<string, unknown> : {};
  console.info("[ADD_TO_TRIP_INPUT_NORMALIZATION]", {
    surface: input.surface,
    hasGooglePlaceId: Boolean(input.normalized?.googlePlaceId),
    hasCanonicalPlaceId: Boolean(input.normalized?.canonicalPlaceId),
    nameType: valueType(raw.localizedDisplayName ?? raw.placeName ?? raw.name),
    addressType: valueType(raw.address),
    categoryType: valueType(raw.placeType ?? raw.primaryType ?? raw.category ?? raw.type),
    normalizationSucceeded: Boolean(input.normalized),
    failureField: input.error?.failureField ?? "",
    failureReason: input.error?.failureReason ?? "",
  });
}

export function tripPlaceFromRecommendation(rec: RoamieRecommendationItem): TripPlaceInput {
  return normalizeTripPlaceInput({
    name: rec.name,
    placeName: rec.placeName ?? rec.name,
    title: rec.placeName ?? rec.name,
    address: rec.address ?? "",
    lat: rec.lat,
    lng: rec.lng,
    googlePlaceId: rec.googlePlaceId,
    canonicalPlaceId: rec.googlePlaceId,
    placeType: rec.type,
    description: rec.description,
    googleMapsUrl: rec.googleMapsUrl,
    photoName: rec.photoName ?? null,
    rating: rec.rating ?? null,
    recommendationReason: rec.reason,
    recommendationReasonSource: rec.reasonSource,
  });
}

export function tripPlaceFromPlaceResult(place: PlaceResult): TripPlaceInput {
  const recommendation = place as PlaceResult & {
    reason?: string;
    reasonSource?: RoamieRecommendationItem["reasonSource"];
  };
  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));
  const displayName = normalizedText(place.localizedDisplayName) ?? normalizedText(place.name);
  return normalizeTripPlaceInput({
    name: displayName,
    placeName: displayName,
    title: displayName,
    address: place.address ?? "",
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: isGooglePlaceId(place.id) ? place.id : undefined,
    canonicalPlaceId: place.id,
    placeType: typeLabel,
    description: "",
    googleMapsUrl:
      displayName && place.lat != null && place.lng != null
        ? buildPlaceMapsUrl(place.lat, place.lng, displayName, isGooglePlaceId(place.id) ? place.id : undefined)
        : undefined,
    photoName: place.photoName,
    rating: place.rating,
    navigationLatitude: place.navigationLatitude ?? undefined,
    navigationLongitude: place.navigationLongitude ?? undefined,
    coordinateSource: place.coordinateSource ?? undefined,
    localizedDisplayName: displayName,
    recommendationReason: recommendation.reason,
    recommendationReasonSource: recommendation.reasonSource,
  });
}

export function tripPlaceFromSavedPlace(place: SavedPlace): TripPlaceInput {
  const meta = readSavedPlaceMetadata(place);
  return normalizeTripPlaceInput({
    name: place.name,
    placeName: place.name,
    title: place.name,
    address: place.address ?? "",
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    googlePlaceId: meta.googlePlaceId ?? meta.placeId,
    canonicalPlaceId: meta.placeId ?? meta.googlePlaceId,
    placeType: meta.primaryType ?? place.category ?? undefined,
    description: place.notes ?? "",
    googleMapsUrl:
      place.lat != null && place.lng != null
        ? buildPlaceMapsUrl(place.lat, place.lng, normalizedText(place.name), meta.googlePlaceId)
        : undefined,
    photoName: meta.photoName ?? null,
    rating: meta.rating ?? null,
  });
}

export function tripPlaceToItineraryItem(
  place: TripPlaceInput,
  opts: { date: string; time?: string; notes?: string },
): RoamieItineraryItem {
  const item = normalizeItineraryItem({
    date: opts.date,
    time: opts.time ?? "10:00",
    title: place.title,
    placeName: place.placeName,
    description: place.description ?? "",
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: place.googlePlaceId,
    placeType: place.placeType,
    notes: opts.notes ?? "",
    localizedDisplayName: place.localizedDisplayName,
    navigationLatitude: place.navigationLatitude,
    navigationLongitude: place.navigationLongitude,
    coordinateSource:
      place.coordinateSource ??
      (place.googlePlaceId && place.lat != null && place.lng != null
        ? "google_places"
        : undefined),
    recommendationReason: place.recommendationReason,
    recommendationReasonSource: place.recommendationReasonSource,
    recommendationSource: place.recommendationSource,
    recommendationReasonVersion: place.recommendationReason ? 1 : undefined,
  });
  logRecommendationReasonHandoff({
    surface: place.recommendationSource ?? "unknown",
    canonicalPlaceId: place.canonicalPlaceId,
    hasReason: Boolean(place.recommendationReason),
    reasonSource: place.recommendationReasonSource,
    target: "itinerary_stop",
  });
  logItineraryReasonPersistence({
    canonicalPlaceId: place.canonicalPlaceId,
    stored: Boolean(item.recommendationReason),
    hydrated: false,
    source: item.recommendationSource,
    fallbackUsed: false,
    dropStage: place.recommendationReason && !item.recommendationReason ? "itinerary_normalize" : undefined,
  });
  return item;
}
