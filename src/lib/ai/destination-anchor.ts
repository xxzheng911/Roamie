/**
 * Unified Destination Anchor resolver.
 *
 * Combination Discovery / Candidate Pool / Geo Clustering must share this
 * coordinate source — modules must not each re-resolve destinations.
 *
 * Fallback order:
 * 1. Previous-round Destination Option Metadata (match + coords when present)
 * 2. Conversation Context saved DestinationEntity / coordinates
 * 3. Saved placeId / coordinates / viewport
 * 4. Places Details geometry
 * 5. Places Autocomplete geometry
 * 6. Geocoding API (alias + parent country queries)
 * 7. Alias + country geocode retry (clear fail-cache)
 * 8. Viewport / locked scope
 * 9. Destination Centroid Cache
 * 10. Legacy Approx Center
 * 11. Structured failure → destination_resolution_failed (+ classified reason)
 *
 * Supports country / city / province / state / region / island / archipelago /
 * resort_area / district / administrative_area.
 * Does not invent hardcoded destination hubs for overseas islands.
 */
import type { Locale } from "@/lib/i18n/types";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
  clearDestinationGeocodeCache,
  buildDestinationGeocodeQueries,
} from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  resolveDestinationCoordinates,
  resolveDestinationCountryLabel,
  enrichDestinationCountry,
  validateDestinationScope,
  finalizeDestinationScope,
  countryCodeForCountryName,
  getResolvedDestinationScope,
} from "@/lib/ai/resolved-destination-scope";
import {
  resolveDestinationEntity,
  type DestinationEntityType,
} from "@/lib/ai/destination-entity";
import {
  rememberCityCentroid,
  readCityCentroidCache,
  clearCityCentroidCache,
} from "@/lib/ai/destination-centroid-cache";
import {
  resolveDestinationAlias,
  listDestinationAliases,
} from "@/lib/ai/destination-alias-resolver";

import {
  logDestinationAnchorBuildVersion,
  logDestinationDiag,
  DESTINATION_ANCHOR_BUILD_VERSION,
} from "@/lib/ai/destination-provider-log";
import { isValidAnchorCoordinate } from "@/lib/ai/destination-provider-result";

export type DestinationAnchorSource =
  | "context"
  | "option_metadata"
  | "places_details"
  | "places_autocomplete"
  | "places_search"
  | "text_search"
  | "geocode"
  | "alias_geocode"
  | "parent_region_geocode"
  | "viewport"
  | "city_centroid_cache"
  | "centroid_cache"
  | "fallback";

/** Product-facing destination type for travel anchors (broader than admin locality). */
export type DestinationAnchorType =
  | "city"
  | "locality"
  | "region"
  | "island"
  | "tourist_area"
  | "district"
  | "administrative_area"
  | "country"
  | "archipelago"
  | "province"
  | "state"
  | "resort_area";

/**
 * Structured destination option / travel entity shared across
 * Country recommendation → user selection → Destination Anchor.
 * Coordinates are optional until resolution succeeds.
 */
export type DestinationOptionMetadata = {
  id: string;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  countryName?: string;
  countryCode?: string;
  /** @deprecated Prefer countryName — kept for existing callers. */
  country?: string;
  entityType: DestinationEntityType;
  parentRegion?: string;
  administrativeArea?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  viewport?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  source?: DestinationAnchorSource | "country_city_options" | "alias" | "entity";
  confidence?: number;
};

/** Alias matching the product DestinationEntity contract for travel anchors. */
export type TravelDestinationEntity = DestinationOptionMetadata;

export type DestinationAnchor = {
  destinationName: string;
  normalizedName: string;
  /** English / romanized search name when available. */
  searchName?: string;
  countryCode?: string;
  country?: string;
  administrativeArea?: string;
  entityType?: DestinationEntityType;
  /** Normalized product destination type (city / island / tourist_area / …). */
  destinationType?: DestinationAnchorType;
  latitude: number;
  longitude: number;
  viewport?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  source: DestinationAnchorSource;
};

export type DestinationAnchorFailureReason =
  | "destination_option_not_matched"
  | "destination_alias_not_resolved"
  | "destination_entity_failed"
  | "destination_country_context_missing"
  | "country_hint_missing"
  | "anchor_autocomplete_empty"
  | "anchor_geometry_missing"
  | "anchor_type_rejected"
  | "anchor_geocode_empty"
  | "destination_geocode_empty"
  | "anchor_country_mismatch"
  | "anchor_all_providers_failed"
  | "destination_anchor_invalid"
  | "destination_resolution_failed"
  | "no_coordinates";

