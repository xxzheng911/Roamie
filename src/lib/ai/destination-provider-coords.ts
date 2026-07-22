/**
 * Unified coordinate extraction from Google Geocode / Places (legacy + New),
 * native bridge, and backend proxy response shapes.
 * Destination Anchor must not treat valid geometry as empty.
 */

export type DestinationProviderCandidate = {
  name: string;
  formattedAddress?: string;
  placeId?: string;
  latitude: number;
  longitude: number;
  countryCode?: string;
  administrativeArea?: string;
  locality?: string;
  types?: string[];
  provider: string;
  sourceQuery: string;
};

/** @deprecated Prefer DestinationProviderCandidate */
export type ProviderCoordinateCandidate = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  placeId?: string;
  countryCode?: string;
  country?: string;
  name?: string;
  types?: string[];
  sourceShape: string;
  administrativeArea?: string;
  locality?: string;
};

export type ExtractCoordsResult = {
  candidates: ProviderCoordinateCandidate[];
  responseShape: string;
  rawResultCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "function") {
    try {
      const n = (value as () => unknown)();
      return readFiniteNumber(n);
    } catch {
      return null;
    }
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const types = value.filter((t): t is string => typeof t === "string" && Boolean(t.trim()));
  return types.length ? types : undefined;
}

function extractLatLngPair(node: unknown): { lat: number; lng: number; shape: string } | null {
  const obj = asRecord(node);
  if (!obj) return null;

  // Places New API: { latitude, longitude }
  const latNew = readFiniteNumber(obj.latitude);
  const lngNew = readFiniteNumber(obj.longitude);
  if (latNew != null && lngNew != null) {
    return { lat: latNew, lng: lngNew, shape: "location.latitude/longitude" };
  }

  // Legacy Geocode / Maps: { lat, lng } — including lat()/lng() callables
  const lat = readFiniteNumber(obj.lat);
  const lng = readFiniteNumber(obj.lng);
  if (lat != null && lng != null) {
    return { lat, lng, shape: "location.lat/lng" };
  }

  // Nested geometry.location
  const geometry = asRecord(obj.geometry);
  if (geometry) {
    const fromGeom = extractLatLngPair(geometry.location);
    if (fromGeom) {
      return { ...fromGeom, shape: `geometry.${fromGeom.shape}` };
    }
  }

  // Nested location
  if (obj.location) {
    const fromLoc = extractLatLngPair(obj.location);
    if (fromLoc) return fromLoc;
  }

  // TripLocation / our formats
  const ourLat = readFiniteNumber(obj.lat ?? obj.latitude);
  const ourLng = readFiniteNumber(obj.lng ?? obj.longitude);
  if (ourLat != null && ourLng != null) {
    return { lat: ourLat, lng: ourLng, shape: "flat.lat/lng" };
  }

  return null;
}

function countryFromAddressComponents(components: unknown): {
  country?: string;
  countryCode?: string;
  administrativeArea?: string;
  locality?: string;
} {
  if (!Array.isArray(components)) return {};
  let country: string | undefined;
  let countryCode: string | undefined;
  let administrativeArea: string | undefined;
  let locality: string | undefined;
  for (const raw of components) {
    const c = asRecord(raw);
    if (!c) continue;
    const types = readTypes(c.types) ?? [];
    const longName =
      readString(c.long_name) ??
      readString(c.longText) ??
      readString(c.longName);
    const shortName =
      readString(c.short_name) ??
      readString(c.shortText) ??
      readString(c.shortName);
    if (types.includes("country")) {
      country = longName;
      countryCode = shortName?.toUpperCase();
    }
    if (types.includes("administrative_area_level_1") && !administrativeArea) {
      administrativeArea = longName ?? shortName;
    }
    if ((types.includes("locality") || types.includes("postal_town")) && !locality) {
      locality = longName ?? shortName;
    }
  }
  return { country, countryCode, administrativeArea, locality };
}

function candidateFromNode(
  node: unknown,
  fallbackShape: string,
): ProviderCoordinateCandidate | null {
  const obj = asRecord(node);
  if (!obj) return null;
  const pair = extractLatLngPair(obj);
  if (!pair) return null;
  const { country, countryCode, administrativeArea, locality } =
    countryFromAddressComponents(obj.address_components ?? obj.addressComponents);
  const displayName = asRecord(obj.displayName);
  return {
    latitude: pair.lat,
    longitude: pair.lng,
    formattedAddress:
      readString(obj.formatted_address) ??
      readString(obj.formattedAddress) ??
      readString(obj.address),
    placeId:
      readString(obj.place_id) ??
      readString(obj.placeId) ??
      readString(obj.id),
    countryCode,
    country,
    name:
      readString(displayName?.text) ??
      readString(obj.name) ??
      readString(obj.city) ??
      readString(obj.formattedName) ??
      locality,
    types: readTypes(obj.types) ?? readTypes(obj.primaryType ? [obj.primaryType] : undefined),
    sourceShape: pair.shape || fallbackShape,
    administrativeArea,
    locality,
  };
}

