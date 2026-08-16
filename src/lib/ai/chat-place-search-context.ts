import type { ChatPlanningSession } from "@/lib/chat-session";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { resolveSessionDestination } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
  type GeocodeDestinationFn,
} from "@/lib/ai/destination-geocode";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { sanitizeDestinationForGeocode } from "@/lib/ai/itinerary-entity-extraction";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import {
  logChatDestinationCoords,
  logChatDeviceCoords,
  logChatPlaceQueryDestination,
  logChatPlaceRejectWrongRegion,
  logChatPlaceRenderGuard,
  logChatPlaceResultGuard,
  logChatSearchMode,
} from "@/lib/ai/chat-place-flow-log";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { isExplicitDeviceNearbyRequest } from "@/lib/ai/recommendation-search-scope";
import type { DestinationAreaScope } from "@/lib/ai/destination-travel-profile";
import {
  evidenceIncludesArea,
  evidenceIncludesParentCity,
} from "@/lib/ai/destination-area-aliases";

export type ChatPlaceSearchMode = "destination" | "nearby";

export type LatLng = { lat: number; lng: number };

export type ChatPlaceSearchContext = {
  searchMode: ChatPlaceSearchMode;
  destinationName?: string;
  destinationLatLng?: LatLng | null;
  deviceLatLng?: LatLng | null;
  /** true when geocode failed and search should omit device location bias */
  textOnlyDestinationSearch?: boolean;
  destinationCountry?: string;
  destinationCity?: string;
  /** Country-level destination blocked from Places until city/region refined */
  placesCallBlocked?: boolean;
  placesBlockReason?: string;
};

/** @deprecated Use isExplicitDeviceNearbyRequest — bare「附近」follows trip destination. */
const EXPLICIT_NEARBY_RE =
  /(?:我現在附近|我目前所在|離我最近|以現在定位|用定位搜|我這邊附近|我这边附近|around\s*me|near\s*me|我的附近|今天附近可以|現在附近有)/;

const COUNTRY_ALIASES: Record<string, string[]> = {
  澳洲: ["Australia", "AU", "澳洲", "澳大利亚", "Victoria", "VIC", "New South Wales", "NSW"],
  日本: ["Japan", "JP", "日本"],
  韓國: ["Korea", "South Korea", "KR", "韓國", "韩国"],
  泰國: ["Thailand", "TH", "泰國", "泰国"],
  新加坡: ["Singapore", "SG", "新加坡"],
  法國: ["France", "FR", "法國", "法国"],
  英國: ["United Kingdom", "UK", "England", "GB", "英國", "英国"],
  美國: ["United States", "USA", "US", "美國", "美国"],
  台灣: ["Taiwan", "TW", "台灣", "台湾"],
};

const TAIWAN_REJECT_RE =
  /(?:台灣|台湾|Taiwan|Taipei|臺北|台北|New Taipei|新北|Taichung|台中|臺中|Tainan|台南|臺南|Kaohsiung|高雄|Nantou|南投|Changhua|彰化|Miaoli|苗栗|Hualien|花蓮|Yilan|宜蘭|Pingtung|屏東|Taitung|台東|臺東|Chiayi|嘉義|Hsinchu|新竹|Keelung|基隆|Penghu|澎湖|Kinmen|金門)/i;

const LOCALITY_ONLY_TYPES = new Set([
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "sublocality",
  "sublocality_level_1",
  "political",
  "country",
]);

export type DestinationGuardProfile = {
  acceptMarkers: string[];
  rejectRes: RegExp[];
  country?: string;
  city?: string;
};

export type DestinationAreaMatch = {
  areaMatched: boolean;
  parentCityMatched: boolean;
};

/** Match structured city + area evidence without treating distance or the place name as area proof. */
export function matchPlaceToDestinationArea(
  place: PlaceResult,
  scope: DestinationAreaScope,
): DestinationAreaMatch {
  const address = place.address ?? "";
  return {
    areaMatched: evidenceIncludesArea(address, scope.area),
    parentCityMatched: evidenceIncludesParentCity(address, scope.parentCity),
  };
}

export function filterPlacesByDestinationArea(
  places: PlaceResult[],
  scope: DestinationAreaScope,
): PlaceResult[] {
  return places.filter((place) => {
    const match = matchPlaceToDestinationArea(place, scope);
    return match.areaMatched && match.parentCityMatched;
  });
}

export function filterPlacesByDestinationParentCity(
  places: PlaceResult[],
  scope: DestinationAreaScope,
): PlaceResult[] {
  return places.filter((place) => matchPlaceToDestinationArea(place, scope).parentCityMatched);
}

export function isExplicitNearbyQuery(userText: string): boolean {
  return isExplicitDeviceNearbyRequest(userText) || EXPLICIT_NEARBY_RE.test(userText.trim());
}

export function resolveDestinationNameForSearch(
  context: CanonicalTravelContext,
  session: ChatPlanningSession,
): string | undefined {
  const fromCtx = context.destination?.trim();
  if (fromCtx) return sanitizeDestinationForGeocode(fromCtx);
  const sessionDest = resolveSessionDestination(session);
  return sessionDest ? sanitizeDestinationForGeocode(sessionDest) : undefined;
}

