import type { TripLocation } from "@/lib/location/types";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";

/** 行程規劃表單統一地點格式 */
export type TripPlaceRef = {
  name: string;
  address: string;
  placeId: string;
  lat: number;
  lng: number;
};

export function tripLocationToPlaceRef(loc: TripLocation): TripPlaceRef {
  return {
    name: loc.displayLabel || loc.formattedName || loc.city || loc.country,
    address: loc.address?.trim() || loc.formattedName || loc.displayLabel,
    placeId: loc.placeId,
    lat: loc.lat,
    lng: loc.lng,
  };
}

export function tripPlaceInputToTripLocation(place: TripPlaceInput, placeId: string): TripLocation | null {
  if (place.lat == null || place.lng == null) return null;
  const name = place.placeName || place.name;
  return {
    placeId: place.googlePlaceId ?? placeId,
    country: name,
    city: name,
    lat: place.lat,
    lng: place.lng,
    formattedName: name,
    displayLabel: name,
    address: place.address,
  };
}

export function isValidTripPlaceRef(place: TripPlaceRef | null | undefined): place is TripPlaceRef {
  if (!place) return false;
  if (!place.placeId?.trim()) return false;
  if (!place.name?.trim()) return false;
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return false;
  return true;
}

export type TripPlaceFieldRole = "start" | "destination";

const LOG_BY_ROLE: Record<TripPlaceFieldRole, Record<string, string>> = {
  start: {
    search: "[Trip Start Place Search]",
    autocomplete: "[Place Autocomplete Result]",
    selected: "[Place Selected]",
    details: "[Place Details Loaded]",
    saved: "[Start Place Saved]",
    validation: "[Trip Place Validation Failed]",
  },
  destination: {
    search: "[Trip Destination Search]",
    autocomplete: "[Place Autocomplete Result]",
    selected: "[Place Selected]",
    details: "[Place Details Loaded]",
    saved: "[Destination Place Saved]",
    validation: "[Trip Place Validation Failed]",
  },
};

export function logTripPlace(
  role: TripPlaceFieldRole,
  kind: keyof (typeof LOG_BY_ROLE)["start"],
  detail?: Record<string, unknown>,
): void {
  const marker = LOG_BY_ROLE[role][kind];
  if (detail && Object.keys(detail).length > 0) {
    console.info(marker, detail);
    return;
  }
  console.info(marker);
}
