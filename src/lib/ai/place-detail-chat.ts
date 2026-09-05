import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { ChatConversationMode } from "@/lib/ai/trip-planning-context";
import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
} from "@/lib/ai/chat-place-intent";
import { isExplicitNearbyQuery } from "@/lib/ai/chat-place-search-context";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { Locale } from "@/lib/i18n/types";
import {
  enrichChatPlaceItemFromDetails,
  hasValidPlaceCoordinates,
  logChatContextPlace,
  parseCityCountryFromAddress,
} from "@/lib/chat-place-context";

export type FetchPlaceDetailsForFocusFn = (
  placeId: string,
  opts?: { placeName?: string; city?: string },
) => Promise<{
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  placeId?: string;
} | null>;

export type PlaceDetailFollowUpIntent =
  | "add_to_trip"
  | "nearby_cafe"
  | "nearby_late_snack"
  | "view_route"
  | "continue_chat";

export type PlaceFocusNearbyFailureReason =
  | "missing_anchor"
  | "missing_coords"
  | "provider_error"
  | "raw_zero"
  | "operational_filtered"
  | "geographic_filtered"
  | "deduped_exhausted"
  | "display_filtered"
  | "processing_error";

export type PlaceFocusNearbyResult = {
  applied: boolean;
  failureReason?: PlaceFocusNearbyFailureReason;
  counts: import("@/lib/ai/chat-place-recommendation").PlaceFocusNearbyDiagnostics;
};

export function resolvePlaceFocusNearbyResult(
  applied: boolean,
  runtime: {
    reason?: string;
    finalCount?: number;
    placeFocusDiagnostics?: import("@/lib/ai/chat-place-recommendation").PlaceFocusNearbyDiagnostics;
  } | null,
): PlaceFocusNearbyResult {
  const counts = runtime?.placeFocusDiagnostics ?? {
    rawCount: 0,
    operationalCount: 0,
    geographicCount: 0,
    preDedupeCount: 0,
    dedupedCount: 0,
    finalCount: runtime?.finalCount ?? 0,
  };
  if (applied && (runtime?.finalCount ?? counts.finalCount) > 0) return { applied: true, counts };
  let failureReason: PlaceFocusNearbyFailureReason;
  if (runtime?.reason === "missing_anchor") failureReason = "missing_anchor";
  else if (runtime?.reason === "missing_location") failureReason = "missing_coords";
  else if (runtime?.reason === "provider_zero") failureReason = "provider_error";
  else if (runtime?.reason === "recommendation_processing_failure") {
    failureReason = "processing_error";
  } else if (counts.rawCount === 0) failureReason = "raw_zero";
  else if (counts.operationalCount === 0) failureReason = "operational_filtered";
  else if (counts.geographicCount === 0) failureReason = "geographic_filtered";
  else if (counts.dedupedCount === 0) failureReason = "deduped_exhausted";
  else failureReason = "display_filtered";
  return { applied: false, failureReason, counts };
}

export function isPlaceDetailChatActive(session: ChatPlanningSession): boolean {
  return Boolean(session.placeDetailFocus);
}

export function inferPreviousConversationMode(
  session: ChatPlanningSession,
): ChatConversationMode {
  if (session.previousConversationMode) return session.previousConversationMode;
  if (session.fromMoodFlow || session.fromMoodCard || session.homeMoodShortcutEntry) {
    return "mood_recommend";
  }
  if (session.conversationMode === "destination_planning") return "destination_planning";
  return "nearby_explore";
}

