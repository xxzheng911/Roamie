import { isAffirmativeReply } from "@/lib/ai/chat-conversation-state";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { roamieRecToChatItem, type ChatPlaceItem } from "@/lib/chat-session";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import { extractRecommendedFromMsgs } from "@/lib/ai/chat-recommendation-refresh";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import {
  buildTripAddPlaceBatchSummary,
  createTripAddPlaceRecommendationSession,
  collectBlockedPlaceIdsForSearch,
  getRemainingCandidates,
  isTripAddPlaceExpandSearchConsent,
  isTripAddPlaceMoreRecommendationsRequest,
  logRecommendDedup,
  mergeExpandedTripAddPlaceCandidates,
  normalizeShownIds,
  normalizeStoredPlaceId,
  placeIdFromRecommendation,
  refreshCurrentTripPlaceIds,
  rebuildTripAddPlaceRecommendationSession,
  resolveTripAddPlaceMoreTurn,
  syncShownPlaceIdsFromMessages,
  takeNextTripAddPlaceBatch,
  tripPlaceIdsFromContext,
  slimCandidateForStorage,
  slimRecommendationSession,
  TRIP_ADD_PLACE_EXHAUSTED_MESSAGE,
  TRIP_ADD_PLACE_RADIUS_STEPS_M,
  type TripAddPlaceRecommendationSession,
} from "@/lib/trip/trip-add-place-recommendation-session";
import {
  fetchTripAddPlaceCandidatePool,
  tripAddPlaceRecommendationsToSession,
} from "@/lib/trip/trip-add-place-handoff";
import {
  computeNextSearchCenter,
  resolveTripAddPlaceSearchCenter,
  withTripAddPlaceSearchCenter,
} from "@/lib/trip/trip-add-place-search";
import {
  buildTripAddPlaceDedupRegistry,
  dedupeTripAddPlaceCandidates,
} from "@/lib/trip/trip-add-place-dedup";
import {
  parseTripAddPlaceFollowUpIntent,
  reinforceTripAddPlaceSession,
} from "@/lib/trip/trip-add-place-session";

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** 與 placeIdentityKey 一致，避免 shown / remaining 對不上 */
export function tripRecPlaceId(rec: RoamieRecommendationItem | ChatPlaceItem): string {
  return placeIdentityKey(rec);
}

export type TripAddPlaceSessionDiagnostics = {
  sessionId: string | null;
  tripId: string | null;
  dayIndex: number | null;
  allCandidatesCount: number;
  shownPlaceIdsCount: number;
  rejectedPlaceIdsCount: number;
  addedPlaceIdsCount: number;
  currentTripPlaceIdsCount: number;
  remainingCandidatesCount: number;
  searchRadiusStep: number;
  exhausted: boolean;
  awaitingExpandConsent: boolean;
  hasTripContext: boolean;
};

export function diagnoseTripAddPlaceSession(
  session: ChatPlanningSession,
): TripAddPlaceSessionDiagnostics {
  const rec = session.tripAddPlaceRecommendationSession;
  const ctx = session.tripAddPlaceContext;
  const remaining = rec ? getRemainingCandidates(rec, ctx).length : 0;
  return {
    sessionId: rec?.sessionId ?? null,
    tripId: ctx?.tripId ?? rec?.tripId ?? null,
    dayIndex: ctx?.dayIndex ?? rec?.dayIndex ?? null,
    allCandidatesCount: rec?.allCandidates.length ?? 0,
    shownPlaceIdsCount: rec?.shownPlaceIds.length ?? 0,
    addedPlaceIdsCount: rec?.addedPlaceIds?.length ?? 0,
    currentTripPlaceIdsCount: rec?.currentTripPlaceIds?.length ?? 0,
    rejectedPlaceIdsCount: rec?.rejectedPlaceIds.length ?? 0,
    remainingCandidatesCount: remaining,
    searchRadiusStep: rec?.searchRadiusStep ?? 0,
    exhausted: rec?.exhausted ?? false,
    awaitingExpandConsent: rec?.awaitingExpandConsent ?? false,
    hasTripContext: Boolean(session.tripAddPlaceContext),
  };
}

export function logTripAddPlaceSessionState(
  label: string,
  session: ChatPlanningSession,
  extra?: Record<string, unknown>,
): void {
  console.info(`[TRIP_ADD_PLACE_SESSION] ${label}`, {
    ...diagnoseTripAddPlaceSession(session),
    ...extra,
  });
}

