import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isNearbyPlaceIntent,
  type ChatIntent,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";
import { isExclusionReply } from "@/lib/ai/recommendation-exclusion";
import {
  placeDisplayName,
  roamieRecToChatItem,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import {
  collectRecommendedNormalizedNames,
  extractPlaceIds,
  normalizePlaceName,
} from "@/lib/place-planning-memory";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { extractAllRecommendedFromMsgs } from "@/lib/ai/trip-planning-follow-up";
import { isAffirmativeReply } from "@/lib/ai/chat-conversation-state";
import { NO_MORE_RECOMMENDATIONS_MESSAGE } from "@/lib/ai/place-recommendation-rules";

export const CHAT_STATE_MACHINE_RECOVERY_MESSAGE =
  "我剛剛整理時卡住了，我再幫你重新推薦一次。";

const ALTERNATIVE_RECOMMENDATION_OFFER_RE =
  /要不要換成美食、咖啡廳或室內景點/;

/** 上一輪 AI 是否在詢問改推美食 / 咖啡 / 室內 */
export function isAlternativeRecommendationOffer(content: string | undefined | null): boolean {
  const t = content?.trim() ?? "";
  if (!t) return false;
  return t === NO_MORE_RECOMMENDATIONS_MESSAGE || ALTERNATIVE_RECOMMENDATION_OFFER_RE.test(t);
}

/** 使用者同意改推美食 / 咖啡 / 室內（好、可以、嗯、對…） */
export function isAcceptAlternativeRecommendationReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isAffirmativeReply(t)) return true;
  return /^(ok|OK)$/i.test(t);
}

export function shouldAcceptAlternativeRecommendations(
  msgs: ChatMsg[],
  userText: string,
): boolean {
  const lastAssistant = [...msgs]
    .reverse()
    .find((m) => m.role === "assistant" && m.content?.trim());
  if (!lastAssistant?.content) return false;
  return (
    isAlternativeRecommendationOffer(lastAssistant.content) &&
    isAcceptAlternativeRecommendationReply(userText)
  );
}

const REFRESH_REQUEST_RE =
  /(還有嗎|還有沒有|還有其他|有其他嗎|再推薦|再找找|再找一些|再幫我找|再給我|換其他|換一批|換一個|換別的|有別的嗎|提供其他|其他推薦|不喜歡|不要這些|不要這幾個|不想要這些|不喜歡這些|別的景點|其他景點|還能推薦|再來幾個)/;

const REJECT_CURRENT_BATCH_RE =
  /(不要這些|不要這幾個|不想要這些|不喜歡這些|換掉這些|不要剛剛|不要上面)/;

const PREFERENCE_REFETCH_RE =
  /(想|要|偏好|改|換成).*(室內|戶外|室外|安靜|熱鬧)|^(室內|戶外|室外)/;

/** 使用者要求換一批 / 其他推薦 / 還有嗎 */
export function isRefreshRecommendationsRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return REFRESH_REQUEST_RE.test(t);
}

/** intent = MORE_PLACE_RECOMMENDATIONS */
export function isMorePlaceRecommendationsIntent(text: string): boolean {
  return isRefreshRecommendationsRequest(text);
}

export function logChatMorePlacesIntent(text: string): void {
  logAiPipeline("[CHAT_MORE_PLACES_INTENT]", text.slice(0, 80));
}

export function logChatMorePlacesContext(context: {
  destination?: string;
  category?: string;
  tripPurpose?: string;
}): void {
  logAiPipeline("[CHAT_MORE_PLACES_CONTEXT]", JSON.stringify(context));
}

export function logChatMorePlacesExcludeIds(count: number): void {
  logAiPipeline("[CHAT_MORE_PLACES_EXCLUDE_IDS]", count);
}

export function logChatMorePlacesFetchCount(count: number): void {
  logAiPipeline("[CHAT_MORE_PLACES_FETCH_COUNT]", count);
}

export function logChatMorePlacesNewCount(count: number): void {
  logAiPipeline("[CHAT_MORE_PLACES_NEW_COUNT]", count);
}

export function logChatMorePlacesRendered(count: number): void {
  logAiPipeline("[CHAT_MORE_PLACES_RENDERED]", count);
}

export function logChatMorePlacesNoResultAllowed(allowed: boolean): void {
  logAiPipeline("[CHAT_MORE_PLACES_NO_RESULT_ALLOWED]", allowed);
}

export function isRejectCurrentBatch(text: string): boolean {
  return REJECT_CURRENT_BATCH_RE.test(text.trim());
}

export function shouldRefetchOnPreferenceChange(
  text: string,
  session: ChatPlanningSession,
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!session.recommendedPlaces.length && !(session.recommendedPlaceIds?.length ?? 0)) {
    return false;
  }
  if (isExclusionReply(t)) return true;
  return PREFERENCE_REFETCH_RE.test(t);
}

export function extractRecommendedFromMsgs(msgs: ChatMsg[]): ReturnType<typeof roamieRecToChatItem>[] {
  const all = extractAllRecommendedFromMsgs(msgs);
  if (all.length) return all;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.role === "assistant" && m.roamie?.recommendations?.length) {
      return m.roamie.recommendations.map((rec) => roamieRecToChatItem(rec));
    }
  }
  return [];
}