export type DestinationAnchorFailure = {
  status: "destination_resolution_failed";
  destination: string;
  retryable: true;
  reason: DestinationAnchorFailureReason;
  attempts?: number;
  queriesTried?: string[];
};

export type DestinationAnchorResult =
  | { status: "ok"; anchor: DestinationAnchor }
  | DestinationAnchorFailure;

export {
  rememberCityCentroid,
  readCityCentroidCache,
  clearCityCentroidCache,
};

function mapDestinationType(
  entityType?: DestinationEntityType | null,
): DestinationAnchorType | undefined {
  if (!entityType) return undefined;
  if (entityType === "resort_area") return "tourist_area";
  return entityType as DestinationAnchorType;
}

function logAnchor(
  tag:
    | "[DESTINATION_CONTEXT]"
    | "[DESTINATION_OPTION_MATCH]"
    | "[DESTINATION_CONTEXT_INHERITED]"
    | "[DESTINATION_ALIAS_RESOLVED]"
    | "[DESTINATION_ANCHOR_START]"
    | "[DESTINATION_ANCHOR_INPUT]"
    | "[DESTINATION_ANCHOR_ATTEMPT]"
    | "[DESTINATION_ANCHOR_QUERY]"
    | "[DESTINATION_ANCHOR_CANDIDATE]"
    | "[DESTINATION_GEOCODE_QUERY_PLAN]"
    | "[DESTINATION_PROVIDER_RESPONSE]"
    | "[DESTINATION_ANCHOR_RESOLVED]"
    | "[DESTINATION_ANCHOR_FALLBACK]"
    | "[DESTINATION_ANCHOR_FAILED]",
  parts: Record<string, string | number | boolean | undefined | null>,
): void {
  // Always-on for Destination Anchor critical path (Xcode / Capacitor visibility).
  logDestinationDiag(tag, parts);
}

function matchKey(value: string): string {
  return normalizeDestinationLabel(value).toLowerCase();
}

const ORDINAL_CN: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Parse "第四個" / "第4個" / "4" → 0-based option index. */
export function parseDestinationOptionOrdinal(rawInput: string): number | null {
  const t = (rawInput ?? "").trim();
  if (!t) return null;
  const digit = t.match(
    /^(?:我要|選|选|我想|要)?\s*(?:第\s*)?(\d+)\s*(?:個|个|项|項)?\s*$/,
  );
  if (digit?.[1]) {
    const n = Number(digit[1]);
    return Number.isFinite(n) && n >= 1 ? n - 1 : null;
  }
  const cn = t.match(
    /^(?:我要|選|选|我想|要)?\s*(?:第\s*)?([一二兩三四五六七八九十两])\s*(?:個|个|项|項)?\s*$/,
  );
  if (cn?.[1] && ORDINAL_CN[cn[1]]) return ORDINAL_CN[cn[1]]! - 1;
  return null;
}

/**
 * Strip conversational wrappers so free-text still matches option metadata.
 * e.g. "想去泰國的蘇梅島" / "選蘇梅島" / "我要去 Koh Samui"
 */
function extractDestinationCandidatePhrases(rawInput: string): string[] {
  const input = (rawInput ?? "").trim();
  if (!input) return [];
  const phrases = new Set<string>([input]);
  const stripped = input
    .replace(/^(我想要?|我要|想要?|想去|要去|選|选|去)\s*/u, "")
    .replace(/^(去|到)\s*/u, "")
    .replace(/[。.!?！？]+$/u, "")
    .trim();
  if (stripped) phrases.add(stripped);
  // "泰國的蘇梅島" / "泰國蘇梅島" → keep full + trailing segment
  const ofMatch = stripped.match(/(.+?)的(.+)$/u);
  if (ofMatch?.[2]) phrases.add(ofMatch[2].trim());
  const spaced = stripped.split(/[\s,，、/]+/).filter(Boolean);
  for (const part of spaced) phrases.add(part);
  return [...phrases].filter(Boolean);
}

/**
 * Match user reply against previous-round destination option metadata.
 * Prefer structured options over free-text re-search.
 */
