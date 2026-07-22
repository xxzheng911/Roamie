import type { RoamieRecommendationItem } from "@/lib/ai/types";
import {
  isRefreshRecommendationsRequest,
  isRejectCurrentBatch,
} from "@/lib/ai/chat-recommendation-refresh";
import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { loadChatSession, roamieRecToChatItem, createEmptySession, type ChatPlaceItem } from "@/lib/chat-session";
import { alignChatRecommendationCount } from "@/lib/chat-display-recommendations";
import { isAffirmativeReply } from "@/lib/ai/chat-conversation-state";
import { placeIdentityKey, normalizePlaceName } from "@/lib/place-planning-memory";
import type { TripAddPlaceContext, TripAddPlaceFollowUpIntent } from "@/lib/trip/trip-add-place-session";
import { initTripAddPlaceSearchCenter } from "@/lib/trip/trip-add-place-search";
import {
  appendTripPlaceDedupState,
  buildTripAddPlaceDedupRegistry,
  dedupeTripAddPlaceCandidates,
  isTripPlaceDuplicate,
  tripCanonicalPlaceKey,
} from "@/lib/trip/trip-add-place-dedup";

export const TRIP_ADD_PLACE_BATCH_SIZE = 5;
export const TRIP_ADD_PLACE_MAX_CANDIDATES = 30;

/** 行程加點：擴大搜尋半徑（公尺） */
export const TRIP_ADD_PLACE_RADIUS_STEPS_M = [1_000, 3_000, 5_000, 10_000] as const;

export const TRIP_ADD_PLACE_SEARCH_TIMEOUT_MS = 25_000;

export const TRIP_ADD_PLACE_EXHAUSTED_MESSAGE =
  "目前附近與順路的高品質景點都推薦完了。\n如果你願意多搭乘 10～15 分鐘交通，\n我可以再幫你找更多。";

export const TRIP_ADD_PLACE_ERROR_RECOVERY_MESSAGE =
  "我剛剛整理推薦時卡住了，\n不過我還可以繼續幫你找附近其他熱門景點。";

export type TripAddPlaceRecommendationSession = {
  sessionId: string;
  tripId: string;
  dayIndex: number;
  destination: string;
  intent: TripAddPlaceFollowUpIntent;
  allCandidates: RoamieRecommendationItem[];
  shownPlaceIds: string[];
  /** canonical slug（跨語系去重） */
  shownCanonicalKeys?: string[];
  /** ~100m 網格 */
  shownGeoCells?: string[];
  /** alias token */
  shownAliases?: string[];
  /** 使用者已加入行程的地點，永遠不再推薦 */
  addedPlaceIds: string[];
  rejectedPlaceIds: string[];
  /** 進入推薦時行程內已有地點（id 或 n:name） */
  currentTripPlaceIds: string[];
  batchSize: number;
  batchIndex: number;
  exhausted: boolean;
  /** 0 = 1km, 1 = 3km, 2 = 5km, 3 = 10km */
  searchRadiusStep: number;
  /** 目前搜尋中心（隨半徑圈外擴而移動） */
  searchCenterLat?: number;
  searchCenterLng?: number;
  searchCenterLabel?: string;
  searchCenterPlaceId?: string;
  searchCenterPlaceIds?: string[];
  originLat?: number;
  originLng?: number;
  awaitingExpandConsent: boolean;
  createdAt: string;
};

export function isTripAddPlaceMoreRecommendationsRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    isRefreshRecommendationsRequest(t) ||
    matchesContinueRecommendationGrammar(t) ||
    /想看更多|還有其他選擇|还有其他选择/.test(t)
  );
}