export function enterPlaceDetailChat(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const previousMode = inferPreviousConversationMode(session);
  const focus = {
    ...place,
    displayName: place.displayName?.trim() || placeDisplayName(place),
    placeName: place.placeName?.trim() || place.displayName?.trim() || place.name,
  };
  const anchorPlaceId = (focus.googlePlaceId ?? focus.placeId ?? focus.id ?? "").trim();
  const scopeId = buildPlaceFocusScopeId(anchorPlaceId, undefined, session);
  logChatContextPlace(focus);
  return {
    ...session,
    placeDetailFocus: focus,
    selectedPlaceFromMood: focus,
    placeFocusRecommendationScope: {
      scopeId,
      anchorPlaceId,
      conversationId: session.conversationId ?? session.workspaceId,
      shownPlaceIds: [],
    },
    recommendationSession: undefined,
    activeRecommendationContext: undefined,
    recommendedPlaceIds: undefined,
    recommendedNormalizedNames: undefined,
    usedPlaceIds: undefined,
    usedPlaceNames: undefined,
    usedAreaKeys: undefined,
    recommendedPlaces: [],
    rejectedPlaceNames: undefined,
    previousConversationMode: previousMode,
    conversationMode: "place_focus",
    phase: "followup",
    activeChatIntent: undefined,
    foodPreference: undefined,
  };
}

export function buildPlaceFocusScopeId(
  anchorPlaceId: string,
  category: NearbyPlaceIntent | undefined,
  session: Pick<ChatPlanningSession, "conversationId" | "workspaceId">,
): string {
  const conversation = session.conversationId ?? session.workspaceId ?? "local";
  return `place_focus:${anchorPlaceId || "unknown"}:${category ?? "pending"}:${conversation}`;
}

export function ensurePlaceFocusRecommendationScope(
  session: ChatPlanningSession,
  category: NearbyPlaceIntent,
): ChatPlanningSession {
  const anchor = session.placeDetailFocus;
  const anchorPlaceId = (anchor?.googlePlaceId ?? anchor?.placeId ?? anchor?.id ?? "").trim();
  const scopeId = buildPlaceFocusScopeId(anchorPlaceId, category, session);
  if (session.placeFocusRecommendationScope?.scopeId === scopeId) return session;
  return {
    ...session,
    placeFocusRecommendationScope: {
      scopeId,
      anchorPlaceId,
      requestedCategory: category,
      conversationId: session.conversationId ?? session.workspaceId,
      shownPlaceIds: [],
    },
    recommendationSession: undefined,
    activeRecommendationContext: undefined,
    recommendedPlaceIds: undefined,
    recommendedNormalizedNames: undefined,
    usedPlaceIds: undefined,
    usedPlaceNames: undefined,
    usedAreaKeys: undefined,
    recommendedPlaces: [],
    rejectedPlaceNames: undefined,
  };
}

export function collectPlaceFocusExcludePlaceIds(session: ChatPlanningSession): string[] {
  const scope = session.placeFocusRecommendationScope;
  const ids = new Set<string>();
  const add = (place?: ChatPlaceItem | null) => {
    const id = (place?.googlePlaceId ?? place?.placeId ?? place?.id ?? "").trim();
    if (id) ids.add(id);
  };
  add(session.placeDetailFocus);
  session.selectedPlaces.forEach(add);
  session.plannedStops?.forEach(add);
  scope?.shownPlaceIds.forEach((id) => id.trim() && ids.add(id.trim()));
  return [...ids];
}

export function commitPlaceFocusShownIds(
  session: ChatPlanningSession,
  category: NearbyPlaceIntent,
  shownPlaceIds: string[],
): ChatPlanningSession {
  const scoped = ensurePlaceFocusRecommendationScope(session, category);
  const scope = scoped.placeFocusRecommendationScope!;
  return {
    ...scoped,
    placeFocusRecommendationScope: {
      ...scope,
      shownPlaceIds: [...new Set([...scope.shownPlaceIds, ...shownPlaceIds].filter(Boolean))],
    },
  };
}

function suggestStayDuration(place: ChatPlaceItem, mood: string): string {
  const blob = `${place.type ?? ""} ${place.description ?? ""} ${place.reason ?? ""}`;
  if (/(河|步道|公園|海邊|散步|堤)/.test(blob) || /深夜散步|夜景|走走/.test(mood)) {
    return "40～60 分鐘";
  }
  if (/(咖啡|café|cafe)/i.test(blob)) return "45～75 分鐘";
  if (/(餐廳|宵夜|夜市)/.test(blob)) return "60～90 分鐘";
  if (/(博物館|展覽|美術)/.test(blob)) return "90～120 分鐘";
  return "45～60 分鐘";
}