export function matchDestinationOptionMetadata(
  rawInput: string,
  options: DestinationOptionMetadata[] | null | undefined,
): DestinationOptionMetadata | null {
  if (!options?.length) return null;
  const input = (rawInput ?? "").trim();
  if (!input) return null;

  const ordinal = parseDestinationOptionOrdinal(input);
  if (ordinal != null && options[ordinal]) {
    return options[ordinal]!;
  }

  const phrases = extractDestinationCandidatePhrases(input);
  for (const phrase of phrases) {
    const inputNorm = matchKey(phrase);
    const inputAlias = resolveDestinationAlias(phrase);
    for (const opt of options) {
      const candidates = [
        opt.displayName,
        opt.normalizedName,
        ...(opt.aliases ?? []),
      ]
        .map((v) => matchKey(v))
        .filter(Boolean);
      if (candidates.includes(inputNorm)) return opt;
      if (candidates.includes(matchKey(inputAlias.normalizedName))) return opt;
      if (candidates.includes(matchKey(inputAlias.searchName))) return opt;
      // Soft contains for short island nicknames (普吉 → 普吉島)
      if (
        inputNorm.length >= 2 &&
        candidates.some(
          (c) => c === inputNorm || c.startsWith(inputNorm) || inputNorm.startsWith(c),
        )
      ) {
        return opt;
      }
    }
  }
  return null;
}

/** Product-facing alias — same as matchDestinationOptionMetadata. */
export function matchDestinationOptionFromPreviousTurn(
  rawInput: string,
  options: DestinationOptionMetadata[] | null | undefined,
): DestinationOptionMetadata | null {
  return matchDestinationOptionMetadata(rawInput, options);
}

/**
 * Build option metadata from country→city listing (no coordinates required).
 */
export function buildDestinationOptionMetadata(params: {
  name: string;
  country: string;
  entityType?: DestinationEntityType | string;
  id?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  viewport?: DestinationOptionMetadata["viewport"];
  parentRegion?: string;
  source?: DestinationOptionMetadata["source"];
  confidence?: number;
}): DestinationOptionMetadata {
  const displayName = params.name.trim();
  const alias = resolveDestinationAlias(displayName, { countryHint: params.country });
  // Alias / entity registry wins over coarse country-list types ("city" for resort towns).
  const entity =
    alias.entityType ??
    (params.entityType as DestinationEntityType | undefined) ??
    resolveDestinationEntity(alias.normalizedName).type;
  const country = normalizeDestinationLabel(params.country) || alias.countryHint || "";
  return {
    id: params.id ?? `dest:${alias.normalizedName}`,
    displayName: displayName || alias.normalizedName,
    normalizedName: alias.normalizedName,
    aliases: listDestinationAliases(alias.normalizedName, country),
    countryName: country || undefined,
    countryCode: alias.countryCode ?? countryCodeForCountryName(country),
    country: country || undefined,
    entityType: entity,
    parentRegion: params.parentRegion,
    administrativeArea: alias.administrativeArea,
    placeId: params.placeId,
    latitude: params.latitude,
    longitude: params.longitude,
    viewport: params.viewport,
    source: params.source ?? "country_city_options",
    confidence: params.confidence ?? (alias.searchName ? 0.9 : 0.6),
  };
}

export function buildDestinationOptionsFromCityList(
  options: Array<{ name: string; type?: string; country?: string }>,
  country: string,
): DestinationOptionMetadata[] {
  return options
    .map((opt, index) =>
      buildDestinationOptionMetadata({
        name: opt.name,
        country: opt.country || country,
        entityType: (opt.type as DestinationEntityType | undefined) ?? undefined,
        id: `opt:${index + 1}:${normalizeDestinationLabel(opt.name)}`,
      }),
    )
    .filter((o) => Boolean(o.normalizedName));
}

function toAnchor(params: {
  raw: string;
  normalized: string;
  searchName?: string;
  lat: number;
  lng: number;
  country?: string;
  countryCode?: string;
  administrativeArea?: string;
  entityType?: DestinationEntityType;
  source: DestinationAnchorSource;
  viewport?: DestinationAnchor["viewport"];
}): DestinationAnchor {
  return {
    destinationName: params.raw.trim() || params.normalized,
    normalizedName: params.normalized,
    searchName: params.searchName,
    country: params.country,
    countryCode: params.countryCode ?? countryCodeForCountryName(params.country),
    administrativeArea: params.administrativeArea,
    entityType: params.entityType,
    destinationType: mapDestinationType(params.entityType),
    latitude: params.lat,
    longitude: params.lng,
    viewport: params.viewport,
    source: params.source,
  };
}