/**
 * Extract coordinates from any known provider response envelope.
 * Never requires truthy lat/lng checks — uses Number.isFinite only.
 */
export function extractCoordinatesFromProviderResponse(
  response: unknown,
): ExtractCoordsResult {
  const root = asRecord(response);
  if (!root) {
    if (Array.isArray(response)) {
      const candidates: ProviderCoordinateCandidate[] = [];
      const seen = new Set<string>();
      const push = (c: ProviderCoordinateCandidate | null) => {
        if (!c) return;
        if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
        const key = `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}|${c.placeId ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(c);
      };
      for (const item of response) push(candidateFromNode(item, "array.item"));
      return {
        candidates,
        responseShape: "array",
        rawResultCount: response.length,
      };
    }
    return { candidates: [], responseShape: "non_object", rawResultCount: 0 };
  }

  const shapes: string[] = [];
  const candidates: ProviderCoordinateCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: ProviderCoordinateCandidate | null) => {
    if (!c) return;
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    const key = `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}|${c.placeId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // Direct location on root (Places Details New)
  const direct = candidateFromNode(root, "root");
  if (direct) {
    shapes.push("root_location");
    push(direct);
  }

  // Geocode: results[]
  const results = Array.isArray(root.results) ? root.results : null;
  if (results) {
    shapes.push("geocode.results[]");
    for (const item of results) push(candidateFromNode(item, "geocode.result"));
  }

  // Places New text search: places[]
  const places = Array.isArray(root.places) ? root.places : null;
  if (places) {
    shapes.push("places.places[]");
    for (const item of places) push(candidateFromNode(item, "places.place"));
  }

  // Generic candidates[]
  const candidatesArr = Array.isArray(root.candidates) ? root.candidates : null;
  if (candidatesArr) {
    shapes.push("candidates[]");
    for (const item of candidatesArr) push(candidateFromNode(item, "candidate"));
  }

  // Places Autocomplete → caller usually resolves details; still parse predictions if present
  const suggestions = Array.isArray(root.suggestions) ? root.suggestions : null;
  if (suggestions) {
    shapes.push("places.suggestions[]");
    for (const item of suggestions) {
      const pred = asRecord(asRecord(item)?.placePrediction);
      if (!pred) continue;
      push(candidateFromNode(pred, "places.prediction"));
    }
  }

  // Our TripLocation wrapper: { location: TripLocation }
  if (root.location && !direct) {
    shapes.push("wrapper.location");
    push(candidateFromNode(root.location, "wrapper.location"));
  }

  // Native / proxy: { data: { ... } } or { result: { ... } }
  for (const wrapKey of ["data", "result", "payload"] as const) {
    const nested = asRecord(root[wrapKey]);
    if (!nested) continue;
    shapes.push(`wrapper.${wrapKey}`);
    push(candidateFromNode(nested, `wrapper.${wrapKey}`));
    if (Array.isArray(nested.results)) {
      for (const item of nested.results) push(candidateFromNode(item, `wrapper.${wrapKey}.results`));
    }
    if (Array.isArray(nested.places)) {
      for (const item of nested.places) push(candidateFromNode(item, `wrapper.${wrapKey}.places`));
    }
  }

  return {
    candidates,
    responseShape: shapes.join("+") || Object.keys(root).sort().join(",") || "empty_object",
    rawResultCount:
      results?.length ??
      places?.length ??
      candidatesArr?.length ??
      suggestions?.length ??
      (direct ? 1 : 0),
  };
}

/**
 * Product contract: unified Destination Anchor provider candidate extraction.
 */
export function extractDestinationCandidatesFromProviderResponse(
  response: unknown,
  opts?: { provider?: string; sourceQuery?: string },
): DestinationProviderCandidate[] {
  const provider = opts?.provider ?? "unknown";
  const sourceQuery = opts?.sourceQuery ?? "";
  const extracted = extractCoordinatesFromProviderResponse(response);
  return extracted.candidates.map((c) => ({
    name: (c.name ?? c.locality ?? c.formattedAddress ?? sourceQuery) || "unknown",
    formattedAddress: c.formattedAddress,
    placeId: c.placeId,
    latitude: c.latitude,
    longitude: c.longitude,
    countryCode: c.countryCode,
    administrativeArea: c.administrativeArea,
    locality: c.locality ?? c.name,
    types: c.types,
    provider,
    sourceQuery,
  }));
}

/** Pick first usable coordinate candidate. */
export function pickProviderCoordinates(
  response: unknown,
): ProviderCoordinateCandidate | null {
  return extractCoordinatesFromProviderResponse(response).candidates[0] ?? null;
}
