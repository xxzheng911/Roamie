/**
 * RAOS Conversation Engine — Recommendation Session
 * Preserves topic/intent/pool/cursor so「還有嗎」continues instead of restarting.
 */
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import { parseChatPlaceIntents } from "@/lib/ai/chat-place-intent";
import { isRefreshRecommendationsRequest } from "@/lib/ai/chat-recommendation-refresh";
import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ShoppingCoverageState } from "@/lib/ai/shopping-query-queue";
import type { PersonalizationSnapshotV1 } from "@/lib/personalization/types";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { personalizationSnapshotInvalidationReason } from "@/lib/personalization/resolve-effective-preference";
import type { PersonalizationContextV1 } from "@/lib/personalization/types";
import type { NearbyGeographicScopeAuthority } from "@/lib/ai/nearby-geographic-scope";

/** Generic / shopping fallback. Not the destination-category UI contract. */
export const RECOMMENDATION_BATCH_SIZE = 4;

/** Destination-category UI cards per turn (cafe / restaurant / attraction). Independent of session pool size. */
export const DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE = 3;

export function defaultRecommendationDisplayBatchSize(
  topic: ChatPlaceCategoryIntent,
): number {
  return topic === "shopping"
    ? RECOMMENDATION_BATCH_SIZE
    : DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE;
}

export function resolveRecommendationDisplayBatchSize(
  session: Pick<ConversationRecommendationSession, "topic" | "displayBatchSize">,
  override?: number,
): number {
  if (override != null && override > 0) return override;
  if (session.displayBatchSize != null && session.displayBatchSize > 0) {
    return session.displayBatchSize;
  }
  return defaultRecommendationDisplayBatchSize(session.topic);
}

export function isUsableSearchCentroid(
  centroid?: { lat?: number | null; lng?: number | null } | null,
): centroid is { lat: number; lng: number } {
  return (
    centroid != null &&
    typeof centroid.lat === "number" &&
    typeof centroid.lng === "number" &&
    Number.isFinite(centroid.lat) &&
    Number.isFinite(centroid.lng) &&
    !(centroid.lat === 0 && centroid.lng === 0)
  );
}

export function remainingRecommendationPoolCount(
  session: ConversationRecommendationSession | null | undefined,
): number {
  if (!session) return 0;
  return Math.max(0, session.pool.length - session.cursor);
}

export type RecommendationSearchScope = "area" | "city" | "district" | "current_location";

function shoppingCanonicalKey(place: {
  name?: string | null;
  placeName?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
}): string {
  const id = (place.googlePlaceId ?? place.placeId ?? "").trim();
  if (id) return `id:${id}`;
  const name = normalizePlaceName(place.placeName ?? place.name ?? "");
  return name ? `n:${name}` : "";
}

export type ConversationRecommendationSession = {
  sessionId: string;
  destination: string;
  parentCity?: string;
  area?: string;
  searchScope?: RecommendationSearchScope;
  /** Active recommendation topic (shopping / cafe / attraction …) */
  topic: ChatPlaceCategoryIntent;
  returnedPlaceIds: string[];
  /** Canonical keys for returned places (dedupe across follow-up searches) */
  returnedCanonicalKeys?: string[];
  /** Soft brand keys already shown — de-prioritize, do not hard-exclude */
  returnedBrandKeys?: string[];
  /** Full ordered candidate pool for this topic */
  pool: RoamieRecommendationItem[];
  /** Next index into `pool` to return */
  cursor: number;
  /** UI cards per turn — independent of `pool.length`. */
  displayBatchSize?: number;
  /** Shopping query strings already used */
  usedQueries?: string[];
  /** Next Shopping Query Queue page index */
  nextQueryCursor?: number;
  /** 0-based recommendation page (each「還有嗎」increments) */
  recommendationPage?: number;
  /** True when shopping query queue is exhausted and no more new places */
  exhausted?: boolean;
  /** Non-shopping continuation search round. */
  continuationSearchRound?: number;
  /** Stable IDs of category-correct continuation attempts already executed. */
  continuationUsedAttemptIds?: string[];
  /** ISO timestamp when shopping follow-up was marked exhausted */
  exhaustedAt?: string;
  /** City used as Places query prefix (e.g. 札幌 when destination is 北海道) */
  activeSearchCity?: string;
  searchRegionLabel?: string;
  searchCentroid?: { lat: number; lng: number };
  searchRadius?: number;
  geoClusterIndex?: number;
  geoClusterLabel?: string;
  /** Valid shopping candidates beyond the UI batch — consume before Places API */
  shoppingCandidateReserve?: RoamieRecommendationItem[];
  /** Covered shopping types / clusters for follow-up query planning */
  shoppingCoverage?: ShoppingCoverageState;
  createdAt: string;
  updatedAt: string;
  personalizationSnapshot?: PersonalizationSnapshotV1;
  geographicScope?: NearbyGeographicScopeAuthority;
};