function acceptCoords(params: {
  raw: string;
  normalized: string;
  searchName?: string;
  lat: number;
  lng: number;
  countryHint?: string | null;
  administrativeArea?: string;
  entityType?: DestinationEntityType;
  source: DestinationAnchorSource;
  generationRequestId?: string;
  viewport?: DestinationAnchor["viewport"];
}): DestinationAnchor | null {
  // Soft-accept: valid WGS84 coords are enough — admin/locality type is metadata only.
  if (!isValidAnchorCoordinate(params.lat, params.lng)) {
    logAnchor("[DESTINATION_ANCHOR_CANDIDATE]", {
      name: params.normalized,
      placeId: "none",
      country: params.countryHint ?? "unknown",
      latitude: params.lat,
      longitude: params.lng,
      types: mapDestinationType(params.entityType) ?? params.entityType,
      source: params.source,
      accepted: false,
      rejectReason: "invalid_coordinates",
    });
    return null;
  }

  const enriched = enrichDestinationCountry({
    destination: params.normalized,
    country: params.countryHint,
    latitude: params.lat,
    longitude: params.lng,
  });
  const validation = validateDestinationScope({
    destination: params.normalized,
    country: enriched.country ?? params.countryHint,
    countryCode: enriched.countryCode,
    latitude: params.lat,
    longitude: params.lng,
  });
  if (!validation.ok) {
    logAnchor("[DESTINATION_ANCHOR_CANDIDATE]", {
      name: params.normalized,
      placeId: "none",
      country: params.countryHint ?? "unknown",
      latitude: params.lat,
      longitude: params.lng,
      types: mapDestinationType(params.entityType) ?? params.entityType,
      source: params.source,
      accepted: false,
      rejectReason: validation.reason ?? "destination_anchor_invalid",
    });
    return null;
  }

  const country = validation.country ?? enriched.country;
  const countryCode = validation.countryCode ?? enriched.countryCode;
  const entityType =
    params.entityType ?? resolveDestinationEntity(params.normalized).type;
  logAnchor("[DESTINATION_ANCHOR_CANDIDATE]", {
    name: params.normalized,
    placeId: "none",
    country: country ?? "unknown",
    countryCode: countryCode ?? "unknown",
    latitude: params.lat,
    longitude: params.lng,
    types: mapDestinationType(entityType) ?? entityType,
    formattedAddress: `${params.normalized}, ${country ?? ""}`,
    source: params.source,
    accepted: true,
    rejectReason: "none",
  });
  finalizeDestinationScope({
    destination: params.normalized,
    latitude: params.lat,
    longitude: params.lng,
    source:
      params.source === "context" ||
      params.source === "option_metadata" ||
      params.source === "places_autocomplete" ||
      params.source === "places_details" ||
      params.source === "places_search" ||
      params.source === "text_search"
        ? "places_geometry"
        : params.source === "geocode" ||
            params.source === "alias_geocode" ||
            params.source === "parent_region_geocode"
          ? "geocode"
          : params.source === "city_centroid_cache" ||
              params.source === "centroid_cache" ||
              params.source === "viewport"
            ? "cache"
            : "approx_center",
    country,
    countryCode,
    type: entityType,
    generationRequestId: params.generationRequestId,
  });
  rememberCityCentroid({
    destination: params.normalized,
    latitude: params.lat,
    longitude: params.lng,
    country,
    countryCode,
  });
  return toAnchor({
    raw: params.raw,
    normalized: params.normalized,
    searchName: params.searchName,
    lat: params.lat,
    lng: params.lng,
    country,
    countryCode,
    administrativeArea: params.administrativeArea,
    entityType,
    source: params.source,
    viewport: params.viewport,
  });
}

export type ResolveDestinationAnchorParams = {
  destination: string;
  locale?: Locale;
  countryHint?: string | null;
  /** Travel Context / session already-saved coordinates */
  contextCoordinates?: { lat: number; lng: number } | null;
  /** Places Autocomplete / Place Details geometry */
  placesGeometry?: { lat: number; lng: number } | null;
  /** Place Details (preferred over autocomplete when both exist). */
  placesDetailsGeometry?: { lat: number; lng: number } | null;
  /** Previous-round destination options (country city list). */
  offeredOptions?: DestinationOptionMetadata[] | null;
  geocodeFn?: GeocodeDestinationFn;
  generationRequestId?: string;
};

