import type { RoamieLocation } from "@/lib/ai/context";
import type { TripLocation } from "@/lib/location/types";

export function tripLocationToRoamie(loc: TripLocation): RoamieLocation {
  return {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city || loc.formattedName || loc.displayLabel,
    country: loc.country,
    placeId: loc.placeId,
    displayLabel: loc.formattedName || loc.displayLabel,
    address: loc.address,
    timezone: loc.timezone,
    utcOffsetMinutes: loc.utcOffsetMinutes,
  };
}