export type ConversationRecommendationContext = {
  destination?: string;
  tripDays?: number;
  travelDates?: { start?: string; end?: string };
  currentTopic?: ChatPlaceCategoryIntent;
  /** Accumulated travel intents for this conversation (Shopping + Cafe …) */
  travelIntents: ChatPlaceCategoryIntent[];
  currentIntent?: ChatPlaceCategoryIntent;
  recommendationType?: ChatPlaceCategoryIntent;
  recommendationCursor?: number;
  conversationStage?: string;
};

function placeIdOf(item: RoamieRecommendationItem): string {
  const ext = item as RoamieRecommendationItem & { placeId?: string };
  return (item.googlePlaceId ?? ext.placeId ?? item.name ?? "").trim();
}

export function createRecommendationSession(params: {
  destination: string;
  topic: ChatPlaceCategoryIntent;
  pool: RoamieRecommendationItem[];
  batchSize?: number;
  usedQueries?: string[];
  nextQueryCursor?: number;
  recommendationPage?: number;
  activeSearchCity?: string;
  parentCity?: string;
  area?: string;
  searchScope?: RecommendationSearchScope;
  searchRegionLabel?: string;
  searchCentroid?: { lat: number; lng: number };
  searchRadius?: number;
  geoClusterIndex?: number;
  geoClusterLabel?: string;
  shoppingCandidateReserve?: RoamieRecommendationItem[];
  shoppingCoverage?: ShoppingCoverageState;
  personalizationSnapshot?: PersonalizationSnapshotV1;
  geographicScope?: NearbyGeographicScopeAuthority;
}): { session: ConversationRecommendationSession; batch: RoamieRecommendationItem[] } {
  const now = new Date().toISOString();
  const batchSize =
    params.batchSize ?? defaultRecommendationDisplayBatchSize(params.topic);
  const pool = dedupePool(params.pool);
  const batch = pool.slice(0, batchSize);
  const reserve =
    params.shoppingCandidateReserve ??
    (params.topic === "shopping" ? pool.slice(batchSize) : []);
  const returnedPlaceIds = batch.map(placeIdOf).filter(Boolean);
  const returnedCanonicalKeys = batch.map(shoppingCanonicalKey).filter((k) => k !== "n:");
  return {
    session: {
      sessionId: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      destination: params.destination.trim(),
      parentCity: params.parentCity?.trim() || undefined,
      area: params.area?.trim() || undefined,
      searchScope: params.searchScope,
      topic: params.topic,
      returnedPlaceIds,
      returnedCanonicalKeys,
      pool,
      cursor: batch.length,
      displayBatchSize: batchSize,
      usedQueries: params.usedQueries ?? [],
      nextQueryCursor: params.nextQueryCursor ?? (params.topic === "shopping" ? 0 : 0),
      recommendationPage: params.recommendationPage ?? 0,
      exhausted: false,
      activeSearchCity: params.activeSearchCity,
      searchRegionLabel: params.searchRegionLabel ?? params.destination.trim(),
      searchCentroid: params.searchCentroid,
      searchRadius: params.searchRadius,
      geoClusterIndex: params.geoClusterIndex,
      geoClusterLabel: params.geoClusterLabel,
      shoppingCandidateReserve:
        params.topic === "shopping" ? dedupePool(reserve) : undefined,
      shoppingCoverage: params.shoppingCoverage,
      personalizationSnapshot: params.personalizationSnapshot,
      geographicScope: params.geographicScope,
      createdAt: now,
      updatedAt: now,
    },
    batch,
  };
}