/**
 * Single resolver for destination search anchors.
 * Callers must not invent alternate geocode paths.
 * Same canonical destination + countryCode shares one in-flight Promise.
 */
const inFlightAnchorResolutions = new Map<string, Promise<DestinationAnchorResult>>();

function anchorFlightKey(destination: string, countryCode?: string | null): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

export function clearDestinationAnchorFlights(destination?: string): void {
  if (!destination) {
    inFlightAnchorResolutions.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...inFlightAnchorResolutions.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      inFlightAnchorResolutions.delete(key);
    }
  }
}

export async function resolveDestinationAnchor(
  params: ResolveDestinationAnchorParams,
): Promise<DestinationAnchorResult> {
  const rawKey = params.destination?.trim() ?? "";
  const aliasPreview = resolveDestinationAlias(rawKey, {
    countryHint: params.countryHint,
  });
  const countryCodeHint =
    aliasPreview.countryCode ?? countryCodeForCountryName(params.countryHint);
  const flightKey = anchorFlightKey(
    aliasPreview.normalizedName || rawKey,
    countryCodeHint,
  );
  const existing = inFlightAnchorResolutions.get(flightKey);
  if (existing) {
    logDestinationDiag("[DESTINATION_ANCHOR_SINGLE_FLIGHT]", {
      key: flightKey,
      source: "in_flight_reuse",
    });
    return existing;
  }
  const task = resolveDestinationAnchorImpl(params).finally(() => {
    inFlightAnchorResolutions.delete(flightKey);
  });
  inFlightAnchorResolutions.set(flightKey, task);
  return task;
}

