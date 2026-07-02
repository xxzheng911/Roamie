import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import { fetchNearbyPlacesForIntent, type PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { withSearchTimeout } from "@/lib/search-timeout";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatDateRangeLabel } from "@/lib/picker-utils";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import type { ChatMsg } from "@/lib/chat-history";
import {
  createEmptySession,
  mapPlaceResultToChatItem,
  roamieRecToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import { syncSessionPlaceMemory } from "@/lib/place-planning-memory";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import { alignChatRecommendationCount } from "@/lib/chat-display-recommendations";
import {
  buildTripAddPlaceDedupRegistry,
  createTripAddPlaceDedupRegistry,
  dedupeTripAddPlaceCandidates,
  isTripPlaceDuplicate,
  registerTripPlaceFingerprint,
} from "@/lib/trip/trip-add-place-dedup";
import {
  buildTripAddPlaceChatMessage,
} from "@/lib/trip/trip-add-place-render";
import {
  filterTripAddPlaceRecommendations,
} from "@/lib/trip/trip-add-place-tourism-filter";
import {
  buildTripAddPlaceMealSummary,
  buildTripAddPlaceTravelContext,
  type TripAddPlaceContext,
  type TripAddPlaceFollowUpIntent,
} from "@/lib/trip/trip-add-place-session";
import { tripAddPlaceNearbyGroups } from "@/lib/trip/trip-add-place-search-attempts";
import {
  rankAndTrimTripAddPlaceCandidates,
  resolveTripAddPlaceSearchCenter,
  tripAddPlaceMaxDistanceKm,
  tripAnchorFromContext,
  TRIP_ADD_PLACE_CANDIDATE_KEEP,
  TRIP_ADD_PLACE_RAW_FETCH_TARGET,
  logTripAddPlaceSearch,
  type TripAddPlaceSearchCenter,
} from "@/lib/trip/trip-add-place-search";
import {
  TRIP_ADD_PLACE_BATCH_SIZE,
  buildTripAddPlaceBatchSummary,
  collectBlockedPlaceIdsForSearch,
  createTripAddPlaceRecommendationSession,
  dedupeCandidatesByPlaceId,
  filterTripAddPlaceCandidates,
  placeIdFromRecommendation,
  slimRecommendationSession,
  TRIP_ADD_PLACE_RADIUS_STEPS_M,
  TRIP_ADD_PLACE_SEARCH_TIMEOUT_MS,
  type TripAddPlaceRecommendationSession,
} from "@/lib/trip/trip-add-place-recommendation-session";

export { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
export {
  isTripMealRequestText,
  parseTripAddPlaceFollowUpIntent,
  reinforceTripAddPlaceSession,
  type TripAddPlaceContext,
} from "@/lib/trip/trip-add-place-session";

const HANDOFF_STORAGE_KEY = "roamie:trip-add-place-handoff";

export type TripAddPlaceHandoffInput = {
  stored: StoredItinerary;
  payload: RoamiePayloadV2;
  settings: TripPlanSettings;
  dayIndex: number;
  selectedDay: number;
  dateKey: string;
  dayItems: RoamieItineraryItem[];
  dayCount: number;
};

function isDuplicatePlace(name: string, existing: string[]): boolean {
  const registry = createTripAddPlaceDedupRegistry();
  for (const n of existing) {
    registerTripPlaceFingerprint(registry, { name: n, placeName: n });
  }
  return isTripPlaceDuplicate({ name, placeName: name }, registry);
}

export function buildTripAddPlaceContext(input: TripAddPlaceHandoffInput): TripAddPlaceContext {
  const { stored, payload, settings, dayIndex, selectedDay, dateKey, dayItems, dayCount } = input;
  const destination = resolveTripDestination(payload);
  const existingPlaceNames = [
    ...new Set(
      (payload.itinerary ?? [])
        .map((item) => item.placeName?.trim() || item.title?.trim())
        .filter(Boolean) as string[],
    ),
  ];
  const currentPlaces = dayItems.map((item) => ({
    name: item.placeName?.trim() || item.title?.trim() || "地點",
    time: item.time,
    address: item.address,
  }));
  const lastItem = dayItems[dayItems.length - 1];
  const lastPlace = lastItem
    ? {
        name: lastItem.placeName?.trim() || lastItem.title?.trim() || "地點",
        lat: lastItem.lat,
        lng: lastItem.lng,
        address: lastItem.address,
        time: lastItem.time,
      }
    : undefined;

  const start = settings.tripStartDate ?? payload.tripSettings?.tripStartDate;
  const end = settings.tripEndDate ?? payload.tripSettings?.tripEndDate;
  const dateLabel =
    start && end
      ? formatDateRangeLabel(start, end, { withYear: true })
      : dayCount > 0
        ? `${dayCount} 天`
        : "";

  return {
    mode: "trip_add_place",
    source: "trip_detail_add_place",
    tripId: stored.id,
    destination,
    origin:
      payload.originLocation?.formattedName?.trim() ||
      payload.originLocation?.displayLabel?.trim() ||
      undefined,
    tripDates: { start, end, dayCount, label: dateLabel },
    selectedDay,
    dayIndex,
    dateKey,
    currentPlaces,
    existingPlaceNames,
    lastPlace,
    transportationMode: settings.transport ?? payload.tripSettings?.transport,
    travelStyle: payload.moodTag?.trim() || undefined,
    budget: undefined,
    timeWindow: {
      start: settings.startTime ?? payload.tripSettings?.startTime,
      end: settings.endTime,
    },
    destinationLocation: payload.destinationLocation ?? null,
  };
}

export function buildTripAddPlaceInitialContext(ctx: TripAddPlaceContext): string {
  const dayLabel = `第 ${ctx.selectedDay} 天（${ctx.dateKey}）`;
  const placesLine =
    ctx.currentPlaces.length > 0
      ? ctx.currentPlaces.map((p) => p.name).join("、")
      : "（尚未排定地點）";
  const lastLine = ctx.lastPlace?.name ? `lastPlace：${ctx.lastPlace.name}` : "";
  const lines = [
    "【行程內頁 → 請 Roamie 推薦下一個地點】",
    `mode：trip_add_place`,
    `source：${ctx.source}`,
    `tripId：${ctx.tripId}`,
    `destination：${ctx.destination}`,
    ctx.origin ? `origin：${ctx.origin}` : "",
    `tripDates：${ctx.tripDates.label}`,
    `selectedDay：${dayLabel}`,
    `dayIndex：${ctx.dayIndex}`,
    `currentPlaces：${placesLine}`,
    `existingPlaceNames：${ctx.existingPlaceNames.join("、") || "—"}`,
    lastLine,
    ctx.transportationMode ? `transportationMode：${ctx.transportationMode}` : "",
    ctx.travelStyle ? `travelStyle：${ctx.travelStyle}` : "",
    ctx.budget ? `budget：${ctx.budget}` : "",
    ctx.weather
      ? `weather：${ctx.weather.city ?? ctx.destination} ${ctx.weather.condition ?? ""} ${ctx.weather.tempC ?? ""}°C`
      : "",
    ctx.timeWindow?.start ? `timeWindow：${ctx.timeWindow.start} - ${ctx.timeWindow.end ?? "—"}` : "",
    "",
    "【必守】",
    "- 延續這趟行程與當天節奏，不要像新對話開場",
    "- 只推薦適合加入「當天」的地點，不要排到其他天",
    "- 不可推薦 existingPlaceNames 已有地點",
    "- 優先順路、附近、不會讓行程太趕的選擇",
    "- 考量交通方式、剩餘時間、天氣與旅行風格",
    "- 若行程已偏滿，先提醒再建議輕量選項",
    "- 使用者按「加入行程」時，直接加入此 trip 的當天",
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildTripAddPlaceOpening(ctx: TripAddPlaceContext): string {
  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  const lead =
    names.length > 0
      ? `我看到你目前${dayLabel}已經排了${names.join("和")}。`
      : `我看到你正在規劃${dayLabel}的行程。`;

  return [
    lead,
    "如果要再加一個地點，我會建議找附近、順路、不會讓行程太趕的地方。",
    "你想要我偏向咖啡休息、景點散步，還是晚餐安排？",
  ].join("\n");
}

export function writeTripAddPlaceHandoff(ctx: TripAddPlaceContext): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(ctx));
}

export function consumeTripAddPlaceHandoff(): TripAddPlaceContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripAddPlaceContext;
    if (parsed?.mode !== "trip_add_place" || !parsed.tripId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function prepareTripAddPlaceSession(
  ctx: TripAddPlaceContext,
  bundle: ClientContextBundle,
): ChatPlanningSession {
  const destLoc = ctx.destinationLocation;
  const location: RoamieLocation = destLoc
    ? (tripLocationToRoamie(destLoc) as RoamieLocation)
    : {
        lat: ctx.lastPlace?.lat ?? bundle.location.lat,
        lng: ctx.lastPlace?.lng ?? bundle.location.lng,
        city: ctx.destination,
      };

  const rejected = [...ctx.existingPlaceNames];

  const base: ChatPlanningSession = {
    ...createEmptySession(),
    phase: "followup",
    mood: ctx.travelStyle,
    location,
    weather: ctx.weather ?? bundle.weather,
    tripDestination: destLoc ?? undefined,
    transportation: ctx.transportationMode,
    budget: ctx.budget,
    tripStartDate: ctx.tripDates.start,
    tripEndDate: ctx.tripDates.end,
    tripDays: ctx.tripDates.dayCount,
    preferredArea: ctx.destination,
    fromTripAddPlace: true,
    tripAddPlaceContext: ctx,
    conversationMode: "trip_add_place",
    activeChatIntent: "attraction",
    pendingHandoff: true,
    rejectedPlaceNames: rejected,
    initialChatContext: buildTripAddPlaceInitialContext(ctx),
    updatedAt: new Date().toISOString(),
  };

  return syncSessionPlaceMemory(base);
}

export function markTripAddPlaceHandoffComplete(
  session: ChatPlanningSession,
): ChatPlanningSession {
  return {
    ...session,
    pendingHandoff: false,
    tripAddPlaceHandoffDone: true,
    phase: "followup",
    updatedAt: new Date().toISOString(),
  };
}

function recommendationAnchor(ctx: TripAddPlaceContext): { lat: number; lng: number } | null {
  const center = tripAnchorFromContext(ctx);
  return center ? { lat: center.lat, lng: center.lng } : null;
}

export function parseNumberedPlaceNamesFromText(text: string): string[] {
  return [...text.matchAll(/^\d+\.\s*(.+)$/gm)]
    .map((m) => m[1]?.trim())
    .filter(Boolean) as string[];
}

function normalizePlaceLookupName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

function pickPlaceByName(
  places: import("@/lib/place-result").PlaceResult[],
  targetName: string,
): import("@/lib/place-result").PlaceResult | undefined {
  const target = normalizePlaceLookupName(targetName);
  return (
    places.find((p) => normalizePlaceLookupName(p.name) === target) ??
    places.find((p) => {
      const n = normalizePlaceLookupName(p.name);
      return n.includes(target) || target.includes(n);
    }) ??
    places[0]
  );
}

/** 文字摘要有地點清單但 structured recommendations 為空時，依名稱查 Google Places 補齊卡片 */
export async function enrichTripAddPlaceRecommendationsFromSummary(params: {
  summary: string;
  ctx: TripAddPlaceContext;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
  existing?: RoamieRecommendationItem[];
}): Promise<RoamieRecommendationItem[]> {
  const { summary, ctx, searchPlaces, locale, existing = [] } = params;
  if (existing.length) return existing.slice(0, 5);

  const names = parseNumberedPlaceNamesFromText(summary);
  if (!names.length) return [];

  const anchor = recommendationAnchor(ctx);
  if (!anchor) return [];

  const seen = new Set(
    existing
      .map((r) => r.googlePlaceId ?? (r as RoamieRecommendationItem & { placeId?: string }).placeId)
      .filter(Boolean) as string[],
  );
  const enriched: RoamieRecommendationItem[] = [];

  for (const name of names.slice(0, 5)) {
    if (isDuplicatePlace(name, ctx.existingPlaceNames)) continue;
    try {
      const { places } = await searchPlaces({
        data: {
          query: `${name} ${ctx.destination}`.trim(),
          lat: anchor.lat,
          lng: anchor.lng,
          mode: "text",
          locale,
          placesCaller: "trip_add_place.enrichFromSummary",
          placesScreen: "chat",
        },
      });
      const pick = pickPlaceByName(places ?? [], name);
      if (!pick?.id || seen.has(pick.id)) continue;
      seen.add(pick.id);
      enriched.push(mapPlaceResultToChatItem(pick, { locale }));
    } catch {
      /* skip failed lookup */
    }
  }

  return filterTripAddPlaceRecommendations(enriched, "attraction").slice(0, 5);
}

export async function ensureHandoffRecommendationSession(params: {
  ctx: TripAddPlaceContext;
  recommendations: RoamieRecommendationItem[];
  recommendationSession: TripAddPlaceRecommendationSession | null;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<TripAddPlaceRecommendationSession | null> {
  const { ctx, recommendations, searchPlaces, locale } = params;
  if (params.recommendationSession?.allCandidates.length) {
    return slimRecommendationSession(params.recommendationSession);
  }
  if (!recommendations.length) return null;

  const pool = await fetchTripAddPlaceCandidatePool({
    ctx,
    intent: "attraction",
    searchPlaces,
    locale,
  });

  const seen = new Set<string>();
  const merged: RoamieRecommendationItem[] = [];
  for (const rec of [...recommendations, ...pool]) {
    const id = placeIdFromRecommendation(rec);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(rec);
  }

  if (!merged.length) return null;

  return slimRecommendationSession(
    createTripAddPlaceRecommendationSession({
      ctx,
      candidates: merged,
      intent: "attraction",
      firstBatch: recommendations,
    }),
  );
}

export function buildTripAddPlaceAssistantMessage(
  summary: string,
  recommendations: RoamieRecommendationItem[],
  moodTag?: string,
  session?: ChatPlanningSession,
): ChatMsg {
  const baseSession =
    session ??
    ({
      fromTripAddPlace: true,
      conversationMode: "trip_add_place",
    } as ChatPlanningSession);
  return buildTripAddPlaceChatMessage({
    summary,
    recommendations,
    moodTag,
    session: baseSession,
  });
}

/** 從 session 還原 assistant 訊息內的地點卡（避免返回後只剩文字） */
export function mergeTripAddPlaceHistoryWithRecommendations(
  history: ChatMsg[],
  session: ChatPlanningSession,
): ChatMsg[] {
  const recs = (session.recommendedPlaces ?? []) as RoamieRecommendationItem[];
  if (!recs.length) return history;

  let lastAssistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx < 0) {
    const summary = session.lastAssistantReply?.trim() || recs.map((r, i) => `${i + 1}. ${r.name}`).join("\n");
    return [...history, buildTripAddPlaceAssistantMessage(summary, recs, session.mood ?? undefined, session)];
  }

  const msg = history[lastAssistantIdx]!;
  const existing = msg.roamie?.recommendations ?? [];
  if (existing.length >= recs.length) return history;

  const merged = [...history];
  merged[lastAssistantIdx] = buildTripAddPlaceAssistantMessage(
    msg.roamie?.summary ?? msg.content,
    recs,
    session.mood ?? undefined,
    session,
  );
  return merged;
}

function nearbyIntentFromFollowUp(intent: TripAddPlaceFollowUpIntent): NearbyPlaceIntent {
  return intent;
}

export async function fetchTripAddPlaceCandidatePool(params: {
  ctx: TripAddPlaceContext;
  intent: TripAddPlaceFollowUpIntent;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
  excludePlaceIds?: string[];
  recSession?: TripAddPlaceRecommendationSession | null;
  radiusSteps?: readonly number[];
  radiusStep?: number;
  expandConsent?: boolean;
  searchCenter?: TripAddPlaceSearchCenter | null;
  userText?: string;
}): Promise<RoamieRecommendationItem[]> {
  const {
    ctx,
    intent,
    searchPlaces,
    locale,
    excludePlaceIds = [],
    recSession,
    radiusSteps,
    radiusStep,
    expandConsent,
    searchCenter,
    userText = "",
  } = params;
  const center = searchCenter ?? resolveTripAddPlaceSearchCenter(ctx, recSession);
  if (!center) return [];

  const step =
    radiusStep ??
    (radiusSteps?.length === 1
      ? TRIP_ADD_PLACE_RADIUS_STEPS_M.indexOf(radiusSteps[0] as (typeof TRIP_ADD_PLACE_RADIUS_STEPS_M)[number])
      : recSession?.searchRadiusStep ?? 0);
  const safeStep = step >= 0 ? step : 0;
  const radius =
    radiusSteps?.[0] ??
    TRIP_ADD_PLACE_RADIUS_STEPS_M[Math.min(safeStep, TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1)]!;
  const maxDistanceKm = tripAddPlaceMaxDistanceKm({
    radiusStep: safeStep,
    expandConsent: expandConsent ?? recSession?.awaitingExpandConsent,
    transportationMode: ctx.transportationMode,
  });

  logTripAddPlaceSearch({
    label: "fetch_pool",
    center,
    radiusM: radius,
    radiusStep: safeStep,
    maxDistanceKm,
  });

  const blockedIds =
    excludePlaceIds.length > 0
      ? excludePlaceIds
      : collectBlockedPlaceIdsForSearch(recSession, ctx);

  const travelCtx = buildTripAddPlaceTravelContext(
    { travelContext: { interests: [] } } as ChatPlanningSession,
    ctx,
    { interests: [] },
  );

  try {
    const places = await withSearchTimeout(
      fetchNearbyPlacesForIntent(
        nearbyIntentFromFollowUp(intent),
        center.lat,
        center.lng,
        locale,
        searchPlaces,
        undefined,
        travelCtx,
        blockedIds,
        {
          cityLabel: ctx.destination,
          maxResults: TRIP_ADD_PLACE_RAW_FETCH_TARGET,
          radiusSteps: [radius],
          maxDistanceKm,
          tripAddPlace: true,
          nearbyGroups: tripAddPlaceNearbyGroups(intent, userText),
          userText,
        },
      ),
      TRIP_ADD_PLACE_SEARCH_TIMEOUT_MS,
    );

    const recommendations = places.map((p) => mapPlaceResultToChatItem(p, { locale }));
    const deduped = dedupeCandidatesByPlaceId(
      recommendations.filter((rec) => !isDuplicatePlace(rec.name, ctx.existingPlaceNames)),
    );
    const filtered = filterTripAddPlaceRecommendations(deduped, intent);
    const dedupedBlocked = filterTripAddPlaceCandidates(filtered, recSession ?? null, ctx);
    return rankAndTrimTripAddPlaceCandidates(
      dedupedBlocked,
      center,
      maxDistanceKm,
      TRIP_ADD_PLACE_CANDIDATE_KEEP,
    );
  } catch {
    return [];
  }
}

export type TripAddPlaceRecommendationsResult = {
  summary: string;
  recommendations: RoamieRecommendationItem[];
  recommendationSession: TripAddPlaceRecommendationSession | null;
  allCandidates: RoamieRecommendationItem[];
};

export async function fetchTripAddPlaceRecommendations(params: {
  ctx: TripAddPlaceContext;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<TripAddPlaceRecommendationsResult> {
  const { ctx, searchPlaces, locale } = params;
  const opening = buildTripAddPlaceOpening(ctx);
  const anchor = recommendationAnchor(ctx);
  if (!anchor) {
    return { summary: opening, recommendations: [], recommendationSession: null, allCandidates: [] };
  }

  const allCandidates = await fetchTripAddPlaceCandidatePool({
    ctx,
    intent: "attraction",
    searchPlaces,
    locale,
    radiusStep: 0,
    radiusSteps: [TRIP_ADD_PLACE_RADIUS_STEPS_M[0]!],
  });

  const uniquePool = dedupeTripAddPlaceCandidates(
    allCandidates,
    buildTripAddPlaceDedupRegistry(null, ctx),
    "handoff_pool",
  );
  const cards = uniquePool.slice(0, TRIP_ADD_PLACE_BATCH_SIZE);
  if (!cards.length) {
    return { summary: opening, recommendations: [], recommendationSession: null, allCandidates: uniquePool };
  }

  const recommendationSession = createTripAddPlaceRecommendationSession({
    ctx,
    candidates: uniquePool,
    intent: "attraction",
    firstBatch: cards,
  });

  const summary = buildTripAddPlaceBatchSummary(ctx, cards, { intent: "attraction" });
  const withOpening = [
    opening,
    "",
    summary,
  ].join("\n");

  return {
    summary: alignChatRecommendationCount(withOpening, cards.length),
    recommendations: cards,
    recommendationSession,
    allCandidates: uniquePool,
  };
}

function buildTripAddPlaceFollowUpSummary(
  ctx: TripAddPlaceContext,
  intent: TripAddPlaceFollowUpIntent,
  recommendations: RoamieRecommendationItem[],
): string {
  if (intent === "restaurant") {
    return buildTripAddPlaceMealSummary(ctx, recommendations);
  }

  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  const area = names.length > 0 ? `${names.join("和")}周邊` : ctx.destination;

  if (!recommendations.length) {
    if (intent === "cafe") {
      return `如果${dayLabel}在${area}，我可以幫你找順路的咖啡廳。你想安靜坐坐還是順便拍照？`;
    }
    return `如果${dayLabel}在${area}，我可以幫你找順路的景點。你想輕鬆散步還是多待一會？`;
  }

  const list = recommendations
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");
  const lead =
    intent === "cafe"
      ? `如果${dayLabel}在${area}，這幾間咖啡廳順路又不會太趕：`
      : `如果${dayLabel}在${area}，這幾個景點順路又不會太趕：`;

  return [lead, "", list, "", "想加入行程的話，直接點卡片就可以。"].join("\n");
}

export async function fetchTripAddPlaceFollowUpRecommendations(params: {
  ctx: TripAddPlaceContext;
  intent: TripAddPlaceFollowUpIntent;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
  excludePlaceIds?: string[];
}): Promise<TripAddPlaceRecommendationsResult> {
  const { ctx, intent, searchPlaces, locale, excludePlaceIds = [] } = params;

  const allCandidates = await fetchTripAddPlaceCandidatePool({
    ctx,
    intent,
    searchPlaces,
    locale,
    excludePlaceIds,
  });

  const uniquePool = dedupeTripAddPlaceCandidates(
    allCandidates,
    buildTripAddPlaceDedupRegistry(null, ctx),
    "followup_pool",
  );
  const cards = uniquePool.slice(0, TRIP_ADD_PLACE_BATCH_SIZE);
  const summary = buildTripAddPlaceFollowUpSummary(ctx, intent, cards);

  if (!cards.length) {
    return { summary, recommendations: [], recommendationSession: null, allCandidates: uniquePool };
  }

  const recommendationSession = createTripAddPlaceRecommendationSession({
    ctx,
    candidates: uniquePool,
    intent,
    firstBatch: cards,
  });

  return {
    summary,
    recommendations: cards,
    recommendationSession,
    allCandidates: uniquePool,
  };
}

export function tripAddPlaceRecommendationsToSession(
  session: ChatPlanningSession,
  recommendations: RoamieRecommendationItem[],
  recommendationSession?: TripAddPlaceRecommendationSession | null,
): ChatPlanningSession {
  const recs = recommendations.map(roamieRecToChatItem);
  const shownIds = recommendationSession?.shownPlaceIds ??
    recs.map((r) => placeIdFromRecommendation(r)).filter(Boolean);
  const slimRec = recommendationSession
    ? slimRecommendationSession(recommendationSession)
    : session.tripAddPlaceRecommendationSession;
  return syncSessionPlaceMemory({
    ...session,
    recommendedPlaces: recs as ChatPlaceItem[],
    recommendedPlaceIds: shownIds,
    tripAddPlaceRecommendationSession: slimRec ?? undefined,
    phase: "followup",
  });
}