function moodFitLine(name: string, mood: string): string {
  if (/深夜散步|夜景/.test(mood)) {
    return `「${name}」很適合你剛剛說的深夜散步。這裡比較適合慢慢走、看夜景，不太像需要排很滿的景點。`;
  }
  if (/下雨天|雨/.test(mood)) {
    return `「${name}」蠻適合下雨天想找室內或仍有氛圍的節奏，不用趕行程。`;
  }
  if (/找咖啡|咖啡/.test(mood)) {
    return `「${name}」跟你剛剛想找咖啡的狀態很合拍，適合坐下來慢慢待一會。`;
  }
  if (/想放空|放鬆/.test(mood)) {
    return `「${name}」蠻符合你想放鬆的節奏，不用排得太滿。`;
  }
  if (/看海/.test(mood)) {
    return `「${name}」適合你想看海、吹吹風的狀態。`;
  }
  return `「${name}」值得停下來感受一下，我們可以從這裡往下細排。`;
}

export function buildPlaceDetailReply(
  place: ChatPlaceItem,
  session: ChatPlanningSession,
): string {
  const name = placeDisplayName(place);
  const mood = session.selectedMood ?? session.mood ?? session.travelContext?.mood ?? "";
  const duration = place.estimatedTime?.trim() || suggestStayDuration(place, mood);
  const reason = place.reason?.trim();

  const lines = [moodFitLine(name, mood)];

  if (reason && !lines[0]!.includes(reason)) {
    lines.push(reason);
  }

  lines.push(
    `如果你要把它放進今晚行程，我會建議停留 ${duration}，後面可以接一間附近咖啡廳或宵夜店。`,
    "",
    "你還想怎麼安排呢？",
  );

  return lines.join("\n");
}

export function parsePlaceDetailFollowUp(text: string): PlaceDetailFollowUpIntent {
  const t = text.trim();
  if (!t) return "continue_chat";
  if (/(加入行程|加進行程|放進行程|列入行程)/.test(t)) return "add_to_trip";
  if (/(查看路線|看路線|怎麼去|導航)/.test(t)) return "view_route";
  if (/(附近|這附近|這一帶|周邊|周边).*(咖啡|咖啡廳|咖啡店)/.test(t)) return "nearby_cafe";
  if (/(咖啡廳|咖啡店|找咖啡|想找咖啡)/.test(t)) return "nearby_cafe";
  if (/(附近|這附近|這一帶).*(宵夜|深夜|小吃|美食|餐廳|吃)/.test(t)) return "nearby_late_snack";
  if (/(宵夜|深夜食堂|夜市)/.test(t)) return "nearby_late_snack";
  return "continue_chat";
}

export function resolvePlaceDetailNearbyIntent(text: string): NearbyPlaceIntent | null {
  const t = text.trim();
  if (!t) return null;

  const followUp = parsePlaceDetailFollowUp(t);
  if (followUp === "nearby_cafe") return "cafe";
  if (followUp === "nearby_late_snack") return "restaurant";

  const explicitNearby =
    isExplicitNearbyQuery(t) || /(這附近|附近|這一帶|周邊|周边)/.test(t);
  if (!explicitNearby) return null;

  const categories = parseChatPlaceIntents(t);
  if (categories.includes("cafe")) return "cafe";
  if (categories.includes("restaurant") || categories.includes("night_market")) {
    return "restaurant";
  }
  if (categories.includes("bar")) return "restaurant";
  if (categories.length === 1) {
    return mapCategoryIntentToNearbyIntent(categories[0]!);
  }
  if (/(咖啡)/.test(t)) return "cafe";
  if (/(美食|餐廳|宵夜|吃)/.test(t)) return "restaurant";
  if (/(酒吧)/.test(t)) return "restaurant";
  if (/(景點|逛逛|散步)/.test(t)) return "attraction";
  return null;
}