function dedupePool(items: RoamieRecommendationItem[]): RoamieRecommendationItem[] {
  const seen = new Set<string>();
  const out: RoamieRecommendationItem[] = [];
  for (const item of items) {
    const id = placeIdOf(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** Continue from cursor — no re-search when pool still has items. */
export function continueRecommendation(
  session: ConversationRecommendationSession,
  batchSize = resolveRecommendationDisplayBatchSize(session),
  currentPersonalization?: PersonalizationContextV1,
): {
  session: ConversationRecommendationSession;
  batch: RoamieRecommendationItem[];
  exhausted: boolean;
} {
  const invalidationReason =
    session.personalizationSnapshot && currentPersonalization
      ? personalizationSnapshotInvalidationReason(session.personalizationSnapshot, currentPersonalization)
      : null;
  if (invalidationReason) {
    const invalidated = {
      ...session,
      pool: session.pool.slice(0, session.cursor),
      exhausted: true,
      updatedAt: new Date().toISOString(),
    };
    devVerboseInfo("[PLUS_PERSONALIZATION_CONTINUATION]", {
      sessionId: session.sessionId,
      contractVersion: session.personalizationSnapshot?.contractVersion ?? "",
      poolCount: session.pool.length,
      cursor: session.cursor,
      profileTier: currentPersonalization.profileTier,
      profileVersion: currentPersonalization.profileVersion ?? "",
      sessionPreferenceVersion: currentPersonalization.sessionPreferenceVersion,
      snapshotReused: false,
      snapshotInvalidated: true,
      invalidationReason,
      displayedPlaceIds: session.returnedPlaceIds,
    });
    return { session: invalidated, batch: [], exhausted: true };
  }
  const start = session.cursor;
  devVerboseInfo("[PLUS_PERSONALIZATION_CONTINUATION]", {
    sessionId: session.sessionId,
    contractVersion: session.personalizationSnapshot?.contractVersion ?? "",
    poolCount: session.pool.length,
    cursor: session.cursor,
    profileTier: session.personalizationSnapshot?.profileTier ?? "free",
    profileVersion: session.personalizationSnapshot?.profileVersion ?? "",
    sessionPreferenceVersion: session.personalizationSnapshot?.sessionPreferenceVersion ?? 0,
    snapshotReused: Boolean(session.personalizationSnapshot),
    snapshotInvalidated: false,
    invalidationReason: "",
    displayedPlaceIds: session.returnedPlaceIds,
  });
  const batch = session.pool.slice(start, start + batchSize);
  if (!batch.length) {
    return { session, batch: [], exhausted: true };
  }
  const returnedPlaceIds = [
    ...session.returnedPlaceIds,
    ...batch.map(placeIdOf).filter(Boolean),
  ];
  const returnedCanonicalKeys = [
    ...(session.returnedCanonicalKeys ?? []),
    ...batch.map(shoppingCanonicalKey).filter((k) => k !== "n:"),
  ];
  const next: ConversationRecommendationSession = {
    ...session,
    returnedPlaceIds: [...new Set(returnedPlaceIds)],
    returnedCanonicalKeys: [...new Set(returnedCanonicalKeys)],
    cursor: start + batch.length,
    updatedAt: new Date().toISOString(),
  };
  return { session: next, batch, exhausted: next.cursor >= next.pool.length };
}

/** Replace topic pool (topic switch) while keeping destination context. */
export function switchRecommendationTopic(params: {
  previous?: ConversationRecommendationSession | null;
  destination: string;
  topic: ChatPlaceCategoryIntent;
  pool: RoamieRecommendationItem[];
  batchSize?: number;
}): { session: ConversationRecommendationSession; batch: RoamieRecommendationItem[] } {
  return createRecommendationSession({
    destination: params.destination,
    topic: params.topic,
    pool: params.pool,
    batchSize: params.batchSize,
  });
}

/** Append newly fetched places after pool exhaustion; advance cursor with a new batch. */
export function extendRecommendationPool(
  session: ConversationRecommendationSession,
  more: RoamieRecommendationItem[],
  batchSize = resolveRecommendationDisplayBatchSize(session),
): {
  session: ConversationRecommendationSession;
  batch: RoamieRecommendationItem[];
  exhausted: boolean;
} {
  const seen = new Set(session.pool.map(placeIdOf).filter(Boolean));
  for (const id of session.returnedPlaceIds) seen.add(id);
  const appended: RoamieRecommendationItem[] = [];
  for (const item of more) {
    const id = placeIdOf(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    appended.push(item);
  }
  if (!appended.length) {
    return { session, batch: [], exhausted: true };
  }
  const pool = [...session.pool, ...appended];
  const start = session.cursor;
  const batch = pool.slice(start, start + batchSize);
  const returnedPlaceIds = [
    ...session.returnedPlaceIds,
    ...batch.map(placeIdOf).filter(Boolean),
  ];
  const returnedCanonicalKeys = [
    ...(session.returnedCanonicalKeys ?? []),
    ...batch.map(shoppingCanonicalKey).filter((k) => k !== "n:"),
  ];
  const next: ConversationRecommendationSession = {
    ...session,
    pool,
    returnedPlaceIds: [...new Set(returnedPlaceIds)],
    returnedCanonicalKeys: [...new Set(returnedCanonicalKeys)],
    cursor: start + batch.length,
    updatedAt: new Date().toISOString(),
  };
  return {
    session: next,
    batch,
    exhausted: next.cursor >= next.pool.length && appended.length < batchSize,
  };
}

/** Patch shopping query-queue fields after a follow-up Places Search. */
export function patchShoppingRecommendationSession(
  session: ConversationRecommendationSession,
  patch: {
    usedQueries?: string[];
    nextQueryCursor?: number;
    recommendationPage?: number;
    exhausted?: boolean;
    exhaustedAt?: string | null;
    returnedPlaceIds?: string[];
    returnedCanonicalKeys?: string[];
    returnedBrandKeys?: string[];
    pool?: RoamieRecommendationItem[];
    cursor?: number;
    activeSearchCity?: string;
    searchRegionLabel?: string;
    searchCentroid?: { lat: number; lng: number };
    searchRadius?: number;
    geoClusterIndex?: number;
    geoClusterLabel?: string;
    shoppingCandidateReserve?: RoamieRecommendationItem[];
    shoppingCoverage?: ShoppingCoverageState;
  },
): ConversationRecommendationSession {
  const next: ConversationRecommendationSession = {
    ...session,
    ...patch,
    usedQueries: patch.usedQueries
      ? [...new Set([...(session.usedQueries ?? []), ...patch.usedQueries])]
      : session.usedQueries,
    returnedPlaceIds: patch.returnedPlaceIds
      ? [...new Set(patch.returnedPlaceIds)]
      : session.returnedPlaceIds,
    returnedCanonicalKeys: patch.returnedCanonicalKeys
      ? [...new Set(patch.returnedCanonicalKeys)]
      : session.returnedCanonicalKeys,
    returnedBrandKeys: patch.returnedBrandKeys
      ? [...new Set(patch.returnedBrandKeys)]
      : session.returnedBrandKeys,
    shoppingCandidateReserve:
      patch.shoppingCandidateReserve !== undefined
        ? patch.shoppingCandidateReserve
        : session.shoppingCandidateReserve,
    shoppingCoverage: patch.shoppingCoverage ?? session.shoppingCoverage,
    updatedAt: new Date().toISOString(),
  };
  if (patch.exhaustedAt === null) {
    delete next.exhaustedAt;
  } else if (typeof patch.exhaustedAt === "string") {
    next.exhaustedAt = patch.exhaustedAt;
  }
  if (patch.exhausted === false) {
    next.exhausted = false;
    delete next.exhaustedAt;
  }
  return next;
}

export function resolveActiveCategoryIntent(
  session: ChatPlanningSession,
): ChatPlaceCategoryIntent | undefined {
  if (session.recommendationSession?.topic) return session.recommendationSession.topic;
  if (session.activeCategoryIntent) return session.activeCategoryIntent;
  if (session.activeChatIntent === "cafe") return "cafe";
  if (session.activeChatIntent === "restaurant") return "restaurant";
  // Do not collapse shopping → attraction via activeChatIntent alone.
  return undefined;
}

export function addTravelIntent(
  intents: ChatPlaceCategoryIntent[] | undefined,
  next: ChatPlaceCategoryIntent,
): ChatPlaceCategoryIntent[] {
  const base = intents ?? [];
  if (base.includes(next)) return base;
  return [...base, next];
}

/** True when user asks for more of the same recommendation (not a new category). */
export function isContinueRecommendationRequest(
  text: string,
  session: ChatPlanningSession,
): boolean {
  if (!isRefreshRecommendationsRequest(text) && !matchesContinueRecommendationGrammar(text)) {
    return false;
  }
  const topicSwitch = detectTopicSwitchIntent(text, resolveActiveCategoryIntent(session));
  // Same-topic category mention (「還有其他咖啡廳嗎」 while on cafe) stays continue.
  return topicSwitch == null;
}

/** Detect category topic switch (Shopping → Cafe). Same topic returns null. */
export function detectTopicSwitchIntent(
  text: string,
  currentTopic?: ChatPlaceCategoryIntent | null,
): ChatPlaceCategoryIntent | null {
  const intents = parseChatPlaceIntents(text);
  if (!intents.length) return null;
  const next = intents[0]!;
  if (currentTopic && next === currentTopic) return null;
  return next;
}

export function buildContinueRecommendationSummary(
  topic: ChatPlaceCategoryIntent,
  picks: { name: string }[],
): string {
  const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  if (topic === "shopping") {
    return ["好的，再幫你找幾個購物／商圈：", "", list, "", "想加進行程的話跟我說。"].join("\n");
  }
  if (topic === "cafe") {
    return ["好的，再幫你找幾間咖啡廳：", "", list, "", "有特別偏好的話再跟我說。"].join("\n");
  }
  if (topic === "restaurant") {
    return ["了解，這次再換幾間餐廳：", "", list, "", "想調整菜系或預算都可以說。"].join("\n");
  }
  return ["好的，再幫你找幾個不同的地方：", "", list, "", "想再加進行程的話跟我說。"].join("\n");
}

export function toRecommendationContext(
  session: ChatPlanningSession,
): ConversationRecommendationContext {
  const topic = resolveActiveCategoryIntent(session);
  const tc = session.travelContext;
  return {
    destination:
      tc?.destination ??
      session.tripPlanningContext?.destination ??
      session.tripDestination?.city ??
      session.recommendationSession?.destination,
    tripDays: session.tripDays ?? tc?.days,
    travelDates: {
      start: session.tripStartDate ?? tc?.startDate ?? tc?.suggestedStartDate,
      end: session.tripEndDate ?? tc?.endDate,
    },
    currentTopic: topic,
    travelIntents: session.travelIntents ?? (topic ? [topic] : []),
    currentIntent: topic,
    recommendationType: topic,
    recommendationCursor: session.recommendationSession?.cursor,
    conversationStage: session.phase,
  };
}