/** 合併 React state 與 sessionStorage，避免 fromTripAddPlace 遺失導致誤走 AI */
export function resolveTripAddPlaceChatSession(
  reactSession: ChatPlanningSession,
  storedSession?: ChatPlanningSession,
): ChatPlanningSession | null {
  const stored =
    storedSession ?? (typeof window !== "undefined" ? loadChatSession() : createEmptySession());

  const reactRec = reactSession.tripAddPlaceRecommendationSession;
  const storedRec = stored.tripAddPlaceRecommendationSession;
  const mergedRec = mergeTripAddPlaceRecommendationSessions(reactRec, storedRec);

  const pick = [reactSession, stored].find(
    (s) => s.fromTripAddPlace && s.tripAddPlaceContext,
  );
  if (pick) {
    const other = pick === reactSession ? stored : reactSession;
    return {
      ...stored,
      ...reactSession,
      fromTripAddPlace: true,
      tripAddPlaceContext: pick.tripAddPlaceContext ?? other.tripAddPlaceContext,
      tripAddPlaceHandoffDone: pick.tripAddPlaceHandoffDone ?? other.tripAddPlaceHandoffDone,
      tripAddPlaceRecommendationSession: mergedRec,
      conversationMode: "trip_add_place",
    };
  }

  const byMode = [reactSession, stored].find(
    (s) => s.conversationMode === "trip_add_place" && s.tripAddPlaceContext,
  );
  if (byMode) {
    return { ...byMode, fromTripAddPlace: true, conversationMode: "trip_add_place" };
  }

  return null;
}

export function isTripAddPlaceExpandSearchConsent(
  userText: string,
  msgs: import("@/lib/chat-history").ChatMsg[],
  recSession?: TripAddPlaceRecommendationSession | null,
): boolean {
  const t = userText.trim();
  if (!t || !isAffirmativeReply(t)) return false;
  if (recSession?.awaitingExpandConsent) return true;
  if (/(多搭|10.?15\s*分鐘|十五分鐘|十分鐘交通|願意多搭)/.test(t)) return true;
  const lastAssistant = [...msgs]
    .reverse()
    .find((m) => m.role === "assistant" && m.content?.trim());
  return Boolean(
    lastAssistant?.content?.includes("10～15 分鐘交通") ||
      lastAssistant?.content?.includes(TRIP_ADD_PLACE_EXHAUSTED_MESSAGE.slice(0, 12)),
  );
}

export function normalizeStoredPlaceId(id: string): string {
  const t = id.trim();
  if (!t) return "";
  if (t.startsWith("id:") || t.startsWith("na:") || t.startsWith("n:")) return t;
  return `id:${t}`;
}

export function placeIdFromRecommendation(
  rec: RoamieRecommendationItem | ChatPlaceItem,
): string {
  return placeIdentityKey(rec);
}

export function normalizeShownIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => normalizeStoredPlaceId(id)).filter(Boolean))];
}