export async function ensurePlaceDetailFocusCoordinates(
  session: ChatPlanningSession,
  geocodeFn: GeocodeDestinationFn,
  locale: Locale,
  fetchDetailsFn?: FetchPlaceDetailsForFocusFn,
): Promise<ChatPlanningSession> {
  const focus = session.placeDetailFocus;
  if (!focus) return session;

  if (hasValidPlaceCoordinates(focus)) {
    logChatContextPlace(focus);
    return session;
  }

  const placeId = (focus.placeId ?? focus.googlePlaceId ?? "").trim();
  if (placeId && fetchDetailsFn) {
    logAiPipeline("[CHAT_NEARBY_GEOCODE]", { place: placeDisplayName(focus), source: "place_details", placeId });
    const details = await fetchDetailsFn(placeId);
    if (details && hasValidPlaceCoordinates(details)) {
      const updated = enrichChatPlaceItemFromDetails(focus, details);
      logChatContextPlace(updated);
      return {
        ...session,
        placeDetailFocus: updated,
        selectedPlaceFromMood: updated,
      };
    }
    console.warn("[CHAT_NEARBY_GEOCODE] place_details failed", { placeId });
  }

  const parsed = parseCityCountryFromAddress(focus.address);
  const query = [placeDisplayName(focus), focus.address, parsed.country]
    .filter(Boolean)
    .join(", ");
  if (!query.trim()) return session;

  logAiPipeline("[CHAT_NEARBY_GEOCODE]", { place: placeDisplayName(focus), query, source: "geocode" });
  const geocoded = await geocodeFn({ data: { query, locale } });
  if (geocoded.location?.lat == null || geocoded.location?.lng == null) {
    console.warn("[CHAT_NEARBY_GEOCODE] failed", { place: placeDisplayName(focus) });
    return session;
  }

  const updated = enrichChatPlaceItemFromDetails(focus, {
    lat: geocoded.location.lat,
    lng: geocoded.location.lng,
    name: placeDisplayName(focus),
    address: focus.address || geocoded.location.address,
    placeId: placeId || undefined,
  });
  logAiPipeline("[CHAT_NEARBY_GEOCODE] ok", {
    place: placeDisplayName(updated),
    lat: updated.lat,
    lng: updated.lng,
  });
  return {
    ...session,
    placeDetailFocus: updated,
    selectedPlaceFromMood: updated,
  };
}

export function sessionWithPlaceDetailSearchCenter(
  session: ChatPlanningSession,
): ChatPlanningSession {
  const focus = session.placeDetailFocus;
  if (!hasValidPlaceCoordinates(focus)) return session;
  const parsed = parseCityCountryFromAddress(focus?.address);
  return {
    ...session,
    location: {
      lat: focus!.lat!,
      lng: focus!.lng!,
      city: focus?.city?.trim() || parsed.city || session.location?.city,
    },
    preferredArea: placeDisplayName(focus!),
  };
}

/** Place-focus nearby must bypass generic context merging so the anchor authority is retained. */
export function preparePlaceDetailNearbySession(
  session: ChatPlanningSession,
  intent: NearbyPlaceIntent,
): ChatPlanningSession {
  return {
    ...ensurePlaceFocusRecommendationScope(sessionWithPlaceDetailSearchCenter(session), intent),
    activeChatIntent: intent,
    activeCategoryIntent:
      intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction",
    phase: "recommend",
  };
}

export function buildPlaceDetailFollowUpReply(
  intent: PlaceDetailFollowUpIntent,
  session: ChatPlanningSession,
): string | null {
  const name = session.placeDetailFocus
    ? placeDisplayName(session.placeDetailFocus)
    : "這個地點";

  switch (intent) {
    case "add_to_trip":
      return `好的，我先把「${name}」記下來。你還想再接咖啡、宵夜，或直接排成今晚的小路線？`;
    case "view_route":
      return `你可以點上方「${name}」卡片裡的查看路線；若要我幫你串下一站，跟我說想接咖啡、宵夜或散步。`;
    case "nearby_cafe":
      return `好，我以「${name}」為中心幫你找附近咖啡廳。`;
    case "nearby_late_snack":
      return `好，我以「${name}」為中心幫你找附近餐廳。`;
    default:
      return null;
  }
}