async function resolveDestinationAnchorImpl(
  params: ResolveDestinationAnchorParams,
): Promise<DestinationAnchorResult> {
  logDestinationAnchorBuildVersion({
    commit: DESTINATION_ANCHOR_BUILD_VERSION,
  });
  const raw = params.destination?.trim() ?? "";
  const matchedOption = matchDestinationOptionFromPreviousTurn(raw, params.offeredOptions);
  if (matchedOption) {
    logAnchor("[DESTINATION_OPTION_MATCH]", {
      input: raw,
      matched: matchedOption.displayName,
      optionId: matchedOption.id,
      normalizedName: matchedOption.normalizedName,
      countryCode: matchedOption.countryCode ?? "unknown",
      entityType: matchedOption.entityType,
      hasCoords:
        Number.isFinite(matchedOption.latitude) && Number.isFinite(matchedOption.longitude),
    });
  } else if (params.offeredOptions?.length) {
    logAnchor("[DESTINATION_OPTION_MATCH]", {
      input: raw,
      matched: "false",
      reason: "destination_option_not_matched",
    });
  }

  const optionCountry =
    matchedOption?.countryName ?? matchedOption?.country ?? undefined;
  const alias = resolveDestinationAlias(matchedOption?.normalizedName ?? raw, {
    countryHint: optionCountry ?? params.countryHint,
    displayName: matchedOption?.displayName ?? raw,
  });
  logAnchor("[DESTINATION_ALIAS_RESOLVED]", {
    raw,
    normalized: alias.normalizedName,
    searchName: alias.searchName,
    localizedName: alias.displayName,
    entityType: alias.entityType ?? "unknown",
    aliases: alias.aliases.slice(0, 8).join("|"),
    countryHint: alias.countryHint ?? params.countryHint ?? "none",
  });

  const normalized = alias.normalizedName || normalizeDestinationLabel(raw);
  let countryHint =
    optionCountry ??
    resolveDestinationCountryLabel(normalized, params.countryHint) ??
    alias.countryHint ??
    params.countryHint?.trim() ??
    undefined;
  const countryCodeHint =
    matchedOption?.countryCode ??
    alias.countryCode ??
    countryCodeForCountryName(countryHint);
  const entityType =
    matchedOption?.entityType ??
    alias.entityType ??
    resolveDestinationEntity(normalized).type;
  const administrativeArea =
    matchedOption?.administrativeArea ?? alias.administrativeArea;
  const destinationType = mapDestinationType(entityType);
  let retryCount = 0;
  let geocodeCount = 0;
  let autocompleteCount = 0;
  let lastFailureReason: DestinationAnchorFailureReason = "destination_resolution_failed";
  const countrySource = matchedOption?.countryCode
    ? "option_metadata"
    : params.countryHint?.trim()
      ? "previous_country_selection"
      : alias.countryHint
        ? "alias"
        : "unknown";

  logAnchor("[DESTINATION_CONTEXT]", {
    raw: raw || normalized,
    normalized,
    countryName: countryHint ?? "unknown",
    parentCountry: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    destinationType: destinationType ?? entityType,
  });

  logAnchor("[DESTINATION_CONTEXT_INHERITED]", {
    destination: raw || normalized,
    countryName: countryHint ?? "unknown",
    country: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    countrySource,
    entityType,
    optionMatched: Boolean(matchedOption),
  });

  logAnchor("[DESTINATION_ANCHOR_START]", {
    destination: raw || normalized,
    countryName: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    entityType,
  });

  logAnchor("[DESTINATION_ANCHOR_INPUT]", {
    rawDestination: raw,
    normalizedDestination: normalized,
    searchName: alias.searchName,
    entityType,
    destinationType: destinationType ?? entityType,
    administrativeArea: administrativeArea ?? "none",
    countryName: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    hasContextCoords: Boolean(params.contextCoordinates),
    // placesGeometry is caller-injected only; Destination Anchor resolves Places via geocodeFn
    // (Geocode → Places Autocomplete → Place Details) when this is false.
    hasPlacesGeometry: Boolean(params.placesGeometry || params.placesDetailsGeometry),
    placesViaGeocodeFn: Boolean(params.geocodeFn),
    hasOfferedOptions: Boolean(params.offeredOptions?.length),
    optionMatched: Boolean(matchedOption),
    hasGeocodeFn: Boolean(params.geocodeFn),
  });

  if (!normalized) {
    logAnchor("[DESTINATION_ANCHOR_FAILED]", {
      destination: raw || "unknown",
      countryCode: countryCodeHint ?? "unknown",
      attempts: retryCount,
      reason: "destination_alias_not_resolved",
      failureReason: "destination_alias_not_resolved",
      queriesTried: "none",
      autocompleteCount: 0,
      geocodeCount: 0,
    });
    return {
      status: "destination_resolution_failed",
      destination: raw || "unknown",
      retryable: true,
      reason: "destination_alias_not_resolved",
      attempts: retryCount,
      queriesTried: [],
    };
  }

  const queries = buildDestinationGeocodeQueries(normalized, params.locale, countryHint);
  logAnchor("[DESTINATION_GEOCODE_QUERY_PLAN]", {
    raw,
    normalized,
    countryName: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    queryCount: queries.length,
    queries: queries.join(" | "),
  });
  for (let i = 0; i < queries.length; i += 1) {
    logAnchor("[DESTINATION_ANCHOR_QUERY]", {
      attempt: i + 1,
      query: queries[i],
      countryName: countryHint ?? "unknown",
      countryCode: countryCodeHint ?? "unknown",
      source: "geocode",
    });
  }

  const tryAccept = (args: {
    lat: number;
    lng: number;
    source: DestinationAnchorSource;
    viewport?: DestinationAnchor["viewport"];
    countryOverride?: string | null;
  }): DestinationAnchor | null =>
    acceptCoords({
      raw: matchedOption?.displayName ?? raw,
      normalized,
      searchName: alias.searchName,
      lat: args.lat,
      lng: args.lng,
      countryHint: args.countryOverride ?? countryHint,
      administrativeArea,
      entityType,
      source: args.source,
      generationRequestId: params.generationRequestId,
      viewport: args.viewport,
    });

  const resolveOk = (anchor: DestinationAnchor): DestinationAnchorResult => {
    logAnchor("[DESTINATION_ANCHOR_RESOLVED]", {
      destination: normalized,
      normalizedDestination: normalized,
      canonicalName: normalized,
      countryName: anchor.country ?? countryHint ?? "unknown",
      countryCode: anchor.countryCode ?? "unknown",
      entityType: anchor.entityType ?? entityType,
      destinationType: anchor.destinationType ?? destinationType ?? entityType,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      provider: anchor.source,
      source: anchor.source,
      placeId: "none",
      matchedQuery: alias.searchName || normalized,
      rawDestination: raw,
      searchName: alias.searchName,
      administrativeArea: anchor.administrativeArea ?? administrativeArea ?? "none",
      hasViewport: Boolean(anchor.viewport),
      retryCount,
    });
    return { status: "ok", anchor };
  };

  // 1. Conversation / Travel Context coordinates
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 1,
    query: normalized,
    source: "context",
    entityType,
  });
  if (
    params.contextCoordinates &&
    isValidAnchorCoordinate(params.contextCoordinates.lat, params.contextCoordinates.lng)
  ) {
    const anchor = tryAccept({
      lat: params.contextCoordinates.lat,
      lng: params.contextCoordinates.lng,
      source: "context",
    });
    if (anchor) return resolveOk(anchor);
    lastFailureReason = "destination_anchor_invalid";
  }

  // 2. Place Details geometry (caller-injected)
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 2,
    query: normalized,
    source: "places_details",
    entityType,
  });
  if (
    params.placesDetailsGeometry &&
    isValidAnchorCoordinate(
      params.placesDetailsGeometry.lat,
      params.placesDetailsGeometry.lng,
    )
  ) {
    const anchor = tryAccept({
      lat: params.placesDetailsGeometry.lat,
      lng: params.placesDetailsGeometry.lng,
      source: "places_details",
    });
    if (anchor) return resolveOk(anchor);
    lastFailureReason = "destination_anchor_invalid";
  }
  if (
    params.placesGeometry &&
    isValidAnchorCoordinate(params.placesGeometry.lat, params.placesGeometry.lng)
  ) {
    const anchor = tryAccept({
      lat: params.placesGeometry.lat,
      lng: params.placesGeometry.lng,
      source: "places_autocomplete",
    });
    if (anchor) return resolveOk(anchor);
    lastFailureReason = "destination_anchor_invalid";
  }

  // Option metadata coords (previous-round UI selection) — still soft-accept.
  if (
    matchedOption &&
    matchedOption.latitude != null &&
    matchedOption.longitude != null &&
    isValidAnchorCoordinate(matchedOption.latitude, matchedOption.longitude)
  ) {
    const anchor = tryAccept({
      lat: matchedOption.latitude,
      lng: matchedOption.longitude,
      source: "option_metadata",
      viewport: matchedOption.viewport,
      countryOverride: matchedOption.countryName ?? matchedOption.country,
    });
    if (anchor) return resolveOk(anchor);
  }

  // 3. Destination Cache (positive city centroid only) — before live Google calls.
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 3,
    query: normalized,
    source: "city_centroid_cache",
    entityType,
  });
  const cached = readCityCentroidCache(normalized, countryCodeHint);
  if (cached && isValidAnchorCoordinate(cached.latitude, cached.longitude)) {
    logAnchor("[DESTINATION_ANCHOR_FALLBACK]", {
      destination: normalized,
      source: "city_centroid_cache",
      lat: cached.latitude,
      lng: cached.longitude,
      retryCount,
    });
    const anchor = tryAccept({
      lat: cached.latitude,
      lng: cached.longitude,
      source: "city_centroid_cache",
      countryOverride: countryHint ?? cached.country,
    });
    if (anchor) return resolveOk(anchor);
  }

  // Locked scope (prior successful resolution in this session).
  const preResolved = resolveDestinationCoordinates({
    destination: normalized,
    country: countryHint,
    countryCode: countryCodeHint,
    placesGeometry: params.placesDetailsGeometry ?? params.placesGeometry,
    approxCenter: null,
    generationRequestId: params.generationRequestId,
  });
  if (preResolved.coordinates && preResolved.source !== "approx_center") {
    const source: DestinationAnchorSource =
      preResolved.source === "scope_lock"
        ? "context"
        : preResolved.source === "places_geometry"
          ? "places_autocomplete"
          : "geocode";
    if (preResolved.scope?.country) countryHint = preResolved.scope.country;
    const anchor = toAnchor({
      raw: matchedOption?.displayName ?? raw,
      normalized,
      searchName: alias.searchName,
      lat: preResolved.coordinates.lat,
      lng: preResolved.coordinates.lng,
      country: preResolved.scope?.country ?? countryHint,
      countryCode: preResolved.scope?.countryCode ?? countryCodeHint,
      administrativeArea,
      entityType,
      source,
    });
    rememberCityCentroid({
      destination: normalized,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      country: anchor.country,
      countryCode: anchor.countryCode,
    });
    return resolveOk(anchor);
  }

  // 4–5. Google Geocoding (max 3) then Places Autocomplete → Details (max 2 / 1)
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 4,
    query: queries[0] ?? `${alias.searchName}, ${countryHint ?? ""}`,
    source: "geocode",
    entityType,
  });
  if (params.geocodeFn) {
    retryCount += 1;
    geocodeCount += 1;
    clearDestinationGeocodeCache(normalized);
    const geo = await geocodeDestinationWithFallback({
      destination: normalized,
      locale: params.locale ?? "zh-TW",
      geocodeFn: params.geocodeFn,
      preferCachedCoordinates: false,
      countryHint,
      countryCode: countryCodeHint,
    });
    if (geo && isValidAnchorCoordinate(geo.lat, geo.lng)) {
      const source: DestinationAnchorSource =
        typeof geo.placeId === "string" && geo.placeId.startsWith("places/")
          ? "places_autocomplete"
          : geo.placeId?.startsWith("approx:")
            ? "fallback"
            : "geocode";
      const resolvedSource: DestinationAnchorSource =
        source === "geocode" &&
        typeof geo.placeId === "string" &&
        /^ChIJ|places\//.test(geo.placeId)
          ? "places_autocomplete"
          : source;
      if (resolvedSource === "places_autocomplete") autocompleteCount += 1;
      const anchor = tryAccept({
        lat: geo.lat,
        lng: geo.lng,
        source: resolvedSource,
        countryOverride: countryHint ?? geo.country,
      });
      if (anchor) return resolveOk(anchor);
      lastFailureReason = "destination_anchor_invalid";
    } else {
      lastFailureReason = "destination_geocode_empty";
      autocompleteCount += 1;
    }
  } else if (!countryHint) {
    lastFailureReason = "destination_country_context_missing";
  }

  // 6. Viewport / locked scope mid-flight
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 5,
    query: normalized,
    source: "viewport",
    entityType,
  });
  const locked = getResolvedDestinationScope(normalized);
  if (locked && isValidAnchorCoordinate(locked.latitude, locked.longitude)) {
    const anchor = tryAccept({
      lat: locked.latitude,
      lng: locked.longitude,
      source: "viewport",
      countryOverride: countryHint ?? locked.country,
    });
    if (anchor) return resolveOk(anchor);
  }

  // Last-resort: legacy approx table only (never invent new hubs for missing cities).
  logAnchor("[DESTINATION_ANCHOR_ATTEMPT]", {
    attempt: 6,
    query: normalized,
    source: "fallback",
    entityType,
  });
  const approx = resolveDestinationApproxCenter(normalized, countryHint);
  if (approx && isValidAnchorCoordinate(approx.lat, approx.lng)) {
    logAnchor("[DESTINATION_ANCHOR_FALLBACK]", {
      destination: normalized,
      source: "fallback",
      lat: approx.lat,
      lng: approx.lng,
      retryCount,
    });
    const anchor = tryAccept({
      lat: approx.lat,
      lng: approx.lng,
      source: "fallback",
    });
    if (anchor) return resolveOk(anchor);
  }

  const failureReason: DestinationAnchorFailureReason =
    lastFailureReason === "destination_anchor_invalid"
      ? "destination_anchor_invalid"
      : lastFailureReason === "destination_country_context_missing"
        ? "country_hint_missing"
        : lastFailureReason === "destination_geocode_empty" ||
            lastFailureReason === "destination_resolution_failed"
          ? params.geocodeFn
            ? "anchor_geocode_empty"
            : "anchor_all_providers_failed"
          : lastFailureReason;

  logAnchor("[DESTINATION_ANCHOR_FAILED]", {
    destination: normalized,
    countryName: countryHint ?? "unknown",
    countryCode: countryCodeHint ?? "unknown",
    attempts: retryCount,
    reason: failureReason,
    failureReason,
    failureStage:
      failureReason === "anchor_geocode_empty"
        ? "geocode"
        : failureReason === "destination_anchor_invalid"
          ? "scope_validation"
          : failureReason === "country_hint_missing"
            ? "country_hint"
            : "resolution",
    searchName: alias.searchName,
    entityType,
    destinationType: destinationType ?? entityType,
    queriesTried: queries.join(" | "),
    attemptedQueries: queries.join(" | "),
    query: queries[0] ?? normalized,
    autocompleteCount,
    geocodeCount,
  });

  return {
    status: "destination_resolution_failed",
    destination: normalized,
    retryable: true,
    reason: failureReason,
    attempts: retryCount,
    queriesTried: queries.slice(0, 12),
  };
}
