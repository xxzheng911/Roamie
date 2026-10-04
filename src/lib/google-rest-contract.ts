import { z } from "zod";
import {
  GOOGLE_PLACES_MAX_RADIUS_METERS,
  PLACES_FIELD_MASK,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_DETAILS_SCREEN_FIELD_MASK,
} from "@/lib/google-maps-api";

const AUTOCOMPLETE_FIELDS =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";
const DETAILS_FIELDS = `${PLACE_DETAILS_SCREEN_FIELD_MASK},${PLACE_DETAILS_FIELD_MASK},addressComponents`;
function selectFields(requested: string | undefined, allowed: string): string {
  if (!requested) return [...new Set(allowed.split(","))].join(",");
  const fields = requested.split(",");
  const allowlist = new Set(allowed.split(","));
  if (fields.some((field) => !allowlist.has(field))) throw new Error("unsupported_google_fields");
  return [...new Set(fields)].join(",");
}

const text = z.string().trim().min(1).max(512);
const language = z.string().regex(/^[a-zA-Z-]{2,20}$/);
const region = z.string().regex(/^[a-zA-Z]{2}$/);
const point = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .strict();
const circle = z
  .object({
    circle: z
      .object({ center: point, radius: z.number().min(0).max(GOOGLE_PLACES_MAX_RADIUS_METERS) })
      .strict(),
  })
  .strict();
const rectangle = z.object({ rectangle: z.object({ low: point, high: point }).strict() }).strict();
const types = z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(50);
const common = { languageCode: language.optional(), regionCode: region.optional() };
const exclusiveLocation = (value: { locationBias?: unknown; locationRestriction?: unknown }) =>
  !(value.locationBias && value.locationRestriction);
const textSearch = z
  .object({
    ...common,
    textQuery: text,
    includedType: z
      .string()
      .regex(/^[a-z_]{1,80}$/)
      .optional(),
    strictTypeFiltering: z.boolean().optional(),
    locationBias: circle.optional(),
    locationRestriction: rectangle.optional(),
    maxResultCount: z.number().int().min(1).max(20).optional(),
    pageSize: z.number().int().min(1).max(20).optional(),
    pageToken: z.string().min(1).max(4096).optional(),
    rankPreference: z.enum(["DISTANCE", "RELEVANCE"]).optional(),
    openNow: z.boolean().optional(),
    minRating: z.number().min(0).max(5).optional(),
  })
  .strict()
  .refine(exclusiveLocation, "conflicting_location_controls");
const nearbySearch = z
  .object({
    ...common,
    includedTypes: types.optional(),
    excludedTypes: types.optional(),
    includedPrimaryTypes: types.optional(),
    excludedPrimaryTypes: types.optional(),
    locationRestriction: circle,
    maxResultCount: z.number().int().min(1).max(20).optional(),
    rankPreference: z.enum(["DISTANCE", "POPULARITY"]).optional(),
  })
  .strict();
const autocomplete = z
  .object({
    ...common,
    input: text,
    includedRegionCodes: z.array(region).max(15).optional(),
    includedPrimaryTypes: z
      .array(z.string().regex(/^(?:[a-z_]{1,80}|\(cities\)|\(regions\))$/))
      .max(5)
      .optional(),
    locationBias: circle.optional(),
    locationRestriction: circle.optional(),
    sessionToken: z.string().max(100).optional(),
    includeQueryPredictions: z.boolean().optional(),
  })
  .strict()
  .refine(exclusiveLocation, "conflicting_location_controls")
  .refine(
    (value) => !value.locationRestriction || value.locationRestriction.circle.radius > 0,
    "empty_location_restriction",
  );
const detailsQuery = z.object({ languageCode: language.optional() }).strict();
const waypoint = z.object({ location: z.object({ latLng: point }).strict() }).strict();
const route = z
  .object({
    origin: waypoint,
    destination: waypoint,
    travelMode: z.enum(["DRIVE", "WALK", "TRANSIT", "BICYCLE", "TWO_WHEELER"]),
    departureTime: z.string().datetime().optional(),
    languageCode: language.optional(),
    units: z.enum(["METRIC", "IMPERIAL"]).optional(),
    routingPreference: z
      .enum(["TRAFFIC_UNAWARE", "TRAFFIC_AWARE", "TRAFFIC_AWARE_OPTIMAL"])
      .optional(),
  })
  .strict();