export function formatTripAddPlaceError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function logTripAddPlaceFailure(
  error: unknown,
  session: ChatPlanningSession,
  userText: string,
  phase: string,
): void {
  console.error("[TRIP_ADD_PLACE_LOCAL_TURN_FAILED]", {
    phase,
    userText: userText.slice(0, 48),
    error: formatTripAddPlaceError(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...diagnoseTripAddPlaceSession(session),
  });
}

function collectShownIdsFromMessages(msgs: ChatMsg[]): string[] {
  const ids = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    for (const rec of m.roamie?.recommendations ?? []) {
      const id = tripRecPlaceId(rec);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function resolveIntent(session: ChatPlanningSession): import("@/lib/trip/trip-add-place-session").TripAddPlaceFollowUpIntent {
  const rec = session.tripAddPlaceRecommendationSession;
  if (rec?.intent) return rec.intent;
  if (session.activeChatIntent === "restaurant") return "restaurant";
  if (session.activeChatIntent === "cafe") return "cafe";
  return "attraction";
}

function normalizeShownIdsLocal(ids: string[]): string[] {
  return normalizeShownIds(ids);
}

function buildRecSessionFromPool(params: {
  session: ChatPlanningSession;
  pool: RoamieRecommendationItem[];
  shownIds: string[];
  intent: import("@/lib/trip/trip-add-place-session").TripAddPlaceFollowUpIntent;
  searchRadiusStep?: number;
}): ChatPlanningSession {
  const ctx = params.session.tripAddPlaceContext!;
  const existing = params.session.tripAddPlaceRecommendationSession;
  const shownPlaceIds = normalizeShownIdsLocal(params.shownIds);
  const draft: TripAddPlaceRecommendationSession = {
    sessionId: existing?.sessionId ?? newSessionId(),
    tripId: ctx.tripId,
    dayIndex: ctx.dayIndex,
    destination: ctx.destination,
    intent: params.intent,
    allCandidates: params.pool.map(slimCandidateForStorage),
    shownPlaceIds,
    addedPlaceIds: existing?.addedPlaceIds ?? [],
    rejectedPlaceIds: existing?.rejectedPlaceIds ?? [],
    currentTripPlaceIds: normalizeShownIdsLocal([
      ...(existing?.currentTripPlaceIds ?? []),
      ...tripPlaceIdsFromContext(ctx),
    ]),
    batchSize: 5,
    batchIndex: Math.max(1, Math.ceil(shownPlaceIds.length / 5)),
    exhausted: false,
    searchRadiusStep: params.searchRadiusStep ?? existing?.searchRadiusStep ?? 0,
    awaitingExpandConsent: false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const remaining = getRemainingCandidates(draft, ctx);

  const recSession = slimRecommendationSession({
    ...draft,
    exhausted: remaining.length === 0,
    awaitingExpandConsent: remaining.length === 0,
  });

  return { ...params.session, tripAddPlaceRecommendationSession: recSession };
}

async function fetchPoolForSession(
  session: ChatPlanningSession,
  searchPlaces: PlaceSearchFn,
  locale: Locale,
  radiusStep?: number,
  opts?: {
    expandConsent?: boolean;
    searchCenter?: import("@/lib/trip/trip-add-place-search").TripAddPlaceSearchCenter | null;
    userText?: string;
  },
): Promise<RoamieRecommendationItem[]> {
  const ctx = session.tripAddPlaceContext!;
  const rec = session.tripAddPlaceRecommendationSession;
  const intent = resolveIntent(session);
  const step = radiusStep ?? rec?.searchRadiusStep ?? 0;
  const radius = TRIP_ADD_PLACE_RADIUS_STEPS_M[Math.min(step, TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1)]!;

  return fetchTripAddPlaceCandidatePool({
    ctx,
    intent,
    searchPlaces,
    locale,
    recSession: rec,
    excludePlaceIds: collectBlockedPlaceIdsForSearch(rec, ctx),
    radiusSteps: [radius],
    radiusStep: step,
    expandConsent: opts?.expandConsent,
    searchCenter: opts?.searchCenter ?? resolveTripAddPlaceSearchCenter(ctx, rec),
    userText: opts?.userText,
  });
}

async function ensureRecommendationSession(
  session: ChatPlanningSession,
  msgs: ChatMsg[],
  searchPlaces: PlaceSearchFn,
  locale: Locale,
): Promise<ChatPlanningSession> {
  const ctx = session.tripAddPlaceContext;
  let rec = session.tripAddPlaceRecommendationSession;

  if (rec && ctx) {
    rec = refreshCurrentTripPlaceIds(rec, ctx);
    rec = syncShownPlaceIdsFromMessages(rec, msgs);
    logRecommendDedup(rec, ctx, "ensure_rec_session");
    if (rec.allCandidates.length) {
      return { ...session, tripAddPlaceRecommendationSession: rec };
    }
  }

  const shownFromMsgs = collectShownIdsFromMessages(msgs);
  const shownIds = normalizeShownIdsLocal([
    ...(rec?.shownPlaceIds ?? []),
    ...(session.recommendedPlaceIds ?? []),
    ...shownFromMsgs,
    ...(session.recommendedPlaces ?? []).map(tripRecPlaceId),
    ...extractRecommendedFromMsgs(msgs).map(tripRecPlaceId),
  ]);

  logTripAddPlaceSessionState("ensure_rec_session_fetch_pool", session, {
    shownFromMsgs: shownFromMsgs.length,
  });

  const pool = await fetchPoolForSession(session, searchPlaces, locale, undefined, {
    userText,
  });
  if (!pool.length) {
    return rec ? { ...session, tripAddPlaceRecommendationSession: rec } : session;
  }

  return buildRecSessionFromPool({
    session: rec ? { ...session, tripAddPlaceRecommendationSession: rec } : session,
    pool,
    shownIds,
    intent: resolveIntent(session),
  });
}

async function expandSearchRadius(
  session: ChatPlanningSession,
  searchPlaces: PlaceSearchFn,
  locale: Locale,
  expandConsent = false,
): Promise<ChatPlanningSession> {
  const ctx = session.tripAddPlaceContext;
  const rec = session.tripAddPlaceRecommendationSession;
  if (!ctx || !rec) return session;

  const currentStep = rec.searchRadiusStep ?? 0;
  if (currentStep >= TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1) {
    return session;
  }

  const nextStep = currentStep + 1;
  const nextCenter = computeNextSearchCenter(ctx, rec);
  let workingRec = rec;
  if (nextCenter) {
    workingRec = withTripAddPlaceSearchCenter(
      { ...rec, searchRadiusStep: nextStep, awaitingExpandConsent: false },
      nextCenter,
    );
  } else {
    workingRec = { ...rec, searchRadiusStep: nextStep, awaitingExpandConsent: false };
  }

  const sessionWithCenter = { ...session, tripAddPlaceRecommendationSession: workingRec };
  const expandedPool = await fetchPoolForSession(
    sessionWithCenter,
    searchPlaces,
    locale,
    nextStep,
    { expandConsent, searchCenter: nextCenter },
  );

  const merged = mergeExpandedTripAddPlaceCandidates(workingRec, expandedPool, ctx);
  return {
    ...session,
    tripAddPlaceRecommendationSession: slimRecommendationSession({
      ...merged,
      searchRadiusStep: nextStep,
      awaitingExpandConsent: false,
      exhausted: getRemainingCandidates(merged, ctx).length === 0,
    }),
  };
}

function turnFromBatch(
  session: ChatPlanningSession,
  batch: RoamieRecommendationItem[],
  recSession: TripAddPlaceRecommendationSession,
  isFollowUp: boolean,
): TripAddPlaceLocalTurnResult {
  const ctx = session.tripAddPlaceContext!;
  const summary = buildTripAddPlaceBatchSummary(ctx, batch, {
    isFollowUp,
    intent: recSession.intent,
  });
  const recs = batch.map(roamieRecToChatItem) as ChatPlaceItem[];
  const slimRec = slimRecommendationSession(recSession);
  return {
    summary,
    recommendations: batch,
    nextSession: tripAddPlaceRecommendationsToSession(
      { ...session, lastAssistantReply: summary },
      batch,
      slimRec,
    ),
  };
}

/** 推薦引擎：不拋錯，盡力產出下一批地點卡 */
export async function runTripAddPlaceRecommendationEngine(params: {
  session: ChatPlanningSession;
  userText: string;
  msgs: ChatMsg[];
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<TripAddPlaceLocalTurnResult> {
  const { userText, msgs, searchPlaces, locale } = params;
  let session = reinforceTripAddPlaceSession(params.session, userText);
  const ctx = session.tripAddPlaceContext;

  if (!ctx) {
    throw new Error("tripAddPlaceContext_missing");
  }

  logTripAddPlaceSessionState("engine_start", session, { userText: userText.slice(0, 48) });
  if (session.tripAddPlaceRecommendationSession && ctx) {
    logRecommendDedup(session.tripAddPlaceRecommendationSession, ctx, "engine_start");
  }

  session = await ensureRecommendationSession(session, msgs, searchPlaces, locale);

  const wantsExpand = isTripAddPlaceExpandSearchConsent(userText, msgs, session.tripAddPlaceRecommendationSession);
  const wantsMore =
    isTripAddPlaceMoreRecommendationsRequest(userText) ||
    (isAffirmativeReply(userText.trim()) && !wantsExpand);

  if (wantsExpand) {
    session = await expandSearchRadius(session, searchPlaces, locale, true);
    logTripAddPlaceSessionState("after_expand_radius", session);
    const expandTurn = resolveTripAddPlaceMoreTurn("再推薦", session, msgs);
    if (expandTurn?.recommendations.length) {
      return {
        summary: expandTurn.summary,
        recommendations: expandTurn.recommendations,
        nextSession: expandTurn.nextPlanningSession,
      };
    }
  }

  if (wantsMore || wantsExpand) {
    const turn = resolveTripAddPlaceMoreTurn(userText, session, msgs);
    if (turn?.recommendations.length) {
      return {
        summary: turn.summary,
        recommendations: turn.recommendations,
        nextSession: turn.nextPlanningSession,
      };
    }

    if (!wantsExpand && turn && !turn.recommendations.length) {
      const expanded = await expandSearchRadius(session, searchPlaces, locale, false);
      const afterExpand = resolveTripAddPlaceMoreTurn("再推薦", expanded, msgs);
      if (afterExpand?.recommendations.length) {
        return {
          summary: afterExpand.summary,
          recommendations: afterExpand.recommendations,
          nextSession: afterExpand.nextPlanningSession,
        };
      }
      return {
        summary: TRIP_ADD_PLACE_EXHAUSTED_MESSAGE,
        recommendations: [],
        nextSession: {
          ...expanded,
          tripAddPlaceRecommendationSession: expanded.tripAddPlaceRecommendationSession
            ? {
                ...expanded.tripAddPlaceRecommendationSession,
                awaitingExpandConsent: true,
                exhausted: true,
              }
            : undefined,
          lastAssistantReply: TRIP_ADD_PLACE_EXHAUSTED_MESSAGE,
        },
      };
    }

    if (wantsExpand) {
      const refetched = await fetchPoolForSession(
        session,
        searchPlaces,
        locale,
        session.tripAddPlaceRecommendationSession?.searchRadiusStep,
        { expandConsent: true, userText },
      );
      if (refetched.length) {
        const shownIds = normalizeShownIdsLocal([
          ...(session.tripAddPlaceRecommendationSession?.shownPlaceIds ?? []),
          ...collectShownIdsFromMessages(msgs),
        ]);
        const rebuilt = buildRecSessionFromPool({
          session,
          pool: refetched,
          shownIds,
          intent: resolveIntent(session),
          searchRadiusStep: session.tripAddPlaceRecommendationSession?.searchRadiusStep,
        });
        const afterRefetch = resolveTripAddPlaceMoreTurn("再推薦", rebuilt, msgs);
        if (afterRefetch?.recommendations.length) {
          return {
            summary: afterRefetch.summary,
            recommendations: afterRefetch.recommendations,
            nextSession: afterRefetch.nextPlanningSession,
          };
        }
      }
    }
  }

  const followUp = parseTripAddPlaceFollowUpIntent(userText);
  if (followUp && !wantsMore && !wantsExpand) {
    const rec = session.tripAddPlaceRecommendationSession;
    const step = rec?.searchRadiusStep ?? 0;
    const pool = await fetchTripAddPlaceCandidatePool({
      ctx,
      intent: followUp,
      searchPlaces,
      locale,
      recSession: rec,
      excludePlaceIds: collectBlockedPlaceIdsForSearch(rec, ctx),
      radiusStep: step,
      radiusSteps: [TRIP_ADD_PLACE_RADIUS_STEPS_M[Math.min(step, TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1)]!],
      expandConsent: rec?.awaitingExpandConsent,
      searchCenter: resolveTripAddPlaceSearchCenter(ctx, rec),
      userText,
    });
    const firstBatch = dedupeTripAddPlaceCandidates(
      pool,
      buildTripAddPlaceDedupRegistry(rec, ctx),
      "followup_intent",
    ).slice(0, 5);
    if (firstBatch.length && rec) {
      const merged = mergeExpandedTripAddPlaceCandidates(
        { ...rec, intent: followUp },
        pool,
        ctx,
      );
      const { batch, session: updatedRec } = takeNextTripAddPlaceBatch(merged, ctx);
      if (batch.length) {
        return turnFromBatch(
          { ...session, activeChatIntent: followUp },
          batch,
          updatedRec,
          updatedRec.batchIndex > 2,
        );
      }
    }
    if (firstBatch.length) {
      const recSession = createTripAddPlaceRecommendationSession({
        ctx,
        candidates: pool.map(slimCandidateForStorage),
        intent: followUp,
        firstBatch,
      });
      return turnFromBatch(session, firstBatch, recSession, false);
    }
    if (rec && step < TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1) {
      const expanded = await expandSearchRadius(session, searchPlaces, locale, true);
      const retry = resolveTripAddPlaceMoreTurn("再推薦", expanded, msgs);
      if (retry?.recommendations.length) {
        return {
          summary: retry.summary,
          recommendations: retry.recommendations,
          nextSession: retry.nextPlanningSession,
        };
      }
    }
  }

  const rec = session.tripAddPlaceRecommendationSession;
  if (rec && ctx) {
    const synced = syncShownPlaceIdsFromMessages(
      refreshCurrentTripPlaceIds(rec, ctx),
      msgs,
    );
    const remaining = getRemainingCandidates(synced, ctx);
    if (remaining.length > 0) {
      const { batch, session: updatedRec } = takeNextTripAddPlaceBatch(synced, ctx);
      if (batch.length) {
        return turnFromBatch(session, batch, updatedRec, updatedRec.batchIndex > 2);
      }
    }
  }

  const retryMore = resolveTripAddPlaceMoreTurn("還有嗎", session, msgs);
  if (retryMore?.recommendations.length) {
    return {
      summary: retryMore.summary,
      recommendations: retryMore.recommendations,
      nextSession: retryMore.nextPlanningSession,
    };
  }

  const expanded = await expandSearchRadius(session, searchPlaces, locale, true);
  const afterExpand = resolveTripAddPlaceMoreTurn("再推薦", expanded, msgs);
  if (afterExpand?.recommendations.length) {
    return {
      summary: afterExpand.summary,
      recommendations: afterExpand.recommendations,
      nextSession: afterExpand.nextPlanningSession,
    };
  }

  const fallback =
    "這一帶順路地點我都找過一輪了。可以換個類型（咖啡廳、餐廳、景點），或說「好」讓我擴大搜尋範圍。";
  return {
    summary: fallback,
    recommendations: [],
    nextSession: {
      ...expanded,
      tripAddPlaceRecommendationSession: expanded.tripAddPlaceRecommendationSession
        ? {
            ...expanded.tripAddPlaceRecommendationSession,
            awaitingExpandConsent: true,
            exhausted: true,
          }
        : undefined,
      lastAssistantReply: fallback,
    },
  };
}

export type TripAddPlaceLocalTurnResult = {
  summary: string;
  recommendations: RoamieRecommendationItem[];
  nextSession: ChatPlanningSession;
};

async function recoverTripAddPlaceLocalTurn(
  params: {
    session: ChatPlanningSession;
    userText: string;
    msgs: ChatMsg[];
    searchPlaces: PlaceSearchFn;
    locale: Locale;
  },
  originalError: unknown,
): Promise<TripAddPlaceLocalTurnResult> {
  try {
    const retry = await runTripAddPlaceRecommendationEngine({
      ...params,
      userText: isTripAddPlaceMoreRecommendationsRequest(params.userText)
        ? params.userText
        : "還有嗎",
    });
    if (retry.recommendations.length) return retry;
  } catch (retryError) {
    logTripAddPlaceFailure(retryError, params.session, params.userText, "recover_retry");
  }

  logTripAddPlaceFailure(originalError, params.session, params.userText, "recover_exhausted");
  const fallback =
    "告訴我你想找咖啡廳、餐廳或景點；也可以說「還有嗎」，我會從順路清單繼續推薦。";
  return {
    summary: fallback,
    recommendations: [],
    nextSession: { ...params.session, lastAssistantReply: fallback },
  };
}

/** 行程加點聊天：全程本地 Places 推薦，不呼叫 OpenAI */
export async function processTripAddPlaceUserMessage(params: {
  session: ChatPlanningSession;
  userText: string;
  msgs: ChatMsg[];
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<TripAddPlaceLocalTurnResult> {
  console.info("[TRIP_ADD_PLACE_LOCAL_TURN]", params.userText.slice(0, 48));
  try {
    return await runTripAddPlaceRecommendationEngine(params);
  } catch (error) {
    logTripAddPlaceFailure(error, params.session, params.userText, "process_message");
    return recoverTripAddPlaceLocalTurn(params, error);
  }
}