export function hasPriorPlaceRecommendations(
  session: ChatPlanningSession,
  msgs?: ChatMsg[],
): boolean {
  if (
    session.recommendedPlaces.length > 0 ||
    (session.recommendedPlaceIds?.length ?? 0) > 0 ||
    (session.recommendedNormalizedNames?.length ?? 0) > 0
  ) {
    return true;
  }
  if (msgs?.some((m) => (m.roamie?.recommendations?.length ?? 0) > 0)) {
    return true;
  }
  return Boolean(
    session.travelContext?.mustVisitGenerated ||
      session.travelContext?.tripPurpose === "must_visit_places" ||
      session.travelContext?.tripPurpose === "refresh_recommendations" ||
      session.travelContext?.tripPurpose === "more_place_recommendations",
  );
}

/** 是否應重新呼叫 Places API（排除已推薦） */
export function shouldRefetchPlaces(
  text: string,
  session: ChatPlanningSession,
  context?: CanonicalTravelContext,
  msgs?: ChatMsg[],
): boolean {
  if (!isRefreshRecommendationsRequest(text) && !shouldRefetchOnPreferenceChange(text, session)) {
    return false;
  }
  if (!hasPriorPlaceRecommendations(session, msgs)) return false;

  const hasDestination = Boolean(
    context?.destination?.trim() ||
      session.tripPlanningContext?.destination?.trim() ||
      session.tripDestination?.city?.trim(),
  );
  const hasNearbyIntent = Boolean(
    session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent),
  );
  const hasLocation =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);

  return hasDestination || hasNearbyIntent || hasLocation;
}

export function resolveRefreshNearbyIntent(
  session: ChatPlanningSession,
  context: CanonicalTravelContext,
): NearbyPlaceIntent | null {
  if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
    return session.activeChatIntent;
  }
  if (context.setting === "室內" || /室內/.test(context.mood ?? "")) {
    if (session.activeChatIntent === "cafe") return "cafe";
    return "attraction";
  }
  if (/咖啡/.test(context.mood ?? "") || context.interests?.includes("咖啡")) return "cafe";
  if (/美食|餐廳|吃/.test(context.mood ?? "") || context.interests?.includes("美食")) {
    return "restaurant";
  }
  return "attraction";
}

/** 套用「換一批」語意：拒絕當批、標記 refresh purpose */
export function applyRefreshRecommendationSession(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  let next = session;

  if (isRejectCurrentBatch(text)) {
    const rejected = new Set(session.rejectedPlaceNames ?? []);
    for (const place of session.recommendedPlaces) {
      rejected.add(placeDisplayName(place));
    }
    next = { ...next, rejectedPlaceNames: [...rejected] };
  }

  const travelContext = {
    ...(next.travelContext ?? { interests: [] }),
    tripPurpose: "more_place_recommendations" as const,
    mustVisitGenerated: false,
  };

  return {
    ...next,
    phase: "recommend",
    travelContext,
  };
}

export function collectExcludePlaceIds(session: ChatPlanningSession, msgs?: ChatMsg[]): string[] {
  const fromSession = session.recommendedPlaceIds ?? session.usedPlaceIds ?? [];
  const fromPlaces = extractPlaceIds(session.recommendedPlaces);
  const fromSelected = extractPlaceIds(session.selectedPlaces ?? []);
  const fromMsgs = extractPlaceIds(extractAllRecommendedFromMsgs(msgs ?? []));
  const fromStops = extractPlaceIds(session.plannedStops ?? []);
  return [...new Set([...fromSession, ...fromPlaces, ...fromSelected, ...fromMsgs, ...fromStops])];
}

/** 切換行程風格時：只排除相同 Google place_id，不因名稱或 fallback id 擋住新風格 */
export function collectHardDuplicatePlaceIds(
  session: ChatPlanningSession,
  msgs?: ChatMsg[],
): string[] {
  return collectExcludePlaceIds(session, msgs).filter(isHardGooglePlaceId);
}

export function collectBlockedCoreNames(
  session: ChatPlanningSession,
  msgs?: ChatMsg[],
): string[] {
  const names = new Set(collectRecommendedNormalizedNames(session));
  for (const place of extractAllRecommendedFromMsgs(msgs ?? [])) {
    const core = normalizePlaceName(place.name);
    if (core) names.add(core);
  }
  for (const place of session.recommendedPlaces) {
    const core = normalizePlaceName(place.name);
    if (core) names.add(core);
  }
  for (const name of session.usedPlaceNames ?? []) {
    if (name) names.add(name);
  }
  return [...names];
}

export function buildAlternativeRecommendationSummary(picks: { name: string }[]): string {
  if (!picks.length) {
    return "我暫時沒連上即時地點資料，你可以稍後再試或換個說法。";
  }
  const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  return [
    "好的，我幫你找美食、咖啡廳和室內景點：",
    "",
    list,
    "",
    "有想加進行程的跟我說。",
  ].join("\n");
}

export function buildRefreshRecommendationSummary(
  picks: { name: string }[],
  intent: ChatIntent,
): string {
  const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  if (intent === "cafe") {
    return ["好的，換一批咖啡廳給你：", "", list, "", "有特別偏好的話再跟我說。"].join("\n");
  }
  if (intent === "restaurant") {
    return ["了解，這次換幾間不同的餐廳：", "", list, "", "想調整菜系或預算都可以說。"].join("\n");
  }
  return ["好的，再幫你找幾個不同的地方：", "", list, "", "想再加進行程的話跟我說。"].join("\n");
}