const querySchema = z
  .object({
    language: language.optional(),
    region: region.optional(),
    address: text.optional(),
    place_id: z
      .string()
      .regex(/^[\w-]{1,256}$/)
      .optional(),
    latlng: z
      .string()
      .regex(/^-?[\d.]+,-?[\d.]+$/)
      .optional(),
    result_type: z
      .string()
      .regex(/^[a-z_|]{1,200}$/)
      .optional(),
    origin: text.optional(),
    destination: text.optional(),
    mode: z.enum(["driving", "walking", "transit", "bicycling"]).optional(),
    departure_time: z
      .string()
      .regex(/^(now|\d{1,12})$/)
      .optional(),
    alternatives: z.enum(["true", "false"]).optional(),
    transit_mode: z
      .string()
      .regex(/^[a-z|]{1,50}$/)
      .optional(),
    transit_routing_preference: z.enum(["less_walking", "fewer_transfers"]).optional(),
  })
  .strict();
export const GoogleRestEnvelope = z
  .object({
    url: z.string().max(8192),
    method: z.enum(["GET", "POST"]),
    body: z.unknown().optional(),
    fieldMask: z.string().min(1).max(2048).optional(),
    // Compatibility-only metadata; deliberately excluded from provider authority.
    attemptKind: z.enum(["initial", "retry", "fallback", "unknown"]).optional(),
  })
  .strict();

/** Rebuild an allowlisted provider request. Never forward arbitrary URLs, headers, fields or keys. */
export function googleRestRequest(input: unknown) {
  const data = GoogleRestEnvelope.parse(input);
  const url = new URL(data.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    throw new Error("invalid_google_request");
  if (url.searchParams.has("key")) throw new Error("client_credential_forbidden");
  let family: "places" | "routes" | "geocoding";
  let body: unknown;
  let fields: string | undefined;
  if (url.hostname === "places.googleapis.com") {
    family = "places";
    if (
      ["/v1/places:searchText", "/v1/places:searchNearby"].includes(url.pathname) &&
      data.method === "POST"
    ) {
      body = (url.pathname.endsWith("searchText") ? textSearch : nearbySearch).parse(data.body);
      fields = selectFields(data.fieldMask, PLACES_FIELD_MASK);
    } else if (url.pathname === "/v1/places:autocomplete" && data.method === "POST") {
      body = autocomplete.parse(data.body);
      fields = selectFields(data.fieldMask, AUTOCOMPLETE_FIELDS);
    } else if (/^\/v1\/places\/[A-Za-z0-9_-]{1,256}$/.test(url.pathname) && data.method === "GET") {
      detailsQuery.parse(Object.fromEntries(url.searchParams));
      fields = selectFields(data.fieldMask, DETAILS_FIELDS);
    } else throw new Error("unsupported_google_operation");
    if (data.method === "POST" && url.search) throw new Error("unexpected_query");
  } else if (
    url.hostname === "routes.googleapis.com" &&
    url.pathname === "/directions/v2:computeRoutes" &&
    data.method === "POST" &&
    !url.search
  ) {
    family = "routes";
    body = route.parse(data.body);
    fields = selectFields(
      data.fieldMask,
      "routes.duration,routes.distanceMeters,routes.legs.staticDuration",
    );
  } else if (
    url.hostname === "maps.googleapis.com" &&
    ["/maps/api/geocode/json", "/maps/api/directions/json"].includes(url.pathname) &&
    data.method === "GET"
  ) {
    if (data.fieldMask) throw new Error("unexpected_fields");
    const q = querySchema.parse(Object.fromEntries(url.searchParams));
    family = url.pathname.includes("geocode") ? "geocoding" : "routes";
    if (family === "geocoding" && !q.address && !q.place_id && !q.latlng)
      throw new Error("location_required");
    if (family === "routes" && (!q.origin || !q.destination)) throw new Error("route_required");
    if (q.latlng) {
      const [latitude, longitude] = q.latlng.split(",").map(Number);
      point.parse({ latitude, longitude });
    }
    url.search = new URLSearchParams(q as Record<string, string>).toString();
  } else throw new Error("unsupported_google_operation");
  if (data.method === "GET" && data.body != null) throw new Error("unexpected_body");
  return { url: url.toString(), method: data.method, body, fields, family };
}