export function resolveChatPlaceSearchMode(
  context: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): ChatPlaceSearchMode {
  // Device GPS only for explicit current-location requests (or place-detail focus).
  if (isExplicitDeviceNearbyRequest(userText) || isPlaceDetailChatActive(session)) {
    return "nearby";
  }
  const destination = resolveDestinationNameForSearch(context, session);
  if (destination) return "destination";
  // Bare「附近」without trip destination → device nearby
  if (/附近|這一帶|这一带|離我|我這邊|我这边|around\s*me|nearby/i.test(userText)) {
    return "nearby";
  }
  return "nearby";
}

export function buildDestinationGuardProfile(destination: string): DestinationGuardProfile {
  const label = normalizeDestinationLabel(destination);
  const entity = resolveDestinationEntity(label);
  const en = EN_CITY_NAMES[label];
  const acceptMarkers = new Set<string>([label]);
  if (en) acceptMarkers.add(en);

  const country = entity.country;
  if (country) {
    for (const alias of COUNTRY_ALIASES[country] ?? [country]) {
      acceptMarkers.add(alias);
    }
  }

  if (label === "墨爾本") {
    acceptMarkers.add("Melbourne");
    acceptMarkers.add("Victoria");
  }
  if (label === "雪梨") {
    acceptMarkers.add("Sydney");
    acceptMarkers.add("New South Wales");
  }

  const rejectRes: RegExp[] = [];
  if (country && country !== "台灣" && country !== "台湾") {
    rejectRes.push(TAIWAN_REJECT_RE);
  }

  const city = entity.type === "city" ? label : undefined;
  return {
    acceptMarkers: [...acceptMarkers],
    rejectRes,
    country,
    city,
  };
}

function placeRegionText(place: PlaceResult): string {
  return `${place.name ?? ""} ${place.address ?? ""}`.trim();
}

function isLocalityOnlyPlace(place: PlaceResult): boolean {
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary && LOCALITY_ONLY_TYPES.has(primary)) return true;
  const types = place.types ?? [];
  if (types.length > 0 && types.every((t) => LOCALITY_ONLY_TYPES.has(t.trim().toLowerCase()))) {
    return true;
  }
  return false;
}

function isTransportPlace(place: PlaceResult, userText?: string): boolean {
  return isForbiddenTransitAttraction(place, userText);
}

export function passesDestinationPlaceGuard(
  place: PlaceResult,
  profile: DestinationGuardProfile,
  userText?: string,
): boolean {
  const text = placeRegionText(place);
  if (!text.trim()) {
    logChatPlaceResultGuard(place.name ?? "unknown", false, "empty_text");
    return false;
  }

  for (const re of profile.rejectRes) {
    if (re.test(text)) {
      logChatPlaceRejectWrongRegion(place.name ?? "unknown", re.source);
      return false;
    }
  }

  if (isLocalityOnlyPlace(place)) {
    logChatPlaceResultGuard(place.name ?? "unknown", false, "locality");
    return false;
  }

  if (isTransportPlace(place, userText)) {
    logChatPlaceResultGuard(place.name ?? "unknown", false, "transport");
    return false;
  }

  const lower = text.toLowerCase();
  const matched = profile.acceptMarkers.some((marker) => {
    const m = marker.trim();
    if (!m) return false;
    return lower.includes(m.toLowerCase()) || text.includes(m);
  });

  if (!matched) {
    logChatPlaceResultGuard(place.name ?? "unknown", false, "no_region_match");
    return false;
  }

  logChatPlaceResultGuard(place.name ?? "unknown", true, "ok");
  return true;
}

export function filterPlacesByDestinationGuard(
  places: PlaceResult[],
  destination: string,
  userText?: string,
): PlaceResult[] {
  const profile = buildDestinationGuardProfile(destination);
  return places.filter((place) => passesDestinationPlaceGuard(place, profile, userText));
}

export function passesDestinationRenderGuard(
  item: RoamieRecommendationItem,
  profile: DestinationGuardProfile,
): boolean {
  const text = `${item.name ?? ""} ${item.address ?? ""}`.trim();
  if (!text) {
    logChatPlaceRenderGuard(item.name ?? "unknown", false, "empty");
    return false;
  }

  for (const re of profile.rejectRes) {
    if (re.test(text)) {
      logChatPlaceRenderGuard(item.name ?? "unknown", false, "wrong_country");
      return false;
    }
  }

  if (profile.city) {
    const cityMatched = profile.acceptMarkers.some((marker) => {
      const m = marker.trim();
      if (!m || m === profile.country) return false;
      return text.toLowerCase().includes(m.toLowerCase()) || text.includes(m);
    });
    if (!cityMatched && profile.country) {
      const countryMatched = (COUNTRY_ALIASES[profile.country] ?? [profile.country]).some(
        (c) => text.includes(c) || text.toLowerCase().includes(c.toLowerCase()),
      );
      if (!countryMatched) {
        logChatPlaceRenderGuard(item.name ?? "unknown", false, "missing_city_region");
        return false;
      }
    }
  }

  logChatPlaceRenderGuard(item.name ?? "unknown", true, "ok");
  return true;
}

