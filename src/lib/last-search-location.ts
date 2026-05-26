const LAST_SEARCH_KEY = "roamie:last-search-location";

export type LastSearchLocation = {
  lat: number;
  lng: number;
  city?: string;
  label?: string;
  at: string;
};

function isValidCoords(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function readLastSearchLocation(): { lat: number; lng: number; city?: string } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_SEARCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSearchLocation;
    if (!isValidCoords(parsed.lat, parsed.lng)) return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      city: parsed.city?.trim() || parsed.label?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function rememberLastSearchLocation(input: {
  lat: number;
  lng: number;
  city?: string;
  label?: string;
}): void {
  if (!isValidCoords(input.lat, input.lng)) return;
  if (typeof sessionStorage === "undefined") return;
  const payload: LastSearchLocation = {
    lat: input.lat,
    lng: input.lng,
    city: input.city?.trim() || undefined,
    label: input.label?.trim() || undefined,
    at: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(payload));
    console.info("[Location] remembered last search city", {
      lat: payload.lat,
      lng: payload.lng,
      city: payload.city ?? payload.label ?? null,
    });
  } catch {
    /* ignore */
  }
}