export function tripPlaceIdsFromContext(ctx: TripAddPlaceContext): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const name of [
    ...ctx.existingPlaceNames,
    ...ctx.currentPlaces.map((p) => p.name),
  ]) {
    const n = normalizePlaceName(name);
    if (!n) continue;
    const key = `n:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export type TripAddPlaceBlockedSets = {
  placeIds: Set<string>;
  names: Set<string>;
  canonicalKeys: Set<string>;
};

export function buildTripAddPlaceBlockedSets(
  recSession: TripAddPlaceRecommendationSession | null | undefined,
  ctx?: TripAddPlaceContext | null,
): TripAddPlaceBlockedSets {
  const registry = buildTripAddPlaceDedupRegistry(recSession, ctx);
  return {
    placeIds: registry.placeIds,
    names: new Set(
      [...registry.canonicalKeys].map((k) => k.toLowerCase()),
    ),
    canonicalKeys: registry.canonicalKeys,
  };
}

export function isTripAddPlaceCandidateBlocked(
  rec: RoamieRecommendationItem | ChatPlaceItem,
  blocked: TripAddPlaceBlockedSets,
  registry?: ReturnType<typeof buildTripAddPlaceDedupRegistry>,
): boolean {
  if (registry && isTripPlaceDuplicate(rec, registry)) return true;

  const id = normalizeStoredPlaceId(placeIdFromRecommendation(rec));
  if (id && blocked.placeIds.has(id)) return true;

  const canonical = tripCanonicalPlaceKey(rec.placeName ?? rec.name);
  if (canonical && blocked.canonicalKeys.has(canonical)) return true;

  const name = normalizePlaceName(rec.placeName ?? rec.name);
  if (!name) return false;
  if (blocked.names.has(name)) return true;

  for (const tripName of blocked.names) {
    if (
      name.length >= 2 &&
      tripName.length >= 2 &&
      (name.includes(tripName) || tripName.includes(name))
    ) {
      return true;
    }
  }
  return false;
}

export function filterTripAddPlaceCandidates(
  candidates: RoamieRecommendationItem[],
  recSession: TripAddPlaceRecommendationSession | null | undefined,
  ctx?: TripAddPlaceContext | null,
): RoamieRecommendationItem[] {
  const registry = buildTripAddPlaceDedupRegistry(recSession, ctx);
  return candidates.filter((c) => !isTripPlaceDuplicate(c, registry));
}

export function collectBlockedPlaceIdsForSearch(
  recSession: TripAddPlaceRecommendationSession | null | undefined,
  ctx?: TripAddPlaceContext | null,
): string[] {
  const registry = buildTripAddPlaceDedupRegistry(recSession, ctx);
  return [...registry.placeIds];
}

export function dedupeCandidatesByPlaceId(
  candidates: RoamieRecommendationItem[],
): RoamieRecommendationItem[] {
  return dedupeTripAddPlaceCandidates(candidates, null, "by_place_id");
}

export function mergeTripAddPlaceRecommendationSessions(
  a?: TripAddPlaceRecommendationSession | null,
  b?: TripAddPlaceRecommendationSession | null,
): TripAddPlaceRecommendationSession | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;

  const allCandidates = dedupeCandidatesByPlaceId([...a.allCandidates, ...b.allCandidates]);
  const base = a.allCandidates.length >= b.allCandidates.length ? a : b;

  return slimRecommendationSession({
    ...base,
    sessionId: a.sessionId || b.sessionId,
    allCandidates,
    shownPlaceIds: normalizeShownIds([...a.shownPlaceIds, ...b.shownPlaceIds]),
    shownCanonicalKeys: [...new Set([...(a.shownCanonicalKeys ?? []), ...(b.shownCanonicalKeys ?? [])])],
    shownGeoCells: [...new Set([...(a.shownGeoCells ?? []), ...(b.shownGeoCells ?? [])])],
    shownAliases: [...new Set([...(a.shownAliases ?? []), ...(b.shownAliases ?? [])])],
    addedPlaceIds: normalizeShownIds([...(a.addedPlaceIds ?? []), ...(b.addedPlaceIds ?? [])]),
    rejectedPlaceIds: normalizeShownIds([...a.rejectedPlaceIds, ...b.rejectedPlaceIds]),
    currentTripPlaceIds: normalizeShownIds([
      ...(a.currentTripPlaceIds ?? []),
      ...(b.currentTripPlaceIds ?? []),
    ]),
    searchRadiusStep: Math.max(a.searchRadiusStep, b.searchRadiusStep),
    searchCenterLat: base.searchCenterLat ?? a.searchCenterLat ?? b.searchCenterLat,
    searchCenterLng: base.searchCenterLng ?? a.searchCenterLng ?? b.searchCenterLng,
    searchCenterLabel: base.searchCenterLabel ?? a.searchCenterLabel ?? b.searchCenterLabel,
    searchCenterPlaceId: base.searchCenterPlaceId ?? a.searchCenterPlaceId ?? b.searchCenterPlaceId,
    searchCenterPlaceIds: normalizeShownIds([
      ...(a.searchCenterPlaceIds ?? []),
      ...(b.searchCenterPlaceIds ?? []),
    ]),
    originLat: a.originLat ?? b.originLat,
    originLng: a.originLng ?? b.originLng,
    batchIndex: Math.max(a.batchIndex, b.batchIndex),
    exhausted: a.exhausted && b.exhausted,
    awaitingExpandConsent: a.awaitingExpandConsent || b.awaitingExpandConsent,
  });
}

export function syncShownPlaceIdsFromMessages(
  recSession: TripAddPlaceRecommendationSession,
  msgs: import("@/lib/chat-history").ChatMsg[],
): TripAddPlaceRecommendationSession {
  const fromMsgs: string[] = [];
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    for (const rec of m.roamie?.recommendations ?? []) {
      const id = normalizeStoredPlaceId(placeIdFromRecommendation(rec));
      if (id) fromMsgs.push(id);
    }
  }
  const shownPlaceIds = normalizeShownIds([...recSession.shownPlaceIds, ...fromMsgs]);
  let next = { ...recSession, shownPlaceIds };
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    const recs = [
      ...(m.roamie?.recommendations ?? []),
      ...(m.structuredPlaces?.map((p) => ({
        name: p.name,
        placeName: p.name,
        googlePlaceId: p.placeId,
        lat: p.lat,
        lng: p.lng,
        type: p.types[0] ?? "地點",
        address: p.address,
      })) ?? []),
    ] as RoamieRecommendationItem[];
    if (recs.length) next = appendTripPlaceDedupState(next, recs);
  }
  if (
    shownPlaceIds.length === recSession.shownPlaceIds.length &&
    (next.shownCanonicalKeys?.length ?? 0) === (recSession.shownCanonicalKeys?.length ?? 0)
  ) {
    return recSession;
  }
  return next;
}

export function refreshCurrentTripPlaceIds(
  recSession: TripAddPlaceRecommendationSession,
  ctx: TripAddPlaceContext,
): TripAddPlaceRecommendationSession {
  const currentTripPlaceIds = normalizeShownIds([
    ...(recSession.currentTripPlaceIds ?? []),
    ...tripPlaceIdsFromContext(ctx),
  ]);
  return { ...recSession, currentTripPlaceIds };
}

export function markTripAddPlaceAdded(
  session: ChatPlanningSession,
  rec: RoamieRecommendationItem | ChatPlaceItem,
): ChatPlanningSession {
  const recSession = session.tripAddPlaceRecommendationSession;
  if (!recSession) return session;

  const id = normalizeStoredPlaceId(placeIdFromRecommendation(rec));
  const addedPlaceIds = normalizeShownIds([...(recSession.addedPlaceIds ?? []), id]);
  const shownPlaceIds = normalizeShownIds([...recSession.shownPlaceIds, id]);

  return {
    ...session,
    tripAddPlaceRecommendationSession: appendTripPlaceDedupState(
      {
        ...recSession,
        addedPlaceIds,
        shownPlaceIds,
      },
      rec,
    ),
  };
}

export function logRecommendDedup(
  recSession: TripAddPlaceRecommendationSession | null | undefined,
  ctx: TripAddPlaceContext | null | undefined,
  label?: string,
): void {
  const remaining = recSession
    ? filterTripAddPlaceCandidates(recSession.allCandidates, recSession, ctx)
    : [];
  console.info("[RECOMMEND_DEDUP]", {
    label: label ?? "check",
    allCandidates: recSession?.allCandidates.length ?? 0,
    currentTripCount:
      (ctx?.currentPlaces.length ?? 0) + (ctx?.existingPlaceNames.length ?? 0),
    shownCount: recSession?.shownPlaceIds.length ?? 0,
    shownCanonicalCount: recSession?.shownCanonicalKeys?.length ?? 0,
    shownGeoCellCount: recSession?.shownGeoCells?.length ?? 0,
    addedCount: recSession?.addedPlaceIds?.length ?? 0,
    rejectedCount: recSession?.rejectedPlaceIds.length ?? 0,
    remainingCount: remaining.length,
    expandedRadius: TRIP_ADD_PLACE_RADIUS_STEPS_M[recSession?.searchRadiusStep ?? 0],
  });
}

function newRecSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `trip-rec-${Date.now()}`;
  }
}

export function slimCandidateForStorage(rec: RoamieRecommendationItem): RoamieRecommendationItem {
  const ext = rec as RoamieRecommendationItem & { placeId?: string };
  return {
    name: rec.name,
    placeName: rec.placeName ?? rec.name,
    type: rec.type || "地點",
    description: (rec.description ?? rec.address ?? "").slice(0, 240),
    reason: (rec.reason ?? rec.description ?? "").slice(0, 240),
    estimatedTime: rec.estimatedTime ?? "1-2 小時",
    address: rec.address ?? "",
    lat: rec.lat ?? null,
    lng: rec.lng ?? null,
    googleMapsUrl: rec.googleMapsUrl ?? "",
    reasonSource: rec.reasonSource ?? "template",
    googlePlaceId: ext.googlePlaceId ?? ext.placeId ?? undefined,
    placeId: ext.placeId ?? ext.googlePlaceId ?? undefined,
    photoName: ext.photoName ?? null,
    rating: ext.rating ?? null,
    userRatingCount: ext.userRatingCount ?? null,
    openStatusLabel: rec.openStatusLabel,
    todayHoursLabel: rec.todayHoursLabel,
    closingSoonNote: rec.closingSoonNote,
    nextOpenHint: rec.nextOpenHint,
  };
}

export function slimRecommendationSession(
  rec: TripAddPlaceRecommendationSession,
): TripAddPlaceRecommendationSession {
  return {
    ...rec,
    allCandidates: rec.allCandidates.map(slimCandidateForStorage),
  };
}

export function createTripAddPlaceRecommendationSession(params: {
  ctx: TripAddPlaceContext;
  candidates: RoamieRecommendationItem[];
  intent: TripAddPlaceFollowUpIntent;
  firstBatch: RoamieRecommendationItem[];
}): TripAddPlaceRecommendationSession {
  const { ctx, candidates, intent, firstBatch } = params;
  const baseRegistry = buildTripAddPlaceDedupRegistry(null, ctx);
  const allCandidates = dedupeTripAddPlaceCandidates(
    candidates,
    baseRegistry,
    "create_session_pool",
  );
  const batchRegistry = buildTripAddPlaceDedupRegistry(null, ctx);
  const batch = dedupeTripAddPlaceCandidates(firstBatch, batchRegistry, "create_session_batch");

  const previewSession = appendTripPlaceDedupState(
    {
      sessionId: newRecSessionId(),
      tripId: ctx.tripId,
      dayIndex: ctx.dayIndex,
      destination: ctx.destination,
      intent,
      allCandidates: allCandidates.map(slimCandidateForStorage),
      shownPlaceIds: [],
      addedPlaceIds: [],
      rejectedPlaceIds: [],
      currentTripPlaceIds: tripPlaceIdsFromContext(ctx),
      batchSize: TRIP_ADD_PLACE_BATCH_SIZE,
      batchIndex: 1,
      exhausted: false,
      searchRadiusStep: 0,
      awaitingExpandConsent: false,
      createdAt: new Date().toISOString(),
    },
    batch,
  );
  const remainingAfterFirst = filterTripAddPlaceCandidates(allCandidates, previewSession, ctx);

  const draft = initTripAddPlaceSearchCenter(
    {
      ...previewSession,
      exhausted: remainingAfterFirst.length === 0,
      awaitingExpandConsent: remainingAfterFirst.length === 0,
    },
    ctx,
  );
  return draft;
}

export function getRemainingCandidates(
  recSession: TripAddPlaceRecommendationSession,
  ctx?: TripAddPlaceContext | null,
): RoamieRecommendationItem[] {
  return filterTripAddPlaceCandidates(recSession.allCandidates, recSession, ctx);
}

export function takeNextTripAddPlaceBatch(
  recSession: TripAddPlaceRecommendationSession,
  ctx?: TripAddPlaceContext | null,
): {
  batch: RoamieRecommendationItem[];
  session: TripAddPlaceRecommendationSession;
} {
  const remaining = getRemainingCandidates(recSession, ctx);
  const batch = remaining.slice(0, recSession.batchSize);
  const newShown = batch
    .map((r) => normalizeStoredPlaceId(placeIdFromRecommendation(r)))
    .filter(Boolean);
  const nextRemaining = remaining.slice(batch.length);

  return {
    batch,
    session: appendTripPlaceDedupState(
      {
        ...recSession,
        shownPlaceIds: normalizeShownIds([...recSession.shownPlaceIds, ...newShown]),
        batchIndex: recSession.batchIndex + 1,
        exhausted: nextRemaining.length === 0,
        awaitingExpandConsent: nextRemaining.length === 0,
      },
      batch,
    ),
  };
}

export function rejectLastShownBatch(
  recSession: TripAddPlaceRecommendationSession,
  lastBatchIds: string[],
): TripAddPlaceRecommendationSession {
  const reject = lastBatchIds.filter(Boolean);
  const rejectedPlaceIds = [...new Set([...recSession.rejectedPlaceIds, ...reject])];
  const shownPlaceIds = recSession.shownPlaceIds.filter((id) => !reject.includes(id));
  return { ...recSession, rejectedPlaceIds, shownPlaceIds };
}

function areaLabel(ctx: TripAddPlaceContext): string {
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  if (names.length > 0) return `${names.join("和")}周邊`;
  return ctx.destination;
}

export function buildTripAddPlaceBatchSummary(
  ctx: TripAddPlaceContext,
  recommendations: RoamieRecommendationItem[],
  opts?: { isFollowUp?: boolean; intent?: TripAddPlaceFollowUpIntent },
): string {
  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const area = areaLabel(ctx);
  const intent = opts?.intent ?? "attraction";

  if (!recommendations.length) {
    return TRIP_ADD_PLACE_EXHAUSTED_MESSAGE;
  }

  const list = recommendations.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const lead = opts?.isFollowUp
    ? intent === "cafe"
      ? `如果${dayLabel}在${area}，再幫你找這幾間順路的咖啡廳：`
      : intent === "restaurant"
        ? `如果${dayLabel}在${area}，再推薦這幾間順路餐廳：`
        : `如果${dayLabel}在${area}，再推薦這幾個順路景點：`
    : intent === "cafe"
      ? `如果${dayLabel}在${area}，這幾間咖啡廳順路又不會太趕：`
      : intent === "restaurant"
        ? `如果${dayLabel}在${area}，這幾間餐廳順路又不會太趕：`
        : `如果${dayLabel}在${area}，這幾個景點順路又不會太趕：`;

  return alignChatRecommendationCount(
    [lead, "", list, "", "想加入行程的話，直接點卡片就可以。"].join("\n"),
    recommendations.length,
  );
}

export function extractLastBatchPlaceIds(msgs: import("@/lib/chat-history").ChatMsg[]): string[] {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant") continue;
    const recs = m.roamie?.recommendations ?? [];
    if (recs.length) {
      return recs.map((r) => placeIdFromRecommendation(r)).filter(Boolean);
    }
  }
  return [];
}

export function applyTripAddPlaceRecommendationSession(
  planningSession: ChatPlanningSession,
  recSession: TripAddPlaceRecommendationSession,
  batch: RoamieRecommendationItem[],
): ChatPlanningSession {
  const recs = batch.map(roamieRecToChatItem) as ChatPlaceItem[];
  const allShownIds = recSession.shownPlaceIds;
  return {
    ...planningSession,
    recommendedPlaces: recs,
    recommendedPlaceIds: allShownIds,
    tripAddPlaceRecommendationSession: recSession,
    phase: "followup",
  };
}

export function shouldHandleTripAddPlaceMoreTurn(
  userText: string,
  session: ChatPlanningSession,
): boolean {
  if (!session.fromTripAddPlace || !session.tripAddPlaceContext) return false;
  return (
    isTripAddPlaceMoreRecommendationsRequest(userText) || isRejectCurrentBatch(userText)
  );
}

export function resolveTripAddPlaceMoreTurn(
  userText: string,
  session: ChatPlanningSession,
  msgs: import("@/lib/chat-history").ChatMsg[],
): {
  summary: string;
  recommendations: RoamieRecommendationItem[];
  nextPlanningSession: ChatPlanningSession;
} | null {
  const ctx = session.tripAddPlaceContext;
  let recSession = session.tripAddPlaceRecommendationSession;
  if (!ctx || !recSession) return null;

  recSession = refreshCurrentTripPlaceIds(recSession, ctx);
  recSession = syncShownPlaceIdsFromMessages(recSession, msgs);
  logRecommendDedup(recSession, ctx, "before_more_turn");

  let workingRecSession = recSession;

  if (isRejectCurrentBatch(userText)) {
    const lastBatchIds = extractLastBatchPlaceIds(msgs);
    if (lastBatchIds.length) {
      workingRecSession = rejectLastShownBatch(workingRecSession, lastBatchIds);
    }
  }

  const { batch, session: updatedRecSession } = takeNextTripAddPlaceBatch(workingRecSession, ctx);

  if (!batch.length) {
    return {
      summary: TRIP_ADD_PLACE_EXHAUSTED_MESSAGE,
      recommendations: [],
      nextPlanningSession: {
        ...session,
        tripAddPlaceRecommendationSession: {
          ...updatedRecSession,
          exhausted: true,
          awaitingExpandConsent: true,
        },
        lastAssistantReply: TRIP_ADD_PLACE_EXHAUSTED_MESSAGE,
      },
    };
  }

  const summary = buildTripAddPlaceBatchSummary(ctx, batch, {
    isFollowUp: updatedRecSession.batchIndex > 2,
    intent: updatedRecSession.intent,
  });

  return {
    summary,
    recommendations: batch,
    nextPlanningSession: {
      ...applyTripAddPlaceRecommendationSession(session, updatedRecSession, batch),
      lastAssistantReply: summary,
    },
  };
}

/** 舊 session 沒有 candidate pool 時，依已推薦 id 重建分頁狀態 */
export function rebuildTripAddPlaceRecommendationSession(
  planningSession: ChatPlanningSession,
  candidates: RoamieRecommendationItem[],
): ChatPlanningSession {
  const ctx = planningSession.tripAddPlaceContext;
  if (!ctx || !candidates.length) return planningSession;

  const existing = planningSession.tripAddPlaceRecommendationSession;
  const shownPlaceIds = normalizeShownIds(
    existing?.shownPlaceIds ??
      planningSession.recommendedPlaceIds ??
      (planningSession.recommendedPlaces ?? []).map(placeIdFromRecommendation).filter(Boolean),
  );

  const currentTripPlaceIds = normalizeShownIds([
    ...(existing?.currentTripPlaceIds ?? []),
    ...tripPlaceIdsFromContext(ctx),
  ]);

  const intent: TripAddPlaceFollowUpIntent =
    existing?.intent ??
    (planningSession.activeChatIntent === "restaurant"
      ? "restaurant"
      : planningSession.activeChatIntent === "cafe"
        ? "cafe"
        : "attraction");

  let recSession: TripAddPlaceRecommendationSession = slimRecommendationSession({
    sessionId: existing?.sessionId ?? newRecSessionId(),
    tripId: ctx.tripId,
    dayIndex: ctx.dayIndex,
    destination: ctx.destination,
    intent,
    allCandidates: candidates,
    shownPlaceIds,
    addedPlaceIds: existing?.addedPlaceIds ?? [],
    rejectedPlaceIds: existing?.rejectedPlaceIds ?? [],
    currentTripPlaceIds,
    batchSize: TRIP_ADD_PLACE_BATCH_SIZE,
    batchIndex: Math.max(1, Math.ceil(shownPlaceIds.length / TRIP_ADD_PLACE_BATCH_SIZE)),
    exhausted: false,
    searchRadiusStep: existing?.searchRadiusStep ?? 0,
    awaitingExpandConsent: false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });

  const remainingCount = getRemainingCandidates(recSession, ctx).length;
  recSession = {
    ...recSession,
    exhausted: remainingCount === 0,
    awaitingExpandConsent: remainingCount === 0,
  };

  return {
    ...planningSession,
    tripAddPlaceRecommendationSession: recSession,
  };
}

export function mergeExpandedTripAddPlaceCandidates(
  recSession: TripAddPlaceRecommendationSession,
  incoming: RoamieRecommendationItem[],
  ctx?: TripAddPlaceContext | null,
): TripAddPlaceRecommendationSession {
  const registry = buildTripAddPlaceDedupRegistry(recSession, ctx);
  const fresh = dedupeTripAddPlaceCandidates(
    filterTripAddPlaceCandidates(incoming, recSession, ctx),
    registry,
    "merge_expanded",
  );

  const mergedPool = dedupeTripAddPlaceCandidates(
    [...recSession.allCandidates, ...fresh.map(slimCandidateForStorage)],
    buildTripAddPlaceDedupRegistry(recSession, ctx),
    "merge_pool",
  );

  const merged: TripAddPlaceRecommendationSession = {
    ...recSession,
    allCandidates: mergedPool.map(slimCandidateForStorage),
  };
  const remainingCount = getRemainingCandidates(merged, ctx).length;

  return {
    ...merged,
    exhausted: remainingCount === 0,
    awaitingExpandConsent: remainingCount === 0,
  };
}

export function tripAddPlaceRadiusStepsForSession(
  recSession: TripAddPlaceRecommendationSession,
): number[] {
  const step = Math.min(
    recSession.searchRadiusStep,
    TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1,
  );
  return [TRIP_ADD_PLACE_RADIUS_STEPS_M[step]!];
}