export function filterRecommendationsByDestinationRenderGuard(
  items: RoamieRecommendationItem[],
  destination: string,
): RoamieRecommendationItem[] {
  const profile = buildDestinationGuardProfile(destination);
  return items.filter((item) => passesDestinationRenderGuard(item, profile));
}

export function buildDestinationEnglishFallbackQueries(
  destination: string,
  category?: string,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  const entity = resolveDestinationEntity(label);
  const countryEn =
    entity.country === "澳洲"
      ? "Australia"
      : entity.country === "日本"
        ? "Japan"
        : entity.country === "韓國"
          ? "South Korea"
          : entity.country === "泰國"
            ? "Thailand"
            : entity.country === "新加坡"
              ? "Singapore"
              : entity.country;

  const destEn = countryEn && en !== countryEn ? `${en}, ${countryEn}` : en;

  const attempts: SearchAttempt[] = [
    { query: `${destEn} restaurants`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${destEn} shopping district`, mode: "text", includedTypes: ["shopping_mall"] },
    { query: `${destEn} cafe`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${destEn} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
  ];

  if (category) {
    attempts.unshift({ query: `${label} ${category}`, mode: "text" });
    attempts.unshift({ query: `${destEn} ${category}`, mode: "text" });
  }

  return attempts;
}

export async function resolveChatPlaceSearchContext(params: {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  userText: string;
  locale: Locale;
  geocodeFn?: GeocodeDestinationFn;
  deviceLatLng?: LatLng | null;
}): Promise<ChatPlaceSearchContext> {
  const { context, session, userText, locale, geocodeFn, deviceLatLng } = params;
  const searchMode = resolveChatPlaceSearchMode(context, session, userText);
  const destinationName = resolveDestinationNameForSearch(context, session);

  logChatSearchMode(searchMode);
  if (deviceLatLng) {
    logChatDeviceCoords(deviceLatLng.lat, deviceLatLng.lng);
  }

  if (searchMode === "nearby" || !destinationName) {
    return {
      searchMode: "nearby",
      deviceLatLng: deviceLatLng ?? undefined,
    };
  }

  const label = normalizeDestinationLabel(destinationName);
  const entity = resolveDestinationEntity(label);

  // Country-level destinations must never become a Places search center.
  const { evaluateDestinationScopeGate, logDestinationScopeBlocked, logUnexpectedPlacesCall } =
    await import("@/lib/ai/destination-scope");
  const scopeGate = evaluateDestinationScopeGate({
    destination: label,
    destinationType: entity.type,
    countryCode: entity.country,
    requestedIntent: "chat_place_search",
  });
  if (scopeGate.placesCallBlocked) {
    logDestinationScopeBlocked(scopeGate);
    logUnexpectedPlacesCall({
      trigger: "resolveChatPlaceSearchContext",
      intent: "chat_place_search",
      destinationType: scopeGate.destinationType,
      scopePrecision: scopeGate.scopePrecision,
      callPath: "chat-place-search-context.resolveChatPlaceSearchContext",
    });
    return {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: null,
      deviceLatLng: deviceLatLng ?? undefined,
      destinationCountry: entity.country,
      placesCallBlocked: true,
      placesBlockReason: scopeGate.reason,
    };
  }

  let destinationLatLng: LatLng | null = null;
  let textOnlyDestinationSearch = false;

  if (geocodeFn) {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });
    if (geocoded?.lat != null && geocoded?.lng != null) {
      destinationLatLng = { lat: geocoded.lat, lng: geocoded.lng };
    }
  }

  if (!destinationLatLng) {
    const approx = resolveDestinationApproxCenter(label);
    if (approx) {
      destinationLatLng = approx;
    } else {
      textOnlyDestinationSearch = true;
    }
  }

  if (destinationLatLng) {
    logChatDestinationCoords(label, destinationLatLng.lat, destinationLatLng.lng);
  } else {
    logChatDestinationCoords(label, null, null);
  }

  logChatPlaceQueryDestination(label, searchMode);

  return {
    searchMode: "destination",
    destinationName: label,
    destinationLatLng,
    deviceLatLng: deviceLatLng ?? undefined,
    textOnlyDestinationSearch,
    destinationCountry: entity.country,
    destinationCity: entity.type === "city" ? label : undefined,
  };
}

export function placesSearchContextPayload(
  searchContext: ChatPlaceSearchContext,
  intentCategory?: string,
): {
  destinationName?: string;
  searchMode?: ChatPlaceSearchMode;
  skipLocationBias?: boolean;
  intentCategory?: string;
  cacheDestination?: string;
  cacheCity?: string;
  cacheCountry?: string;
} {
  return {
    destinationName: searchContext.destinationName,
    searchMode: searchContext.searchMode,
    skipLocationBias: searchContext.textOnlyDestinationSearch === true,
    intentCategory,
    cacheDestination: searchContext.destinationName,
    cacheCity: searchContext.destinationCity ?? searchContext.destinationName,
    cacheCountry: searchContext.destinationCountry,
  };
}
