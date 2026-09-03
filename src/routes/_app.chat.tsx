import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useMessengerChatLayout } from "@/hooks/use-messenger-chat-layout";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageList, RoamieAssistantAvatar } from "@/components/chat/ChatMessageList";
import { ChatKeyboardDebugOverlay } from "@/components/chat/ChatKeyboardDebugOverlay";
import { useScrollPerfMonitor } from "@/hooks/use-scroll-perf-monitor";
import { isChatKeyboardDebugEnabled } from "@/lib/chat-keyboard-visual-debug";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import {
  logChatNavigationBack,
  logChatNavigationEntry,
  logChatNavigationFallback,
  resolveChatBackTarget,
  resolveChatEntrySource,
  TRAVEL_DRAFTS_ROUTE,
} from "@/lib/chat-navigation";
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ROAMIE_BUILD_DEBUG } from "@/lib/app-bundle-version";
import { supabase } from "@/integrations/supabase/client";
import { loadChatHistory, clearChatHistory, type ChatMsg } from "@/lib/chat-history";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { enrichRoamieContext } from "@/lib/ai/enrich-context";
import { resolveEffectivePlanTierWithProfile } from "@/lib/access/resolve";
import { getWeather } from "@/lib/weather.functions";
import { geocodeTripLocationFromText } from "@/lib/location.functions";
import {
  buildNearbyLocationClarificationCopy,
  createPendingNearbyLocationRequest,
  hasUsableNearbyCoordinates,
  isUsableNearbyClarificationLocation,
  normalizeNearbyClarificationQuery,
  NEARBY_CLARIFICATION_CONTRACT_VERSION,
  resolveChatRouteAuthority,
  shouldAllowNearbyDispatch,
  shouldResolveNearbyCurrentLocation,
} from "@/lib/ai/nearby-location-clarification";
import { searchPlaces } from "@/lib/places.functions";
import { getPlaceDetailsServerFnViaGateway } from "@/lib/pie/places-gateway";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import { PreferenceQuizCta } from "@/components/PreferenceQuizCta";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
import {
  logTripNav,
  tripDetailNavigateOptions,
  TRIP_DETAIL_ROUTE,
} from "@/lib/trip/trip-detail-nav";
import { isValidUuid } from "@/lib/uuid";
import {
  consumeTripAddPlaceHandoff,
  enrichTripAddPlaceRecommendationsFromSummary,
  fetchTripAddPlaceCandidatePool,
  fetchTripAddPlaceFollowUpRecommendations,
  fetchTripAddPlaceRecommendations,
  ensureHandoffRecommendationSession,
  buildTripAddPlaceAssistantMessage,
  isTripAddPlaceSession,
  markTripAddPlaceHandoffComplete,
  mergeTripAddPlaceHistoryWithRecommendations,
  parseTripAddPlaceFollowUpIntent,
  prepareTripAddPlaceSession,
  reinforceTripAddPlaceSession,
  tripAddPlaceRecommendationsToSession,
} from "@/lib/trip/trip-add-place-handoff";
import {
  isTripAddPlaceMoreRecommendationsRequest,
  markTripAddPlaceAdded,
  rebuildTripAddPlaceRecommendationSession,
  resolveTripAddPlaceChatSession,
  resolveTripAddPlaceMoreTurn,
  shouldHandleTripAddPlaceMoreTurn,
} from "@/lib/trip/trip-add-place-recommendation-session";
import {
  logTripAddPlaceFailure,
  processTripAddPlaceUserMessage,
} from "@/lib/trip/trip-add-place-recommendation-engine";
import {
  logTripAddPlaceMode,
  shouldShowTripAddPlacePlusUpsell,
  TRIP_ADD_PLACE_EMPTY_HINT,
} from "@/lib/trip/trip-add-place-mode";
import {
  buildTripAddPlaceChatMessage,
  buildTripAddPlaceLoadingMessage,
  buildTripAddPlaceRenderFallbackMessage,
  logTripAddPlaceRenderEmpty,
} from "@/lib/trip/trip-add-place-render";
import { appendPlaceToTrip } from "@/lib/trip/append-place-to-trip";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { generateItinerary } from "@/lib/itinerary.functions";
import { confirmSaveTrip, updateTripMeta } from "@/lib/itinerary-storage";
import { clearDraftTrip, loadDraftTrip, saveDraftTrip } from "@/lib/trip-draft-storage";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  coalesceItineraryItems,
  hasValidItineraryStops,
  ITINERARY_GENERATION_FAILED_MESSAGE,
} from "@/lib/trip/itinerary-guards";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { buildPlannerRequiredAnchors } from "@/lib/place-planning-memory";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import {
  finalizeChatRecommendationDisplay,
  mergeAssistantRecommendationMessage,
} from "@/lib/chat-display-recommendations";
import { shouldSuppressChatPlaceCards } from "@/lib/ai/chat-suppress-place-cards";
import { enrichChatPlaceItemFromDetails, hasValidPlaceCoordinates } from "@/lib/chat-place-context";
import {
  logChatUiReceivedCards,
  logChatRenderBlocked,
  safeChatLog,
} from "@/lib/ai/chat-place-flow-log";
import { openRecommendationPlaceDetail } from "@/lib/recommendation-place-handoff";
import {
  buildPlaceDetailFollowUpReply,
  buildPlaceDetailReply,
  ensurePlaceDetailFocusCoordinates,
  enterPlaceDetailChat,
  isPlaceDetailChatActive,
  parsePlaceDetailFollowUp,
  resolvePlaceDetailNearbyIntent,
  sessionWithPlaceDetailSearchCenter,
  type FetchPlaceDetailsForFocusFn,
} from "@/lib/ai/place-detail-chat";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import {
  clearChatUiCache,
  consumeChatUiCache,
  peekChatUiCache,
  preserveChatUiForPlaceDetail,
} from "@/lib/chat-ui-cache";
import { logAppError } from "@/lib/log-error";
import { isLateNightMode } from "@/lib/recommend-place-ranking";
import {
  buildApiMessagesFromConversation,
  extractChatPlanningContextFromText,
  resolveChatApiPhase,
  resolveSessionPhaseAfterReply,
} from "@/lib/chat-planning-flow";
import {
  applyTripIntentToSession,
  formatTripIntentForAi,
  parseTripIntentFromSession,
  parseTripIntentFromText,
} from "@/lib/recommendation/trip-intent";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import {
  loadChatSession,
  saveChatSession,
  clearChatSession,
  createEmptySession,
  mergeSessionFromRoamie,
  addSelectedPlace,
  extractPlanningHintsFromText,
  extractDiscoveryFromText,
  isDiscoveryComplete,
  isUserConfirmingItinerary,
  canGenerateItinerary,
  buildConversationSummary,
  roamieRecToChatItem,
  placeDisplayName,
  mapPlaceResultToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import {
  buildPlusHomeHandoffOpening,
  markPlusHomeHandoffComplete,
  preparePlusHomeChatSession,
} from "@/lib/plus-chat-handoff";
import {
  buildContextualMoodHandoffOpening,
  buildHandoffRoamiePayload,
  buildInitialChatContext,
  prepareMoodFlowSession,
  markMoodHandoffComplete,
  isMoodHandoffDoneForRec,
  clearMoodHandoffStorage,
} from "@/lib/mood-chat-handoff";
import {
  buildPlanTripHandoffOpening,
  buildPlanAiHandoffOpening,
  markPlanHandoffComplete,
} from "@/lib/plan-trip-handoff";
import { clearPlanFormDraft } from "@/lib/plan-form-draft-storage";
import {
  fetchPlanningSelectionRecommendations,
  isPlanningSelectionContinuation,
  isPlanningSelectionMode,
  preparePlanningSelectionForGenerate,
  resolvePlanningSelectionPlaces,
  togglePlanningSelectionPlace,
} from "@/lib/planning-selection";
import {
  applyPlanningSelectionDateAuthority,
  logPlanningSelectionDateAuthority,
  logPlanningSelectionDateMismatch,
  resolvePlanningSelectionDateAuthority,
} from "@/lib/planning-selection-date-authority";
import { buildContextBundleForTrip } from "@/lib/fetch-context";
import {
  logPlanningSelectionHandoffLoading,
  logPlanningSelectionHandoffStage,
} from "@/lib/planning-selection-handoff-log";
import { formatTripLocationLabel } from "@/lib/location/format";
import { useI18n } from "@/hooks/use-i18n";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { resolveChatConnectionFallbackMessage } from "@/lib/user-facing-error";
import { useAccess } from "@/hooks/use-access";
import {
  beginItineraryGenerationCredits,
  beginPlaceRecommendationCredits,
  fetchCreditAccount,
  INSUFFICIENT_CREDITS_ITINERARY_MESSAGE,
  INSUFFICIENT_CREDITS_PLACE_MESSAGE,
  isCreditsFeatureEnabled,
  resolveCreditsGreeting,
  settleCreditsOperation,
  type CreditsOperationHandle,
} from "@/lib/credits";

import { useTravelPrefStatus } from "@/hooks/use-preference-quiz-status";
import { mergePreferencesWithTravelPrefStatus } from "@/lib/travel-pref-status";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildPlanningMemoryContext,
  buildTripFromSelectedPlaces,
  extractPlaceNames,
  syncSessionPlaceMemory,
} from "@/lib/place-planning-memory";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { readHomeMood, clearHomeMoodUiSelection } from "@/lib/home-mood";
import { normalizeHomeMoodId } from "@/lib/home-mood-options";
import {
  beginHomeMoodShortcutSession,
  discardHomeMoodShortcutSession,
  isHomeMoodShortcutSearch,
  markHomeMoodShortcutEngaged,
  shouldDiscardHomeMoodShortcutSession,
} from "@/lib/home-mood-shortcut-session";
import {
  isolateHomeShortcutFromPlanning,
  isolateHomeSeaShortcutFromPlanning,
  isStructuredHomeNearbyShortcut,
  isStructuredHomeSeaShortcut,
  resolveHomeShortcutSearchProfile,
} from "@/lib/ai/home-shortcut-handoff";
import {
  mergeTripPlanningContext,
  resolveConversationMode,
  formatTripPlanningContextForAi,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import {
  buildTravelContext,
  extractTravelIntent,
  updateTripDraftFromConversation,
} from "@/services/aiTravelContextService";
import {
  mergeTravelContext,
  formatTravelContextForAi,
  type CanonicalTravelContext,
} from "@/lib/ai/travel-context";
import {
  applyQuickChipContext,
  buildStructuredShortcutContext,
  detectChatIntent,
  inferNearbyIntentFromContext,
  isNearbyPlaceIntent,
  moodLabelForShortcutMode,
  resolveNormalizedShortcutRequestFromText,
  sessionHasLocation,
  resolveChatShortcutContext,
  resolveNearbyShortcutScene,
  userExplicitlyWantsNearbyPlaces,
} from "@/lib/ai/chat-intent";
import {
  logShortcutRecommendationRequestNotSent,
  logShortcutRecommendationSummary,
} from "@/lib/ai/shortcut-recommendation-telemetry";
import {
  logRtResponseBranch,
  logShortcutRuntime,
  type RtShortcutSource,
} from "@/lib/ai/shortcut-runtime-diag";
import {
  buildCampingIntroReply,
  campingSearchAttempts,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import {
  applyDiningContextFromText,
  isFoodPreferenceReply,
  parseFoodPreference,
  resolveChatIntent,
  restaurantCuisineQuestion,
  shouldAskRestaurantCuisine,
  shouldFetchNearbyPlaces,
} from "@/lib/ai/chat-dining-flow";
import {
  buildNearbyPlaceRecommendation,
  buildSummaryForRecommendations,
  restaurantSearchFallbackQueries,
} from "@/lib/ai/chat-place-recommendation";
import { filterPlacesForFoodIntent, isFoodIntentText } from "@/lib/ai/chat-food-filter";
import { resolveNearbySearchCenter } from "@/lib/ai/chat-nearby-search";
import {
  buildDestinationMustVisitRecommendation,
  buildAlternativeDestinationRecommendations,
  buildMoreDestinationRecommendations,
} from "@/lib/ai/destination-place-recommendation";
import { buildDestinationCategoryRecommendations } from "@/lib/ai/chat-destination-category-recommendation";
import {
  extractProvisionalDestinationAreaCandidate,
  resolveDestinationAreaScope,
  resolveValidatedDestinationAreaScope,
} from "@/lib/ai/destination-travel-profile";
import {
  buildPendingGeographicClarification,
  isPlaceClarificationTripPlanningOverride,
  restorePlaceIntentAfterGeographicClarification,
} from "@/lib/ai/destination-geographic-clarification";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { coerceTravelDestination } from "@/lib/ai/trip-planning-context";
import {
  filterRecommendationsForExplicitDestinationScope,
  isolateSessionToExplicitDestination,
  logDestinationRecommendationFallbackSummary,
  resolveExplicitDestinationFallbackScope,
  shouldBlockCrossScopeRecommendationFallback,
} from "@/lib/ai/destination-recommendation-fallback-scope";
import {
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
  resolveDestinationForCategorySearch,
  shouldBlockPlanningFallbackForCategoryQuery,
  shouldFetchDestinationCategoryPlaces,
} from "@/lib/ai/chat-place-intent";
import {
  addTravelIntent,
  buildContinueRecommendationSummary,
  continueRecommendation,
  createRecommendationSession,
  extendRecommendationPool,
  isContinueRecommendationRequest,
  resolveActiveCategoryIntent,
  RECOMMENDATION_BATCH_SIZE,
  DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
  defaultRecommendationDisplayBatchSize,
  isUsableSearchCentroid,
} from "@/lib/ai/conversation-recommendation-session";
import {
  buildPersonalizationContextV1,
  buildPersonalizationSnapshotV1,
} from "@/lib/personalization/resolve-effective-preference";
import {
  buildInitialShoppingSearchAttempts,
  buildShoppingCoverageState,
  buildShoppingDisplayAndReserveFromPool,
  buildShoppingExhaustedFollowupMessage,
  detectShoppingSubtype,
  logChatLoadingFinalized,
  logShoppingCoverageState,
  logShoppingReserveLoaded,
  logShoppingReservePersisted,
  shoppingBrandKey,
  takeShoppingReserveBatch,
  SHOPPING_DISPLAY_LIMIT,
  SHOPPING_FOLLOWUP_MIN_NEW,
  SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE,
} from "@/lib/ai/shopping-query-queue";
import {
  resolveShoppingSearchScope,
  resolveRegionPrimaryCity,
} from "@/lib/ai/shopping-search-scope";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import {
  createClarificationGeographicScope,
  type NearbyGeographicScopeAuthority,
} from "@/lib/ai/nearby-geographic-scope";
import { parsePlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent";
import {
  assertDestinationRequestNotUsingGps,
  isExplicitDeviceNearbyRequest,
  logContinueRecommendationResolved,
  logRecommendationGpsOverrideBlocked,
  logRecommendationPlacesRequest,
  logRecommendationScopeRuntimeReady,
  resolveRecommendationSearchCenter,
  restoreContinueRecommendationCategory,
} from "@/lib/ai/recommendation-search-scope";
import {
  applyRefinementPatchToSession,
  buildRecommendationRefinementResults,
  categoryIntentToRecommendationIntent,
  ensureActiveRecommendationContext,
  recommendationIntentToCategoryIntent,
  resolveChatIntentArbitration,
  restoreActiveRecommendationContextFromWorkspace,
  shouldSkipTripPlanningForRefinement,
  syncActiveRecommendationContextAfterResults,
} from "@/lib/ai/recommendation-refinement";
import {
  attachWorkspaceIdsToSession,
  loadConversationWorkspace,
  setActiveWorkspaceId,
  upsertDraftWorkspaceFromSession,
} from "@/lib/conversation-workspace";
import {
  beginNewChatSession,
  logWorkspaceRestored,
  shouldStartFreshChatSession,
} from "@/lib/chat-session-lifecycle";
import {
  applyRefreshRecommendationSession,
  CHAT_STATE_MACHINE_RECOVERY_MESSAGE,
  collectBlockedCoreNames,
  collectExcludePlaceIds,
  collectHardDuplicatePlaceIds,
  extractRecommendedFromMsgs,
  isMorePlaceRecommendationsIntent,
  isRefreshRecommendationsRequest,
  logChatMorePlacesExcludeIds,
  logChatMorePlacesIntent,
  logChatMorePlacesNoResultAllowed,
  resolveRefreshNearbyIntent,
  shouldAcceptAlternativeRecommendations,
  shouldRefetchPlaces,
} from "@/lib/ai/chat-recommendation-refresh";
import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";
import { NO_MORE_RECOMMENDATIONS_MESSAGE } from "@/lib/ai/place-recommendation-rules";
import {
  isFallbackPlanningPlaceId,
  logPlaceDetailsHttp400Ignored,
  logPlaceDetailsSkipFallbackId,
} from "@/lib/ai/planning-place-id";
import {
  logAiStyleReselectGenerateFail,
  logAiStyleReselectGenerateStart,
  logAiStyleReselectGenerateSuccess,
} from "@/lib/ai/planning-style-reselect-log";
import {
  collectUsedPlaces,
  logAiFollowupMoreDetected,
  logAiFollowupSessionUsedUpdated,
  mergeTripSessionUsedPlacesFromMessages,
} from "@/lib/ai/trip-planning-follow-up";
import { resolveRecommendationStyleTag } from "@/lib/ai/resolve-recommendation-style-tag";
import { isAddAllToTripIntent } from "@/lib/ai/parse-add-all-to-trip-intent";
import {
  logAiCreateTripError,
  logAiCreateTripStart,
  logAiCreateTripSuccess,
  prepareSessionForCreateTripFromRecommendations,
} from "@/lib/ai/create-trip-from-recommendations";
import {
  buildItineraryDaysFromDayPlan,
  buildItineraryFromDayPlan,
  dayPlanToChatPlaces,
  dayPlanToRecommendations,
  resolvePlannerStyleKey,
  verifyDayPlanItineraryOrder,
  type AiDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import { dedupePlaceCardsForRender } from "@/lib/ai/ai-trip-place-allocator";
import {
  logAiCreateItineraryDay,
  logAiCreateTripDates,
  logTripCardRenderDates,
  resolveTripCreateDates,
} from "@/lib/ai/resolve-trip-create-dates";
import {
  alignDayPlanToSession,
  clearPlanningSessionState,
  getFrozenPlanningDayPlan,
  getOrCreatePlanningSessionId,
  isStalePlanningSession,
  isPlanningRenderInProgress,
  logAiPlaceCardsSkipStale,
  logAiPushPlaceCardsSession,
  logAiStaleRecommendationsBlocked,
  resetPlanningPipelineForRegenerate,
  setPlanningRenderInProgress,
  shouldStartNewPlanningSession,
  startNewPlanningSession,
} from "@/lib/ai/ai-planning-session";
import {
  isReplanIntent,
  resetChatPlanningForReplan,
  withChatPlanningState,
  isStyleReselectTurn,
  shouldTriggerTripStylePlanning,
  applyStyleReselectToSession,
  logChatRegeneratePlaceCardsStart,
  logChatRegeneratePlaceCardsDone,
  stripPreviousPlaceCardMessages,
} from "@/lib/ai/chat-planning-state";
import {
  enrichContextForItineraryMode,
  logChatRenderItinerary,
  logChatRenderPlaceList,
  shouldUseItineraryMode,
} from "@/lib/ai/chat-itinerary-mode";
import { parseAskTripStyleSelection, type TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  logAiRenderBlocked,
  logAiRenderItineraryStart,
  logAiRenderItinerarySuccess,
} from "@/lib/ai/normalize-planning-places";
import {
  shouldFetchDestinationPlaces,
  resolveMustVisitDestination,
  mergeContextForPlaceFetch,
  buildNamedFallbackRecommendations,
} from "@/lib/ai/must-visit-places";
import { resolveConversationDestination } from "@/lib/ai/ai-chat-conversation-state";
import { buildWeatherAwarePlaceIntro, resolveWeatherScene } from "@/lib/ai/weather-place-search";
import { placesStatsPayload } from "@/lib/places-api-stats";
import {
  resolveChatLocation,
  resolveNearbyRecommendationScope,
} from "@/lib/ai/resolve-chat-location";
import { getEffectiveLocationSnapshot } from "@/lib/effective-location";
import {
  filterPlacesByDestinationGuard,
  placesSearchContextPayload,
  resolveChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";
import { markAskedClarifyKey, resolveChatRoute } from "@/lib/ai/chat-router";
import {
  applyAdviceResultToSession,
  resolveDestinationAdvice,
  adviceToAssistantChatMsg,
} from "@/lib/ai/destination-advice";
import {
  buildDestinationRecommendationFailedMessage,
  clearDiscoveredCombinationsCache,
  ensureDestinationCombinationsReady,
  getCachedDiscoveredCombinations,
  getLastCombinationDiscoveryFailure,
  REFRESH_DESTINATION_RECOMMENDATIONS_OPTION,
} from "@/lib/ai/destination-combination-discovery";
import {
  getDestinationCombinations,
  hasDestinationPlanningBasics,
} from "@/lib/ai/destination-combination-suggestions";
import {
  buildDestinationDirectionAck,
  canEnterCombinationDiscovery,
  evaluateCombinationDiscoveryGuard,
  hasValidTripDuration,
  logCombinationDiscoveryGuard,
  logConversationStateTransition,
  logTripDurationGuard,
  resolveValidTripDays,
  tripDurationFieldsFromContext,
} from "@/lib/ai/trip-duration-guard";
import { buildDateAndDurationQuestionReply } from "@/lib/ai/city-days-planning";
import {
  isCountryLevelDestination,
  logCountryLevelPlacesBlocked,
} from "@/lib/ai/destination-scope";
import { beginPlacesGenerationSession } from "@/lib/places-api-guard";
import { resetPlacesRateLimitEncountered } from "@/lib/places-classic-landmark-cache";
import { clearResolvedDestinationScope } from "@/lib/ai/resolved-destination-scope";
import {
  clearDestinationGeocodeCache,
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isPlanningTurnActive,
  processAdviceTurn,
  resolvePlanningFallbackTurn,
  type ChatTurnResult,
} from "@/lib/ai/chat-state-machine";
import {
  AI_ITINERARY_SUCCESS_REDIRECT_MESSAGE,
  createItineraryFromSession,
  logAiItinerarySuccess,
  logAiState,
  prepareDirectItineraryFlow,
} from "@/lib/ai/ai-itinerary-state-machine";
import { prepareDirectItinerarySession } from "@/lib/ai/itinerary-place-fetch";
import {
  logItineraryFailureReason,
  logItineraryItemsCoalesced,
  logItinerarySaveFailed,
  logItinerarySavePayloadReady,
  logItinerarySaveStart,
  logItinerarySaveSuccess,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import { prefetchDestinationWeather } from "@/lib/ai/destination-weather-prefetch";
import { buildPlanningOfflineReply } from "@/lib/ai/chat-turn-engine";
import {
  isDestinationPlanningSession,
  isGenericFallbackReply,
  prepareSessionForUserTurn,
} from "@/lib/ai/chat-conversation-state";
import {
  applyBudgetRefinementToSession,
  buildBudgetRefinementSummary,
  isBudgetRefinementText,
  refineRecommendationItemsForBudget,
} from "@/lib/ai/budget-refinement";
import {
  fallbackSearchQuery,
  generateLocalRecommendationFallback,
} from "@/lib/ai/local-recommendation-fallback";
import { getTripLegsWithDurations, travelLabelToRoutesMode } from "@/services/routesService";
import { generateOutfitSuggestion, normalizeWeather } from "@/services/weatherService";
import { attachCoreTripToPayload, toCoreTrip, type CoreTrip } from "@/lib/trip/core-trip";
import { getImmediateTripCoverImage, getTripCoverImage } from "@/services/placeImageService";

type ChatSearch = {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
  prompt?: string;
  tripId?: string;
  day?: number;
  /** Plus Conversation Workspace resume */
  workspaceId?: string;
};

export const Route = createFileRoute("/_app/chat")({
  validateSearch: (s: Record<string, unknown>): ChatSearch => {
    const dayRaw = s.day;
    const day =
      typeof dayRaw === "number"
        ? dayRaw
        : typeof dayRaw === "string" && dayRaw.trim()
          ? Number.parseInt(dayRaw, 10)
          : undefined;
    return {
      from: typeof s.from === "string" ? s.from : undefined,
      recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
      fromMoodFlow: typeof s.fromMoodFlow === "string" ? s.fromMoodFlow : undefined,
      mood: typeof s.mood === "string" ? s.mood : undefined,
      prompt: typeof s.prompt === "string" ? s.prompt : undefined,
      tripId: typeof s.tripId === "string" ? s.tripId : undefined,
      day: day != null && Number.isFinite(day) && day > 0 ? day : undefined,
      workspaceId: typeof s.workspaceId === "string" ? s.workspaceId : undefined,
    };
  },
  component: Chat,
});

async function getAiPreferences() {
  return mergePreferencesWithTravelPrefStatus(
    await getPreferences(),
    readCachedAuthenticatedUserIdSync(),
  );
}

function Chat() {
  const { t, locale } = useI18n();
  const travelPrefStatus = useTravelPrefStatus();
  const { hasPlusAccess, subscriptionHydrated } = useAccess();
  const { openAddToTrip } = useAddToTrip();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [greetingContent, setGreetingContent] = useState(() => t("chat.greeting"));
  const greetingMsg = useMemo(
    (): ChatMsg => ({ role: "assistant", content: greetingContent }),
    [greetingContent],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isCreditsFeatureEnabled()) {
        await fetchCreditAccount();
      }
      const resolved = await resolveCreditsGreeting(
        {
          stage1: t("chat.greeting"),
          stage2: t("chat.creditsGreetingStage2"),
          stage3: t("chat.creditsGreetingStage3"),
          stage4: t("chat.creditsGreetingStage4"),
        },
        { isPlus: hasPlusAccess },
      );
      if (!cancelled) setGreetingContent(resolved.content);
    })();
    return () => {
      cancelled = true;
    };
  }, [t, hasPlusAccess]);
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => [
    { role: "assistant", content: t("chat.greeting") },
  ]);
  const msgsRef = useRef<ChatMsg[]>([]);
  const [session, setSession] = useState<ChatPlanningSession>(() => loadChatSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectionGenerationStatus, setSelectionGenerationStatus] = useState<string | null>(null);
  const selectionLoadingPaintRef = useRef<{
    startedAt: number;
    selectedCount: number;
    tripDays: number;
    logged: boolean;
  } | null>(null);
  const selectionRecommendationInFlightRef = useRef(false);
  const selectionGenerateInFlightRef = useRef(false);
  const activeGenerationRequestIdRef = useRef<string | null>(null);
  const lastFailureGenerationRequestIdRef = useRef<string | null>(null);
  const lastGenerationTriggerMessageIdRef = useRef<string | null>(null);
  const suppressPlaceCards = useMemo(
    () => shouldSuppressChatPlaceCards(session, { generating }),
    [session, generating],
  );
  useLayoutEffect(() => {
    const timing = selectionLoadingPaintRef.current;
    if (!generating || !selectionGenerationStatus || !timing || timing.logged) return;
    timing.logged = true;
    const now = Date.now();
    console.info("[PLANNING_SELECTION_GENERATION_TIMING]", {
      stage: "loading_visible",
      elapsedMs: now - timing.startedAt,
      stageDurationMs: now - timing.startedAt,
      selectedCount: timing.selectedCount,
      tripDays: timing.tripDays,
      success: true,
      failureReason: "",
    });
  }, [generating, selectionGenerationStatus]);
  const ensureSubscriptionHydratedForCredits = useCallback(
    (conversation?: ChatMsg[]): boolean => {
      if (subscriptionHydrated) return true;
      const pendingMessage = "正在同步會員與額度狀態，請稍候再試。";
      if (conversation) {
        setMsgs((prev) => {
          const base = prev.length === conversation.length ? conversation : prev;
          if (base.length > 0) {
            const last = base[base.length - 1];
            if (last?.role === "assistant" && last.content === pendingMessage) {
              return base;
            }
          }
          return [...base, { role: "assistant", content: pendingMessage }];
        });
      } else {
        toast.message(pendingMessage);
      }
      return false;
    },
    [subscriptionHydrated],
  );
  const chatBackNavigation = useMemo(() => {
    const tripCtx = session.tripAddPlaceContext;
    const tripAddPlaceTarget =
      session.fromTripAddPlace && tripCtx && isValidUuid(tripCtx.tripId)
        ? tripDetailNavigateOptions(tripCtx.tripId, { day: tripCtx.selectedDay })
        : null;
    return resolveChatBackTarget({
      from: search.from,
      fromTripAddPlace: session.fromTripAddPlace,
      fromPlanForm: session.fromPlanForm,
      fromPlanAi: session.fromPlanAi,
      tripAddPlaceTarget,
    });
  }, [
    search.from,
    session.fromTripAddPlace,
    session.fromPlanForm,
    session.fromPlanAi,
    session.tripAddPlaceContext,
  ]);

  useEffect(() => {
    const entrySource = resolveChatEntrySource({
      from: search.from,
      fromTripAddPlace: session.fromTripAddPlace,
      fromPlanForm: session.fromPlanForm,
      fromPlanAi: session.fromPlanAi,
    });
    logChatNavigationEntry({
      entrySource,
      workspaceId: search.workspaceId ?? session.workspaceId ?? null,
      returnRoute: chatBackNavigation.target.to,
    });
    if (chatBackNavigation.usedFallback && chatBackNavigation.reason) {
      logChatNavigationFallback({
        entrySource: chatBackNavigation.entrySource,
        reason: chatBackNavigation.reason,
        fallbackRoute: chatBackNavigation.target.to,
      });
    }
    // Log once per entry identity (from + workspace), not on every session field churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: entry params only
  }, [search.from, search.workspaceId]);

  // iOS swipe / history back: stack should already be travel-drafts when entry was push.
  useEffect(() => {
    if (chatBackNavigation.entrySource !== "travel_draft") return;
    const onPopState = () => {
      logChatNavigationBack({
        entrySource: "travel_draft",
        resolvedReturnRoute: TRAVEL_DRAFTS_ROUTE,
        method: "gesture",
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [chatBackNavigation.entrySource]);
  const [hydrating, setHydrating] = useState(true);
  const chatRouteStartedAtRef = useRef(Date.now());
  useEffect(() => {
    const current = loadChatSession();
    const trace = current.planningSelectionHandoffTrace;
    if (!trace || search.from !== "plan-ai") return;
    logPlanningSelectionHandoffStage("chat_mount", trace, {
      sessionId: current.planningSelection?.id,
    });
    logPlanningSelectionHandoffLoading(trace, true, "chat_hydration", "chat_session_hydration");
    // This is a mount boundary diagnostic; the persisted trace is consumed by
    // the normal session hydration below, not by an event-only side channel.
  }, []);
  useEffect(() => {
    const blockingDependencies = [
      ...(hydrating ? ["chat_session_hydration"] : []),
      ...(generating ? ["itinerary_generation"] : []),
      ...(streaming ? ["chat_response_stream"] : []),
    ];
    console.info("[ROUTE_LOADING_STATE]", {
      route: "/chat",
      loading: blockingDependencies.length > 0,
      reason: blockingDependencies[0] ?? "render_ready",
      blockingDependencies,
      elapsedMs: Date.now() - chatRouteStartedAtRef.current,
      subscriptionHydrated,
    });
  }, [generating, hydrating, streaming, subscriptionHydrated]);
  const [lastFailed, setLastFailed] = useState<ChatMsg[] | null>(null);
  const [partial, setPartial] = useState<Partial<RoamieResponse>>({});
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(false);
  const prevMsgsLengthRef = useRef(0);
  const pendingScrollTopRef = useRef<number | null>(null);
  const {
    metrics: messengerLayout,
    scrollToBottom,
    scrollToUserMessage,
    scrollToAiMessageStart,
    scrollToPlaceCardsStart,
  } = useMessengerChatLayout({
    headerRef,
    composerRef,
    messagesRef,
    bottomAnchorRef,
  });
  const keyboardVisible = messengerLayout.keyboardOpen;
  const selectionMode = isPlanningSelectionMode(session);
  const showShortcutChips = true;
  const actionChips = useMemo(() => {
    const options = session.pendingQuestion?.options ?? [];
    const chips: string[] = [];
    if (selectionMode) {
      chips.push("生成行程", "再推薦一些");
      return chips;
    }
    if (
      options.includes("重新生成") ||
      session.aiItineraryState === "FAILED" ||
      session.chatPlanningState === "generationFailed"
    ) {
      chips.push("重新生成");
    }
    if (options.includes("幫我生成")) chips.push("幫我生成");
    return chips;
  }, [
    selectionMode,
    session.pendingQuestion?.options,
    session.aiItineraryState,
    session.chatPlanningState,
  ]);
  useEffect(() => {
    if (!selectionMode) return;
    devVerboseInfo("[PLANNING_SELECTION_SHORTCUTS]", {
      visible: showShortcutChips,
      actions: actionChips,
      selectedPlaceIdsCount: session.planningSelection?.selectedPlaceIds.length ?? 0,
      shownPlaceIdsCount: session.planningSelection?.shownPlaceIds.length ?? 0,
    });
  }, [
    selectionMode,
    showShortcutChips,
    actionChips,
    session.planningSelection?.selectedPlaceIds.length,
    session.planningSelection?.shownPlaceIds.length,
  ]);
  const abortRef = useRef<AbortController | null>(null);
  const handoffStartedRef = useRef<string | null>(null);
  const planHandoffStartedRef = useRef(false);
  const tripAddPlaceHandoffStartedRef = useRef(false);
  /** Prevents re-hydrate from wiping an established session when search params change mid-chat. */
  const chatLifecycleEstablishedRef = useRef(false);
  /** Workspace id restored into the live session (explicit open only). */
  const restoredWorkspaceIdRef = useRef<string | null>(null);
  const autoPromptHandledRef = useRef(false);
  const homeMoodShortcutEngagedRef = useRef(false);
  const initialRestoreSettledRef = useRef(false);
  const nearbyPushRuntimeRef = useRef<{
    returned: boolean;
    reason: string;
    candidateCount: number;
    renderableCount: number;
    finalCount: number;
    scope: string;
    deviceLocationAvailable: boolean;
    deviceLocationUsed: boolean;
  } | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const discoveringLoadingAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveringLoadingRequestIdRef = useRef<string | null>(null);
  const [chatLoading, setChatLoading] = useState<{
    baseText: string;
    requestId: string;
    dots: number;
  } | null>(null);

  const partialScrollKey = `${partial.summary?.length ?? 0}:${partial.recommendations?.length ?? 0}`;

  const logRtNearbyPush = useCallback(
    (payload: {
      returned: boolean;
      reason: string;
      candidateCount: number;
      renderableCount: number;
      finalCount: number;
      scope: string;
      deviceLocationAvailable: boolean;
      deviceLocationUsed: boolean;
    }) => {
      nearbyPushRuntimeRef.current = payload;
      logShortcutRuntime("[RT_NEARBY_PUSH]", payload);
    },
    [],
  );

  const logRtNoMoreReason = useCallback(
    (payload: {
      caller: string;
      route: string;
      followup: boolean;
      hasActiveRecommendationContext: boolean;
      reason: string;
    }) => {
      logShortcutRuntime("[RT_NO_MORE_REASON]", {
        caller: payload.caller,
        route: payload.route,
        followup: payload.followup,
        hasActiveRecommendationContext: payload.hasActiveRecommendationContext,
        nearbyPushReturned: nearbyPushRuntimeRef.current?.returned ?? "",
        reason: payload.reason,
      });
    },
    [],
  );

  useScrollPerfMonitor("chat", messagesRef);

  useEffect(() => {
    if (hydrating || !streaming) return;
    // Dots-only loading must not re-scroll the list every animation frame.
    if (chatLoading) return;
    const lastIndex = msgs.length - 1;
    if (lastIndex >= 0 && msgs[lastIndex]?.role === "assistant") {
      scrollToAiMessageStart(lastIndex, msgs[lastIndex]?.id);
    }
  }, [hydrating, streaming, partialScrollKey, msgs, chatLoading, scrollToAiMessageStart]);

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null) return;
    if (msgs.length > prevMsgsLengthRef.current) {
      const lastIndex = msgs.length - 1;
      const last = msgs[lastIndex];
      if (last?.role === "user") {
        scrollToUserMessage(lastIndex, last.id);
      } else if (last?.role === "assistant") {
        scrollToAiMessageStart(lastIndex, last.id);
        if (
          (last.roamie?.recommendations?.length ?? 0) > 0 ||
          (last.structuredPlaces?.length ?? 0) > 0
        ) {
          requestAnimationFrame(() => {
            scrollToPlaceCardsStart(lastIndex, last.id);
          });
        }
      }
    }
    prevMsgsLengthRef.current = msgs.length;
  }, [
    hydrating,
    msgs,
    msgs.length,
    scrollToUserMessage,
    scrollToAiMessageStart,
    scrollToPlaceCardsStart,
  ]);

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null) return;
    if (prevStreamingRef.current && !streaming) {
      const lastIndex = msgs.length - 1;
      const last = msgs[lastIndex];
      if (last?.role === "assistant") {
        scrollToAiMessageStart(lastIndex, last.id);
        if (
          (last.roamie?.recommendations?.length ?? 0) > 0 ||
          (last.structuredPlaces?.length ?? 0) > 0
        ) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollToPlaceCardsStart(lastIndex, last.id);
            });
          });
        }
      }
    }
    prevStreamingRef.current = streaming;
  }, [hydrating, streaming, msgs, scrollToAiMessageStart, scrollToPlaceCardsStart]);
  const [clearing, setClearing] = useState(false);
  const fetchWeather = useServerFn(getWeather);
  const geocodeLocationFn = useServerFn(geocodeTripLocationFromText);
  const fetchPlaceDetailsFn = useServerFn(getPlaceDetailsServerFnViaGateway);
  const searchNearbyPlacesServerFn = useServerFn(searchPlaces);
  const searchNearbyPlaces = useMemo(
    () => createUnifiedSearchPlacesFn(searchNearbyPlacesServerFn),
    [searchNearbyPlacesServerFn],
  );
  const prepareDestinationCombinations = useCallback(
    async (context: CanonicalTravelContext, session: ChatPlanningSession) => {
      const comboDest =
        context.destination?.trim() ||
        session.tripPlanningContext?.destination?.trim() ||
        session.tripDestination?.city?.trim();
      if (!comboDest) return;
      const durationFields = tripDurationFieldsFromContext(context, session);
      const days = resolveValidTripDays(durationFields);
      const guard = evaluateCombinationDiscoveryGuard({
        destination: comboDest,
        destinationType: context.destinationType,
        destinationCountry: context.destinationCountry,
        destinationCity: context.destinationCity,
        destinationCountryCode: context.destinationCountryCode,
        destinationCoordinates: context.destinationCoordinates,
        destinationScopeId: context.destinationScopeId,
        ...durationFields,
        days,
        pendingQuestion: session.pendingQuestion,
        session,
      });
      logCombinationDiscoveryGuard(guard, comboDest);
      if (!guard.allowed || days == null) {
        if (guard.reason === "missing_trip_duration") {
          logTripDurationGuard({
            tripDays: days ?? null,
            startDate: context.startDate,
            endDate: context.endDate,
            valid: false,
            nextState: "waitingTripDays",
          });
        }
        return;
      }
      if (
        !hasDestinationPlanningBasics({
          destination: comboDest,
          days,
          startDate: context.startDate,
          endDate: context.endDate,
        })
      ) {
        return;
      }
      const label = normalizeDestinationLabel(comboDest);
      if (isCountryLevelDestination(label)) {
        logCountryLevelPlacesBlocked(label, "city_required");
        return;
      }
      // Always run discovery when cache is empty — never treat theme titles as ready combos.
      if (getCachedDiscoveredCombinations(label)?.length) return;
      if (getDestinationCombinations(label).length >= 3) {
        // Curated real-name combos already available — still ensure session cache is warm.
        await ensureDestinationCombinationsReady({
          destination: label,
          searchPlaces: searchNearbyPlaces,
          geocodeFn: geocodeLocationFn,
          locale,
          days,
          generationRequestId:
            context.generationRequestId?.trim() || `combo_${label}_${Date.now().toString(36)}`,
          destinationCountry:
            context.destinationCountry ??
            session.travelContext?.destinationCountry ??
            session.tripDestination?.country,
          offeredDestinationOptions:
            context.offeredDestinationOptions ?? session.travelContext?.offeredDestinationOptions,
        });
        return;
      }
      const generationRequestId =
        context.generationRequestId?.trim() || `combo_${label}_${Date.now().toString(36)}`;
      beginPlacesGenerationSession(generationRequestId);
      logAiPipeline(
        "[COMBINATION_DISCOVERY_STARTED]",
        `destination=${label}`,
        `generationRequestId=${generationRequestId}`,
      );
      const ready = await ensureDestinationCombinationsReady({
        destination: label,
        searchPlaces: searchNearbyPlaces,
        geocodeFn: geocodeLocationFn,
        locale,
        days,
        generationRequestId,
        destinationCountry:
          context.destinationCountry ??
          session.travelContext?.destinationCountry ??
          session.tripDestination?.country,
        offeredDestinationOptions:
          context.offeredDestinationOptions ?? session.travelContext?.offeredDestinationOptions,
      });
      if (!ready.ok) {
        if (
          ready.destinationResolutionFailed ||
          ready.failureReason === "destination_resolution_failed"
        ) {
          logAiPipeline(
            "[COMBINATION_DISCOVERY_FAILED]",
            `destination=${label}`,
            "status=destination_resolution_failed",
            `reason=${ready.failureDetail ?? ready.failureReason ?? "no_coordinates"}`,
            "retryable=true",
          );
        } else if ((ready.combinations?.length ?? 0) < 3) {
          logAiPipeline(
            "[COMBINATION_DISCOVERY_INSUFFICIENT]",
            `destination=${label}`,
            "reason=real_places_below_minimum",
          );
        }
      }
    },
    [searchNearbyPlaces, geocodeLocationFn, locale],
  );

  const stopDiscoveringLoadingAnimation = useCallback((reason = "cancelled") => {
    if (discoveringLoadingAnimRef.current != null) {
      clearInterval(discoveringLoadingAnimRef.current);
      discoveringLoadingAnimRef.current = null;
    }
    const requestId = discoveringLoadingRequestIdRef.current;
    if (requestId) {
      logAiPipeline("[CHAT_LOADING_DOTS_STOPPED]", `requestId=${requestId}`);
      logAiPipeline("[CHAT_LOADING_STOPPED]", `reason=${reason}`, `requestId=${requestId}`);
      discoveringLoadingRequestIdRef.current = null;
    }
    setChatLoading(null);
  }, []);

  const startDiscoveringLoadingAnimation = useCallback(
    (baseText: string, requestId: string) => {
      stopDiscoveringLoadingAnimation();
      discoveringLoadingRequestIdRef.current = requestId;
      setChatLoading({ baseText, requestId, dots: 1 });
      logAiPipeline("[CHAT_LOADING_DOTS_STARTED]", `requestId=${requestId}`);
      discoveringLoadingAnimRef.current = setInterval(() => {
        setChatLoading((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          const nextDots = prev.dots >= 3 ? 1 : prev.dots + 1;
          return { ...prev, dots: nextDots };
        });
      }, 500);
    },
    [stopDiscoveringLoadingAnimation],
  );

  const yieldToNextPaint = useCallback(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }, []);

  const commitUserMessageWithDiscoveringLoading = useCallback(
    (trimmed: string, existingMsgs: ChatMsg[]): ChatMsg[] => {
      const submitAt = Date.now();
      const requestId = `load_${submitAt.toString(36)}`;
      // Loading lives in chatLoading state — do not append an assistant bubble to msgs.
      const next: ChatMsg[] = [...existingMsgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      setStreaming(true);
      startDiscoveringLoadingAnimation("收到！我整理一下推薦", requestId);
      logAiPipeline(
        "[CHAT_SUBMIT_UI_COMMITTED]",
        `messageId=user_${submitAt}`,
        `elapsedMs=${Date.now() - submitAt}`,
      );
      logAiPipeline(
        "[CHAT_LOADING_RENDERED]",
        "text=收到！我整理一下推薦.",
        `elapsedMs=${Date.now() - submitAt}`,
      );
      requestAnimationFrame(() => {
        scrollToBottom("new_message", { force: true });
      });
      return next;
    },
    [startDiscoveringLoadingAnimation, scrollToBottom],
  );

  const stripDiscoveringLoadingMessage = useCallback((conversation: ChatMsg[]): ChatMsg[] => {
    // Legacy: strip any leftover discovering loading bubble from older builds.
    const last = conversation[conversation.length - 1];
    if (last?.role === "assistant" && last.content.startsWith("收到！我整理一下推薦")) {
      return conversation.slice(0, -1);
    }
    return conversation;
  }, []);
  const fetchPlaceDetailsForFocus = useCallback<FetchPlaceDetailsForFocusFn>(
    async (placeId, opts) => {
      const trimmedId = placeId.trim();
      if (isFallbackPlanningPlaceId(trimmedId)) {
        logPlaceDetailsSkipFallbackId(trimmedId);
        const placeName = opts?.placeName?.trim();
        const city = opts?.city?.trim();
        if (placeName && city) {
          try {
            const search = await searchNearbyPlaces({
              data: {
                query: `${city} ${placeName}`,
                mode: "text",
                locale,
                placesCaller: "style_reselect_place_resolve",
                placesScreen: "chat",
                destinationName: city,
                searchMode: "destination",
              },
            });
            const realId =
              search.places?.find((p) => (p.name ?? "").trim() === placeName)?.id ??
              search.places?.[0]?.id;
            if (realId && !isFallbackPlanningPlaceId(realId)) {
              const result = await fetchPlaceDetailsFn({ data: { placeId: realId, locale } });
              const place = result.place;
              if (place?.lat != null && place?.lng != null) {
                return {
                  lat: place.lat,
                  lng: place.lng,
                  name: place.name,
                  address: place.address,
                  placeId: place.id,
                };
              }
            }
          } catch {
            /* keep fallback basic data */
          }
        }
        return null;
      }

      const result = await fetchPlaceDetailsFn({ data: { placeId: trimmedId, locale } });
      if (result.error === "synthetic_id") return null;
      const place = result.place;
      if (!place || place.lat == null || place.lng == null) {
        if (result.error) {
          logPlaceDetailsHttp400Ignored(trimmedId);
        }
        return null;
      }
      return {
        lat: place.lat,
        lng: place.lng,
        name: place.name,
        address: place.address,
        placeId: place.id,
      };
    },
    [fetchPlaceDetailsFn, locale, searchNearbyPlaces],
  );
  const generate = useServerFn(generateItinerary);

  const selectedNames = useMemo(
    () => new Set(session.selectedPlaces.map((p) => p.name)),
    [session.selectedPlaces],
  );

  const persistSession = useCallback(
    (next: ChatPlanningSession, messagesForWorkspace?: ChatMsg[]) => {
      let sessionToSave = next;
      const workspace = upsertDraftWorkspaceFromSession({
        session: next,
        messages: messagesForWorkspace ?? msgsRef.current,
        hasPlusAccess,
        userId: readCachedAuthenticatedUserIdSync(),
      });
      sessionToSave = attachWorkspaceIdsToSession(next, workspace);
      sessionRef.current = sessionToSave;
      setSession(sessionToSave);
      saveChatSession(sessionToSave);
      if (sessionToSave.planningSelection?.mode === "planning_selection") {
        devVerboseInfo("[PLANNING_SELECTION_PERSIST]", {
          sessionId: sessionToSave.planningSelection.id,
          selectedCount: resolvePlanningSelectionPlaces(sessionToSave).length,
        });
      }
      if (sessionToSave.homeMoodShortcutEngaged) {
        homeMoodShortcutEngagedRef.current = true;
      }
    },
    [hasPlusAccess],
  );

  const persistPlanningAdviceTurn = useCallback(
    (turn: ChatTurnResult, baseSession: ChatPlanningSession) => {
      const recs = turn.advice.recommendations?.map(roamieRecToChatItem) ?? [];
      let nextSession = applyAdviceResultToSession(
        {
          ...turn.session,
          pendingQuestion: turn.route?.pendingQuestion,
          lastResolvedPendingQuestion: undefined,
          adviceSelectionThisTurn: undefined,
          lastAssistantReply: turn.advice.reply ?? baseSession.lastAssistantReply,
          recommendedPlaces: turn.advice.triggerItineraryGeneration
            ? []
            : recs.length
              ? recs
              : turn.session.recommendedPlaces,
          phase: turn.advice.triggerItineraryGeneration
            ? "generating"
            : turn.advice.contextPatch?.conversationState === "ready_for_itinerary"
              ? "ready"
              : recs.length
                ? "recommend"
                : turn.session.phase,
        },
        turn.advice,
      );
      if (turn.route?.pendingQuestion?.type === "ask_trip_style") {
        nextSession = withChatPlanningState(nextSession, "waitingStyleSelection", "ask_trip_style");
      } else if (turn.route?.pendingQuestion?.type === "ask_days") {
        nextSession = withChatPlanningState(nextSession, "waitingTripDays", "ask_days");
      } else if (turn.advice.triggerPlaceRecommendations) {
        nextSession = withChatPlanningState(nextSession, "generatingPlan", "trip_style_selected");
      }
      persistSession(nextSession);
      return nextSession;
    },
    [persistSession],
  );

  const runDirectItineraryRef = useRef<
    (
      session: ChatPlanningSession,
      context: CanonicalTravelContext,
      conversation: ChatMsg[],
    ) => Promise<void>
  >(async () => {});

  const pushDestinationPlaceRecommendationRef = useRef<
    (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        forceRegenerate?: boolean;
        replacePreviousCards?: boolean;
      },
    ) => Promise<boolean>
  >(async () => false);

  const completeAdviceTurn = useCallback(
    async (
      turn: ChatTurnResult,
      baseSession: ChatPlanningSession,
      context: CanonicalTravelContext,
      conversation: ChatMsg[],
    ) => {
      stopDiscoveringLoadingAnimation("success");
      const updated = persistPlanningAdviceTurn(turn, baseSession);
      const userText = [...conversation].reverse().find((m) => m.role === "user")?.content ?? "";
      const conversationBase = stripDiscoveringLoadingMessage(conversation);
      const withReply: ChatMsg[] = turn.advice.triggerPlaceRecommendations
        ? conversationBase
        : turn.advice.triggerItineraryGeneration
          ? conversationBase
          : [...conversationBase, adviceToAssistantChatMsg(turn.advice)];
      if (!turn.advice.triggerPlaceRecommendations) {
        setMsgs(withReply);
        if (!turn.advice.triggerItineraryGeneration) {
          setStreaming(false);
        }
        const pendingType = turn.advice.pendingQuestion?.type ?? "";
        if (pendingType === "ask_days" || pendingType === "duration_choice") {
          logRtResponseBranch("trip_duration_question");
        } else if (pendingType === "region_choice") {
          logRtResponseBranch("destination_clarification");
        } else {
          logRtResponseBranch("other");
        }
      }
      if (turn.advice.triggerItineraryGeneration) {
        const planRequestId = `plan_${Date.now().toString(36)}`;
        startDiscoveringLoadingAnimation("正在整理並規劃中", planRequestId);
        setGenerating(true);
        setStreaming(true);
        persistSession({
          ...updated,
          phase: "generating",
          aiItineraryState: "CREATING_TRIP",
          recommendedPlaces: [],
        });
        await runDirectItineraryRef.current(
          {
            ...updated,
            phase: "generating",
            aiItineraryState: "CREATING_TRIP",
            recommendedPlaces: [],
          },
          { ...context, ...turn.advice.contextPatch },
          withReply,
        );
        stopDiscoveringLoadingAnimation();
        setStreaming(false);
      }
      const planningHandle = turn.advice.triggerPlaceRecommendations
        ? getOrCreatePlanningSessionId(
            withChatPlanningState(updated, "generatingPlan", "trigger_place_recommendations"),
            "trigger_place_recommendations",
          )
        : null;
      if (planningHandle) {
        persistSession(planningHandle.session);
      }

      if (turn.advice.triggerPlaceRecommendations && planningHandle) {
        setStreaming(true);
        try {
          logAiRenderItineraryStart();
          const styleReselect = isStyleReselectTurn(userText, planningHandle.session, {
            ...context,
            ...turn.advice.contextPatch,
          });
          const advicePlaceCtx = {
            ...(planningHandle.session.travelContext ?? context),
            ...turn.advice.contextPatch,
            planningDaysConfirmed:
              turn.advice.contextPatch?.planningDaysConfirmed ??
              planningHandle.session.travelContext?.planningDaysConfirmed ??
              context.planningDaysConfirmed ??
              Boolean(planningHandle.session.travelContext?.days ?? context.days),
          };
          const sessionForAdvice = styleReselect
            ? applyStyleReselectToSession(planningHandle.session, advicePlaceCtx, styleReselect)
            : {
                ...planningHandle.session,
                travelContext: advicePlaceCtx,
              };
          if (styleReselect) {
            persistSession(sessionForAdvice);
          }
          const applied = await pushDestinationPlaceRecommendationRef.current(
            sessionForAdvice,
            userText,
            conversationBase,
            {
              forceRegenerate: true,
              replacePreviousCards: Boolean(styleReselect),
            },
          );
          if (applied) {
            const live = loadChatSession();
            const count = live.recommendedPlaces?.length ?? live.currentDayPlan?.items.length ?? 0;
            logAiRenderItinerarySuccess(count);
            if (styleReselect) {
              logChatRegeneratePlaceCardsDone(count);
            }
          } else {
            const live = loadChatSession();
            const placeCtx = {
              ...(live.travelContext ?? context),
              ...turn.advice.contextPatch,
            };
            const label =
              resolveConversationDestination(placeCtx, live) ?? placeCtx.destination?.trim();
            const namedRecs = label ? buildNamedFallbackRecommendations(label) : [];
            if (namedRecs.length && label) {
              const intro = buildWeatherAwarePlaceIntro(
                label,
                resolveWeatherScene(live.weather ?? null, label),
                false,
              );
              const summary = [
                intro,
                "",
                ...namedRecs.map(
                  (rec, index) =>
                    `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
                ),
                "",
                "想加進行程的話，跟我說你最想先排哪幾個。",
              ].join("\n");
              setMsgs([
                ...conversationBase,
                {
                  role: "assistant",
                  content: summary,
                  roamie: {
                    version: 2,
                    title: "必去推薦",
                    summary,
                    moodTag: placeCtx.mood ?? "",
                    recommendations: namedRecs,
                    itinerary: [],
                    generatedAt: new Date().toISOString(),
                  },
                },
              ]);
              persistSession(
                withChatPlanningState(
                  {
                    ...live,
                    recommendedPlaces: namedRecs as ChatPlaceItem[],
                    phase: "recommend",
                    pendingQuestion: undefined,
                  },
                  "planGenerated",
                  "style_plan_named_fallback",
                ),
              );
            } else if (turn.advice.reply?.trim()) {
              setMsgs([...conversationBase, adviceToAssistantChatMsg(turn.advice)]);
            }
          }
        } finally {
          setStreaming(false);
        }
      }
    },
    [
      persistPlanningAdviceTurn,
      stopDiscoveringLoadingAnimation,
      stripDiscoveringLoadingMessage,
      startDiscoveringLoadingAnimation,
    ],
  );

  useEffect(() => {
    return () => {
      stopDiscoveringLoadingAnimation();
    };
  }, [stopDiscoveringLoadingAnimation]);

  const markShortcutEngaged = useCallback(() => {
    homeMoodShortcutEngagedRef.current = true;
    setSession((prev) => {
      const next = markHomeMoodShortcutEngaged(prev);
      if (next === prev) return prev;
      saveChatSession(next);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (peekChatUiCache()) return;
      const pending = loadChatSession();
      if (pending.homeMoodShortcutEngaged || homeMoodShortcutEngagedRef.current) return;
      if (!shouldDiscardHomeMoodShortcutSession(pending)) return;
      abortRef.current?.abort();
      clearChatSession();
      void clearChatHistory();
    };
  }, []);

  useEffect(() => {
    if (
      hydrating ||
      !initialRestoreSettledRef.current ||
      session.fromMoodFlow ||
      session.fromMoodCard ||
      session.fromPlusHome ||
      session.fromTripAddPlace
    ) {
      return;
    }
    setMsgs((prev) => {
      if (prev.length === 0) return [greetingMsg];
      if (
        prev.length === 1 &&
        prev[0].role === "assistant" &&
        !prev[0].roamie &&
        prev[0].content !== greetingMsg.content
      ) {
        logAiPipeline("[NEARBY_FALLBACK]", "reason=handoff_overwritten_prevented");
      }
      return prev;
    });
  }, [
    greetingMsg,
    hydrating,
    session.fromMoodFlow,
    session.fromMoodCard,
    session.fromPlusHome,
    session.fromTripAddPlace,
  ]);

  useEffect(() => {
    if (hydrating || streaming) return;
    if (!session.fromTripAddPlace || !session.tripAddPlaceContext) return;
    if (msgs.length > 0) return;

    logTripAddPlaceRenderEmpty({
      reason: "blank_after_ready",
      messagesCount: 0,
      candidatesCount: session.recommendedPlaces?.length ?? 0,
      structuredPlacesCount: 0,
      loading: false,
    });

    const recs = (session.recommendedPlaces ?? []) as RoamieRecommendationItem[];
    if (recs.length) {
      setMsgs([
        buildTripAddPlaceAssistantMessage(
          session.lastAssistantReply ?? "",
          recs,
          session.mood ?? undefined,
          session,
        ),
      ]);
      return;
    }

    setMsgs([
      session.tripAddPlaceHandoffDone
        ? { role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }
        : buildTripAddPlaceRenderFallbackMessage(session),
    ]);
  }, [
    hydrating,
    streaming,
    msgs.length,
    session,
    session.fromTripAddPlace,
    session.tripAddPlaceContext,
    session.tripAddPlaceHandoffDone,
    session.recommendedPlaces,
    session.lastAssistantReply,
    session.mood,
  ]);

  useEffect(() => {
    let cancelled = false;
    initialRestoreSettledRef.current = false;
    setHydrating(true);
    (async () => {
      try {
        const uiCache = consumeChatUiCache();
        if (uiCache?.msgs?.length) {
          let session = loadChatSession();
          homeMoodShortcutEngagedRef.current = true;
          if (session.homeMoodShortcutEntry && !session.homeMoodShortcutEngaged) {
            session = markHomeMoodShortcutEngaged(session);
            saveChatSession(session);
          }
          setSession(session);
          setMsgs(uiCache.msgs);
          pendingScrollTopRef.current = uiCache.scrollTop;
          chatLifecycleEstablishedRef.current = true;
          const places = await listPlaces();
          setSavedNames(new Set(places.map((p) => p.name)));
          return;
        }

        // Plus: only restore Conversation State when user explicitly opens a Workspace.
        if (search.workspaceId && hasPlusAccess) {
          if (
            chatLifecycleEstablishedRef.current &&
            restoredWorkspaceIdRef.current === search.workspaceId
          ) {
            return;
          }
          const workspace = loadConversationWorkspace(
            search.workspaceId,
            readCachedAuthenticatedUserIdSync(),
          );
          if (workspace?.planningSession) {
            logWorkspaceRestored(workspace.workspaceId);
            let session: ChatPlanningSession = {
              ...workspace.planningSession,
              workspaceId: workspace.workspaceId,
              conversationId: workspace.conversationId,
            };
            session = restoreActiveRecommendationContextFromWorkspace({
              session,
              workspaceContext: workspace.activeRecommendationContext,
            });
            setActiveWorkspaceId(workspace.workspaceId);
            // Open ≠ Update: restore live session only — do not upsert/bump updatedAt.
            const sessionToSave = session;
            setSession(sessionToSave);
            saveChatSession(sessionToSave);
            chatLifecycleEstablishedRef.current = true;
            restoredWorkspaceIdRef.current = workspace.workspaceId;
            const places = await listPlaces();
            if (!cancelled) setSavedNames(new Set(places.map((p) => p.name)));
            if (workspace.messages?.length) {
              setMsgs(workspace.messages);
            } else {
              setMsgs([greetingMsg]);
            }
            return;
          }
        }

        // Already established this mount — keep live session (do not re-load stale storage).
        if (chatLifecycleEstablishedRef.current) {
          return;
        }

        // Free + Plus default: opening chat without Workspace/handoff = brand-new session.
        if (shouldStartFreshChatSession(search)) {
          const previous = loadChatSession();
          const fresh = beginNewChatSession({
            reason: "chat_page_open",
            previous,
            hasPlusAccess,
          });
          await clearChatHistory();
          persistSession(fresh);
          setSession(fresh);
          setMsgs([greetingMsg]);
          homeMoodShortcutEngagedRef.current = false;
          chatLifecycleEstablishedRef.current = true;
          restoredWorkspaceIdRef.current = null;
          const places = await listPlaces();
          if (!cancelled) setSavedNames(new Set(places.map((p) => p.name)));
          return;
        }

        let session = loadChatSession();
        homeMoodShortcutEngagedRef.current = Boolean(session.homeMoodShortcutEngaged);

        if (search.from === "trip_add_place") {
          const handoff = consumeTripAddPlaceHandoff();
          if (handoff && (!search.tripId || handoff.tripId === search.tripId)) {
            const bundle = handoff.destinationLocation
              ? await buildContextBundleForTrip(handoff.destinationLocation, fetchWeather)
              : await buildClientContextBundle(fetchWeather);
            const enrichedHandoff = {
              ...handoff,
              weather: handoff.weather ?? bundle.weather,
            };
            session = prepareTripAddPlaceSession(enrichedHandoff, bundle);
            await clearChatHistory();
            persistSession(session);
            setSession(session);
            homeMoodShortcutEngagedRef.current = true;
          }
        }

        if (session.fromTripAddPlace && session.tripAddPlaceContext) {
          session = reinforceTripAddPlaceSession(session);
          setSession(session);
          logTripAddPlaceMode(
            session,
            search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
          );
        }

        const homeShortcutEntry = isHomeMoodShortcutSearch(search);
        if (!homeShortcutEntry && shouldDiscardHomeMoodShortcutSession(session)) {
          await discardHomeMoodShortcutSession();
          session = createEmptySession();
          homeMoodShortcutEngagedRef.current = false;
        }

        const moodId = normalizeHomeMoodId(search.mood?.trim() || readHomeMood());
        if (search.from !== "trip_add_place" && moodId && homeShortcutEntry) {
          const moodLabel = t(`home.moods.${moodId}`);
          const moodPrompt = search.prompt?.trim() || t(`home.moodPrompts.${moodId}`);
          let moodSession = beginHomeMoodShortcutSession(session, moodLabel, moodId);
          const bundle = await buildClientContextBundle(fetchWeather);
          moodSession = {
            ...moodSession,
            location: bundle.location,
            weather: bundle.weather,
            phase: "recommend",
          };
          const mergedMood = mergeTravelContext(moodSession, moodPrompt);
          session = mergedMood.session;
          homeMoodShortcutEngagedRef.current = false;
          clearHomeMoodUiSelection();
          persistSession(session);
        } else if (moodId && !session.homeMoodShortcutEngaged && search.from !== "trip_add_place") {
          const moodLabel = t(`home.moods.${moodId}`);
          const moodPrompt = search.prompt?.trim() || t(`home.moodPrompts.${moodId}`);
          let moodSession: ChatPlanningSession = {
            ...session,
            mood: moodLabel,
            selectedMood: moodLabel,
            fromMoodCard: true,
            fromMoodFlow: search.from === "mood" ? true : session.fromMoodFlow,
            activeChatIntent: moodId === "coffee" ? "cafe" : "attraction",
          };
          if (search.from === "mood") {
            const bundle = await buildClientContextBundle(fetchWeather);
            moodSession = {
              ...moodSession,
              location: bundle.location,
              weather: bundle.weather,
              fromMoodFlow: true,
              activeChatIntent: moodId === "coffee" ? "cafe" : "attraction",
              phase: "recommend",
            };
          }
          const mergedMood = mergeTravelContext(moodSession, moodPrompt);
          session = mergedMood.session;
          clearHomeMoodUiSelection();
          persistSession(session);
        } else if (search.from === "plus-home" && hasPlusAccess && !session.fromPlusHome) {
          const prefs = await getAiPreferences();
          session = preparePlusHomeChatSession({
            mood: session.selectedMood,
            prefs,
          });
          persistSession(session);
        }

        const isMoodFlow =
          search.fromMoodFlow === "1" ||
          search.from === "mood" ||
          (search.from === "recommendations" && !!search.recommendationId);

        if (isMoodFlow && search.recommendationId) {
          const record = await getRecommendation(search.recommendationId);
          const payload =
            record?.payload && isRoamiePayloadV2(record.payload) ? record.payload : null;
          if (record && payload?.recommendations?.length) {
            const bundle = await buildClientContextBundle(fetchWeather);
            const prefs = await getAiPreferences();
            const handoffDone = session.moodHandoffDone || isMoodHandoffDoneForRec(record.id);
            session = prepareMoodFlowSession({
              record,
              payload,
              bundle,
              preferences: prefs,
              existing: {
                ...session,
                moodHandoffDone: handoffDone,
                pendingHandoff: handoffDone ? false : true,
              },
            });
            persistSession(session);
          }
        } else {
          persistSession(session);
        }

        chatLifecycleEstablishedRef.current = true;

        const places = await listPlaces();
        setSavedNames(new Set(places.map((p) => p.name)));

        const current = loadChatSession();
        const handoffKey = current.recommendationId ?? search.recommendationId ?? "";
        const shouldRunHandoff =
          current.fromMoodFlow &&
          current.pendingHandoff &&
          !current.moodHandoffDone &&
          handoffStartedRef.current !== handoffKey;

        if (shouldRunHandoff && handoffKey) {
          handoffStartedRef.current = handoffKey;
          setMsgs([greetingMsg]);
          await runRecommendationHandoff(current);
        } else {
          const shouldRunTripAddPlaceHandoff =
            current.fromTripAddPlace &&
            current.tripAddPlaceContext &&
            current.pendingHandoff &&
            !current.tripAddPlaceHandoffDone;

          if (shouldRunTripAddPlaceHandoff) {
            tripAddPlaceHandoffStartedRef.current = true;
            setMsgs([buildTripAddPlaceLoadingMessage()]);
            setSession(reinforceTripAddPlaceSession(current));
            try {
              await runTripAddPlaceHandoff(current);
            } catch (handoffError) {
              console.error("[TRIP_ADD_PLACE_HANDOFF_FAILED]", handoffError);
              if (!cancelled) {
                const fallback = buildTripAddPlaceRenderFallbackMessage(current, {
                  error:
                    handoffError instanceof Error ? handoffError.message : String(handoffError),
                });
                setMsgs([fallback]);
                persistSession(
                  markTripAddPlaceHandoffComplete({
                    ...current,
                    lastAssistantReply: fallback.content,
                  }),
                );
              }
            }
          } else if (
            (search.from === "plan" || search.from === "plan-ai") &&
            current.fromPlanForm &&
            current.pendingHandoff &&
            !current.planHandoffDone &&
            !planHandoffStartedRef.current
          ) {
            planHandoffStartedRef.current = true;
            const selectionTrace = current.planningSelectionHandoffTrace;
            if (selectionTrace) {
              logPlanningSelectionHandoffStage("handoff_consume_start", selectionTrace, {
                sessionId: current.planningSelection?.id,
              });
            }
            setMsgs([greetingMsg]);
            if (selectionTrace) {
              logPlanningSelectionHandoffStage("handoff_consume_done", selectionTrace, {
                sessionId: current.planningSelection?.id,
              });
            }
            await runPlanFormHandoff(current);
          } else if (
            current.fromPlusHome &&
            current.pendingHandoff &&
            !current.plusHomeHandoffDone &&
            hasPlusAccess
          ) {
            const summary = buildPlusHomeHandoffOpening(current, current.plusHomeInsight);
            const opener: ChatMsg = {
              role: "assistant",
              content: summary,
              roamie: buildHandoffRoamiePayload(current, summary),
            };
            setMsgs([opener]);
            persistSession(markPlusHomeHandoffComplete(current));
          } else if (current.fromMoodFlow && current.moodHandoffDone) {
            const history = await loadChatHistory();
            if (history.length) {
              setMsgs(history);
            } else {
              const summary = buildContextualMoodHandoffOpening(current);
              const opener: ChatMsg = {
                role: "assistant",
                content: summary,
                roamie: buildHandoffRoamiePayload(current, summary),
              };
              setMsgs([opener]);
            }
          } else if (current.fromTripAddPlace && current.tripAddPlaceHandoffDone) {
            const restored = reinforceTripAddPlaceSession(current);
            persistSession(restored);
            setSession(restored);
            logTripAddPlaceMode(
              restored,
              search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
            );
            const history = await loadChatHistory();
            const recs = (restored.recommendedPlaces ?? []) as RoamieRecommendationItem[];
            if (history.length) {
              setMsgs(mergeTripAddPlaceHistoryWithRecommendations(history, restored));
            } else if (recs.length) {
              const summary =
                restored.lastAssistantReply?.trim() ||
                recs.map((r, i) => `${i + 1}. ${r.name}`).join("\n");
              setMsgs([
                buildTripAddPlaceAssistantMessage(
                  summary,
                  recs,
                  restored.mood ?? undefined,
                  restored,
                ),
              ]);
            } else {
              setMsgs([{ role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }]);
            }
          } else if (current.fromTripAddPlace && current.tripAddPlaceContext) {
            const restored = reinforceTripAddPlaceSession(current);
            persistSession(restored);
            setSession(restored);
            logTripAddPlaceMode(
              restored,
              search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
            );
            const history = await loadChatHistory();
            if (history.length) {
              setMsgs(mergeTripAddPlaceHistoryWithRecommendations(history, restored));
            } else {
              setMsgs([{ role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }]);
            }
          } else if (search.from === "plan" || search.from === "plan-ai" || search.from === "map") {
            // Handoff-seeded session: prefer live session over durable chat_messages history.
            const history = await loadChatHistory();
            if (history.length) setMsgs(history);
            else setMsgs([greetingMsg]);
          } else {
            // Do not auto-load prior Supabase history into a handoff that already has opener;
            // for remaining handoffs without opener, show greeting rather than stale trip state.
            setMsgs([greetingMsg]);
          }
        }
      } catch (e) {
        console.error(e);
        const current = loadChatSession();
        if (current.fromTripAddPlace && current.tripAddPlaceContext && !cancelled) {
          logTripAddPlaceRenderEmpty({
            reason: "hydrate_error",
            messagesCount: 0,
            candidatesCount: current.recommendedPlaces?.length ?? 0,
            structuredPlacesCount: 0,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
          setMsgs([
            current.tripAddPlaceHandoffDone
              ? { role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }
              : buildTripAddPlaceRenderFallbackMessage(current, {
                  error: e instanceof Error ? e.message : String(e),
                }),
          ]);
        }
      } finally {
        initialRestoreSettledRef.current = true;
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search.recommendationId,
    search.from,
    search.mood,
    search.tripId,
    search.workspaceId,
    hasPlusAccess,
    t,
  ]);

  useEffect(() => {
    if (hydrating) return;
    const prompt = search.prompt?.trim();
    if (!prompt || autoPromptHandledRef.current) return;
    autoPromptHandledRef.current = true;
    void send(prompt, { source: search.from === "mood" ? "home_mood" : "auto" });
    void navigate({
      to: "/chat",
      search: {
        from: search.from,
        recommendationId: search.recommendationId,
        fromMoodFlow: search.fromMoodFlow,
        mood: search.mood,
      },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrating, search.prompt]);

  const handleAddToTripFromChat = useCallback(
    async (rec: RoamieRecommendationItem) => {
      markShortcutEngaged();
      const ctx = session.tripAddPlaceContext;
      if (session.fromTripAddPlace && ctx) {
        if (!isValidUuid(ctx.tripId)) {
          toast.error("行程 ID 無效，請從行程頁重新進入");
          navigate({ to: "/saved", search: { tab: "trips" } });
          return;
        }
        try {
          await appendPlaceToTrip(
            { kind: "trip", tripId: ctx.tripId },
            tripPlaceFromRecommendation(rec),
            { date: ctx.dateKey, position: "end" },
          );
          persistSession(markTripAddPlaceAdded(session, rec));
          toast.success("已加入行程");
          logTripNav("ChatTripAddPlace", ctx.tripId);
          navigate(tripDetailNavigateOptions(ctx.tripId, { day: ctx.selectedDay }));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "加入行程失敗");
        }
        return;
      }
      openAddToTrip(tripPlaceFromRecommendation(rec));
    },
    [
      session.fromTripAddPlace,
      session.tripAddPlaceContext,
      navigate,
      openAddToTrip,
      persistSession,
    ],
  );

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
    markShortcutEngaged();
    setSavingName(rec.name);
    try {
      const { saved } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: rec.name,
          category: rec.type,
          address: rec.address || null,
          city: session.location?.city ?? null,
          lat: rec.lat ?? null,
          lng: rec.lng ?? null,
          notes: rec.reason,
          mood_tag: session.mood ?? partial.moodTag ?? null,
          placeId: rec.googlePlaceId,
          googlePlaceId: rec.googlePlaceId,
          photoName: rec.photoName,
          rating: rec.rating,
          userRatingCount: rec.userRatingCount,
        }),
      );
      setSavedNames((prev) => {
        const next = new Set(prev);
        if (saved) next.add(rec.name);
        else next.delete(rec.name);
        return next;
      });
      toast.success(saved ? "已收藏" : "已取消收藏");
      if (saved) {
        persistSession(addSelectedPlace(session, roamieRecToChatItem(rec)));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSavingName(null);
    }
  };

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null && messagesRef.current) {
      const top = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
      requestAnimationFrame(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = top;
      });
    }
  }, [msgs, streaming, partial, generating, hydrating]);

  const buildRequest = useCallback(
    async (
      conversation: ChatMsg[],
      overrides?: Partial<{
        chatPhase: import("@/lib/ai/context").ChatPhase;
        chatInput: string;
        userText: string;
        focusedPlace: ChatPlaceItem;
      }>,
      sessionOverride?: ChatPlanningSession,
    ) => {
      const activeSession = sessionOverride ?? session;
      const syncedForBundle = syncSessionPlaceMemory(activeSession);
      const bundle = syncedForBundle.tripDestination
        ? await buildContextBundleForTrip(syncedForBundle.tripDestination, fetchWeather)
        : await buildClientContextBundle(fetchWeather);
      const prefs = await getAiPreferences();
      const apiMessages = buildApiMessagesFromConversation(
        conversation.filter((m) => m.content !== t("chat.greeting")),
      );
      const lastUser = [...apiMessages].reverse().find((m) => m.role === "user");
      const userText = overrides?.userText ?? lastUser?.content ?? "";

      const savedList = await listPlaces();
      const planTier = await resolveEffectivePlanTierWithProfile();
      const synced = syncSessionPlaceMemory(activeSession);
      const tripIntent = parseTripIntentFromSession(synced);
      const apiPhase: import("@/lib/ai/context").ChatPhase =
        overrides?.chatPhase ?? resolveChatApiPhase(synced, userText, undefined, tripIntent);
      const tripIntentBlock = formatTripIntentForAi(tripIntent, prefs);
      devVerboseInfo("[Roamie AI] request context", {
        phase: apiPhase,
        destination: tripIntent.destinationCity ?? synced.location?.city ?? null,
        missing: tripIntent.missingKeys,
        planTier,
      });
      const initialCtx = [
        buildTravelContext(
          userText,
          updateTripDraftFromConversation(
            {
              destination: tripIntent.destinationCity,
              startDate: synced.tripStartDate,
              endDate: synced.tripEndDate,
              days: synced.tripDays,
              origin: synced.tripOrigin ? formatTripLocationLabel(synced.tripOrigin) : undefined,
              transportMode: synced.transportation,
              mood: synced.selectedMood ?? synced.mood,
            },
            extractTravelIntent(userText),
          ),
          {
            mood: synced.selectedMood ?? synced.mood,
            preferences: synced.discovery,
            savedPlaceNames: synced.selectedPlaceNames,
          },
          {
            ...bundle,
            mode: "chat",
            chatInput: userText,
            location: bundle.location,
            weather: bundle.weather,
            selectedPlaces: synced.selectedPlaces,
            plannedStops: synced.plannedStops,
            savedPlaceNames: savedList.map((p) => p.name),
            planTier,
          },
        ),
        synced.initialChatContext ?? buildInitialChatContext(synced),
        buildPlanningMemoryContext(synced),
        tripIntentBlock,
        synced.travelContext ? formatTravelContextForAi(synced.travelContext) : "",
        synced.tripPlanningContext
          ? formatTripPlanningContextForAi(synced.tripPlanningContext)
          : "",
        synced.placeDetailFocus
          ? [
              "【Place Detail Context】",
              `mode: place_detail`,
              `previousMode: ${synced.previousConversationMode ?? "mood_recommend"}`,
              `selectedPlace: ${placeDisplayName(synced.placeDetailFocus)}`,
              synced.placeDetailFocus.placeId ? `placeId: ${synced.placeDetailFocus.placeId}` : "",
              synced.placeDetailFocus.address ? `address: ${synced.placeDetailFocus.address}` : "",
              synced.placeDetailFocus.type ? `type: ${synced.placeDetailFocus.type}` : "",
              synced.placeDetailFocus.reason
                ? `recommendationReason: ${synced.placeDetailFocus.reason}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const recentNames = [
        ...new Set([
          ...loadRecentRecommendationNames(),
          ...extractPlaceNames(synced.selectedPlaces),
          ...(synced.plannedStops ? extractPlaceNames(synced.plannedStops) : []),
        ]),
      ];

      const base = toRoamieRequest("chat", bundle, {
        mood: synced.selectedMood ?? synced.mood,
        locale,
        preferences: prefs,
        planTier,
        chatInput: overrides?.chatInput ?? userText,
        lastUserIntent: userText || synced.lastUserIntent,
        messages: apiMessages,
        chatPhase: apiPhase,
        time: bundle.time,
        fromMoodCard: synced.fromMoodCard,
        fromMoodFlow: synced.fromMoodFlow,
        fromPlanForm: synced.fromPlanForm,
        fromPlanAi: synced.fromPlanAi,
        planAiMode: synced.planAiMode,
        selectedMood: synced.selectedMood ?? synced.mood,
        selectedCategory: synced.selectedCategory ?? synced.mood,
        initialChatContext: initialCtx,
        lateNightMode: synced.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
        avoidTypes: synced.avoidTypes,
        preferredArea: synced.preferredArea,
        rejectedPlaceNames: synced.rejectedPlaceNames,
        focusedPlace: overrides?.focusedPlace,
        selectedPlaces: synced.selectedPlaces,
        selectedPlaceIds: synced.selectedPlaceIds,
        selectedPlaceNames: synced.selectedPlaceNames,
        plannedStops: synced.plannedStops,
        recommendedPlaces: synced.recommendedPlaces,
        recentRecommendationNames: recentNames,
        savedPlaceNames: savedList.map((p) => p.name),
        planningHints: {
          vibe: synced.discovery?.vibe,
          companionship: synced.discovery?.companionship,
          setting: synced.discovery?.setting,
          mustVisit: synced.discovery?.mustVisit,
          transportation: synced.transportation,
          budget: synced.budget,
          pace: synced.pace,
          travelDate: synced.travelDate,
          startTime: synced.startTime,
          endTime: synced.endTime,
          conversationSummary: [tripIntentBlock, buildConversationSummary(synced, conversation)]
            .filter(Boolean)
            .join("\n\n"),
          fromMoodCard: synced.fromMoodCard,
          fromMoodFlow: synced.fromMoodFlow,
          selectedMood: synced.selectedMood ?? synced.mood,
          selectedCategory: synced.selectedCategory,
          lateNightMode: synced.lateNightMode,
          initialChatContext: initialCtx,
          avoidTypes: synced.avoidTypes,
          preferredArea: synced.preferredArea,
          rejectedPlaceNames: synced.rejectedPlaceNames,
          lastUserIntent: userText || synced.lastUserIntent,
        },
      });

      const enriched = await enrichRoamieContext(base, {
        session: synced,
        userText,
        conversation,
        tripIntent,
        planTier,
        weather: bundle.weather,
      });
      devVerboseInfo("[Roamie AI] dialogue stage", {
        stage: enriched.conversationStage,
        chatPhase: enriched.chatPhase,
      });
      return enriched;
    },
    [fetchWeather, session, locale, t],
  );

  const runRecommendationHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      setStreaming(true);
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const bundle = await buildClientContextBundle(fetchWeather);
        const prefs = await getAiPreferences();

        const focused =
          handoffSession.selectedPlaceFromMood ??
          (handoffSession.selectedPlaces.length === 1
            ? handoffSession.selectedPlaces[0]
            : undefined);

        const syncedHandoff = syncSessionPlaceMemory(handoffSession);
        const initialCtx = [
          syncedHandoff.initialChatContext ?? buildInitialChatContext(syncedHandoff),
          buildPlanningMemoryContext(syncedHandoff),
        ]
          .filter(Boolean)
          .join("\n\n");
        const recentNames = [
          ...new Set([
            ...loadRecentRecommendationNames(),
            ...extractPlaceNames(syncedHandoff.selectedPlaces),
          ]),
        ];

        const req = toRoamieRequest("chat", bundle, {
          mood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
          locale,
          preferences: prefs,
          chatPhase: "handoff",
          time: bundle.time,
          fromMoodCard: true,
          fromMoodFlow: true,
          selectedMood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
          selectedCategory: syncedHandoff.selectedCategory ?? syncedHandoff.mood,
          initialChatContext: initialCtx,
          lateNightMode: syncedHandoff.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
          focusedPlace: focused,
          selectedPlaces: syncedHandoff.selectedPlaces,
          selectedPlaceIds: syncedHandoff.selectedPlaceIds,
          selectedPlaceNames: syncedHandoff.selectedPlaceNames,
          plannedStops: syncedHandoff.plannedStops,
          recommendedPlaces: syncedHandoff.recommendedPlaces,
          recentRecommendationNames: recentNames,
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: [initialCtx, syncedHandoff.conversationSummary]
              .filter(Boolean)
              .join("\n\n"),
            fromMoodCard: true,
            fromMoodFlow: true,
            selectedMood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
            selectedCategory: syncedHandoff.selectedCategory,
            lateNightMode: syncedHandoff.lateNightMode,
            initialChatContext: initialCtx,
          },
        });

        let summary = buildContextualMoodHandoffOpening(syncedHandoff);
        let roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summary);

        try {
          const full = await fetchRoamieAI(req, { token });
          if (full.summary?.trim()) {
            summary = full.summary;
            const aiRecs =
              full.recommendations?.length > 0
                ? full.recommendations.map(roamieRecToChatItem)
                : undefined;
            roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summary, aiRecs);
          }
        } catch (e) {
          console.warn("[Roamie] handoff AI failed, using fallback", e);
        }

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            syncedHandoff,
            "",
            summary,
            (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
          );
        const opener: ChatMsg = {
          role: "assistant",
          content: displaySummary,
          roamie: {
            ...roamiePayload,
            summary: displaySummary,
            recommendations: filteredRecs,
          },
        };
        setMsgs([opener]);

        const nextSession = syncSessionPlaceMemory(
          markMoodHandoffComplete({
            ...syncedHandoff,
            phase: syncedHandoff.selectedPlaces.length ? "followup" : "collect",
            recommendedPlaces: filteredRecs.length
              ? (filteredRecs as ChatPlaceItem[])
              : syncedHandoff.recommendedPlaces,
            initialChatContext: initialCtx,
          }),
        );
        persistSession(nextSession);
      } finally {
        setStreaming(false);
      }
    },
    [fetchWeather, persistSession],
  );

  const runPlanFormHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      const selectionTrace = handoffSession.planningSelectionHandoffTrace;
      let selectionLoadingCleared = false;
      setStreaming(true);
      if (selectionTrace) {
        logPlanningSelectionHandoffStage("initial_recommendation_start", selectionTrace, {
          sessionId: handoffSession.planningSelection?.id,
        });
        logPlanningSelectionHandoffLoading(
          selectionTrace,
          true,
          "initial_recommendation",
          "places_recommendation",
        );
      }
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const dest = handoffSession.tripDestination;
        if (!dest) {
          toast.error("缺少目的地資訊，請回到規劃頁重新選擇");
          return;
        }

        const bundle = await buildContextBundleForTrip(dest, fetchWeather, {
          weatherBlocking: !isPlanningSelectionMode(handoffSession),
        });
        const prefs = await getAiPreferences();
        const syncedHandoff = syncSessionPlaceMemory({
          ...handoffSession,
          location: bundle.location,
          weather: bundle.weather,
        });
        const initialCtx = [
          syncedHandoff.initialChatContext ?? "",
          buildPlanningMemoryContext(syncedHandoff),
        ]
          .filter(Boolean)
          .join("\n\n");

        if (isPlanningSelectionMode(syncedHandoff)) {
          if (!ensureSubscriptionHydratedForCredits()) return;
          const creditsGate = await beginPlaceRecommendationCredits({
            hasPlusAccess,
            metadata: { path: "planning_selection_initial" },
          });
          if (creditsGate.blocked) {
            setMsgs([{ role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE }]);
            return;
          }
          let creditsHandle: CreditsOperationHandle | null = creditsGate.handle;
          let delivered = false;
          try {
            const selectionResult = await fetchPlanningSelectionRecommendations({
              session: syncedHandoff,
              searchPlaces: searchNearbyPlaces,
              locale,
              userProfile: userProfileForReasonFrom(prefs, {
                mood: syncedHandoff.mood,
                hasPlusAccess,
              }),
            });
            const summary = selectionResult.places.length
              ? `我依照你選的「${selectionResult.session.planningSelection?.styles.join("、")}」先找了這些地點。喜歡的就按「＋ 加入這地點」，也可以叫我再推薦一些。`
              : "目前這批沒有找到合適地點，你可以按「再推薦一些」換一批。";
            const nextSession = markPlanHandoffComplete(selectionResult.session);
            setMsgs([
              {
                role: "assistant",
                content: summary,
                roamie: { summary, recommendations: selectionResult.places, itinerary: [] },
              },
            ]);
            if (selectionTrace) {
              logPlanningSelectionHandoffStage("initial_recommendation_done", selectionTrace, {
                sessionId: selectionResult.session.planningSelection?.id,
              });
              logPlanningSelectionHandoffStage("selection_first_render", selectionTrace, {
                sessionId: selectionResult.session.planningSelection?.id,
              });
            }
            persistSession(nextSession);
            delivered = selectionResult.places.length > 0;
          } finally {
            // Credit settlement keeps its existing authority, but its remote
            // refresh is not a first-card render dependency.
            setStreaming(false);
            selectionLoadingCleared = true;
            if (selectionTrace) {
              logPlanningSelectionHandoffStage("handoff_loading_clear", selectionTrace, {
                sessionId: handoffSession.planningSelection?.id,
              });
              logPlanningSelectionHandoffLoading(selectionTrace, false, "cards_settled", null);
            }
            await settleCreditsOperation(creditsHandle, delivered);
            creditsHandle = null;
          }
          return;
        }

        const req = toRoamieRequest("chat", bundle, {
          mood: syncedHandoff.mood,
          locale,
          preferences: prefs,
          chatPhase: "expand",
          time: bundle.time,
          fromPlanForm: true,
          fromPlanAi: syncedHandoff.fromPlanAi,
          planAiMode: syncedHandoff.planAiMode,
          initialChatContext: initialCtx,
          selectedPlaces: syncedHandoff.selectedPlaces,
          selectedPlaceIds: syncedHandoff.selectedPlaceIds,
          selectedPlaceNames: syncedHandoff.selectedPlaceNames,
          plannedStops: syncedHandoff.plannedStops,
          recommendedPlaces: syncedHandoff.recommendedPlaces,
          recentRecommendationNames: loadRecentRecommendationNames(),
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: initialCtx,
            travelDate: syncedHandoff.travelDate,
            transportation: syncedHandoff.transportation,
            budget: syncedHandoff.budget,
            startTime: syncedHandoff.startTime,
            initialChatContext: initialCtx,
          },
        });

        const formInput = {
          destination: dest,
          origin: syncedHandoff.tripOrigin,
          days: syncedHandoff.tripDays ?? 2,
          mood: syncedHandoff.mood ?? "",
          styles: syncedHandoff.tripStyles?.split(/[、,]/).filter(Boolean) ?? [],
          startDate: syncedHandoff.tripStartDate ?? "",
          endDate: syncedHandoff.tripEndDate ?? "",
          departureTime: syncedHandoff.startTime ?? "",
          travelers: syncedHandoff.tripCompanionCount ?? 1,
          transport: syncedHandoff.transportation ?? "",
          budgetMode: syncedHandoff.budget ?? "",
        };
        const summary = syncedHandoff.planAiMode
          ? buildPlanAiHandoffOpening(formInput, bundle, locale)
          : buildPlanTripHandoffOpening(formInput, bundle, locale);
        let summaryText = summary;

        let roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summaryText);

        try {
          const full = await fetchRoamieAI(req, { token });
          if (full.summary?.trim()) {
            summaryText = full.summary;
            const aiRecs =
              full.recommendations?.length > 0
                ? full.recommendations.map(roamieRecToChatItem)
                : undefined;
            roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summaryText, aiRecs);
          }
        } catch (e) {
          console.warn("[Roamie] plan handoff AI failed, using fallback", e);
        }

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            syncedHandoff,
            "",
            summaryText,
            (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
          );
        const opener: ChatMsg = {
          role: "assistant",
          content: displaySummary,
          roamie: {
            ...roamiePayload,
            summary: displaySummary,
            recommendations: filteredRecs,
          },
        };
        setMsgs([opener]);

        const recs = filteredRecs as ChatPlaceItem[];
        const nextSession = syncSessionPlaceMemory(
          markPlanHandoffComplete({
            ...syncedHandoff,
            recommendedPlaces: recs.length ? recs : syncedHandoff.recommendedPlaces,
            initialChatContext: initialCtx,
          }),
        );
        persistSession(nextSession);
        devVerboseInfo("[Roamie] plan handoff ok", formatTripLocationLabel(dest));
      } catch (error) {
        if (selectionTrace && !selectionLoadingCleared) {
          const failureReason = error instanceof Error ? error.message : String(error);
          logPlanningSelectionHandoffStage("initial_recommendation_done", selectionTrace, {
            success: false,
            failureReason,
            sessionId: handoffSession.planningSelection?.id,
          });
          const fallback = "推薦結果整理失敗，請再試一次。";
          setMsgs([{ role: "assistant", content: fallback }]);
          persistSession(markPlanHandoffComplete(handoffSession));
          console.error("[PLANNING_SELECTION_INITIAL_RECOMMENDATION_FAILED]", error);
          return;
        }
        throw error;
      } finally {
        setStreaming(false);
        if (selectionTrace) {
          logPlanningSelectionHandoffStage("handoff_loading_clear", selectionTrace, {
            sessionId: handoffSession.planningSelection?.id,
          });
          logPlanningSelectionHandoffLoading(selectionTrace, false, "settled", null);
        }
      }
    },
    [
      fetchWeather,
      persistSession,
      locale,
      searchNearbyPlaces,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );

  const runTripAddPlaceHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      const ctx = handoffSession.tripAddPlaceContext;
      if (!ctx) return;
      setStreaming(true);
      try {
        let { summary, recommendations, recommendationSession } =
          await fetchTripAddPlaceRecommendations({
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        if (!recommendations.length) {
          recommendations = await enrichTripAddPlaceRecommendationsFromSummary({
            summary,
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        }
        const sessionWithRecs = tripAddPlaceRecommendationsToSession(
          handoffSession,
          recommendations,
          recommendationSession,
        );
        let { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, "", summary, recommendations);
        if (!filteredRecs.length && recommendations.length) {
          filteredRecs = recommendations.slice(0, 5);
        }
        if (!filteredRecs.length) {
          filteredRecs = await enrichTripAddPlaceRecommendationsFromSummary({
            summary: displaySummary,
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        }
        recommendationSession = await ensureHandoffRecommendationSession({
          ctx,
          recommendations: filteredRecs,
          recommendationSession,
          searchPlaces: searchNearbyPlaces,
          locale,
        });

        const assistantMessage = buildTripAddPlaceChatMessage({
          summary: displaySummary,
          recommendations: filteredRecs,
          moodTag: handoffSession.mood ?? ctx.travelStyle ?? "",
          session: sessionWithRecs,
        });

        if (!assistantMessage.structuredPlaces?.length && filteredRecs.length) {
          logTripAddPlaceRenderEmpty({
            reason: "handoff_structured_empty",
            messagesCount: 0,
            candidatesCount: filteredRecs.length,
            structuredPlacesCount: 0,
            loading: false,
          });
        }

        if (!assistantMessage.content.trim() && !assistantMessage.structuredPlaces?.length) {
          const fallback = buildTripAddPlaceRenderFallbackMessage(sessionWithRecs, {
            candidatesCount: recommendationSession?.allCandidates.length ?? filteredRecs.length,
          });
          setMsgs([fallback]);
          persistSession(
            markTripAddPlaceHandoffComplete({
              ...sessionWithRecs,
              lastAssistantReply: fallback.content,
            }),
          );
          setSession(reinforceTripAddPlaceSession(loadChatSession()));
          return;
        }

        setMsgs([assistantMessage]);
        const nextSession = markTripAddPlaceHandoffComplete({
          ...sessionWithRecs,
          recommendedPlaces: (assistantMessage.roamie?.recommendations ??
            filteredRecs) as ChatPlaceItem[],
          tripAddPlaceRecommendationSession:
            recommendationSession ?? sessionWithRecs.tripAddPlaceRecommendationSession,
          lastAssistantReply: assistantMessage.content,
        });
        persistSession(nextSession);
        setSession(reinforceTripAddPlaceSession(nextSession));
        devVerboseInfo(
          "[Roamie] trip add place handoff ok",
          ctx.tripId,
          `day=${ctx.selectedDay}`,
          `cards=${assistantMessage.structuredPlaces?.length ?? filteredRecs.length}`,
          `pool=${recommendationSession?.allCandidates.length ?? 0}`,
        );
      } catch (error) {
        console.error("[TRIP_ADD_PLACE_HANDOFF_FAILED]", error);
        const fallback = buildTripAddPlaceRenderFallbackMessage(handoffSession, {
          error: error instanceof Error ? error.message : String(error),
        });
        setMsgs([fallback]);
        persistSession(
          markTripAddPlaceHandoffComplete({
            ...handoffSession,
            lastAssistantReply: fallback.content,
          }),
        );
        setSession(reinforceTripAddPlaceSession(loadChatSession()));
        throw error;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces],
  );

  const commitTripAddPlaceLocalTurn = useCallback(
    async (
      tripSession: ChatPlanningSession,
      userText: string,
      baseConversation: ChatMsg[],
    ): Promise<void> => {
      const turn = await processTripAddPlaceUserMessage({
        session: tripSession,
        userText,
        msgs: baseConversation,
        searchPlaces: searchNearbyPlaces,
        locale,
      });
      const { summary: displaySummary, recommendations: filteredRecs } =
        finalizeChatRecommendationDisplay(
          turn.nextSession,
          userText,
          turn.summary,
          turn.recommendations,
        );
      const finalRecs = filteredRecs.length ? filteredRecs : turn.recommendations;
      const nextSession = {
        ...turn.nextSession,
        fromTripAddPlace: true,
        conversationMode: "trip_add_place" as const,
        recommendedPlaces: finalRecs as ChatPlaceItem[],
        lastAssistantReply: displaySummary,
      };
      persistSession(nextSession);
      setSession(reinforceTripAddPlaceSession(nextSession));
      const assistantMessage = buildTripAddPlaceChatMessage({
        summary: displaySummary,
        recommendations: finalRecs,
        moodTag: turn.nextSession.mood ?? tripSession.tripAddPlaceContext?.travelStyle,
        session: nextSession,
      });
      if (!assistantMessage.structuredPlaces?.length && finalRecs.length) {
        logTripAddPlaceRenderEmpty({
          reason: "local_turn_structured_empty",
          messagesCount: baseConversation.length + 1,
          candidatesCount: finalRecs.length,
          structuredPlacesCount: 0,
          loading: false,
        });
      }
      setMsgs([...baseConversation, assistantMessage]);
      setPartial({});
    },
    [locale, persistSession, searchNearbyPlaces],
  );

  const pushTripAddPlaceMoreRecommendations = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
    ): Promise<boolean> => {
      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (!tripSession) return false;
      if (
        !shouldHandleTripAddPlaceMoreTurn(userText, tripSession) &&
        !isTripAddPlaceMoreRecommendationsRequest(userText)
      ) {
        return false;
      }
      try {
        await commitTripAddPlaceLocalTurn(tripSession, userText, conversation);
        return true;
      } catch (e) {
        logTripAddPlaceFailure(e, tripSession, userText, "push_more");
        try {
          await commitTripAddPlaceLocalTurn(
            tripSession,
            isTripAddPlaceMoreRecommendationsRequest(userText) ? userText : "還有嗎",
            conversation,
          );
        } catch (retryError) {
          logTripAddPlaceFailure(retryError, tripSession, userText, "push_more_retry");
        }
        return true;
      }
    },
    [commitTripAddPlaceLocalTurn],
  );

  const pushNearbyPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      intent: import("@/lib/ai/chat-intent").NearbyPlaceIntent,
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        blockedCoreNames?: string[];
        userText?: string;
        cityLabel?: string;
        authoritativeSearchCenter?: {
          lat: number;
          lng: number;
          displayLabel: string;
          source: "clarification_geocode";
          originalQuery: string;
          selectedAuthority: "nearby";
          geographicScope: NearbyGeographicScopeAuthority;
        };
      },
    ): Promise<boolean> => {
      const structuredHomeShortcut = isStructuredHomeNearbyShortcut(activeSession);
      const authoritativeCenter = opts?.authoritativeSearchCenter;
      const geographicScope =
        authoritativeCenter?.geographicScope ??
        activeSession.recommendationSession?.geographicScope;
      const merged = authoritativeCenter
        ? {
            context: activeSession.travelContext ?? { interests: [] },
            session: activeSession,
          }
        : structuredHomeShortcut
          ? {
              context: activeSession.travelContext ?? { interests: [] },
              session: activeSession,
            }
          : mergeTravelContext(activeSession, userText);
      logAiPipeline("[NEARBY_INTENT]", `intent=${intent}`, `userText=${userText.slice(0, 80)}`);
      let workingSession = merged.session;
      let sessionForSaveBase = workingSession;
      let rtScope = "none";
      let rtDeviceLocationAvailable = false;
      let rtDeviceLocationUsed = false;
      const placeDetailActive = isPlaceDetailChatActive(workingSession);
      if (placeDetailActive) {
        workingSession = await ensurePlaceDetailFocusCoordinates(
          workingSession,
          geocodeLocationFn,
          locale,
          fetchPlaceDetailsForFocus,
        );
        workingSession = sessionWithPlaceDetailSearchCenter(workingSession);
      }

      let searchCtx: Awaited<ReturnType<typeof resolveChatPlaceSearchContext>>;
      let lat: number | undefined;
      let lng: number | undefined;
      let nearbyCenterLabel: string | undefined;

      if (placeDetailActive) {
        const nearbyCenter = resolveNearbySearchCenter(workingSession, userText);
        if (!nearbyCenter) {
          console.warn("[CHAT_PLACES_REQUEST] skipped reason=place_detail_missing_coords");
          logRtNearbyPush({
            returned: false,
            reason: "missing_location",
            candidateCount: 0,
            renderableCount: 0,
            finalCount: 0,
            scope: "explicit_place",
            deviceLocationAvailable: false,
            deviceLocationUsed: false,
          });
          return false;
        }
        lat = nearbyCenter.lat;
        lng = nearbyCenter.lng;
        nearbyCenterLabel = nearbyCenter.basePlaceName;
        sessionForSaveBase = workingSession;
        searchCtx = {
          searchMode: "nearby",
          deviceLatLng: { lat, lng },
        };
        logRecommendationScopeRuntimeReady({
          isNearbyPlaceIntent: true,
          scope: "explicit_place",
        });
        logShortcutRuntime("[RT_NEARBY_SCOPE]", {
          isNearbyIntent: true,
          scope: "explicit_place",
          deviceLocationAvailable: false,
          deviceLocationUsed: false,
          routeMode: "explicit_place",
        });
        rtScope = "explicit_place";
        rtDeviceLocationAvailable = false;
        rtDeviceLocationUsed = false;
      } else {
        const structuredNearbyShortcut =
          workingSession.normalizedShortcutRequest?.structured === true &&
          workingSession.normalizedShortcutRequest?.intent === "nearby_recommendation";
        const shouldResolveCurrentLocation =
          !authoritativeCenter &&
          (isExplicitDeviceNearbyRequest(userText) ||
            shouldResolveNearbyCurrentLocation({
              userText,
              structuredShortcut: structuredNearbyShortcut,
            }));
        const hadSessionLocation = hasUsableNearbyCoordinates(workingSession.location);
        const deviceSession = shouldResolveCurrentLocation
          ? await resolveChatLocation(workingSession)
          : workingSession;
        const resolvedLocation = hasUsableNearbyCoordinates(deviceSession.location);
        logAiPipeline("[NEARBY_LOCATION_SOURCE]", {
          source: hadSessionLocation
            ? "session"
            : resolvedLocation
              ? "effective_or_native"
              : "unavailable",
          requested: shouldResolveCurrentLocation,
        });
        logAiPipeline("[NEARBY_LOCATION_RESOLVED]", {
          resolved: resolvedLocation,
          lat: deviceSession.location?.lat ?? "",
          lng: deviceSession.location?.lng ?? "",
          city: deviceSession.location?.city ?? "",
        });
        sessionForSaveBase = deviceSession;
        searchCtx = authoritativeCenter
          ? {
              searchMode: "nearby" as const,
              deviceLatLng: { lat: authoritativeCenter.lat, lng: authoritativeCenter.lng },
            }
          : await resolveChatPlaceSearchContext({
              context: merged.context,
              session: deviceSession,
              userText,
              locale,
              geocodeFn: geocodeLocationFn,
              deviceLatLng:
                shouldResolveCurrentLocation &&
                deviceSession.location?.lat != null &&
                deviceSession.location?.lng != null
                  ? { lat: deviceSession.location.lat, lng: deviceSession.location.lng }
                  : null,
            });

        const searchCenterRaw = resolveRecommendationSearchCenter({
          userText,
          session: deviceSession,
          context: merged.context,
          destinationLatLng: searchCtx.destinationLatLng,
          destinationName: searchCtx.destinationName,
          deviceLatLng:
            deviceSession.location?.lat != null && deviceSession.location?.lng != null
              ? { lat: deviceSession.location.lat, lng: deviceSession.location.lng }
              : null,
        });
        const shortcutGpsReady =
          structuredNearbyShortcut &&
          deviceSession.location?.lat != null &&
          deviceSession.location?.lng != null;
        const explicitNearbyGpsReady =
          userExplicitlyWantsNearbyPlaces(userText) &&
          deviceSession.location?.lat != null &&
          deviceSession.location?.lng != null;
        const searchCenter = authoritativeCenter
          ? {
              mode: "current_location" as const,
              latitude: authoritativeCenter.lat,
              longitude: authoritativeCenter.lng,
              label: authoritativeCenter.displayLabel,
              source: authoritativeCenter.source,
              deviceLocationAvailable: true,
              deviceLocationUsed: false,
            }
          : shortcutGpsReady || explicitNearbyGpsReady
            ? {
                mode: "current_location" as const,
                latitude: deviceSession.location!.lat,
                longitude: deviceSession.location!.lng,
                label: deviceSession.location?.city,
                source: "explicit_current_location" as const,
                deviceLocationAvailable: true,
                deviceLocationUsed: true,
              }
            : searchCenterRaw;

        const isDeviceNearbyScope =
          searchCenter?.mode === "current_location" ||
          (searchCtx.searchMode === "nearby" && isExplicitDeviceNearbyRequest(userText));

        logRecommendationScopeRuntimeReady({
          isNearbyPlaceIntent: Boolean(isDeviceNearbyScope),
          scope: searchCenter?.mode ?? searchCtx.searchMode,
        });
        logShortcutRuntime("[RT_NEARBY_SCOPE]", {
          isNearbyIntent: true,
          scope: searchCenter?.mode ?? searchCtx.searchMode,
          deviceLocationAvailable:
            Boolean(searchCenter?.deviceLocationAvailable) ||
            (deviceSession.location?.lat != null && deviceSession.location?.lng != null),
          deviceLocationUsed: Boolean(searchCenter?.deviceLocationUsed),
          routeMode: searchCenter?.mode ?? searchCtx.searchMode,
        });
        rtScope =
          geographicScope?.entityType === "district"
            ? "clarification_district"
            : String(searchCenter?.mode ?? searchCtx.searchMode);
        rtDeviceLocationAvailable =
          Boolean(searchCenter?.deviceLocationAvailable) ||
          (deviceSession.location?.lat != null && deviceSession.location?.lng != null);
        rtDeviceLocationUsed = Boolean(searchCenter?.deviceLocationUsed);
        logAiPipeline("[NEARBY_SCOPE]", {
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });

        if (searchCenter) {
          if (searchCtx.searchMode === "destination" && searchCenter.deviceLocationUsed) {
            logRecommendationGpsOverrideBlocked({
              destination: searchCtx.destinationName ?? searchCenter.destination ?? "",
              reason: "destination_scope_active",
            });
            // Hard guard: keep destination coords
            if (searchCtx.destinationLatLng) {
              lat = searchCtx.destinationLatLng.lat;
              lng = searchCtx.destinationLatLng.lng;
              nearbyCenterLabel = searchCtx.destinationName;
            } else {
              console.warn(
                "[CHAT_PLACES_REQUEST] skipped reason=destination_scope_gps_override_blocked",
              );
              logRtNearbyPush({
                returned: false,
                reason: "missing_location",
                candidateCount: 0,
                renderableCount: 0,
                finalCount: 0,
                scope: rtScope,
                deviceLocationAvailable: rtDeviceLocationAvailable,
                deviceLocationUsed: rtDeviceLocationUsed,
              });
              return false;
            }
          } else {
            lat = searchCenter.latitude;
            lng = searchCenter.longitude;
            nearbyCenterLabel = searchCenter.label ?? searchCenter.destination;
            if (searchCenter.mode === "destination") {
              searchCtx.searchMode = "destination";
              searchCtx.destinationName = searchCenter.destination ?? searchCtx.destinationName;
              searchCtx.destinationLatLng = {
                lat: searchCenter.latitude,
                lng: searchCenter.longitude,
              };
            } else if (searchCenter.mode === "current_location") {
              searchCtx.searchMode = "nearby";
              delete searchCtx.destinationLatLng;
              delete searchCtx.destinationName;
              delete searchCtx.textOnlyDestinationSearch;
            }
          }
        } else if (searchCtx.searchMode === "destination") {
          if (searchCtx.destinationLatLng) {
            lat = searchCtx.destinationLatLng.lat;
            lng = searchCtx.destinationLatLng.lng;
            nearbyCenterLabel = searchCtx.destinationName;
          } else if (searchCtx.textOnlyDestinationSearch) {
            lat = 0;
            lng = 0;
            nearbyCenterLabel = searchCtx.destinationName;
          } else {
            console.warn("[CHAT_PLACES_REQUEST] skipped reason=destination_coords_unavailable");
            logRtNearbyPush({
              returned: false,
              reason: "missing_location",
              candidateCount: 0,
              renderableCount: 0,
              finalCount: 0,
              scope: rtScope,
              deviceLocationAvailable: rtDeviceLocationAvailable,
              deviceLocationUsed: rtDeviceLocationUsed,
            });
            return false;
          }
        } else if (isExplicitDeviceNearbyRequest(userText)) {
          const nearbyCenter = resolveNearbySearchCenter(deviceSession, userText, {
            searchMode: "nearby",
          });
          if (nearbyCenter) {
            lat = nearbyCenter.lat;
            lng = nearbyCenter.lng;
            nearbyCenterLabel = nearbyCenter.basePlaceName;
            searchCtx.searchMode = "nearby";
          }
        } else {
          // No destination and not explicit device nearby — do not invent GPS center
          console.warn("[CHAT_PLACES_REQUEST] skipped reason=no_search_center");
          logRtNearbyPush({
            returned: false,
            reason: "missing_location",
            candidateCount: 0,
            renderableCount: 0,
            finalCount: 0,
            scope: rtScope,
            deviceLocationAvailable: rtDeviceLocationAvailable,
            deviceLocationUsed: rtDeviceLocationUsed,
          });
          return false;
        }

        if (
          searchCtx.searchMode === "destination" &&
          lat != null &&
          lng != null &&
          deviceSession.location?.lat != null &&
          deviceSession.location?.lng != null &&
          Math.abs(lat - deviceSession.location.lat) < 0.0001 &&
          Math.abs(lng - deviceSession.location.lng) < 0.0001 &&
          searchCtx.destinationName
        ) {
          // Destination label with device coords = GPS override — block
          logRecommendationGpsOverrideBlocked({
            destination: searchCtx.destinationName,
            reason: "destination_scope_gps_override_blocked",
          });
          if (searchCtx.destinationLatLng) {
            lat = searchCtx.destinationLatLng.lat;
            lng = searchCtx.destinationLatLng.lng;
          } else {
            logRtNearbyPush({
              returned: false,
              reason: "missing_location",
              candidateCount: 0,
              renderableCount: 0,
              finalCount: 0,
              scope: rtScope,
              deviceLocationAvailable: rtDeviceLocationAvailable,
              deviceLocationUsed: rtDeviceLocationUsed,
            });
            return false;
          }
        }
      }

      if (lat == null || lng == null) {
        logAiPipeline("[NEARBY_FALLBACK]", "reason=missing_location");
        console.warn("[CHAT_PLACES_REQUEST] skipped reason=no_location");
        logShortcutRuntime("[RT_NEARBY_RESULT]", {
          followup: matchesContinueRecommendationGrammar(userText) ? 1 : 0,
          batch: activeSession.recommendationSession?.recommendationPage ?? 0,
          raw: 0,
          renderable: 0,
          final: 0,
          fallbackReason: "missing_location",
        });
        logRtNearbyPush({
          returned: false,
          reason: "missing_location",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return false;
      }
      logAiPipeline("[NEARBY_SEARCH_CENTER_AUTHORITY]", {
        position: "before_fetch",
        source:
          authoritativeCenter?.source ??
          (searchCtx.searchMode === "destination" ? "destination" : "session_or_device"),
        lat,
        lng,
        displayLabel: authoritativeCenter?.displayLabel ?? nearbyCenterLabel ?? "",
        selectedAuthority: authoritativeCenter?.selectedAuthority ?? "",
        pendingResume: Boolean(authoritativeCenter),
        originalQuery: authoritativeCenter?.originalQuery ?? userText,
      });
      if (
        authoritativeCenter &&
        (Math.abs(lat - authoritativeCenter.lat) > 0.000001 ||
          Math.abs(lng - authoritativeCenter.lng) > 0.000001)
      ) {
        logAiPipeline("[NEARBY_SEARCH_CENTER_MISMATCH]", {
          expectedLat: authoritativeCenter.lat,
          expectedLng: authoritativeCenter.lng,
          actualLat: lat,
          actualLng: lng,
          expectedSource: authoritativeCenter.source,
          actualSource: searchCtx.searchMode,
        });
        logRtNearbyPush({
          returned: false,
          reason: "center_mismatch",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return false;
      }
      const nearbyFollowup =
        matchesContinueRecommendationGrammar(userText) ||
        (activeSession.normalizedShortcutRequest?.structured === true &&
          activeSession.normalizedShortcutRequest.intent === "nearby_recommendation" &&
          (userText.trim() === "不喜歡" || userText.trim() === "不喜欢"))
          ? 1
          : 0;
      const nearbyBatch =
        (activeSession.recommendationSession?.recommendationPage ?? 0) + (nearbyFollowup ? 1 : 0);
      const nearbyExcludedCount =
        opts?.excludePlaceIds?.length ?? collectExcludePlaceIds(activeSession, conversation).length;
      logAiPipeline(
        "[NEARBY_CONTEXT]",
        `followup=${nearbyFollowup}`,
        `batch=${nearbyBatch}`,
        `excludedCount=${nearbyExcludedCount}`,
        `mode=${searchCtx.searchMode}`,
        `destination=${searchCtx.destinationName ?? ""}`,
        `lat=${lat.toFixed(4)}`,
        `lng=${lng.toFixed(4)}`,
      );

      const requestCheck = assertDestinationRequestNotUsingGps({
        searchMode: searchCtx.searchMode === "destination" ? "destination" : "current_location",
        center: { latitude: lat, longitude: lng },
        centerSource: searchCtx.searchMode === "destination" ? "destination_anchor" : "gps",
        destination: searchCtx.destinationName,
        category: intent,
        radiusMeters: 1500,
      });
      if (!requestCheck.ok) {
        console.warn(`[CHAT_PLACES_REQUEST] skipped reason=${requestCheck.reason}`);
        logRtNearbyPush({
          returned: false,
          reason: "other",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return false;
      }

      logRecommendationPlacesRequest({
        mode: searchCtx.searchMode,
        category: intent,
        destination: searchCtx.destinationName,
        lat,
        lng,
      });
      logAiPipeline("[NEARBY_QUERY_CATEGORY]", {
        intent,
        category:
          intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction",
        userText: userText.slice(0, 80),
      });

      const sessionForSave = sessionForSaveBase;
      const excludePlaceIds = opts?.excludePlaceIds ?? collectExcludePlaceIds(sessionForSave);
      const blockedCoreNames = opts?.blockedCoreNames ?? collectBlockedCoreNames(sessionForSave);
      const continuationScene = resolveNearbyShortcutScene(userText, sessionForSave);
      const homeSearchProfile = resolveHomeShortcutSearchProfile(sessionForSave);
      const shouldCommitGenericNearbyPool =
        nearbyFollowup === 0 &&
        searchCtx.searchMode === "nearby" &&
        !continuationScene &&
        !homeSearchProfile &&
        sessionForSave.normalizedShortcutRequest?.structured !== true;
      if (nearbyFollowup) {
        logShortcutRuntime("[RT_CONTINUATION_CONTEXT]", {
          shortcutScene: continuationScene ?? "",
          intent,
          scope: rtScope,
          previousRecommendedCount:
            sessionForSave.activeRecommendationContext?.previousPlaceIds.length ??
            sessionForSave.recommendedPlaceIds?.length ??
            sessionForSave.recommendedPlaces.length,
          exclusionCount: excludePlaceIds.length,
        });
        logShortcutRuntime("[RT_CONTINUATION_FETCH]", {
          willFetch: true,
          reason: "structured_nearby_continuation",
          scene: continuationScene ?? "",
          scope: rtScope,
          exclusionCount: excludePlaceIds.length,
        });
      }

      if (!ensureSubscriptionHydratedForCredits(conversation)) {
        logRtNearbyPush({
          returned: true,
          reason: "other",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return true;
      }
      const placeCreditsGate = await beginPlaceRecommendationCredits({
        hasPlusAccess,
        metadata: { path: "nearby", intent },
      });
      if (placeCreditsGate.blocked) {
        setMsgs((prev) => {
          const base = prev.length === conversation.length ? conversation : prev;
          return [...base, { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE }];
        });
        logRtNearbyPush({
          returned: true,
          reason: "other",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return true;
      }
      let placeCreditsHandle: CreditsOperationHandle | null = placeCreditsGate.handle;
      let nearbyProviderCompleted = false;
      let nearbyProcessingStage = "provider";

      try {
        const { summary, payload, continuationRecommendations, shortcutDiagnostics } =
          await buildNearbyPlaceRecommendation({
            intent,
            lat,
            lng,
            locale,
            context: merged.context,
            searchPlaces: searchNearbyPlaces,
            foodPreference: sessionForSave.foodPreference,
            excludedCategories:
              sessionForSave.excludedCategories ?? merged.context.excludedCategories,
            excludePlaceIds,
            rejectedPlaceNames: opts?.rejectedPlaceNames ?? sessionForSave.rejectedPlaceNames,
            priorRecommended: [
              ...sessionForSave.recommendedPlaces,
              ...extractRecommendedFromMsgs(conversation),
            ],
            blockedCoreNames,
            userText: userText,
            cityLabel: placeDetailActive
              ? workingSession.placeDetailFocus?.city ||
                workingSession.placeDetailFocus?.country ||
                undefined
              : (nearbyCenterLabel ??
                opts?.cityLabel ??
                (searchCtx.searchMode === "destination"
                  ? searchCtx.destinationName
                  : (sessionForSave.location?.city ?? merged.context.destination))),
            searchContext: searchCtx,
            hasPlusAccess,
            placeDetailNearby: placeDetailActive,
            focusPlaceId:
              workingSession.placeDetailFocus?.placeId ??
              workingSession.placeDetailFocus?.googlePlaceId,
            shortcutScene: continuationScene,
            searchProfile: homeSearchProfile,
            searchCenterAuthority: authoritativeCenter,
            geographicScope,
            fetchPlaceDetails: async (placeId) => {
              const result = await fetchPlaceDetailsFn({ data: { placeId, locale } });
              return result.place;
            },
          });
        nearbyProviderCompleted = true;
        nearbyProcessingStage = "recommendation_processing";
        const sessionWithIntent: ChatPlanningSession = {
          ...sessionForSave,
          pendingNearbyLocationRequest: undefined,
          activeChatIntent: intent,
          activeCategoryIntent:
            intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction",
          phase: "recommend",
          travelContext: {
            ...merged.context,
            excludedCategories:
              sessionForSave.excludedCategories ?? merged.context.excludedCategories,
          },
        };
        const sessionWithNearbyContext: ChatPlanningSession = {
          ...sessionWithIntent,
          activeRecommendationContext: ensureActiveRecommendationContext(sessionWithIntent, {
            destination:
              searchCtx.destinationName ??
              nearbyCenterLabel ??
              sessionForSave.location?.city ??
              merged.context.destination ??
              "附近",
            intent:
              intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction",
            latitude: lat,
            longitude: lng,
            resolvedSearchCity: searchCtx.destinationName ?? sessionForSave.location?.city,
            searchScope:
              geographicScope?.entityType === "district"
                ? "district"
                : searchCtx.searchMode === "nearby"
                  ? "current_location"
                  : "city",
            shortcutScene: continuationScene ?? undefined,
            shortcutSource: sessionForSave.normalizedShortcutRequest?.source,
            shortcutMode: sessionForSave.normalizedShortcutRequest?.mode,
            searchProfile: resolveHomeShortcutSearchProfile(sessionForSave) ?? undefined,
          }),
        };
        if (nearbyFollowup) {
          logShortcutRuntime("[RT_CONTINUATION_HANDOFF]", {
            scene: continuationScene ?? "",
            searchReturnedCount:
              shortcutDiagnostics?.searchReturnedCount ?? payload.recommendations?.length ?? 0,
            callerReceivedCount: payload.recommendations?.length ?? 0,
            rawStatsCount: shortcutDiagnostics?.rawCount ?? 0,
            candidateArrayCount: payload.recommendations?.length ?? 0,
            fallbackReason: (payload.recommendations?.length ?? 0) ? "" : "build_returned_empty",
          });
          logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
            stage: "before_display_policy",
            count: payload.recommendations?.length ?? 0,
            previousIdCount: excludePlaceIds.length,
            currentCandidateIdsAddedToMemory: 0,
          });
        }
        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithNearbyContext,
            userText,
            summary,
            payload.recommendations ?? [],
          );
        if (nearbyFollowup) {
          logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
            stage: "after_display_policy",
            count: filteredRecs.length,
            previousIdCount: excludePlaceIds.length,
            currentCandidateIdsAddedToMemory: 0,
          });
          const finalIds = new Set(
            filteredRecs.map((item) => item.googlePlaceId ?? item.placeId ?? item.id ?? ""),
          );
          for (const item of payload.recommendations ?? []) {
            const itemId = item.googlePlaceId ?? item.placeId ?? item.id ?? "";
            if (finalIds.has(itemId)) continue;
            logShortcutRuntime("[RT_CONTINUATION_DROP]", {
              stage: "display_policy",
              placeName: item.name ?? item.placeName ?? "",
              placeId: itemId,
              identityKey: itemId ? `google:${itemId}` : "",
              reason: "display_policy_rejected",
              matchedPreviousIdentity: "",
            });
          }
          logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
            stage: "after_final_pick",
            count: filteredRecs.length,
            previousIdCount: excludePlaceIds.length,
            currentCandidateIdsAddedToMemory: 0,
          });
        }
        logAiPipeline(
          "[NEARBY_CANDIDATES]",
          `raw=${payload.recommendations?.length ?? 0}`,
          `renderable=${filteredRecs.length}`,
          `intent=${intent}`,
        );
        logAiPipeline("[NEARBY_DISPLAY_COUNT]", { count: filteredRecs.length });
        logShortcutRuntime("[RT_NEARBY_RESULT]", {
          followup: nearbyFollowup,
          batch: nearbyBatch,
          raw: payload.recommendations?.length ?? 0,
          renderable: filteredRecs.length,
          final: filteredRecs.length,
          fallbackReason: filteredRecs.length
            ? ""
            : (payload.recommendations ?? []).length > 0
              ? "not_renderable"
              : shortcutDiagnostics?.afterAlreadyRecommendedCount === 0
                ? "all_excluded_previous"
                : shortcutDiagnostics?.afterCanonicalIdCount === 0
                  ? "canonical_invalid"
                  : shortcutDiagnostics?.afterCategoryGuardCount === 0
                    ? "category_filtered"
                    : shortcutDiagnostics?.afterQualityCount === 0
                      ? "quality_filtered"
                      : "search_exhausted",
        });
        if (nearbyFollowup) {
          const fallbackReason = filteredRecs.length
            ? ""
            : (payload.recommendations ?? []).length > 0
              ? "not_renderable"
              : shortcutDiagnostics?.afterAlreadyRecommendedCount === 0
                ? "all_excluded_previous"
                : shortcutDiagnostics?.afterCategoryGuardCount === 0
                  ? "category_filtered"
                  : "search_exhausted";
          logShortcutRuntime("[RT_CONTINUATION_RESULT]", {
            rawCount: shortcutDiagnostics?.rawCount ?? payload.recommendations?.length ?? 0,
            filteredCount:
              shortcutDiagnostics?.afterExclusionCount ?? payload.recommendations?.length ?? 0,
            sceneCandidateCount:
              shortcutDiagnostics?.afterCategoryGuardCount ?? payload.recommendations?.length ?? 0,
            renderableCount: filteredRecs.length,
            finalCount: filteredRecs.length,
            fallbackReason,
          });
        }
        if (shortcutDiagnostics) {
          shortcutDiagnostics.renderableCount = filteredRecs.length;
          shortcutDiagnostics.finalCardCount = filteredRecs.length;
          logShortcutRecommendationSummary(shortcutDiagnostics);
        }
        const syncedSummary =
          filteredRecs.length > 0
            ? buildSummaryForRecommendations(
                intent,
                filteredRecs,
                merged.context,
                sessionForSave.excludedCategories ?? merged.context.excludedCategories,
                resolveNearbyShortcutScene(userText, sessionForSave),
                resolveHomeShortcutSearchProfile(sessionForSave),
              )
            : displaySummary;
        devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count: filteredRecs.length });
        devVerboseInfo("[CHAT_PLACE_CARD_LIMIT]", { limit: intent === "cafe" ? 6 : 5 });
        if (!filteredRecs.length) {
          await settleCreditsOperation(placeCreditsHandle, false);
          placeCreditsHandle = null;
          if (!nearbyFollowup && (payload.recommendations ?? []).length === 0 && summary.trim()) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
              return [...base, { role: "assistant", content: summary }];
            });
            persistSession(sessionWithIntent);
            setPartial({});
            logAiPipeline("[NEARBY_FINAL]", "status=summary_only");
            logRtResponseBranch("other");
            logRtNearbyPush({
              returned: true,
              reason: "no_candidates",
              candidateCount: payload.recommendations?.length ?? 0,
              renderableCount: 0,
              finalCount: 0,
              scope: rtScope,
              deviceLocationAvailable: rtDeviceLocationAvailable,
              deviceLocationUsed: rtDeviceLocationUsed,
            });
            return true;
          }
          console.warn("[CHAT_PLACE_CARD_RENDER] count=0 after_filter");
          const fallbackReason =
            (payload.recommendations?.length ?? 0) > 0
              ? "not_renderable"
              : shortcutDiagnostics?.afterAlreadyRecommendedCount === 0
                ? "all_excluded_previous"
                : shortcutDiagnostics?.afterCanonicalIdCount === 0
                  ? "canonical_invalid"
                  : shortcutDiagnostics?.afterCategoryGuardCount === 0
                    ? "category_filtered"
                    : shortcutDiagnostics?.afterQualityCount === 0
                      ? "quality_filtered"
                      : "search_exhausted";
          logAiPipeline("[NEARBY_FALLBACK]", `reason=${fallbackReason}`);
          logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: fallbackReason });
          logRtNearbyPush({
            returned: false,
            reason:
              fallbackReason === "search_exhausted"
                ? "no_candidates"
                : fallbackReason === "not_renderable"
                  ? "display_filtered_zero"
                  : "not_renderable",
            candidateCount: payload.recommendations?.length ?? 0,
            renderableCount: filteredRecs.length,
            finalCount: filteredRecs.length,
            scope: rtScope,
            deviceLocationAvailable: rtDeviceLocationAvailable,
            deviceLocationUsed: rtDeviceLocationUsed,
          });
          return false;
        }

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: syncedSummary,
              roamie: {
                ...payload,
                summary: syncedSummary,
                recommendations: filteredRecs,
              },
            },
          ];
        });

        const recs = filteredRecs as ChatPlaceItem[];
        const nearbyRecommendationId = (item: RoamieRecommendationItem): string => {
          const extended = item as RoamieRecommendationItem & {
            placeId?: string;
            id?: string;
          };
          return (item.googlePlaceId ?? extended.placeId ?? extended.id ?? "").trim();
        };
        const continuationTopic =
          intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction";
        const displayedIds = new Set(
          recs.map((item) => nearbyRecommendationId(item)).filter(Boolean),
        );
        logAiPipeline("[GENERIC_NEARBY_POOL_COMMIT_DECISION]", {
          eligibleForCommit: shouldCommitGenericNearbyPool,
          displayedCount: recs.length,
          continuationCount: continuationRecommendations.length,
          selectedAuthority: opts?.authoritativeSearchCenter?.selectedAuthority ?? "nearby",
          shortcutScene: continuationScene ?? "",
          pendingResume: Boolean(opts?.authoritativeSearchCenter),
          reason: shouldCommitGenericNearbyPool
            ? "generic_nearby_first_turn"
            : nearbyFollowup
              ? "continuation_turn"
              : continuationScene
                ? "shortcut_scene"
                : homeSearchProfile
                  ? "home_search_profile"
                  : sessionForSave.normalizedShortcutRequest?.structured === true
                    ? "structured_shortcut"
                    : "non_nearby_search_scope",
        });
        nearbyProcessingStage = "continuation_pool_commit";
        const renderableContinuationPool = (
          shouldCommitGenericNearbyPool ? continuationRecommendations : []
        ).filter((item) => {
          const itemId = nearbyRecommendationId(item);
          if (displayedIds.has(itemId)) return false;
          return (
            finalizeChatRecommendationDisplay(sessionWithNearbyContext, userText, "", [item])
              .recommendations.length > 0
          );
        });
        const orderedContinuationPool = [...recs, ...renderableContinuationPool];
        const continuationProfile = userProfileForReasonFrom(sessionForSave.preferences, {
          hasPlusAccess,
        });
        const continuationPersonalization = buildPersonalizationContextV1({
          surface: "chatNearby",
          profile: continuationProfile,
          profileVersion: sessionForSave.preferences?.updated_at,
          sessionPreference: sessionForSave.sessionPreference,
          explicitCurrentRequest: {
            interests: merged.context.interests,
            categoryExclude: sessionForSave.excludedCategories,
            mood: merged.context.mood,
          },
        });
        const createdContinuation = createRecommendationSession({
          destination:
            searchCtx.destinationName ??
            nearbyCenterLabel ??
            sessionForSave.location?.city ??
            merged.context.destination ??
            "附近",
          topic: continuationTopic,
          pool: orderedContinuationPool,
          batchSize: Math.max(1, recs.length),
          activeSearchCity: searchCtx.destinationName ?? sessionForSave.location?.city,
          searchScope: searchCtx.searchMode === "nearby" ? "current_location" : "city",
          searchRegionLabel:
            searchCtx.destinationName ??
            nearbyCenterLabel ??
            sessionForSave.location?.city ??
            "附近",
          searchCentroid: { lat, lng },
          personalizationSnapshot: buildPersonalizationSnapshotV1(
            continuationPersonalization,
            orderedContinuationPool.map((item) => nearbyRecommendationId(item)).filter(Boolean),
          ),
          geographicScope,
        });
        const continuationSession = {
          ...createdContinuation.session,
          displayBatchSize: defaultRecommendationDisplayBatchSize(continuationTopic),
        };
        if (shouldCommitGenericNearbyPool) {
          logAiPipeline("[CONTINUATION_POOL_CREATED]", {
            storedPoolCount: continuationSession.pool.length,
            remainingCount: renderableContinuationPool.length,
            displayedCount: recs.length,
          });
        }
        logAiPipeline("[GENERIC_NEARBY_POOL_COMMIT_RESULT]", {
          committed: shouldCommitGenericNearbyPool,
          storedPoolCount: shouldCommitGenericNearbyPool ? continuationSession.pool.length : 0,
          remainingCount: shouldCommitGenericNearbyPool ? renderableContinuationPool.length : 0,
          sessionCreated: shouldCommitGenericNearbyPool,
        });
        nearbyProcessingStage = "session_commit";
        const sessionWithCommittedNearbyContext: ChatPlanningSession = {
          ...sessionWithNearbyContext,
          recommendationSession: shouldCommitGenericNearbyPool
            ? continuationSession
            : sessionWithNearbyContext.recommendationSession,
          activeRecommendationContext: ensureActiveRecommendationContext(sessionWithNearbyContext, {
            destination:
              searchCtx.destinationName ??
              nearbyCenterLabel ??
              sessionForSave.location?.city ??
              merged.context.destination ??
              "附近",
            intent:
              intent === "restaurant" ? "restaurant" : intent === "cafe" ? "cafe" : "attraction",
            places: recs,
            latitude: lat,
            longitude: lng,
            resolvedSearchCity: searchCtx.destinationName ?? sessionForSave.location?.city,
            searchScope: searchCtx.searchMode === "nearby" ? "current_location" : "city",
            shortcutScene: continuationScene ?? undefined,
            shortcutSource: sessionForSave.normalizedShortcutRequest?.source,
            shortcutMode: sessionForSave.normalizedShortcutRequest?.mode,
            searchProfile: resolveHomeShortcutSearchProfile(sessionForSave) ?? undefined,
          }),
        };
        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithCommittedNearbyContext,
            recommendedPlaces: recs,
          }),
        );
        if (nearbyFollowup) {
          logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
            stage: "after_final_pick",
            count: recs.length,
            previousIdCount: excludePlaceIds.length,
            currentCandidateIdsAddedToMemory: recs.length,
            memoryCommit: true,
          });
        }
        await settleCreditsOperation(placeCreditsHandle, true);
        placeCreditsHandle = null;
        devVerboseInfo(
          "[CHAT_REFRESH_RECOMMEND]",
          `count=${recs.length}`,
          `excluded=${excludePlaceIds.length}`,
        );
        logAiPipeline("[NEARBY_FINAL]", `count=${recs.length}`, `intent=${intent}`);
        logRtResponseBranch("nearby_cards");
        setPartial({});
        logRtNearbyPush({
          returned: true,
          reason: "other",
          candidateCount: payload.recommendations?.length ?? 0,
          renderableCount: filteredRecs.length,
          finalCount: recs.length,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return true;
      } catch (e) {
        await settleCreditsOperation(placeCreditsHandle, false);
        console.warn("[CHAT_PLACES_REQUEST] failed", e instanceof Error ? e.message : String(e));
        const fallbackReason =
          e instanceof Error && e.message === "places_empty"
            ? "search_exhausted"
            : nearbyProviderCompleted
              ? "recommendation_processing_failure"
              : "provider_zero";
        if (
          nearbyProviderCompleted &&
          shouldCommitGenericNearbyPool &&
          nearbyProcessingStage === "continuation_pool_commit"
        ) {
          logAiPipeline("[GENERIC_NEARBY_POOL_COMMIT_ERROR]", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
        logAiPipeline("[NEARBY_FALLBACK]", `reason=${fallbackReason}`);
        logAiPipeline("[NEARBY_FAILURE_REASON]", {
          reason: fallbackReason,
          detail: e instanceof Error ? e.message : String(e),
          processingStage: nearbyProcessingStage,
        });
        logShortcutRuntime("[RT_NEARBY_RESULT]", {
          followup: nearbyFollowup,
          batch: nearbyBatch,
          raw: 0,
          renderable: 0,
          final: 0,
          fallbackReason,
        });
        if (nearbyFollowup) {
          logShortcutRuntime("[RT_CONTINUATION_RESULT]", {
            rawCount: 0,
            filteredCount: 0,
            sceneCandidateCount: 0,
            renderableCount: 0,
            finalCount: 0,
            fallbackReason,
          });
        }
        logRtNearbyPush({
          returned: false,
          reason:
            fallbackReason === "provider_zero"
              ? "provider_zero"
              : fallbackReason === "recommendation_processing_failure"
                ? "recommendation_processing_failure"
                : "no_candidates",
          candidateCount: 0,
          renderableCount: 0,
          finalCount: 0,
          scope: rtScope,
          deviceLocationAvailable: rtDeviceLocationAvailable,
          deviceLocationUsed: rtDeviceLocationUsed,
        });
        return false;
      }
    },
    [
      logRtNearbyPush,
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      fetchPlaceDetailsForFocus,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );

  const pushDestinationPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        forceRegenerate?: boolean;
        replacePreviousCards?: boolean;
      },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const styleReselect = isStyleReselectTurn(userText, activeSession, placeCtx);
      const stylePlanTurn = shouldTriggerTripStylePlanning(userText, activeSession, placeCtx);
      const forceRegenerate =
        opts?.forceRegenerate === true || Boolean(styleReselect) || stylePlanTurn;
      const replacePreviousCards = opts?.replacePreviousCards ?? forceRegenerate;

      const canFetch =
        forceRegenerate || stylePlanTurn || shouldFetchDestinationPlaces(userText, placeCtx);
      const destination = canFetch
        ? (resolveMustVisitDestination(placeCtx, userText) ??
          resolveConversationDestination(placeCtx, activeSession) ??
          placeCtx.destination?.trim() ??
          activeSession.tripPlanningContext?.destination?.trim())
        : undefined;
      if (!destination) return false;

      let sessionForPlan: ChatPlanningSession;
      if (styleReselect) {
        sessionForPlan = applyStyleReselectToSession(
          {
            ...merged.session,
            activeChatIntent: "destination_advice",
            conversationMode: "destination_planning",
            travelContext: {
              ...placeCtx,
              destination,
              planningTripStyle: styleReselect,
              planningDaysConfirmed: true,
              mustVisitGenerated: false,
            },
          },
          { ...placeCtx, destination, planningTripStyle: styleReselect },
          styleReselect,
        );
      } else {
        sessionForPlan = getOrCreatePlanningSessionId(
          {
            ...merged.session,
            activeChatIntent: "destination_advice",
            conversationMode: "destination_planning",
            travelContext: {
              ...placeCtx,
              destination,
            },
          },
          "generate_places",
        ).session;
      }

      const flowSessionId =
        sessionForPlan.planningSessionId ??
        getOrCreatePlanningSessionId(sessionForPlan, "ensure").sessionId;

      if (isPlanningRenderInProgress(flowSessionId)) {
        devVerboseInfo("[AI_PLANNING_SKIP]", "reason=duplicate_in_flight");
        return false;
      }
      if (isPlanningRenderInProgress() && !isPlanningRenderInProgress(flowSessionId)) {
        devVerboseInfo("[AI_PLANNING_SKIP]", "reason=render_in_progress_other_session");
        return false;
      }
      setPlanningRenderInProgress(true, flowSessionId);

      if (!ensureSubscriptionHydratedForCredits(conversation)) return true;
      const placeCreditsGate = await beginPlaceRecommendationCredits({
        hasPlusAccess,
        metadata: { path: "destination_places", destination },
      });
      if (placeCreditsGate.blocked) {
        setPlanningRenderInProgress(false, flowSessionId);
        setMsgs([
          ...conversation,
          { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE },
        ]);
        return true;
      }
      let placeCreditsHandle: CreditsOperationHandle | null = placeCreditsGate.handle;
      const settlePlaceCredits = async (ok: boolean) => {
        await settleCreditsOperation(placeCreditsHandle, ok);
        placeCreditsHandle = null;
      };

      if (styleReselect) {
        const days = placeCtx.days ?? activeSession.tripDays ?? 1;
        logAiStyleReselectGenerateStart(
          destination,
          styleReselect,
          days,
          sessionForPlan.planVersion ?? 1,
        );
        logChatRegeneratePlaceCardsStart(destination, styleReselect, days);
      } else if (forceRegenerate) {
        const days = placeCtx.days ?? activeSession.tripDays;
        if (days && placeCtx.planningTripStyle) {
          logChatRegeneratePlaceCardsStart(
            destination,
            placeCtx.planningTripStyle as TripStyleKey,
            days,
          );
        }
      }

      persistSession({ ...sessionForPlan, planningSessionId: flowSessionId });

      const excludePlaceIds = styleReselect
        ? collectHardDuplicatePlaceIds(activeSession, conversation)
        : stylePlanTurn
          ? []
          : (opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession));
      const rejectedPlaceNames = opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      const renderDestinationReply = async (
        summary: string,
        recommendations: RoamieRecommendationItem[],
        payload: RoamiePayloadV2,
        contextPatch: Partial<CanonicalTravelContext>,
        dayPlan?: AiDayPlan,
      ) => {
        const incomingDayPlan = (() => {
          if (dayPlan?.items.length) return dayPlan;
          const frozen = getFrozenPlanningDayPlan(flowSessionId);
          return frozen?.items.length ? frozen : undefined;
        })();
        const incomingPlanSessionId = incomingDayPlan?.planningSessionId;

        logAiPushPlaceCardsSession(incomingPlanSessionId ?? flowSessionId, flowSessionId);

        if (
          incomingDayPlan &&
          incomingPlanSessionId &&
          incomingPlanSessionId !== flowSessionId &&
          isStalePlanningSession(sessionForPlan, incomingPlanSessionId, flowSessionId)
        ) {
          logAiPlaceCardsSkipStale(incomingPlanSessionId, flowSessionId);
          logAiStaleRecommendationsBlocked();
          return false;
        }
        const alignedDayPlan =
          incomingDayPlan && incomingPlanSessionId
            ? alignDayPlanToSession(incomingDayPlan, flowSessionId)
            : undefined;

        const sessionWithRecs: ChatPlanningSession = {
          ...sessionForPlan,
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
          },
        };

        const orderedRecs = alignedDayPlan
          ? dayPlanToChatPlaces(alignedDayPlan)
          : ((recommendations ?? []) as ChatPlaceItem[]);

        const { summary: displaySummary, recommendations: filteredRecs } = alignedDayPlan
          ? { summary, recommendations: orderedRecs }
          : finalizeChatRecommendationDisplay(sessionWithRecs, userText, summary, recommendations);

        let recs = alignedDayPlan
          ? orderedRecs
          : ((filteredRecs.length ? filteredRecs : recommendations) as ChatPlaceItem[]);

        recs = dedupePlaceCardsForRender(recs) as ChatPlaceItem[];
        const itineraryRender = Boolean(alignedDayPlan || stylePlanTurn);
        if (!recs.length && !displaySummary.trim()) {
          logAiRenderBlocked(
            "empty_recommendations",
            recs.length,
            alignedDayPlan?.items.length ?? 0,
            flowSessionId,
            flowSessionId,
          );
          if (styleReselect) {
            logAiStyleReselectGenerateFail(
              "empty_recommendations",
              sessionForPlan.planVersion ?? 1,
            );
          }
          persistSession(
            withChatPlanningState(sessionForPlan, "idle", "render_empty_recommendations"),
          );
          await settlePlaceCredits(false);
          return false;
        }

        const requestedTripDays = placeCtx.days ?? alignedDayPlan?.days ?? sessionForPlan.tripDays;

        const itineraryRenderSuccess =
          Boolean(alignedDayPlan?.items.length) &&
          recs.length > 0 &&
          (alignedDayPlan?.days ?? 0) > 0 &&
          (!requestedTripDays || alignedDayPlan!.days === requestedTripDays);

        if (itineraryRender && !itineraryRenderSuccess) {
          safeChatLog(
            logAiRenderBlocked,
            "itinerary_plan_incomplete",
            recs.length,
            alignedDayPlan?.items.length ?? 0,
            flowSessionId,
            flowSessionId,
          );
          safeChatLog(logChatRenderBlocked, "itinerary_plan_incomplete");
          if (styleReselect) {
            safeChatLog(
              logAiStyleReselectGenerateFail,
              "itinerary_plan_incomplete",
              sessionForPlan.planVersion ?? 1,
            );
          }
          persistSession(
            withChatPlanningState(sessionForPlan, "idle", "itinerary_plan_incomplete"),
          );
          await settlePlaceCredits(false);
          return false;
        }

        if (alignedDayPlan) {
          logChatRenderItinerary(alignedDayPlan.days, alignedDayPlan.items.length);
        } else if (stylePlanTurn) {
          logChatRenderItinerary(0, recs.length);
        } else {
          logChatRenderPlaceList(recs.length, "destination_reply");
        }

        if (alignedDayPlan || stylePlanTurn) {
          logAiRenderItineraryStart();
        }

        const storedDayPlan = alignedDayPlan
          ? { ...alignedDayPlan, planningSessionId: flowSessionId }
          : undefined;

        const baseConversation = replacePreviousCards
          ? stripPreviousPlaceCardMessages(conversation)
          : conversation;

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base =
            trimmedPrev.length === baseConversation.length ? baseConversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: recs,
                dayPlan: storedDayPlan,
                moodTag:
                  resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
                  payload.moodTag,
              },
            },
          ];
        });

        persistSession(
          syncSessionPlaceMemory(
            mergeTripSessionUsedPlacesFromMessages(
              withChatPlanningState(
                {
                  ...sessionWithRecs,
                  currentDayPlan: storedDayPlan,
                  recommendedPlaces: recs,
                  selectedPlaces: [],
                  pendingQuestion: undefined,
                },
                itineraryRenderSuccess ? "planGenerated" : "idle",
                itineraryRenderSuccess ? "render_itinerary_success" : "itinerary_plan_incomplete",
              ),
              baseConversation,
            ),
          ),
        );
        setPartial({});
        if (itineraryRenderSuccess) {
          requestAnimationFrame(() => {
            const lastIndex = baseConversation.length;
            scrollToPlaceCardsStart(lastIndex);
          });
          logAiRenderItinerarySuccess(
            recs.length,
            alignedDayPlan?.days,
            requestedTripDays ?? alignedDayPlan?.days,
          );
        }
        if (styleReselect) {
          logAiStyleReselectGenerateSuccess(
            recs.length || alignedDayPlan?.items.length || 0,
            sessionForPlan.planVersion ?? 1,
          );
        }
        if (forceRegenerate) {
          logChatRegeneratePlaceCardsDone(recs.length);
        }
        await settlePlaceCredits(recs.length > 0);
        return true;
      };

      setStreaming(true);
      try {
        const regenCtx = forceRegenerate
          ? enrichContextForItineraryMode(
              userText,
              {
                ...placeCtx,
                destination,
                mustVisitGenerated: false,
                ...(styleReselect || stylePlanTurn
                  ? {
                      planningTripStyle:
                        styleReselect ??
                        parseAskTripStyleSelection(userText) ??
                        placeCtx.planningTripStyle,
                      planningDaysConfirmed: true,
                    }
                  : {}),
              },
              sessionForPlan,
            )
          : enrichContextForItineraryMode(userText, { ...placeCtx, destination }, sessionForPlan);

        const { summary, recommendations, payload, contextPatch, dayPlan } =
          await buildDestinationMustVisitRecommendation({
            destination,
            userText,
            context: regenCtx,
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            fetchPlaceDetailsFn: fetchPlaceDetailsForFocus,
            excludePlaceIds,
            rejectedPlaceNames,
            planningSessionId: flowSessionId,
            session: sessionForPlan,
          });

        return renderDestinationReply(summary, recommendations, payload, contextPatch, dayPlan);
      } catch (error) {
        console.warn("[CHAT_PLACES_ERROR]", error instanceof Error ? error.message : String(error));
        if (styleReselect) {
          logAiStyleReselectGenerateFail(
            error instanceof Error ? error.message : String(error),
            sessionForPlan.planVersion ?? 1,
          );
        }
        const label = destination;
        const itineraryRequested = shouldUseItineraryMode(userText, placeCtx, sessionForPlan);
        if (itineraryRequested) {
          logChatRenderPlaceList(0, "itinerary_planner_error");
          const intro = buildWeatherAwarePlaceIntro(label, resolveWeatherScene(null, label), false);
          const summary = [intro, "", `${label} 的行程還在整理中，稍後再試一次。`].join("\n");
          await settlePlaceCredits(false);
          return renderDestinationReply(
            summary,
            [],
            {
              version: 2,
              title: "必去推薦",
              summary,
              moodTag:
                resolveRecommendationStyleTag(sessionForPlan, placeCtx) || placeCtx.mood || "",
              recommendations: [],
              itinerary: [],
              generatedAt: new Date().toISOString(),
            },
            {
              destination: label,
              mustVisitGenerated: false,
              tripPurpose: "must_visit_places",
              planningStage: undefined,
            },
          );
        }
        const namedRecs = buildNamedFallbackRecommendations(label);
        const intro = buildWeatherAwarePlaceIntro(label, resolveWeatherScene(null, label), false);
        const summary = namedRecs.length
          ? [
              intro,
              "",
              ...namedRecs.map(
                (rec, index) => `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
              ),
              "",
              "想加進行程的話，跟我說你最想先排哪幾個。",
            ].join("\n")
          : [intro, "", `我暫時沒連上${label}的即時地點資料，你可以稍後再試或換個說法。`].join(
              "\n",
            );
        const payload: RoamiePayloadV2 = {
          version: 2,
          title: "必去推薦",
          summary,
          moodTag: resolveRecommendationStyleTag(sessionForPlan, placeCtx) || placeCtx.mood || "",
          recommendations: [],
          itinerary: [],
          generatedAt: new Date().toISOString(),
        };
        if (!namedRecs.length) {
          console.warn("[CHAT_RENDER_BLOCKED]", "reason=no_real_places");
        }
        return renderDestinationReply(summary, [], payload, {
          destination: label,
          mustVisitGenerated: true,
          tripPurpose: "must_visit_places",
          planningStage: "recommendations_generated",
        });
      } finally {
        setPlanningRenderInProgress(false, flowSessionId);
        setStreaming(false);
      }
    },
    [
      logRtNoMoreReason,
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      fetchWeather,
      scrollToPlaceCardsStart,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );
  pushDestinationPlaceRecommendationRef.current = pushDestinationPlaceRecommendation;

  const pushMorePlaceRecommendations = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const destination =
        placeCtx.destination?.trim() ||
        activeSession.tripPlanningContext?.destination?.trim() ||
        activeSession.tripDestination?.city?.trim();
      if (!destination) return false;

      if (!ensureSubscriptionHydratedForCredits(conversation)) return true;
      const placeCreditsGate = await beginPlaceRecommendationCredits({
        hasPlusAccess,
        metadata: { path: "more_places", destination },
      });
      if (placeCreditsGate.blocked) {
        setMsgs([
          ...conversation,
          { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE },
        ]);
        return true;
      }
      let placeCreditsHandle: CreditsOperationHandle | null = placeCreditsGate.handle;
      const settlePlaceCredits = async (ok: boolean) => {
        await settleCreditsOperation(placeCreditsHandle, ok);
        placeCreditsHandle = null;
      };

      if (isMorePlaceRecommendationsIntent(userText)) {
        logAiFollowupMoreDetected(userText);
        logChatMorePlacesIntent(userText);
      }

      const sessionWithUsed = mergeTripSessionUsedPlacesFromMessages(activeSession, conversation);
      const usedPlaces = collectUsedPlaces(sessionWithUsed, conversation);
      const activeCategory =
        resolveActiveCategoryIntent(activeSession) ?? activeSession.activeCategoryIntent;

      const excludePlaceIds = opts?.excludePlaceIds ?? usedPlaces.usedPlaceIds;
      const rejectedPlaceNames = opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      logChatMorePlacesExcludeIds(excludePlaceIds.length);

      const renderMorePlacesReply = async (
        summary: string,
        recommendations: RoamieRecommendationItem[],
        payload: RoamiePayloadV2,
        contextPatch: Partial<CanonicalTravelContext>,
        nextRecSession?: ChatPlanningSession["recommendationSession"],
      ) => {
        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          ...sessionWithUsed,
          activeChatIntent: activeSession.activeChatIntent ?? "destination_advice",
          activeCategoryIntent: activeCategory ?? activeSession.activeCategoryIntent,
          travelIntents: activeSession.travelIntents,
          recommendationSession: nextRecSession ?? activeSession.recommendationSession,
          conversationMode: "destination_planning",
          phase: "recommend",
          pendingQuestion: undefined,
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
            tripPurpose: "more_place_recommendations",
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, userText, summary, recommendations);

        // Shopping: never fall back to unfiltered (wrong-category) results.
        const recs = (
          activeCategory === "shopping"
            ? filteredRecs
            : filteredRecs.length
              ? filteredRecs
              : recommendations
        ) as ChatPlaceItem[];
        if (!recs.length) {
          logChatMorePlacesNoResultAllowed(true);
          await settlePlaceCredits(false);
          return false;
        }

        logChatMorePlacesNoResultAllowed(false);

        const moreDisplaySummary =
          activeCategory === "shopping"
            ? buildContinueRecommendationSummary("shopping", recs)
            : displaySummary;

        const nextMsgs = (() => {
          const trimmedPrev = conversation.filter(
            (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
          );
          const styleTag =
            resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
            payload.moodTag;
          return [
            ...trimmedPrev,
            {
              role: "assistant" as const,
              content: moreDisplaySummary,
              roamie: {
                ...payload,
                summary: moreDisplaySummary,
                recommendations: recs,
                moodTag: styleTag,
              },
            },
          ];
        })();
        setMsgs(nextMsgs);

        const priorRecs = activeSession.recommendedPlaces ?? [];
        const mergedRecs = [...priorRecs];
        const seenIds = new Set(collectExcludePlaceIds(activeSession, conversation));
        for (const rec of recs) {
          const id = rec.googlePlaceId ?? rec.placeId;
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          mergedRecs.push(rec);
        }

        const sessionAfterRecs: ChatPlanningSession = {
          ...sessionWithRecs,
          recommendedPlaces: mergedRecs,
        };
        const updatedUsed = collectUsedPlaces(sessionAfterRecs, conversation);

        persistSession(
          syncSessionPlaceMemory({
            ...sessionAfterRecs,
            usedPlaceIds: updatedUsed.usedPlaceIds,
            usedPlaceNames: updatedUsed.usedPlaceNames,
            usedAreaKeys: updatedUsed.usedAreaKeys,
            recommendedPlaceIds: updatedUsed.usedPlaceIds,
            recommendedNormalizedNames: updatedUsed.usedPlaceNames,
            pendingQuestion: undefined,
          }),
          nextMsgs,
        );
        logAiFollowupSessionUsedUpdated(updatedUsed);
        setPartial({});
        await settlePlaceCredits(true);
        return true;
      };

      // Shopping「還有嗎」: load reserve first (always log), then Places only if needed.
      const isShoppingFollowup =
        activeCategory === "shopping" &&
        activeSession.recommendationSession?.topic === "shopping" &&
        isContinueRecommendationRequest(userText, activeSession);

      let shoppingSessionForSearch = activeSession.recommendationSession;
      let shoppingReservePrefetch: RoamieRecommendationItem[] = [];
      const shoppingSubtype = detectShoppingSubtype(userText);

      if (isShoppingFollowup && shoppingSessionForSearch) {
        logShoppingReserveLoaded({
          destinationKey: shoppingSessionForSearch.destination,
          workspaceId: activeSession.workspaceId,
          found: true,
          reserveCount: shoppingSessionForSearch.shoppingCandidateReserve?.length ?? 0,
        });

        // Already exhausted + general「還有嗎」→ guide subtype, do not re-hit same queries.
        if (shoppingSessionForSearch.exhausted && shoppingSubtype === "general") {
          const exhaustedCopy = buildShoppingExhaustedFollowupMessage(
            shoppingSessionForSearch.activeSearchCity ??
              shoppingSessionForSearch.destination ??
              destination,
          );
          const exhaustedMsgs = [
            ...conversation.filter(
              (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
            ),
            { role: "assistant" as const, content: exhaustedCopy },
          ];
          setMsgs(exhaustedMsgs);
          persistSession(
            {
              ...sessionWithUsed,
              activeCategoryIntent: "shopping",
              recommendationSession: shoppingSessionForSearch,
              pendingQuestion: undefined,
              travelContext: {
                ...placeCtx,
                destination,
                tripPurpose: "more_place_recommendations",
              },
            },
            exhaustedMsgs,
          );
          await settlePlaceCredits(false);
          return true;
        }

        // Subtype refinement clears exhausted so a new direction can search.
        if (shoppingSubtype !== "general" && shoppingSessionForSearch.exhausted) {
          shoppingSessionForSearch = {
            ...shoppingSessionForSearch,
            exhausted: false,
            exhaustedAt: undefined,
          };
        }

        // Always enter reserve consumption (logs even when reserveCount=0).
        const reserved = takeShoppingReserveBatch(
          shoppingSessionForSearch,
          RECOMMENDATION_BATCH_SIZE,
          { subtype: shoppingSubtype },
        );
        shoppingSessionForSearch = reserved.session;
        shoppingReservePrefetch = reserved.batch;
        if (reserved.batch.length >= SHOPPING_FOLLOWUP_MIN_NEW) {
          const summary = buildContinueRecommendationSummary("shopping", reserved.batch);
          return renderMorePlacesReply(
            summary,
            reserved.batch,
            {
              version: 2,
              title: "更多推薦",
              summary,
              moodTag: resolveRecommendationStyleTag(activeSession, placeCtx) || "",
              recommendations: reserved.batch,
              itinerary: [],
              generatedAt: new Date().toISOString(),
            },
            {
              destination,
              tripPurpose: "more_place_recommendations",
              conversationState: "itinerary_draft",
              planningStage: "recommendations_generated",
            },
            reserved.session,
          );
        }
      }

      // Continue from Recommendation Session cursor when same non-shopping topic
      if (
        !isShoppingFollowup &&
        isContinueRecommendationRequest(userText, activeSession) &&
        activeSession.recommendationSession &&
        activeCategory &&
        activeSession.recommendationSession.topic === activeCategory
      ) {
        logAiPipeline("[CONTINUATION_POOL_RESTORED]", {
          storedPoolCount: activeSession.recommendationSession.pool.length,
          remainingCount: Math.max(
            0,
            activeSession.recommendationSession.pool.length -
              activeSession.recommendationSession.cursor,
          ),
        });
        const continuationCurrentProfile = userProfileForReasonFrom(activeSession.preferences, {
          hasPlusAccess,
        });
        const continuationCurrentContext = buildPersonalizationContextV1({
          surface: "chatNearby",
          profile: continuationCurrentProfile,
          profileVersion: activeSession.preferences?.updated_at,
          sessionPreference: activeSession.sessionPreference,
        });
        const continued = continueRecommendation(
          activeSession.recommendationSession,
          undefined,
          continuationCurrentContext,
        );
        if (continued.batch.length) {
          logAiPipeline(
            "[RECOMMENDATION_CONTINUATION_SUMMARY]",
            `message=${userText}`,
            "continuationDetected=true",
            "explicitDestinationDetected=false",
            "destinationChanged=false",
            `destination=${activeSession.recommendationSession.destination}`,
            `parentCity=${activeSession.recommendationSession.parentCity ?? ""}`,
            `area=${activeSession.recommendationSession.area ?? ""}`,
            `searchScope=${activeSession.recommendationSession.searchScope ?? ""}`,
            `searchRegionLabel=${activeSession.recommendationSession.searchRegionLabel ?? activeSession.recommendationSession.destination}`,
            `category=${activeCategory}`,
            "scene=",
            `storedPoolCount=${Math.max(0, activeSession.recommendationSession.pool.length - activeSession.recommendationSession.cursor)}`,
            "usedStoredPool=true",
            "newSearchTriggered=false",
            `searchRound=${activeSession.recommendationSession.continuationSearchRound ?? 0}`,
            "attemptCount=0",
            "remainingStrategyCount=",
            "rawCount=0",
            "afterScopeCount=0",
            "afterCategoryCount=0",
            "afterDedupeCount=0",
            `renderableCount=${continued.batch.length}`,
            `finalCount=${continued.batch.length}`,
            `exhausted=${continued.exhausted}`,
            `exhaustedReason=${continued.exhausted ? "stored_pool_exhausted" : ""}`,
          );
          const summary = buildContinueRecommendationSummary(activeCategory, continued.batch);
          return renderMorePlacesReply(
            summary,
            continued.batch,
            {
              version: 2,
              title: "更多推薦",
              summary,
              moodTag: resolveRecommendationStyleTag(activeSession, placeCtx) || "",
              recommendations: continued.batch,
              itinerary: [],
              generatedAt: new Date().toISOString(),
            },
            {
              destination,
              tripPurpose: "more_place_recommendations",
              conversationState: "itinerary_draft",
              planningStage: "recommendations_generated",
            },
            continued.session,
          );
        }
        logAiPipeline("[CONTINUATION_POOL_EXHAUSTED]", {
          reason: "stored_pool_exhausted",
        });
        // Pool exhausted locally — try supplement search below; if still empty, show no-more.
      }

      const morePlacesRequestId = `more_places_${Date.now().toString(36)}`;
      let loadingFinalizeReason = "success";
      setStreaming(true);
      try {
        const excludeForSearch = [
          ...excludePlaceIds,
          ...shoppingReservePrefetch.map((r) => r.googlePlaceId ?? "").filter(Boolean),
        ];
        const { summary, recommendations, payload, contextPatch, recommendationSessionPatch } =
          await buildMoreDestinationRecommendations({
            destination,
            userText,
            context: { ...placeCtx, destination, tripPurpose: "more_place_recommendations" },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            excludePlaceIds: excludeForSearch,
            rejectedPlaceNames,
            activeChatIntent: activeSession.activeChatIntent,
            activeCategoryIntent: activeCategory,
            session: sessionWithUsed,
            usedPlaces,
            recommendationSession: shoppingSessionForSearch,
          });

        let nextRecSession =
          recommendationSessionPatch ??
          shoppingSessionForSearch ??
          activeSession.recommendationSession;

        // Merge sparse reserve prefetch with network hits for shopping follow-up.
        let shoppingMerged = recommendations;
        if (activeCategory === "shopping" && shoppingReservePrefetch.length) {
          const seen = new Set(
            shoppingReservePrefetch.map((r) => r.googlePlaceId ?? "").filter(Boolean),
          );
          shoppingMerged = [...shoppingReservePrefetch];
          for (const rec of recommendations) {
            const id = rec.googlePlaceId ?? "";
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            shoppingMerged.push(rec);
            if (shoppingMerged.length >= RECOMMENDATION_BATCH_SIZE) break;
          }
        }

        if (activeCategory && shoppingMerged.length) {
          if (
            activeCategory === "shopping" &&
            (recommendationSessionPatch || shoppingReservePrefetch.length)
          ) {
            nextRecSession =
              recommendationSessionPatch ?? shoppingSessionForSearch ?? nextRecSession;
            const contSummary = buildContinueRecommendationSummary("shopping", shoppingMerged);
            loadingFinalizeReason = "success";
            return renderMorePlacesReply(
              contSummary,
              shoppingMerged,
              { ...payload, summary: contSummary, recommendations: shoppingMerged },
              contextPatch,
              nextRecSession,
            );
          }
          if (
            nextRecSession &&
            nextRecSession.topic === activeCategory &&
            nextRecSession.cursor >= nextRecSession.pool.length
          ) {
            const extended = extendRecommendationPool(nextRecSession, recommendations);
            nextRecSession = extended.session;
            if (extended.batch.length) {
              const contSummary = buildContinueRecommendationSummary(
                activeCategory,
                extended.batch,
              );
              loadingFinalizeReason = "success";
              return renderMorePlacesReply(
                contSummary,
                extended.batch,
                { ...payload, summary: contSummary, recommendations: extended.batch },
                contextPatch,
                nextRecSession,
              );
            }
          } else if (!nextRecSession || nextRecSession.topic !== activeCategory) {
            const created = createRecommendationSession({
              destination,
              topic: activeCategory,
              pool: recommendations,
              batchSize: defaultRecommendationDisplayBatchSize(activeCategory),
            });
            nextRecSession = created.session;
            const contSummary = buildContinueRecommendationSummary(activeCategory, created.batch);
            loadingFinalizeReason = "success";
            return renderMorePlacesReply(
              contSummary,
              created.batch,
              { ...payload, summary: contSummary, recommendations: created.batch },
              contextPatch,
              nextRecSession,
            );
          }
        }

        if (recommendations.length) {
          loadingFinalizeReason = "success";
          return renderMorePlacesReply(
            summary,
            recommendations,
            payload,
            contextPatch,
            nextRecSession,
          );
        }

        // Exhausted after supplement — soft no-more; keep session / destination / intent.
        // Shopping must not suggest switching to food/cafe.
        loadingFinalizeReason = "no_results";
        logChatMorePlacesNoResultAllowed(true);
        const shoppingRecForNoMore =
          recommendationSessionPatch ?? nextRecSession ?? activeSession.recommendationSession;
        const shoppingAlreadyExhausted =
          activeCategory === "shopping" && Boolean(shoppingRecForNoMore?.exhausted);
        const shoppingNowExhausted =
          activeCategory === "shopping" &&
          shoppingRecForNoMore != null &&
          (shoppingRecForNoMore.shoppingCandidateReserve?.length ?? 0) === 0 &&
          // Mark exhausted after a no-result round so the next「還有嗎」branches.
          true;
        const noMoreCopy =
          activeCategory === "shopping"
            ? shoppingAlreadyExhausted
              ? buildShoppingExhaustedFollowupMessage(
                  shoppingRecForNoMore?.activeSearchCity ?? destination,
                )
              : SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE
            : NO_MORE_RECOMMENDATIONS_MESSAGE;
        const exhaustedAt = new Date().toISOString();
        const exhaustedRecSession = (() => {
          if (!shoppingRecForNoMore || activeCategory !== "shopping") {
            return shoppingRecForNoMore;
          }
          if (!shoppingNowExhausted && !shoppingAlreadyExhausted) {
            return shoppingRecForNoMore;
          }
          return {
            ...shoppingRecForNoMore,
            exhausted: true,
            exhaustedAt: shoppingRecForNoMore.exhaustedAt ?? exhaustedAt,
          };
        })();
        const exhaustedMsgs = [
          ...conversation.filter(
            (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
          ),
          { role: "assistant" as const, content: noMoreCopy },
        ];
        setMsgs(exhaustedMsgs);
        logRtNoMoreReason({
          caller: "pushMorePlaceRecommendations",
          route: "MORE_RECOMMENDATIONS",
          followup: true,
          hasActiveRecommendationContext: Boolean(
            sessionWithUsed.activeRecommendationContext || sessionWithUsed.recommendationSession,
          ),
          reason: "continuation_exhausted",
        });
        persistSession(
          {
            ...sessionWithUsed,
            activeCategoryIntent: activeCategory ?? activeSession.activeCategoryIntent,
            recommendationSession: exhaustedRecSession,
            pendingQuestion: undefined,
            travelContext: {
              ...placeCtx,
              destination,
              tripPurpose: "more_place_recommendations",
            },
          },
          exhaustedMsgs,
        );
        await settlePlaceCredits(false);
        logRtResponseBranch("no_more");
        return true;
      } catch (error) {
        loadingFinalizeReason = "error";
        console.warn("[CHAT_PLACES_ERROR]", error instanceof Error ? error.message : String(error));
        logChatMorePlacesNoResultAllowed(true);
        await settlePlaceCredits(false);
        return false;
      } finally {
        setStreaming(false);
        logChatLoadingFinalized({
          requestId: morePlacesRequestId,
          reason: loadingFinalizeReason,
        });
      }
    },
    [
      logRtNoMoreReason,
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      fetchWeather,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );

  const pushDestinationCategoryPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      // Explicit Nearby requests belong to the Nearby dispatcher. Their full
      // query is not a provisional destination label.
      if (userExplicitlyWantsNearbyPlaces(userText)) return false;
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const shortcutNearby =
        merged.session.normalizedShortcutRequest?.structured === true &&
        merged.session.normalizedShortcutRequest.intent === "nearby_recommendation" &&
        merged.session.normalizedShortcutRequest.mode === "rainy";
      if (shortcutNearby) {
        logShortcutRuntime("[RT_RAINY_ROUTE]", {
          structured: true,
          shortcutMode: "rainy",
          destinationCategorySkipped: true,
          genericPlaceRouteSkipped: true,
          scope: "current_location",
        });
        return false;
      }
      const intents = parseChatPlaceIntents(userText);
      if (!intents.length) return false;
      const provisionalArea = extractProvisionalDestinationAreaCandidate(userText);
      const validatedAreaScope = await resolveValidatedDestinationAreaScope({
        input: userText,
        locale,
        geocodeFn: geocodeLocationFn,
      });
      // An explicit district-only label must not silently inherit an older session destination.
      if (provisionalArea && !validatedAreaScope) {
        logShortcutRuntime("[RT_RAINY_ROUTE]", {
          diverted: true,
          blockedFunction: "pushDestinationCategoryPlaceRecommendation",
          reason: "provisional_geographic_clarification",
          areaCandidate: provisionalArea.areaCandidate,
        });
        const clarificationMsgs: ChatMsg[] = [
          ...conversation,
          {
            role: "assistant",
            content: `你指的是哪個地區的${provisionalArea.areaCandidate}？`,
          },
        ];
        setMsgs(clarificationMsgs);
        persistSession(
          {
            ...merged.session,
            pendingClarification: buildPendingGeographicClarification({
              rawGeographicLabel: provisionalArea.areaCandidate,
              categoryIntent: intents[0]!,
              originalUserText: userText,
            }),
            activeCategoryIntent: intents[0],
            pendingQuestion: undefined,
            lastAssistantReply: `你指的是哪個地區的${provisionalArea.areaCandidate}？`,
          },
          clarificationMsgs,
        );
        return true;
      }
      const baseDestination = resolveDestinationForCategorySearch(
        placeCtx,
        merged.session,
        userText,
      );
      if (!baseDestination && !validatedAreaScope) return false;
      const destination = validatedAreaScope?.displayLabel ?? baseDestination;
      const persistedAreaScope =
        validatedAreaScope ??
        (destination ? resolveDestinationAreaScope(destination) : null) ??
        resolveDestinationAreaScope(userText);

      const excludePlaceIds = opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames = opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      if (!ensureSubscriptionHydratedForCredits(conversation)) return true;
      const placeCreditsGate = await beginPlaceRecommendationCredits({
        hasPlusAccess,
        metadata: { path: "destination_category", destination, intents },
      });
      if (placeCreditsGate.blocked) {
        setMsgs([
          ...conversation,
          { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE },
        ]);
        return true;
      }
      let placeCreditsHandle: CreditsOperationHandle | null = placeCreditsGate.handle;

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch, searchCentroid, usedQueries } =
          await buildDestinationCategoryRecommendations({
            destination,
            intents,
            userText,
            context: { ...placeCtx, destination },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            excludePlaceIds,
            rejectedPlaceNames,
            session: activeSession,
            userProfile: userProfileForReasonFrom(activeSession.preferences, {
              hasPlusAccess,
            }),
          });

        if (!recommendations.length) {
          await settleCreditsOperation(placeCreditsHandle, false);
          placeCreditsHandle = null;
          return false;
        }

        const categoryIntent = intents[0]!;
        const activeIntent = mapCategoryIntentToNearbyIntent(categoryIntent);
        const shoppingScope =
          categoryIntent === "shopping"
            ? resolveShoppingSearchScope({
                destination,
                shownPlaces: recommendations,
              })
            : null;
        const destinationEntity =
          categoryIntent === "shopping" ? resolveDestinationEntity(destination) : null;
        // Always resolve a destination search centroid for the Recommendation Snapshot
        // so「有其他的嗎」can restore the same geocoded area center — never a shopping cluster.
        const snapshotCentroid =
          (isUsableSearchCentroid(searchCentroid) ? searchCentroid : undefined) ??
          (categoryIntent === "shopping" ? shoppingScope?.searchCentroid : undefined) ??
          (() => {
            const approx = resolveDestinationApproxCenter(destination);
            return approx ? { lat: approx.lat, lng: approx.lng } : undefined;
          })();
        const snapshotRadius = shoppingScope?.searchRadius;
        const shoppingSeed =
          categoryIntent === "shopping"
            ? buildInitialShoppingSearchAttempts(
                destination,
                userText,
                shoppingScope?.activeSearchCity,
                destinationEntity?.country,
              )
            : null;
        // Shopping: split FULL validated pool → display(4) + reserve(rest) before UI render.
        const displayBatchSize =
          categoryIntent === "shopping"
            ? SHOPPING_DISPLAY_LIMIT
            : DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE;
        const shoppingSplit =
          categoryIntent === "shopping"
            ? buildShoppingDisplayAndReserveFromPool(recommendations, SHOPPING_DISPLAY_LIMIT)
            : null;
        const shoppingCoverage =
          categoryIntent === "shopping"
            ? buildShoppingCoverageState({
                destination,
                places: shoppingSplit?.displayed ?? recommendations.slice(0, displayBatchSize),
                coveredClusters: shoppingScope?.geoClusterLabel
                  ? [shoppingScope.geoClusterLabel]
                  : [],
                destinationCountryCode: destinationEntity?.country,
                destinationLanguage: shoppingSeed?.locale,
                usedQueryGroups: shoppingSeed?.groups?.map((g) => g.id),
              })
            : undefined;
        const { session: recSession, batch } = createRecommendationSession({
          destination,
          topic: categoryIntent,
          pool: recommendations,
          batchSize: displayBatchSize,
          usedQueries: shoppingSeed?.usedQueries ?? usedQueries,
          nextQueryCursor: shoppingSeed?.nextQueryCursor,
          recommendationPage: 0,
          activeSearchCity: shoppingScope?.activeSearchCity,
          parentCity: persistedAreaScope?.parentCity,
          area: persistedAreaScope?.area,
          searchScope: persistedAreaScope ? "area" : "city",
          searchRegionLabel: shoppingScope?.searchRegionLabel ?? destination,
          searchCentroid: snapshotCentroid,
          searchRadius: snapshotRadius,
          geoClusterIndex: shoppingScope?.geoClusterIndex,
          geoClusterLabel: shoppingScope?.geoClusterLabel,
          shoppingCandidateReserve: shoppingSplit?.reserve,
          shoppingCoverage,
        });
        if (categoryIntent === "shopping" && shoppingScope) {
          const brands = recommendations
            .map((r) => shoppingBrandKey({ name: r.name, placeName: r.placeName }))
            .filter(Boolean);
          recSession.returnedBrandKeys = [...new Set(brands)];
          logShoppingCoverageState(
            recSession.shoppingCoverage ?? shoppingCoverage!,
            recSession.shoppingCandidateReserve?.length ?? 0,
          );
          logShoppingReservePersisted({
            destinationKey: destination,
            workspaceId: activeSession.workspaceId,
            reserveCount: recSession.shoppingCandidateReserve?.length ?? 0,
            storage: "sessionStorage",
          });
        }
        // Text + place cards must share the same final batch (atomic commit).
        const batchRecs = batch.length ? batch : recommendations.slice(0, displayBatchSize);
        const alignedSummary =
          categoryIntent === "shopping" || recommendations.length > displayBatchSize
            ? (() => {
                const list = batchRecs
                  .map(
                    (rec, index) =>
                      `${index + 1}. ${rec.name}${rec.rating != null ? `（${rec.rating}★）` : ""}${rec.reason ? ` — ${rec.reason}` : ""}`,
                  )
                  .join("\n");
                const heading =
                  categoryIntent === "shopping"
                    ? "購物／商圈推薦："
                    : categoryIntent === "cafe"
                      ? "咖啡廳推薦："
                      : categoryIntent === "restaurant"
                        ? "餐廳推薦："
                        : "推薦：";
                return [
                  `在${destination}，這些地方值得先看看：`,
                  "",
                  heading,
                  list,
                  "",
                  "想加進行程的話，直接點卡片或跟我說你最想先排哪幾個。",
                ].join("\n");
              })()
            : summary;

        // Keep combination_choice pending so user can still reply「1、2」after place rec.
        // tripPurpose=recommend_places ensures Place Cards are not suppressed.
        const preserveCombinationPending =
          activeSession.pendingQuestion?.type === "combination_choice"
            ? activeSession.pendingQuestion
            : undefined;
        const placeParsed = parsePlaceRecommendationIntent(userText);
        const activeRecContext = ensureActiveRecommendationContext(
          {
            ...merged.session,
            recommendationSession: recSession,
            activeCategoryIntent: categoryIntent,
          },
          {
            destination,
            intent: categoryIntent,
            places: batch.length ? batch : recommendations.slice(0, displayBatchSize),
            usedQueries: shoppingSeed?.usedQueries ?? recSession.usedQueries,
            resolvedSearchCity:
              shoppingScope?.activeSearchCity ??
              recSession.activeSearchCity ??
              persistedAreaScope?.parentCity ??
              resolveRegionPrimaryCity(destination) ??
              destination,
            parentCity: persistedAreaScope?.parentCity,
            area: persistedAreaScope?.area,
            searchScope: persistedAreaScope ? "area" : "city",
            latitude:
              snapshotCentroid?.lat ??
              shoppingScope?.searchCentroid?.lat ??
              recSession.searchCentroid?.lat,
            longitude:
              snapshotCentroid?.lng ??
              shoppingScope?.searchCentroid?.lng ??
              recSession.searchCentroid?.lng,
            radius: snapshotRadius ?? shoppingScope?.searchRadius ?? recSession.searchRadius,
          },
        );
        if (placeParsed) {
          if (placeParsed.subtypes.length) {
            activeRecContext.cuisine = [
              ...new Set([...(activeRecContext.cuisine ?? []), ...placeParsed.subtypes]),
            ];
          }
          if (placeParsed.preferredFeatures.length) {
            activeRecContext.preferredKeywords = [
              ...new Set([
                ...(activeRecContext.preferredKeywords ?? []),
                ...placeParsed.preferredFeatures,
              ]),
            ];
            activeRecContext.atmosphere = [
              ...new Set([
                ...(activeRecContext.atmosphere ?? []),
                ...placeParsed.preferredFeatures,
                ...(placeParsed.atmosphere ?? []),
              ]),
            ];
          }
          if (placeParsed.excludedFeatures.length) {
            activeRecContext.excludedKeywords = [
              ...new Set([
                ...(activeRecContext.excludedKeywords ?? []),
                ...placeParsed.excludedFeatures,
              ]),
            ];
          }
          if (placeParsed.mealSlot) activeRecContext.mealSlot = placeParsed.mealSlot;
          if (placeParsed.budget) {
            activeRecContext.budget = { level: placeParsed.budget };
          }
          if (placeParsed.indoorOnly) activeRecContext.indoorOnly = true;
          activeRecContext.destinationDisplayName = destination;
        }
        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          activeChatIntent: activeIntent,
          activeCategoryIntent: categoryIntent,
          travelIntents: addTravelIntent(activeSession.travelIntents, categoryIntent),
          recommendationSession: recSession,
          activeRecommendationContext: activeRecContext,
          // Stay on place recommendation without flipping into device-nearby explore.
          conversationMode: "destination_planning",
          phase: "recommend",
          pendingClarification: undefined,
          pendingQuestion: preserveCombinationPending,
          tripPlanningContext: activeSession.tripPlanningContext
            ? {
                ...activeSession.tripPlanningContext,
                destination,
                intent: "destination_planning",
              }
            : {
                selectedPlaces: [],
                destination,
                intent: "destination_planning",
              },
          tripDays: activeSession.tripDays,
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
            days: placeCtx.days ?? activeSession.tripDays ?? activeSession.travelContext?.days,
            startDate: placeCtx.startDate ?? activeSession.travelContext?.startDate,
            endDate: placeCtx.endDate ?? activeSession.travelContext?.endDate,
            tripPurpose: "recommend_places",
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, userText, alignedSummary, batchRecs);

        // Shopping: text list + cards must stay on the same gated batch.
        const recs = (
          categoryIntent === "shopping"
            ? filteredRecs
            : filteredRecs.length
              ? filteredRecs
              : batchRecs
        ) as ChatPlaceItem[];
        if (!recs.length) {
          console.warn("[CHAT_PLACE_CARD_RENDER] count=0 after_finalize");
          await settleCreditsOperation(placeCreditsHandle, false);
          placeCreditsHandle = null;
          return false;
        }

        const finalDisplaySummary =
          categoryIntent === "shopping"
            ? (() => {
                const list = recs
                  .map(
                    (rec, index) =>
                      `${index + 1}. ${rec.name}${rec.rating != null ? `（${rec.rating}★）` : ""}${rec.reason ? ` — ${rec.reason}` : ""}`,
                  )
                  .join("\n");
                return [
                  `在${destination}，這些地方值得先看看：`,
                  "",
                  "購物／商圈推薦：",
                  list,
                  "",
                  "想加進行程的話，直接點卡片或跟我說你最想先排哪幾個。",
                ].join("\n");
              })()
            : displaySummary;

        logChatUiReceivedCards(recs.length);
        console.info(
          "[PLACE_RECOMMENDATION_RENDER]",
          `category=${categoryIntent}`,
          `textCount=${finalDisplaySummary.length}`,
          `cardCount=${recs.length}`,
        );

        const nextMsgs = (() => {
          const trimmedPrev = conversation.filter(
            (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
          );
          return [
            ...trimmedPrev,
            {
              role: "assistant" as const,
              content: finalDisplaySummary,
              roamie: {
                ...payload,
                summary: finalDisplaySummary,
                recommendations: recs,
                moodTag:
                  resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
                  payload.moodTag,
              },
            },
          ];
        })();
        setMsgs(nextMsgs);

        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithRecs,
            recommendedPlaces: recs,
            pendingClarification: undefined,
            pendingQuestion: preserveCombinationPending,
          }),
          nextMsgs,
        );
        console.info(
          "[CHAT_PLACE_RECOMMENDATION_RENDERED]",
          `textCount=${finalDisplaySummary.length}`,
          `cardCount=${recs.length}`,
        );
        console.info(
          "[ACTIVE_RECOMMENDATION_CONTEXT_SAVED]",
          `destination=${destination}`,
          `resolvedCity=${activeRecContext.resolvedSearchCity ?? ""}`,
          `primaryType=${categoryIntent}`,
          `subtypes=${(activeRecContext.cuisine ?? []).join(",")}`,
        );
        setPartial({});
        await settleCreditsOperation(placeCreditsHandle, true);
        placeCreditsHandle = null;
        return true;
      } catch (error) {
        await settleCreditsOperation(placeCreditsHandle, false);
        console.warn("[CHAT_PLACES_ERROR]", error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );

  const pushRecommendationRefinement = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
    ): Promise<boolean> => {
      const arbitration = resolveChatIntentArbitration(userText, activeSession);
      if (
        arbitration.route !== "RECOMMENDATION_REFINEMENT" &&
        arbitration.route !== "MORE_RECOMMENDATIONS"
      ) {
        return false;
      }

      let sessionForSearch = activeSession;
      if (arbitration.refinement && arbitration.route === "RECOMMENDATION_REFINEMENT") {
        sessionForSearch = applyRefinementPatchToSession(activeSession, arbitration.refinement);
      } else if (!sessionForSearch.activeRecommendationContext) {
        const dest =
          sessionForSearch.recommendationSession?.destination ||
          sessionForSearch.travelContext?.destination ||
          sessionForSearch.tripPlanningContext?.destination ||
          sessionForSearch.tripDestination?.city ||
          "";
        const topic = resolveActiveCategoryIntent(sessionForSearch);
        if (!dest || !topic) return false;
        sessionForSearch = {
          ...sessionForSearch,
          activeRecommendationContext: ensureActiveRecommendationContext(sessionForSearch, {
            destination: dest,
            intent: topic,
            places: sessionForSearch.recommendedPlaces,
            usedQueries: sessionForSearch.recommendationSession?.usedQueries,
            resolvedSearchCity: sessionForSearch.recommendationSession?.activeSearchCity,
            parentCity: sessionForSearch.recommendationSession?.parentCity,
            area: sessionForSearch.recommendationSession?.area,
            searchScope: sessionForSearch.recommendationSession?.searchScope,
            latitude: sessionForSearch.recommendationSession?.searchCentroid?.lat,
            longitude: sessionForSearch.recommendationSession?.searchCentroid?.lng,
            radius: sessionForSearch.recommendationSession?.searchRadius,
          }),
        };
      }

      const recCtx = sessionForSearch.activeRecommendationContext;
      if (!recCtx) return false;

      if (arbitration.route === "MORE_RECOMMENDATIONS") {
        // Bare「還有嗎」must consume the stored session pool / destination-category
        // continuation search — not the refinement Places contract.
        return false;
      }

      const snapshotCategory = recommendationIntentToCategoryIntent(recCtx.intent);
      const restoredCategory = restoreContinueRecommendationCategory({
        resolvedRoute: arbitration.route,
        requestCategory: snapshotCategory,
        snapshotCategory,
      });
      // Ensure snapshot intent wins for MORE_RECOMMENDATIONS (shopping ≠ attraction).
      if (restoredCategory !== snapshotCategory) {
        sessionForSearch = {
          ...sessionForSearch,
          activeCategoryIntent:
            restoredCategory as import("@/lib/ai/chat-place-category-types").ChatPlaceCategoryIntent,
          activeRecommendationContext: {
            ...recCtx,
            intent: categoryIntentToRecommendationIntent(
              restoredCategory as import("@/lib/ai/chat-place-category-types").ChatPlaceCategoryIntent,
            ),
          },
        };
      }

      const merged = mergeTravelContext(sessionForSearch, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, sessionForSearch);

      if (!ensureSubscriptionHydratedForCredits(conversation)) return true;
      const placeCreditsGate = await beginPlaceRecommendationCredits({
        hasPlusAccess,
        metadata: { path: "refinement", destination: recCtx.destinationName },
      });
      if (placeCreditsGate.blocked) {
        setMsgs([
          ...conversation,
          { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE },
        ]);
        return true;
      }
      let placeCreditsHandle: CreditsOperationHandle | null = placeCreditsGate.handle;

      setStreaming(true);
      try {
        const activeRec = sessionForSearch.activeRecommendationContext ?? recCtx;
        const result = await buildRecommendationRefinementResults({
          context: activeRec,
          travelContext: { ...placeCtx, destination: activeRec.destinationName },
          locale,
          searchPlaces: searchNearbyPlaces,
          geocodeFn: geocodeLocationFn,
          session: sessionForSearch,
          userProfile: userProfileForReasonFrom(sessionForSearch.preferences, {
            hasPlusAccess,
          }),
        });
        if (!result?.recommendations.length) {
          await settleCreditsOperation(placeCreditsHandle, false);
          placeCreditsHandle = null;
          const noMoreMsgs = [
            ...conversation,
            {
              role: "assistant" as const,
              content: NO_MORE_RECOMMENDATIONS_MESSAGE,
            },
          ];
          setMsgs(noMoreMsgs);
          logRtNoMoreReason({
            caller: "pushRecommendationRefinement",
            route: "RECOMMENDATION_REFINEMENT",
            followup: false,
            hasActiveRecommendationContext: Boolean(sessionForSearch.activeRecommendationContext),
            reason: "no_candidates",
          });
          persistSession(
            {
              ...sessionForSearch,
              activeRecommendationContext: {
                ...activeRec,
                exhausted: true,
                updatedAt: Date.now(),
              },
              pendingQuestion: undefined,
            },
            noMoreMsgs,
          );
          logRtResponseBranch("no_more");
          return true;
        }

        const categoryIntent =
          resolveActiveCategoryIntent(sessionForSearch) ??
          recommendationIntentToCategoryIntent(activeRec.intent) ??
          "restaurant";
        const { session: recSession, batch } = createRecommendationSession({
          destination: activeRec.destinationName,
          topic: categoryIntent,
          pool: result.recommendations,
          batchSize: defaultRecommendationDisplayBatchSize(categoryIntent),
          usedQueries: [...(activeRec.usedQueries ?? []), ...result.usedQueries],
          activeSearchCity: activeRec.resolvedSearchCity,
          parentCity: activeRec.parentCity,
          area: activeRec.area,
          searchScope: activeRec.searchScope,
          searchRegionLabel: activeRec.destinationDisplayName ?? activeRec.destinationName,
          searchCentroid:
            activeRec.latitude != null && activeRec.longitude != null
              ? { lat: activeRec.latitude, lng: activeRec.longitude }
              : undefined,
          searchRadius: activeRec.radius,
        });

        const batchRecs = batch.length
          ? batch
          : result.recommendations.slice(0, defaultRecommendationDisplayBatchSize(categoryIntent));
        let nextSession: ChatPlanningSession = {
          ...sessionForSearch,
          activeCategoryIntent: categoryIntent,
          recommendationSession: recSession,
          phase: "recommend",
          pendingQuestion: undefined,
          travelContext: {
            ...placeCtx,
            destination: activeRec.destinationName,
            tripPurpose: "refine_recommendations",
          },
        };
        nextSession = syncActiveRecommendationContextAfterResults(
          nextSession,
          batchRecs,
          result.usedQueries,
        );

        const list = batchRecs
          .map(
            (rec, index) =>
              `${index + 1}. ${rec.name}${rec.rating != null ? `（${rec.rating}★）` : ""}${rec.reason ? ` — ${rec.reason}` : ""}`,
          )
          .join("\n");
        const summary = result.summary.includes(batchRecs[0]?.name ?? "")
          ? result.summary
          : [
              `在${activeRec.destinationDisplayName ?? activeRec.destinationName}，依你補充的條件再幫你找：`,
              "",
              list,
              "",
              "想再調整條件或說「還有嗎」都可以。",
            ].join("\n");

        console.info(
          "[CHAT_REFINEMENT_UI_RENDERED]",
          `intent=${activeRec.intent}`,
          `finalCount=${batchRecs.length}`,
          `cardCount=${batchRecs.length}`,
        );

        const nextMsgs = [
          ...conversation,
          {
            role: "assistant" as const,
            content: summary,
            roamie: {
              ...result.payload,
              summary,
              recommendations: batchRecs,
            },
          },
        ];
        setMsgs(nextMsgs);
        persistSession(
          syncSessionPlaceMemory({
            ...nextSession,
            recommendedPlaces: batchRecs as ChatPlaceItem[],
            pendingQuestion: undefined,
          }),
          nextMsgs,
        );
        setPartial({});
        await settleCreditsOperation(placeCreditsHandle, true);
        placeCreditsHandle = null;
        return true;
      } catch (error) {
        await settleCreditsOperation(placeCreditsHandle, false);
        console.warn(
          "[CHAT_REFINEMENT_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      hasPlusAccess,
      ensureSubscriptionHydratedForCredits,
    ],
  );

  const pushAlternativeDestinationPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      destination: string,
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const label = destination.trim();
      if (!label) return false;

      const excludePlaceIds = opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames = opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch } =
          await buildAlternativeDestinationRecommendations({
            destination: label,
            userText,
            context: {
              ...placeCtx,
              destination: label,
              tripPurpose: "alternative_recommendations",
            },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            excludePlaceIds,
            rejectedPlaceNames,
          });

        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          activeChatIntent: "restaurant",
          conversationMode: activeSession.conversationMode ?? "destination_planning",
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination: label,
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, userText, summary, recommendations);

        if (!filteredRecs.length && !displaySummary.trim()) {
          return false;
        }

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: filteredRecs.length ? filteredRecs : recommendations,
              },
            },
          ];
        });

        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithRecs,
            recommendedPlaces: (filteredRecs.length
              ? filteredRecs
              : recommendations) as ChatPlaceItem[],
            pendingQuestion: undefined,
          }),
        );
        setPartial({});
        return true;
      } catch (error) {
        console.warn(
          "[CHAT_ALTERNATIVE_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchWeather],
  );

  const applyLocalFallback = useCallback(
    async (
      activeSession: ChatPlanningSession,
      activeUserText: string,
      conversation: ChatMsg[],
      reason: string,
    ): Promise<boolean> => {
      devVerboseInfo(`[CHAT_FALLBACK_USED] reason=${reason}`);

      if (isPlaceDetailChatActive(activeSession)) {
        return false;
      }

      const mergedForScope = mergeTravelContext(activeSession, activeUserText);
      const explicitScope = resolveExplicitDestinationFallbackScope({
        userText: activeUserText,
        session: activeSession,
        context: mergedForScope.context,
      });
      const scopedSession = explicitScope
        ? isolateSessionToExplicitDestination(activeSession, explicitScope)
        : activeSession;

      if (explicitScope && reason === "destination_category_places_failed") {
        logDestinationRecommendationFallbackSummary({
          destination: explicitScope.destination,
          sourcePath: "local-recommendation-fallback",
          fallbackDestination: scopedSession.travelContext?.destination,
          accepted: false,
          reason: "explicit_destination_builder_empty",
        });
        return false;
      }

      if (
        explicitScope &&
        shouldBlockCrossScopeRecommendationFallback({
          explicit: explicitScope,
          sourcePath: "old_recommendation_session",
          fallbackDestination:
            activeSession.recommendationSession?.destination ||
            activeSession.activeRecommendationContext?.destinationName ||
            activeSession.travelContext?.destination,
        })
      ) {
        logDestinationRecommendationFallbackSummary({
          destination: explicitScope.destination,
          sourcePath: "old_recommendation_session",
          fallbackDestination:
            activeSession.recommendationSession?.destination ||
            activeSession.activeRecommendationContext?.destinationName,
          accepted: false,
          reason: "old_session_destination",
        });
      }

      // Continue recommendation must stay on destination snapshot — never GPS nearby.
      if (
        (scopedSession.activeRecommendationContext ||
          scopedSession.recommendationSession ||
          resolveActiveCategoryIntent(scopedSession)) &&
        (matchesContinueRecommendationGrammar(activeUserText) ||
          isMorePlaceRecommendationsIntent(activeUserText) ||
          isRefreshRecommendationsRequest(activeUserText)) &&
        !isExplicitDeviceNearbyRequest(activeUserText)
      ) {
        const dest =
          scopedSession.activeRecommendationContext?.destinationName ||
          scopedSession.recommendationSession?.destination ||
          scopedSession.travelContext?.destination ||
          scopedSession.tripPlanningContext?.destination;
        if (
          dest?.trim() &&
          (!explicitScope ||
            !shouldBlockCrossScopeRecommendationFallback({
              explicit: explicitScope,
              sourcePath: "recommendation-refinement-fallback",
              fallbackDestination: dest,
            }))
        ) {
          const arbitration = resolveChatIntentArbitration(activeUserText, scopedSession);
          logContinueRecommendationResolved({
            route: arbitration.route,
            category: String(
              resolveActiveCategoryIntent(scopedSession) ??
                scopedSession.activeRecommendationContext?.intent ??
                "",
            ),
            destination: dest,
          });
          if (
            arbitration.route === "MORE_RECOMMENDATIONS" ||
            arbitration.route === "RECOMMENDATION_REFINEMENT"
          ) {
            const refined = await pushRecommendationRefinement(
              scopedSession,
              activeUserText,
              conversation,
            );
            if (refined) return true;
          }
          const more = await pushMorePlaceRecommendations(
            {
              ...scopedSession,
              travelContext: {
                ...(scopedSession.travelContext ?? { interests: [] }),
                destination: dest,
                tripPurpose: "more_place_recommendations",
              },
            },
            activeUserText,
            conversation,
          );
          if (more) return true;
          // Exhausted destination continue — do not invent GPS results.
          return false;
        }
      }

      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (tripSession) {
        try {
          await commitTripAddPlaceLocalTurn(tripSession, activeUserText, conversation);
          return true;
        } catch (e) {
          logTripAddPlaceFailure(e, tripSession, activeUserText, "local_fallback");
          try {
            await commitTripAddPlaceLocalTurn(
              tripSession,
              isTripAddPlaceMoreRecommendationsRequest(activeUserText) ? activeUserText : "還有嗎",
              conversation,
            );
          } catch (retryError) {
            logTripAddPlaceFailure(retryError, tripSession, activeUserText, "local_fallback_retry");
          }
          return true;
        }
      }

      const mergedForAdvice = mergeTravelContext(scopedSession, activeUserText);

      if (shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {
        const destForPlaces =
          mergedForAdvice.context.destination || scopedSession.travelContext?.destination;
        if (
          explicitScope &&
          shouldBlockCrossScopeRecommendationFallback({
            explicit: explicitScope,
            sourcePath: "generic-chat-fallback",
            fallbackDestination: destForPlaces,
          })
        ) {
          logDestinationRecommendationFallbackSummary({
            destination: explicitScope.destination,
            sourcePath: "generic-chat-fallback",
            fallbackDestination: destForPlaces,
            accepted: false,
            reason: "cross_scope_destination",
          });
        } else {
          const applied = await pushDestinationPlaceRecommendation(
            scopedSession,
            activeUserText,
            conversation,
          );
          if (applied) return true;
        }
      }

      if (
        shouldFetchDestinationCategoryPlaces(activeUserText, mergedForAdvice.context, scopedSession)
      ) {
        const destForCategory = resolveDestinationForCategorySearch(
          mergedForAdvice.context,
          scopedSession,
          activeUserText,
        );
        if (
          explicitScope &&
          shouldBlockCrossScopeRecommendationFallback({
            explicit: explicitScope,
            sourcePath: "destination-category-retry",
            fallbackDestination: destForCategory,
          })
        ) {
          logDestinationRecommendationFallbackSummary({
            destination: explicitScope.destination,
            sourcePath: "destination-category-retry",
            fallbackDestination: destForCategory,
            accepted: false,
            reason: "cross_scope_destination",
          });
        } else {
          const applied = await pushDestinationCategoryPlaceRecommendation(
            scopedSession,
            activeUserText,
            conversation,
          );
          if (applied) return true;
        }
      }

      const planningTurn = resolvePlanningFallbackTurn(
        activeUserText,
        scopedSession,
        scopedSession.travelContext ?? { interests: [] },
      );
      if (
        planningTurn.advice.reply &&
        !shouldBlockPlanningFallbackForCategoryQuery(
          activeUserText,
          mergedForAdvice.context,
          scopedSession,
        )
      ) {
        const trimmedConversation = conversation.filter(
          (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
        );
        await completeAdviceTurn(
          planningTurn,
          planningTurn.session,
          mergedForAdvice.context,
          trimmedConversation,
        );
        setPartial({});
        return true;
      }

      if (
        isPlanningTurnActive(mergedForAdvice.session, mergedForAdvice.context) &&
        !shouldBlockPlanningFallbackForCategoryQuery(
          activeUserText,
          mergedForAdvice.context,
          scopedSession,
        )
      ) {
        const offline = buildPlanningOfflineReply(
          mergedForAdvice.context,
          mergedForAdvice.session,
          activeUserText,
        );
        if (offline) {
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            return [...trimmedPrev, { role: "assistant", content: offline }];
          });
          persistSession(mergedForAdvice.session);
          setPartial({});
          return true;
        }
      }

      const adviceTurn = processAdviceTurn(
        activeUserText,
        mergedForAdvice.session,
        mergedForAdvice.context,
      );
      if (adviceTurn.advice.reply) {
        if (explicitScope && hasCategoryPlaceQuery(activeUserText)) {
          logDestinationRecommendationFallbackSummary({
            destination: explicitScope.destination,
            sourcePath: "generic-chat-fallback",
            fallbackDestination: mergedForAdvice.context.destination,
            accepted: false,
            reason: "generic_chat_blocked",
          });
        } else {
          const trimmedConversation = conversation.filter(
            (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
          );
          await completeAdviceTurn(
            adviceTurn,
            mergedForAdvice.session,
            mergedForAdvice.context,
            trimmedConversation,
          );
          setPartial({});
          return true;
        }
      }

      const intent = resolveChatIntent(activeUserText, scopedSession);
      if (
        isNearbyPlaceIntent(intent) &&
        shouldFetchNearbyPlaces(intent, scopedSession, activeUserText)
      ) {
        // Never cover trip destination with device GPS for place-category asks.
        const destForScope =
          explicitScope?.destination ||
          resolveDestinationForCategorySearch(
            mergedForAdvice.context,
            scopedSession,
            activeUserText,
          );
        if (explicitScope && !isExplicitDeviceNearbyRequest(activeUserText)) {
          logDestinationRecommendationFallbackSummary({
            destination: explicitScope.destination,
            sourcePath: "current-location-nearby",
            fallbackDestination: destForScope,
            accepted: false,
            reason: "current_location_blocked",
          });
          console.warn(
            "[RECOMMENDATION_GPS_OVERRIDE_BLOCKED]",
            `destination=${explicitScope.destination}`,
            "reason=explicit_destination_scope_active",
          );
          return false;
        }
        if (destForScope && hasCategoryPlaceQuery(activeUserText)) {
          if (!isExplicitDeviceNearbyRequest(activeUserText)) {
            console.warn(
              "[RECOMMENDATION_SCOPE_MISMATCH]",
              `expectedDestination=${destForScope}`,
              "actualSource=current_device_location",
            );
            return false;
          }
        }
        const applied = await pushNearbyPlaceRecommendation(
          scopedSession,
          activeUserText,
          conversation,
          intent,
        );
        if (applied) return true;
      }

      if (
        scopedSession.activeChatIntent &&
        isNearbyPlaceIntent(scopedSession.activeChatIntent) &&
        (scopedSession.foodPreference || isFoodPreferenceReply(activeUserText))
      ) {
        if (explicitScope && !isExplicitDeviceNearbyRequest(activeUserText)) {
          logDestinationRecommendationFallbackSummary({
            destination: explicitScope.destination,
            sourcePath: "current-location-nearby",
            fallbackDestination: explicitScope.destination,
            accepted: false,
            reason: "current_location_blocked",
          });
        } else {
          const applied = await pushNearbyPlaceRecommendation(
            scopedSession,
            activeUserText,
            conversation,
            scopedSession.activeChatIntent,
          );
          if (applied) return true;
        }
      }

      const { context } = mergeTravelContext(scopedSession, activeUserText);
      let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
      const deviceSession = await resolveChatLocation(scopedSession);
      const deviceLat = deviceSession.location?.lat;
      const deviceLng = deviceSession.location?.lng;
      const searchCtx = await resolveChatPlaceSearchContext({
        context,
        session: scopedSession,
        userText: activeUserText,
        locale,
        geocodeFn: geocodeLocationFn,
        deviceLatLng:
          deviceLat != null && deviceLng != null ? { lat: deviceLat, lng: deviceLng } : null,
      });

      if (searchCtx.placesCallBlocked) {
        console.info(
          "[DESTINATION_SCOPE_BLOCKED]",
          `destination=${searchCtx.destinationName ?? "none"}`,
          `reason=${searchCtx.placesBlockReason ?? "country_scope_requires_refinement"}`,
          "callPath=applyLocalFallback",
        );
        return false;
      }

      let lat: number | undefined;
      let lng: number | undefined;
      if (searchCtx.searchMode === "destination") {
        if (searchCtx.destinationLatLng) {
          lat = searchCtx.destinationLatLng.lat;
          lng = searchCtx.destinationLatLng.lng;
        } else if (searchCtx.textOnlyDestinationSearch) {
          lat = 0;
          lng = 0;
        }
      } else {
        lat = deviceLat;
        lng = deviceLng;
      }

      if (explicitScope && searchCtx.searchMode !== "destination") {
        logDestinationRecommendationFallbackSummary({
          destination: explicitScope.destination,
          sourcePath: "current-location-nearby",
          fallbackDestination: searchCtx.destinationName,
          accepted: false,
          reason: "current_location_blocked",
        });
        return false;
      }
      if (
        explicitScope &&
        searchCtx.destinationName &&
        shouldBlockCrossScopeRecommendationFallback({
          explicit: explicitScope,
          sourcePath: "local-recommendation-fallback",
          fallbackDestination: searchCtx.destinationName,
        })
      ) {
        logDestinationRecommendationFallbackSummary({
          destination: explicitScope.destination,
          sourcePath: "local-recommendation-fallback",
          fallbackDestination: searchCtx.destinationName,
          accepted: false,
          reason: "cross_scope_destination",
        });
        return false;
      }

      const resolvedIntent = resolveChatIntent(activeUserText, scopedSession);
      const isRestaurantFlow =
        scopedSession.activeChatIntent === "restaurant" ||
        resolvedIntent === "restaurant" ||
        isFoodIntentText(activeUserText);
      const isCampingFlow =
        scopedSession.activeChatIntent === "camping" ||
        resolvedIntent === "camping" ||
        context.activity === "camping";
      const searchPayload = placesSearchContextPayload(searchCtx);

      if (lat != null && lng != null) {
        const attempts = isRestaurantFlow
          ? restaurantSearchFallbackQueries(scopedSession.foodPreference, activeUserText)
          : isCampingFlow
            ? campingSearchAttempts()
            : [{ query: fallbackSearchQuery(context), mode: "text" as const }];
        for (const attempt of attempts) {
          try {
            devVerboseInfo(
              `[CHAT_PLACES_REQUEST] type=fallback mode=${attempt.mode} query=${attempt.query || "(nearby)"}`,
            );
            const fallback = await searchNearbyPlaces({
              data: {
                query: attempt.query,
                lat,
                lng,
                mode: attempt.mode,
                includedTypes: attempt.includedTypes,
                locale,
                ...placesStatsPayload({
                  placesCaller: "chat.fallbackSearch",
                  placesScreen: "chat",
                }),
                ...searchPayload,
              },
            });
            placeResults = fallback.places ?? [];
            if (
              (searchCtx.searchMode === "destination" && searchCtx.destinationName) ||
              explicitScope
            ) {
              const guardDest = explicitScope?.destination ?? searchCtx.destinationName;
              if (guardDest && placeResults.length > 0) {
                placeResults = filterPlacesByDestinationGuard(
                  placeResults,
                  guardDest,
                  activeUserText,
                );
              }
            }
            if (isCampingFlow) {
              placeResults = filterCampingPlaces(placeResults);
            }
            if (isRestaurantFlow) {
              const split = filterPlacesForFoodIntent(placeResults, activeUserText);
              placeResults = [...split.restaurants, ...split.districts];
            }
            devVerboseInfo(`[CHAT_PLACES_SUCCESS] count=${placeResults.length}`);
            if (placeResults.length > 0) break;
          } catch (fallbackErr) {
            console.warn("[CHAT_PLACES_REQUEST] failed", fallbackErr);
          }
        }
      }

      if (isCampingFlow && !placeResults.length) {
        const intro = buildCampingIntroReply(context, scopedSession);
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          return [...trimmedPrev, { role: "assistant", content: intro }];
        });
        persistSession({
          ...scopedSession,
          activeChatIntent: "camping",
          phase: "discover",
          travelContext: {
            ...context,
            activity: "camping",
            tripPurpose: "recommend_places",
          },
        });
        setPartial({});
        return true;
      }

      if (isRestaurantFlow && !placeResults.length) {
        if (
          hasCategoryPlaceQuery(activeUserText) &&
          resolveDestinationForCategorySearch(context, scopedSession, activeUserText)
        ) {
          return false;
        }
        const area = context.destination ?? context.currentLocation ?? "附近";
        const emptySummary = `目前在${area}暫時找不到符合的餐廳，可以換個菜系或稍後再試。`;
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          return [
            ...trimmedPrev,
            {
              role: "assistant",
              content: emptySummary,
              roamie: {
                title: "Roamie 推薦",
                summary: emptySummary,
                moodTag: scopedSession.mood ?? "",
                recommendations: [],
                itinerary: [],
              },
            },
          ];
        });
        return false;
      }

      const { summary, payload } = generateLocalRecommendationFallback({
        context,
        session: scopedSession,
        locale,
        places: placeResults ?? [],
      });
      const sessionForDisplay: ChatPlanningSession = {
        ...scopedSession,
        activeChatIntent: isCampingFlow
          ? "camping"
          : (scopedSession.activeChatIntent ?? "restaurant"),
        phase: "recommend",
        travelContext: context,
      };
      const { summary: displaySummary, recommendations: filteredRecs } =
        finalizeChatRecommendationDisplay(
          sessionForDisplay,
          activeUserText,
          summary,
          payload.recommendations ?? [],
        );
      const recs = (
        filteredRecs.length
          ? filteredRecs
          : hasCategoryPlaceQuery(activeUserText)
            ? (payload.recommendations ?? [])
            : filteredRecs
      ) as ChatPlaceItem[];
      const scopedRecs = explicitScope
        ? (filterRecommendationsForExplicitDestinationScope(recs, explicitScope) as ChatPlaceItem[])
        : recs;
      if (explicitScope && recs.length && !scopedRecs.length) {
        logDestinationRecommendationFallbackSummary({
          destination: explicitScope.destination,
          sourcePath: "local-recommendation-fallback",
          fallbackDestination: context.destination,
          candidatePlaceId: recs[0]?.googlePlaceId,
          accepted: false,
          reason: "cross_scope_place",
        });
      }
      if (!scopedRecs.length) {
        if (
          hasCategoryPlaceQuery(activeUserText) &&
          resolveDestinationForCategorySearch(context, scopedSession, activeUserText)
        ) {
          return false;
        }
        return false;
      }
      logChatUiReceivedCards(scopedRecs.length);
      setMsgs((prev) => {
        const trimmedPrev = prev.filter(
          (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
        );
        return [
          ...trimmedPrev,
          {
            role: "assistant",
            content: displaySummary,
            roamie: {
              ...payload,
              summary: displaySummary,
              recommendations: scopedRecs,
            },
          },
        ];
      });
      const nextSession = syncSessionPlaceMemory({
        ...sessionForDisplay,
        recommendedPlaces: scopedRecs,
      });
      persistSession(nextSession);
      setPartial({});
      return scopedRecs.length > 0;
    },
    [
      locale,
      persistSession,
      searchNearbyPlaces,
      geocodeLocationFn,
      pushNearbyPlaceRecommendation,
      pushDestinationPlaceRecommendation,
      pushMorePlaceRecommendations,
      pushDestinationCategoryPlaceRecommendation,
      pushRecommendationRefinement,
      pushTripAddPlaceMoreRecommendations,
      commitTripAddPlaceLocalTurn,
      persistPlanningAdviceTurn,
      completeAdviceTurn,
    ],
  );

  const streamChat = useCallback(
    async (
      conversation: ChatMsg[],
      opts?: {
        phase?: import("@/lib/ai/context").ChatPhase;
        userText?: string;
        focusedPlace?: ChatPlaceItem;
      },
      sessionOverride?: ChatPlanningSession,
    ) => {
      const activeSession = sessionOverride ?? session;
      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (tripSession) {
        console.warn("[TRIP_ADD_PLACE] blocked streamChat — local recommendation only");
        const userText = opts?.userText ?? "";
        const baseConversation = conversation.filter((m) => m.content?.trim());
        try {
          await commitTripAddPlaceLocalTurn(tripSession, userText, baseConversation);
        } catch (e) {
          logTripAddPlaceFailure(e, tripSession, userText, "stream_chat_blocked");
          try {
            await commitTripAddPlaceLocalTurn(
              tripSession,
              isTripAddPlaceMoreRecommendationsRequest(userText) ? userText : "還有嗎",
              baseConversation,
            );
          } catch (retryError) {
            logTripAddPlaceFailure(retryError, tripSession, userText, "stream_chat_blocked_retry");
          }
        }
        return;
      }

      setStreaming(true);
      setLastFailed(null);
      setPartial({});
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutMs = 60_000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;

        setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);

        const req = await buildRequest(
          conversation,
          {
            chatPhase: opts?.phase,
            chatInput: opts?.userText,
            focusedPlace: opts?.focusedPlace,
          },
          sessionOverride,
        );
        devVerboseInfo("[AI_REPLY_REQUEST]", `phase=${req.chatPhase ?? "unknown"}`);

        const full = await streamRoamieAI(
          req,
          {
            onPartial: (p) => {
              setPartial(p);
              setMsgs((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = {
                    role: "assistant",
                    content: p.summary ?? "",
                    roamie: p,
                  };
                }
                return next;
              });
            },
            onError: (msg) => {
              throw new Error(msg);
            },
          },
          { token, signal: controller.signal },
        );

        if (!full) {
          console.error("[AI_REPLY_RESPONSE] stream_returned_null");
          throw new Error("AI 沒有回應，請再試一次。");
        }
        devVerboseInfo(
          "[AI_REPLY_SUCCESS]",
          `recommendations=${full.recommendations?.length ?? 0}`,
        );

        const userText = opts?.userText ?? "";
        const intentForGuard = parseTripIntentFromText(userText, sessionOverride ?? session);
        const summary = full.summary?.trim() ?? "";
        if (isGenericFallbackReply(summary)) {
          console.warn("[CHAT_FALLBACK_BLOCKED] generic_ai_reply");
          throw new Error("AI 沒有回應，請再試一次。");
        }
        const looksRepeatedClarify =
          /這趟比較想放鬆、拍照，還是吃美食/.test(summary) && /(都有|都可以|都行)/.test(userText);
        if (
          (full.recommendations?.length ?? 0) === 0 &&
          intentForGuard.readyForRecommendations &&
          looksRepeatedClarify
        ) {
          const destination =
            intentForGuard.destinationCity ??
            (sessionOverride ?? session).tripDestination?.city ??
            "釜山";
          const fallbackSummary = [
            `${destination} 11 月通常約 9-17°C，早晚偏涼，海風明顯，建議薄羽絨或防風外套。`,
            "你剛說想要放鬆、拍照、美食都有，我先幫你抓 3 個方向：",
            `1) 海景放鬆：廣安里海邊散步 + The Bay 101 夜景`,
            "2) 情侶拍照：海東龍宮寺 + 白淺灘文化村",
            "3) 在地美食：札嘎其市場海鮮 + 南浦洞街區小吃",
            "要不要我接著幫你排成 5 天的輕鬆情侶行程？",
          ].join("\n");
          setMsgs((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: fallbackSummary,
              roamie: {
                title: `${destination} 情侶慢旅行方向`,
                summary: fallbackSummary,
                moodTag: (sessionOverride ?? session).mood ?? "",
                recommendations: [],
                itinerary: [],
              },
            };
            return next;
          });
          return;
        }

        if (full.recommendations?.length) {
          recordRecommendationNames([
            ...full.recommendations.map((r) => r.name),
            ...extractPlaceNames(session.selectedPlaces),
          ]);
        }

        const apiPhaseUsed = opts?.phase ?? resolveChatApiPhase(session, opts?.userText ?? "");
        let nextSession = mergeSessionFromRoamie(
          sessionOverride ?? session,
          full,
          (sessionOverride ?? session).phase,
        );
        const activeSession = sessionOverride ?? session;
        const followUpIntent = parsePlaceDetailFollowUp(opts?.userText ?? "");
        let { summary: displaySummary, recommendations: displayRecs } =
          finalizeChatRecommendationDisplay(
            activeSession,
            opts?.userText ?? "",
            full.summary ?? "",
            full.recommendations ?? [],
          );
        if (
          isPlaceDetailChatActive(activeSession) &&
          followUpIntent !== "nearby_cafe" &&
          followUpIntent !== "nearby_late_snack"
        ) {
          displayRecs = [];
        }
        if (displayRecs.length) {
          nextSession = {
            ...nextSession,
            recommendedPlaces: displayRecs as ChatPlaceItem[],
          };
        }
        if (nextSession.phase === "discover" && isDiscoveryComplete(nextSession)) {
          nextSession = { ...nextSession, phase: "followup" };
        }
        nextSession = {
          ...nextSession,
          phase: resolveSessionPhaseAfterReply(
            nextSession,
            Boolean(displayRecs.length),
            apiPhaseUsed,
          ),
        };
        persistSession(nextSession);

        const displayFull = {
          ...full,
          summary: displaySummary,
          recommendations: displayRecs,
        };
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: displayFull.summary,
            roamie: displayFull,
          };
          return next;
        });
        setPartial({});
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const activeForTimeout = sessionOverride ?? session;
          const activeUserText = opts?.userText ?? "";
          const applied = await applyLocalFallback(
            activeForTimeout,
            activeUserText,
            conversation,
            "ai_timeout",
          );
          if (!applied) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              return [
                ...trimmedPrev,
                {
                  role: "assistant",
                  content: "連線有點久，但我仍會依你的需求幫你找適合的地點。",
                },
              ];
            });
          }
          setPartial({});
          setLastFailed(conversation);
          return;
        }
        console.error("[CHAT_AI_REPLY_ERROR]", e instanceof Error ? e.message : String(e));
        logAppError("[Roamie AI] chat failed", e, {
          userText: opts?.userText,
          phase: opts?.phase,
        });
        const activeForFallback = sessionOverride ?? session;
        const activeUserText = opts?.userText ?? "";
        const applied = await applyLocalFallback(
          activeForFallback,
          activeUserText,
          conversation,
          "ai_reply_failed",
        );
        if (!applied) {
          const fallbackMerged = mergeTravelContext(activeForFallback, activeUserText);
          const planningTurn = resolvePlanningFallbackTurn(
            activeUserText,
            activeForFallback,
            fallbackMerged.context,
          );
          if (planningTurn.advice.reply) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              void completeAdviceTurn(
                planningTurn,
                planningTurn.session,
                fallbackMerged.context,
                trimmedPrev,
              );
              return trimmedPrev;
            });
            setPartial({});
            return;
          }
          if (isPlanningTurnActive(fallbackMerged.session, fallbackMerged.context)) {
            const offline = buildPlanningOfflineReply(
              fallbackMerged.context,
              fallbackMerged.session,
              activeUserText,
            );
            if (offline) {
              setMsgs((prev) => {
                const trimmedPrev = prev.filter(
                  (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
                );
                return [...trimmedPrev, { role: "assistant", content: offline }];
              });
              persistSession(fallbackMerged.session);
              setPartial({});
              return;
            }
          }
          const fallbackAdviceTurn = processAdviceTurn(
            activeUserText,
            fallbackMerged.session,
            fallbackMerged.context,
          );
          if (fallbackAdviceTurn.advice.reply) {
            const trimmedPrev = conversation.filter(
              (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
            );
            await completeAdviceTurn(
              fallbackAdviceTurn,
              fallbackMerged.session,
              fallbackMerged.context,
              trimmedPrev,
            );
            setPartial({});
            return;
          }
          const hint: ChatMsg = {
            role: "assistant",
            content:
              buildPlanningOfflineReply(
                fallbackMerged.context,
                fallbackMerged.session,
                activeUserText,
              ) ?? resolveChatConnectionFallbackMessage(e),
          };
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            return [...trimmedPrev, hint];
          });
        }
        setPartial({});
        setLastFailed(conversation);
      } finally {
        window.clearTimeout(timeoutId);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      buildRequest,
      session,
      persistSession,
      locale,
      applyLocalFallback,
      completeAdviceTurn,
      commitTripAddPlaceLocalTurn,
    ],
  );

  const handleOpenPlaceDetail = (rec: RoamieRecommendationItem) => {
    markShortcutEngaged();
    if (!rec.googlePlaceId?.trim()) {
      toast.message("此建議尚未完成地點驗證，暫時無法開啟詳情");
      return;
    }
    if (rec.lat == null || rec.lng == null) {
      toast.message("此地點尚無座標，暫時無法開啟地點詳情");
      return;
    }
    preserveChatUiForPlaceDetail(msgsRef.current, messagesRef.current?.scrollTop ?? 0);
    const handoff = openRecommendationPlaceDetail(rec);
    if (!handoff) {
      toast.message("此建議尚未完成地點驗證，暫時無法開啟詳情");
      return;
    }
    void navigate({
      to: "/place",
      search: {
        placeId: handoff.placeId || undefined,
        lat: handoff.lat ?? undefined,
        lng: handoff.lng ?? undefined,
        returnTo: "chat",
      },
    });
  };

  const handleDiscussPlace = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    markShortcutEngaged();
    let item = roamieRecToChatItem(rec);
    const placeId = (item.placeId ?? item.googlePlaceId ?? "").trim();
    if (placeId && !hasValidPlaceCoordinates(item)) {
      const details = await fetchPlaceDetailsForFocus(placeId, {
        placeName: item.placeName ?? item.name,
        city: item.city,
      });
      if (details) {
        item = enrichChatPlaceItemFromDetails(item, details);
      }
    }
    const nextSession = enterPlaceDetailChat(session, item);
    persistSession(nextSession);

    const userLine = `想聊聊 ${placeDisplayName(item)}`;
    const assistantLine = buildPlaceDetailReply(item, nextSession);
    setMsgs((prev) => [
      ...prev,
      { role: "user", content: userLine },
      {
        role: "assistant",
        content: assistantLine,
        roamie: {
          title: placeDisplayName(item),
          summary: assistantLine,
          moodTag: nextSession.mood ?? nextSession.selectedMood ?? "",
          recommendations: [],
          itinerary: [],
        },
      },
    ]);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom("new_message", { force: true });
      });
    });
  };

  const send = async (
    overrideText?: string,
    opts?: { source?: "user" | "auto" | "chat_shortcut" | "home_mood" },
  ) => {
    const rawText = overrideText ?? text;
    console.info("[CHAT_SEND_RUNTIME_VERSION]", {
      buildId: ROAMIE_BUILD_DEBUG,
      rawText,
    });
    const trimmed = rawText.trim();
    if (!trimmed || streaming || generating) return;

    if (
      isPlanningSelectionMode(sessionRef.current) &&
      /^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed)
    ) {
      if (selectionGenerateInFlightRef.current) return;
      const currentSession = sessionRef.current;
      const selection = currentSession.planningSelection!;
      const preparedSelection = preparePlanningSelectionForGenerate(currentSession);
      const selectedPlaces = preparedSelection.requiredPlaces;
      devVerboseInfo("[PLANNING_SELECTION_GENERATE_CLICK]", {
        sessionId: selection.id,
        selectedIdsCount: selection.selectedPlaceIds.length,
        selectedPayloadCount: selectedPlaces.length,
        shownCount: selection.shownPlaceIds.length,
      });
      if (selection.selectedPlaceIds.length > 0 && selectedPlaces.length === 0) {
        devVerboseInfo("[SELECTION_PLACE_RESOLUTION_MISMATCH]", {
          sessionId: selection.id,
          selectedIdsCount: selection.selectedPlaceIds.length,
          selectedPayloadCount: 0,
        });
      }
      const conversation: ChatMsg[] = [...msgsRef.current, { role: "user", content: trimmed }];
      setMsgs(conversation);
      setText("");
      if (selectedPlaces.length === 0) {
        devVerboseInfo("[PLANNING_SELECTION_GENERATE_BLOCKED]", {
          sessionId: selection.id,
          reason: "no_selected_payload",
        });
        setMsgs([
          ...conversation,
          { role: "assistant", content: "請先從推薦卡加入至少一個想去的地點，再生成行程。" },
        ]);
        return;
      }
      selectionGenerateInFlightRef.current = true;
      const readySession = preparedSelection.session;
      logPlanningSelectionDateAuthority(
        "generate_click",
        resolvePlanningSelectionDateAuthority(readySession),
        selection.id,
      );
      devVerboseInfo("[PLANNING_SELECTION_GENERATE_RESOLVE]", {
        sessionId: selection.id,
        requiredPlaces: selectedPlaces.length,
        canonicalPlaceIds: selectedPlaces.map(
          (place) => place.googlePlaceId?.trim() || place.placeId?.trim() || `(name:${place.name})`,
        ),
      });
      persistSession(readySession, conversation);
      try {
        await handleGenerateItinerary(readySession, conversation);
      } finally {
        selectionGenerateInFlightRef.current = false;
      }
      return;
    }

    if (isPlanningSelectionMode(session) && isPlanningSelectionContinuation(trimmed)) {
      if (selectionRecommendationInFlightRef.current) return;
      selectionRecommendationInFlightRef.current = true;
      const conversation: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(conversation);
      setText("");
      setStreaming(true);
      let creditsHandle: CreditsOperationHandle | null = null;
      let delivered = false;
      try {
        if (!ensureSubscriptionHydratedForCredits(conversation)) return;
        const creditsGate = await beginPlaceRecommendationCredits({
          hasPlusAccess,
          metadata: { path: "planning_selection_continuation" },
        });
        if (creditsGate.blocked) {
          setMsgs([
            ...conversation,
            { role: "assistant", content: INSUFFICIENT_CREDITS_PLACE_MESSAGE },
          ]);
          return;
        }
        creditsHandle = creditsGate.handle;
        const [prefs, profile] = await Promise.all([getAiPreferences(), getUserProfile()]);
        const result = await fetchPlanningSelectionRecommendations({
          session,
          searchPlaces: searchNearbyPlaces,
          locale,
          userProfile: userProfileForReasonFrom(prefs, {
            travelStyle: profile.travelStyle,
            personalityType: profile.personalityType,
            personalitySummary: profile.personalitySummary,
            mood: session.mood,
            hasPlusAccess,
          }),
        });
        const summary = result.places.length
          ? "再幫你找了一批不同的地點；前面看過和已選的都不會重複。"
          : "目前選擇的風格暫時沒有更多新地點了；你可以先從已推薦的地點中挑選。";
        setMsgs([
          ...conversation,
          {
            role: "assistant",
            content: summary,
            roamie: { summary, recommendations: result.places, itinerary: [] },
          },
        ]);
        persistSession(result.session);
        delivered = result.places.length > 0;
      } finally {
        await settleCreditsOperation(creditsHandle, delivered);
        creditsHandle = null;
        selectionRecommendationInFlightRef.current = false;
        setStreaming(false);
      }
      return;
    }

    const legacyNearbyClarification =
      session.pendingClarification?.kind === "destination_area" &&
      userExplicitlyWantsNearbyPlaces(session.pendingClarification.originalUserText ?? "")
        ? session.pendingClarification
        : undefined;
    const legacyNearbyIntent = legacyNearbyClarification
      ? (inferNearbyIntentFromContext(
          session.travelContext ?? { interests: [] },
          legacyNearbyClarification.originalUserText ?? "",
          session,
        ) ?? mapCategoryIntentToNearbyIntent(legacyNearbyClarification.categoryIntent))
      : null;
    const pendingNearbyLocation =
      session.pendingNearbyLocationRequest ??
      (legacyNearbyClarification && legacyNearbyIntent
        ? createPendingNearbyLocationRequest(
            legacyNearbyIntent,
            legacyNearbyClarification.originalUserText ?? "",
          )
        : undefined);
    console.info("[CHAT_PENDING_NEARBY_CHECK]", {
      hasPending: Boolean(pendingNearbyLocation),
      rawText,
      consumed: Boolean(pendingNearbyLocation),
    });
    if (pendingNearbyLocation) {
      console.info("[NEARBY_CLARIFICATION_RUNTIME_VERSION]", {
        buildId: ROAMIE_BUILD_DEBUG,
        contractVersion: NEARBY_CLARIFICATION_CONTRACT_VERSION,
        hasGeocodeFallback: true,
        copyVersion: "simple-location-question",
      });
      console.info("[PLANNER_BYPASSED_FOR_PENDING_NEARBY]", {
        rawText: trimmed,
        pendingIntent: pendingNearbyLocation.intent,
        reason: "pending_nearby_location_answer",
      });
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      try {
        const normalizedQuery = normalizeNearbyClarificationQuery(trimmed);
        console.info("[NEARBY_LOCATION_GEOCODE_START]", {
          rawQuery: trimmed,
          normalizedQuery,
          resolverPath: "raw_server_then_destination_geocode_fallback",
          pendingIntent: pendingNearbyLocation.intent,
          source: "clarification_geocode",
        });
        console.info("[NEARBY_LOCATION_GEOCODE_ATTEMPT]", {
          attempt: 1,
          query: normalizedQuery,
          resolver: "geocodeTripLocationFromText",
        });
        const direct = await geocodeLocationFn({
          data: { query: normalizedQuery, destinationName: normalizedQuery, locale },
        });
        let location = isUsableNearbyClarificationLocation(direct.location)
          ? direct.location
          : null;
        let resolverPath = "geocodeTripLocationFromText";
        if (!location) {
          console.info("[NEARBY_LOCATION_GEOCODE_ATTEMPT]", {
            attempt: 2,
            query: normalizedQuery,
            resolver: "geocodeDestinationWithFallback",
          });
          const fallbackLocation = await geocodeDestinationWithFallback({
            destination: normalizedQuery,
            locale,
            geocodeFn: geocodeLocationFn,
            preferCachedCoordinates: false,
          });
          if (isUsableNearbyClarificationLocation(fallbackLocation)) {
            location = fallbackLocation;
            resolverPath = "geocodeDestinationWithFallback";
          }
        }
        if (location) {
          const displayLabel =
            location.displayLabel || location.formattedName || location.address || location.city;
          const resumedSession: ChatPlanningSession = {
            ...session,
            location: {
              lat: location.lat,
              lng: location.lng,
              city: displayLabel,
            },
            activeChatIntent: pendingNearbyLocation.intent,
            activeCategoryIntent: pendingNearbyLocation.category,
            pendingNearbyLocationRequest: undefined,
            pendingClarification: undefined,
            pendingQuestion: undefined,
            conversationMode: undefined,
          };
          console.info("[CHAT_PENDING_NEARBY_RESUME]", {
            originalIntent: pendingNearbyLocation.intent,
            originalCategory: pendingNearbyLocation.category,
            originalQuery: pendingNearbyLocation.originalUserText,
            locationAnswer: trimmed,
            resolvedLat: location.lat,
            resolvedLng: location.lng,
            nearbyIntent: pendingNearbyLocation.intent,
            category: pendingNearbyLocation.category,
            subtype: pendingNearbyLocation.subtype ?? "",
            queryCategory: pendingNearbyLocation.queryCategory ?? "",
            mealSlot: pendingNearbyLocation.mealSlot ?? "",
          });
          logAiPipeline("[NEARBY_LOCATION_RESOLVED]", {
            resolved: true,
            source: "clarification_geocode",
            query: trimmed,
            displayLabel,
            lat: location.lat,
            lng: location.lng,
            resolverPath,
            failureReason: "",
          });
          logAiPipeline("[CHAT_ROUTE_AUTHORITY]", {
            nearbyIntent: pendingNearbyLocation.intent,
            pendingNearbyLocationRequest: true,
            categoryPlaceQuery: false,
            selectedAuthority: "nearby",
          });
          logAiPipeline("[AFTER_ROUTE_AUTHORITY]", {
            selectedAuthority: "nearby",
            phase: "pending_nearby_resume",
          });
          logAiPipeline("[ENTER_NEARBY_PIPELINE]", {
            selectedAuthority: "nearby",
            nearbyIntent: pendingNearbyLocation.intent,
          });
          persistSession(resumedSession, next);
          setStreaming(true);
          try {
            const resolvedEntity = resolveDestinationEntity(trimmed);
            const geographicScope = createClarificationGeographicScope({
              entityType: resolvedEntity?.type ?? "administrative_area",
              displayLabel,
              country: resolvedEntity?.country,
            });
            const authoritativeSearchCenter = {
              lat: location.lat,
              lng: location.lng,
              displayLabel,
              source: "clarification_geocode" as const,
              originalQuery: pendingNearbyLocation.originalUserText,
              selectedAuthority: "nearby" as const,
              geographicScope,
            };
            logAiPipeline("[NEARBY_SEARCH_CENTER_AUTHORITY]", {
              position: "pending_resume",
              ...authoritativeSearchCenter,
              pendingResume: true,
            });
            logAiPipeline("[BEFORE_PUSH_NEARBY]", {
              selectedAuthority: "nearby",
              nearbyIntent: pendingNearbyLocation.intent,
            });
            logAiPipeline("[NEARBY_SEARCH_CENTER_AUTHORITY]", {
              position: "before_push_nearby",
              ...authoritativeSearchCenter,
              pendingResume: true,
            });
            const applied = await pushNearbyPlaceRecommendation(
              resumedSession,
              pendingNearbyLocation.originalUserText,
              next,
              pendingNearbyLocation.intent,
              { authoritativeSearchCenter },
            );
            if (applied) return;
            if (nearbyPushRuntimeRef.current?.reason === "provider_zero") {
              logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "provider_failure" });
              setMsgs([
                ...next,
                { role: "assistant", content: "目前無法連線取得附近地點，請稍後再試。" },
              ]);
              return;
            }
            if (nearbyPushRuntimeRef.current?.reason === "center_mismatch") {
              logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "search_center_mismatch" });
              setMsgs([...next, { role: "assistant", content: "位置資訊同步失敗，請再試一次。" }]);
              return;
            }
            if (nearbyPushRuntimeRef.current?.reason === "recommendation_processing_failure") {
              logAiPipeline("[NEARBY_FAILURE_REASON]", {
                reason: "recommendation_processing_failure",
              });
              setMsgs([...next, { role: "assistant", content: "推薦結果整理失敗，請再試一次。" }]);
              return;
            }
            logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "genuine_zero_results" });
            setMsgs([
              ...next,
              {
                role: "assistant",
                content: "這個地區目前沒有找到符合條件的附近地點，可以換個區域再試。",
              },
            ]);
            return;
          } finally {
            setStreaming(false);
          }
        }
        logAiPipeline("[NEARBY_LOCATION_RESOLVED]", {
          resolved: false,
          source: "clarification_geocode",
          displayLabel: "",
          lat: "",
          lng: "",
          resolverPath: "raw_server_then_destination_geocode_fallback",
          failureReason: direct.error ?? "location_unresolved",
        });
      } catch (error) {
        logAiPipeline("[NEARBY_LOCATION_RESOLVED]", {
          resolved: false,
          source: "clarification_geocode",
          displayLabel: "",
          lat: "",
          lng: "",
          resolverPath: "raw_server_then_destination_geocode_fallback",
          failureReason: error instanceof Error ? error.message : String(error),
        });
      }
      persistSession(session, next);
      setMsgs([
        ...next,
        { role: "assistant", content: "我還無法確認這個位置，請再提供城市或地區名稱。" },
      ]);
      logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "location_unresolved" });
      return;
    }

    const rtSource: RtShortcutSource =
      opts?.source === "home_mood"
        ? "home_mood"
        : opts?.source === "chat_shortcut"
          ? "chat_shortcut"
          : "free_text";
    const rtNormalizedPreview =
      opts?.source === "chat_shortcut"
        ? resolveNormalizedShortcutRequestFromText(trimmed, "chat_shortcut")
        : opts?.source === "home_mood"
          ? (session.normalizedShortcutRequest ??
            resolveNormalizedShortcutRequestFromText(trimmed, "home_mood"))
          : null;
    logShortcutRuntime("[RT_SHORTCUT_INPUT]", {
      source: rtSource,
      text: trimmed.slice(0, 80),
      hasNormalizedRequest: Boolean(rtNormalizedPreview),
      mode: rtNormalizedPreview?.mode ?? "",
      intent: rtNormalizedPreview?.intent ?? "",
    });

    // Refresh destination recommendations — keep dest/dates, clear discovery cache only.
    const wantsRefreshRecommendations =
      trimmed === REFRESH_DESTINATION_RECOMMENDATIONS_OPTION ||
      /^(重新整理推薦|重新整理)$/.test(trimmed) ||
      (session.pendingQuestion?.options.includes(REFRESH_DESTINATION_RECOMMENDATIONS_OPTION) ===
        true &&
        /重新整理/.test(trimmed));
    if (wantsRefreshRecommendations) {
      markShortcutEngaged();
      const ctx = session.travelContext ?? { interests: [] as string[] };
      const destination =
        ctx.destination?.trim() ||
        session.tripDestination?.displayLabel?.trim() ||
        session.tripDestination?.city?.trim();
      const days = ctx.days ?? session.tripDays;
      if (!destination || !days) {
        toast.message("目前還缺少目的地或天數，無法重新整理推薦。");
        return;
      }
      const label = normalizeDestinationLabel(destination);
      clearDiscoveredCombinationsCache(label);
      clearResolvedDestinationScope(label);
      clearDestinationGeocodeCache(label);
      resetPlacesRateLimitEncountered();
      const generationRequestId = `refresh_${label}_${Date.now().toString(36)}`;
      beginPlacesGenerationSession(generationRequestId);
      const next = commitUserMessageWithDiscoveringLoading(trimmed, msgs);
      await yieldToNextPaint();
      try {
        await prepareDestinationCombinations(
          {
            ...ctx,
            destination: label,
            days,
            startDate: ctx.startDate ?? session.tripStartDate,
            endDate: ctx.endDate ?? session.tripEndDate,
            generationRequestId,
          },
          {
            ...session,
            pendingQuestion: undefined,
            travelContext: {
              ...ctx,
              destination: label,
              days,
              generationRequestId,
            },
          },
        );
        const refreshedSession = {
          ...session,
          pendingQuestion: undefined,
          travelContext: {
            ...ctx,
            destination: label,
            days,
            startDate: ctx.startDate ?? session.tripStartDate,
            endDate: ctx.endDate ?? session.tripEndDate,
            generationRequestId,
            tripPurpose: "region_selected",
          },
        };
        persistSession(refreshedSession);
        const turn = processAdviceTurn(
          `${ctx.startDate ?? ""}～${ctx.endDate ?? ""} 要去${label}`.trim(),
          refreshedSession,
          refreshedSession.travelContext!,
        );
        if (turn.advice.reply) {
          await completeAdviceTurn(turn, refreshedSession, refreshedSession.travelContext!, next);
          return;
        }
        stopDiscoveringLoadingAnimation("failure");
        setMsgs([
          ...stripDiscoveringLoadingMessage(next),
          {
            role: "assistant",
            content: `目前暫時無法取得${label}的景點資料。\n\n你可以點「重新整理推薦」再試一次。`,
          },
        ]);
        setStreaming(false);
      } catch (error) {
        stopDiscoveringLoadingAnimation("failure");
        setStreaming(false);
        console.warn("[CHAT_REFRESH_RECOMMENDATIONS_ERROR]", error);
      }
      return;
    }

    // Regenerate itinerary: always open a NEW planning pipeline (never reuse prior session).
    const wantsRegen =
      /^(重新生成|再生成一次|再試一次|重試)$/.test(trimmed) ||
      (session.pendingQuestion?.options.includes("重新生成") === true && /重新生成/.test(trimmed));
    if (
      wantsRegen &&
      (session.aiItineraryState === "FAILED" ||
        session.chatPlanningState === "generationFailed" ||
        session.pendingQuestion?.options.includes("重新生成"))
    ) {
      markShortcutEngaged();
      const ctx = session.travelContext ?? { interests: [] as string[] };
      const destination =
        ctx.destination?.trim() ||
        session.tripDestination?.displayLabel?.trim() ||
        session.tripDestination?.city?.trim();
      const days = ctx.days ?? session.tripDays;
      if (!destination || !days) {
        toast.message("目前還缺少目的地或天數，無法重新生成。");
        return;
      }
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);
      const regenId = `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // Full reset: planner / validator / repair / delivery / combination / workspace planning.
      // Keep destination, dates, days, and user combo IDs — do not reuse pipeline caches.
      const regenSession = resetPlanningPipelineForRegenerate(session, "regenerate");
      const regenCtx = {
        ...(regenSession.travelContext ?? ctx),
        destination,
        days,
        generationRequestId: regenId,
        selectedCombinationIds: ctx.selectedCombinationIds,
        selectionSource: ctx.selectionSource,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        nearbyExtensions: ctx.nearbyExtensions,
        unresolvedNearbyExtensions: ctx.unresolvedNearbyExtensions,
        offeredCombinations: ctx.offeredCombinations,
        planningTripStyle: ctx.planningTripStyle,
        // Explicitly do not carry failed-run combination / place caches.
        selectedCombinationPlaceNames: undefined,
        excludedCombinationPlaceNames: undefined,
        partiallyResolvedPlaces: undefined,
        failedCombinationIds: undefined,
        lastItineraryFailure: undefined,
      };
      persistSession({
        ...regenSession,
        travelContext: regenCtx,
      });
      await runDirectItineraryRef.current(
        {
          ...regenSession,
          travelContext: regenCtx,
        },
        regenCtx,
        next,
      );
      return;
    }

    const tripSession = resolveTripAddPlaceChatSession(session, loadChatSession());
    if (tripSession && opts?.source !== "auto") {
      markShortcutEngaged();
      const userMsg: ChatMsg = { role: "user", content: trimmed };
      const baseConversation = [...msgs, userMsg];
      setMsgs(baseConversation);
      setText("");
      setStreaming(true);
      try {
        await commitTripAddPlaceLocalTurn(tripSession, trimmed, baseConversation);
      } catch (e) {
        logTripAddPlaceFailure(e, tripSession, trimmed, "send");
        try {
          await commitTripAddPlaceLocalTurn(
            tripSession,
            isTripAddPlaceMoreRecommendationsRequest(trimmed) ? trimmed : "還有嗎",
            baseConversation,
          );
        } catch (retryError) {
          logTripAddPlaceFailure(retryError, tripSession, trimmed, "send_retry");
        }
      } finally {
        setStreaming(false);
      }
      return;
    }

    if (isPlaceDetailChatActive(session)) {
      markShortcutEngaged();
      const followUp = parsePlaceDetailFollowUp(trimmed);
      const userMsg: ChatMsg = { role: "user", content: trimmed };
      const baseConversation = [...msgs, userMsg];
      setMsgs(baseConversation);
      setText("");

      if (followUp === "add_to_trip" && session.placeDetailFocus) {
        const focus = session.placeDetailFocus;
        let nextSession = addSelectedPlace(session, focus);
        nextSession = enterPlaceDetailChat(nextSession, focus);
        persistSession(nextSession);
        const reply =
          buildPlaceDetailFollowUpReply("add_to_trip", nextSession) ??
          `好的，已把「${placeDisplayName(focus)}」記下來。`;
        setMsgs([...baseConversation, { role: "assistant", content: reply }]);
        return;
      }

      if (followUp === "view_route" && session.placeDetailFocus) {
        const focus = session.placeDetailFocus;
        if (focus.lat != null && focus.lng != null) {
          window.open(buildPlaceMapsUrl(focus.lat, focus.lng, focus.name), "_blank", "noopener");
        }
        const reply =
          buildPlaceDetailFollowUpReply("view_route", session) ??
          "已為你開啟路線，也可以直接點卡片上的查看路線。";
        setMsgs([...baseConversation, { role: "assistant", content: reply }]);
        return;
      }

      const nearbyIntent = resolvePlaceDetailNearbyIntent(trimmed);
      if (nearbyIntent) {
        let centered = await ensurePlaceDetailFocusCoordinates(
          session,
          geocodeLocationFn,
          locale,
          fetchPlaceDetailsForFocus,
        );
        centered = sessionWithPlaceDetailSearchCenter(centered);
        const nextSession = {
          ...centered,
          activeChatIntent: nearbyIntent,
          phase: "recommend" as const,
        };
        persistSession(nextSession);
        const followUpKind = parsePlaceDetailFollowUp(trimmed);
        const preface =
          buildPlaceDetailFollowUpReply(followUpKind, nextSession) ??
          `好，我以「${placeDisplayName(nextSession.placeDetailFocus!)}」為中心幫你找附近地點。`;
        const conversationWithPreface = [
          ...baseConversation,
          { role: "assistant", content: preface },
        ];
        setMsgs(conversationWithPreface);
        setStreaming(true);
        try {
          const applied = await pushNearbyPlaceRecommendation(
            nextSession,
            trimmed,
            conversationWithPreface,
            nearbyIntent,
          );
          if (!applied) {
            toast.message("暫時找不到附近地點，可以換個描述再試。");
          }
        } finally {
          setStreaming(false);
        }
        return;
      }

      let nextSession = enterPlaceDetailChat(session, session.placeDetailFocus!);
      const merged = mergeTravelContext(nextSession, trimmed);
      nextSession = merged.session;
      persistSession(nextSession);
      await streamChat(
        baseConversation,
        {
          phase: "followup",
          userText: trimmed,
          focusedPlace: session.placeDetailFocus,
        },
        nextSession,
      );
      return;
    }

    let nextSession = applyTripIntentToSession(trimmed, session);
    const planningStateBeforeHomeIsolation =
      nextSession.chatPlanningState ?? nextSession.conversationMode ?? "";
    const normalizedShortcutFromTurn = (() => {
      if (opts?.source === "chat_shortcut") {
        return resolveNormalizedShortcutRequestFromText(trimmed, "chat_shortcut");
      }
      if (opts?.source === "home_mood") {
        return (
          session.normalizedShortcutRequest ??
          resolveNormalizedShortcutRequestFromText(trimmed, "home_mood")
        );
      }
      return null;
    })();
    if (opts?.source !== "auto") {
      markShortcutEngaged();
      nextSession = markHomeMoodShortcutEngaged(nextSession);
    }
    nextSession = applyQuickChipContext(trimmed, nextSession);
    nextSession = applyDiningContextFromText(trimmed, nextSession);
    if (normalizedShortcutFromTurn) {
      const homeProfileOwnsScene =
        normalizedShortcutFromTurn.source === "home_mood" &&
        (normalizedShortcutFromTurn.mode === "late_night" ||
          normalizedShortcutFromTurn.mode === "sea");
      const shortcutContext = homeProfileOwnsScene
        ? undefined
        : buildStructuredShortcutContext(normalizedShortcutFromTurn.mode, trimmed);
      const modeMood =
        normalizedShortcutFromTurn.source === "home_mood" &&
        normalizedShortcutFromTurn.mode === "late_night"
          ? "夜晚散策"
          : moodLabelForShortcutMode(normalizedShortcutFromTurn.mode);
      const modeTripPurpose =
        normalizedShortcutFromTurn.mode === "coffee"
          ? "cafe"
          : normalizedShortcutFromTurn.mode === "rainy"
            ? "rainy_day"
            : normalizedShortcutFromTurn.mode === "late_night"
              ? "night_walk"
              : normalizedShortcutFromTurn.mode === "sea"
                ? "coastal"
                : "relax";
      const modeSetting =
        normalizedShortcutFromTurn.mode === "coffee" || normalizedShortcutFromTurn.mode === "rainy"
          ? "室內"
          : normalizedShortcutFromTurn.mode === "relax"
            ? "either"
            : "室外";
      const modeInterests =
        normalizedShortcutFromTurn.mode === "coffee"
          ? ["咖啡", normalizedShortcutFromTurn.modifiers?.quiet ? "安靜" : ""]
          : normalizedShortcutFromTurn.mode === "rainy"
            ? ["室內", "避雨"]
            : normalizedShortcutFromTurn.mode === "late_night"
              ? ["夜景", "散步"]
              : normalizedShortcutFromTurn.mode === "sea"
                ? ["海邊", "散步"]
                : ["放鬆", "慢步"];
      nextSession = {
        ...nextSession,
        shortcutContext,
        normalizedShortcutRequest: normalizedShortcutFromTurn,
        fromMoodFlow:
          normalizedShortcutFromTurn.source === "chat_shortcut" ? true : nextSession.fromMoodFlow,
        homeMoodShortcutEntry:
          normalizedShortcutFromTurn.source === "home_mood"
            ? true
            : nextSession.homeMoodShortcutEntry,
        activeChatIntent: normalizedShortcutFromTurn.mode === "coffee" ? "cafe" : "attraction",
        activeCategoryIntent: normalizedShortcutFromTurn.mode === "coffee" ? "cafe" : "attraction",
        // New shortcut request must not consume stale continuation snapshot.
        recommendationSession: undefined,
        activeRecommendationContext: undefined,
        pendingQuestion: undefined,
        adviceSelectionThisTurn: undefined,
        lastResolvedPendingQuestion: undefined,
        pendingClarification: undefined,
        conversationMode: undefined,
        chatPlanningState: "idle",
        tripPlanningContext: {
          ...(nextSession.tripPlanningContext ?? { selectedPlaces: [] }),
          selectedPlaces: [],
          intent: "general",
        },
        travelContext: {
          ...(nextSession.travelContext ?? { interests: [] }),
          mood: modeMood,
          setting: modeSetting,
          tripPurpose: modeTripPurpose,
          interests: [
            ...new Set([
              ...((nextSession.travelContext?.interests as string[] | undefined) ?? []),
              ...modeInterests.filter(Boolean),
            ]),
          ],
        },
      };
      logAiPipeline(
        "[SHORTCUT_NORMALIZED]",
        `source=${normalizedShortcutFromTurn.source}`,
        `mode=${normalizedShortcutFromTurn.mode}`,
        `intent=${normalizedShortcutFromTurn.intent}`,
        "structured=true",
      );
    }
    logShortcutRuntime("[RT_SHORTCUT_NORMALIZED]", {
      source: normalizedShortcutFromTurn?.source ?? rtSource,
      mode: normalizedShortcutFromTurn?.mode ?? "",
      intent: normalizedShortcutFromTurn?.intent ?? "",
      quiet: Boolean(normalizedShortcutFromTurn?.modifiers?.quiet),
      structured: Boolean(normalizedShortcutFromTurn?.structured),
    });

    const structuredHomeNearbyTurn =
      opts?.source === "home_mood" && isStructuredHomeNearbyShortcut(nextSession);
    const structuredHomeSeaTurn = isStructuredHomeSeaShortcut(nextSession);
    if (structuredHomeNearbyTurn) {
      nextSession = structuredHomeSeaTurn
        ? isolateHomeSeaShortcutFromPlanning(nextSession)
        : isolateHomeShortcutFromPlanning(nextSession);
    }
    const lastAssistantReply = [...msgs]
      .reverse()
      .find((m) => m.role === "assistant" && m.content?.trim())?.content;
    if (!structuredHomeNearbyTurn) {
      nextSession = prepareSessionForUserTurn(nextSession, lastAssistantReply);
    }

    const pendingGeographic = nextSession.pendingClarification;
    const nearbyShortcutTurn =
      nextSession.normalizedShortcutRequest?.structured === true &&
      nextSession.normalizedShortcutRequest.intent === "nearby_recommendation";
    if (pendingGeographic?.kind === "destination_area" && !nearbyShortcutTurn) {
      if (isPlaceClarificationTripPlanningOverride(trimmed)) {
        nextSession = { ...nextSession, pendingClarification: undefined };
      } else {
        const restored = restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        if (restored) {
          const explicitScope = resolveExplicitDestinationFallbackScope({
            userText: restored.restoredUserText,
            session: nextSession,
            restored,
          });
          const sessionForRec: ChatPlanningSession = isolateSessionToExplicitDestination(
            {
              ...nextSession,
              pendingClarification: undefined,
              activeCategoryIntent: restored.categoryIntent,
            },
            explicitScope ?? {
              destination: restored.destinationLabel,
              parentCity: restored.parentCity,
              area: restored.area,
              searchScope: restored.searchScope,
            },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDestinationCategoryPlaceRecommendation(
            sessionForRec,
            restored.restoredUserText,
            next,
          );
          if (applied) return;
          logDestinationRecommendationFallbackSummary({
            destination: restored.destinationLabel,
            sourcePath: "local-recommendation-fallback",
            fallbackDestination:
              nextSession.recommendationSession?.destination ||
              nextSession.travelContext?.destination,
            accepted: false,
            reason: "explicit_destination_builder_empty",
          });
          const emptyMsgs: ChatMsg[] = [
            ...next,
            {
              role: "assistant",
              content: `目前在${restored.destinationLabel}暫時找不到符合的地點，可以換個描述或稍後再試。`,
            },
          ];
          setMsgs(emptyMsgs);
          persistSession(sessionForRec, emptyMsgs);
          return;
        }
        const reaskMsgs: ChatMsg[] = [
          ...next,
          {
            role: "assistant",
            content: `你指的是哪個地區的${pendingGeographic.rawGeographicLabel}？`,
          },
        ];
        setMsgs(reaskMsgs);
        persistSession(nextSession, reaskMsgs);
        logRtResponseBranch("destination_clarification");
        return;
      }
    }

    if (isReplanIntent(trimmed)) {
      nextSession = resetChatPlanningForReplan(nextSession, "user_replan_intent");
    }

    const merged = structuredHomeNearbyTurn
      ? {
          context: nextSession.travelContext ?? { interests: [] },
          session: nextSession,
        }
      : mergeTravelContext(nextSession, trimmed, lastAssistantReply);
    nextSession = merged.session;
    if (isBudgetRefinementText(trimmed)) {
      nextSession = applyBudgetRefinementToSession(trimmed, {
        ...nextSession,
        travelContext: merged.context,
      });
    }
    const planningMerge = structuredHomeNearbyTurn
      ? {
          context: nextSession.tripPlanningContext ?? {
            selectedPlaces: [],
            intent: "mood_recommend" as const,
          },
          session: nextSession,
        }
      : mergeTripPlanningContext(trimmed, nextSession, merged.context);
    nextSession = planningMerge.session;
    const conversationMode = structuredHomeNearbyTurn
      ? "mood_recommend"
      : resolveConversationMode(trimmed, nextSession);

    const rtArbitration = resolveChatIntentArbitration(trimmed, nextSession);
    const rtIntent = resolveChatIntent(trimmed, nextSession);
    const rtNearbyIntent = inferNearbyIntentFromContext(merged.context, trimmed, nextSession);
    logShortcutRuntime("[RT_INTENT_RESULT]", {
      resolvedIntent: rtIntent,
      resolvedRoute: rtArbitration.route,
      reason: rtArbitration.reason,
      planningState: nextSession.chatPlanningState ?? nextSession.conversationMode ?? "",
      activeRecommendationIntent:
        nextSession.activeRecommendationContext?.intent ?? nextSession.activeCategoryIntent ?? "",
    });
    const rtStructuredNearby =
      nextSession.normalizedShortcutRequest?.structured === true &&
      nextSession.normalizedShortcutRequest?.intent === "nearby_recommendation";
    if (rtStructuredNearby) {
      nextSession = await resolveChatLocation(nextSession);
    }
    const rtNearbyScope = resolveNearbyRecommendationScope(nextSession, merged.context.destination);
    logShortcutRuntime("[RT_NEARBY_SCOPE]", {
      isNearbyIntent:
        rtStructuredNearby || isNearbyPlaceIntent(rtIntent) || Boolean(rtNearbyIntent),
      scope: rtNearbyScope.scope,
      deviceLocationAvailable: rtNearbyScope.deviceLocationAvailable,
      deviceLocationUsed:
        (rtStructuredNearby || isNearbyPlaceIntent(rtIntent) || Boolean(rtNearbyIntent)) &&
        rtNearbyScope.deviceLocationUsed,
      routeMode: conversationMode ?? "",
    });

    const destCandidate =
      merged.context.destination?.trim() ||
      nextSession.tripDestination?.displayLabel?.trim() ||
      nextSession.tripDestination?.city?.trim();
    const isTripStyleSelection =
      nextSession.pendingQuestion?.type === "ask_trip_style" ||
      parseAskTripStyleSelection(trimmed) != null;
    if (!isTripStyleSelection) {
      if (nextSession.phase === "done") {
        nextSession = startNewPlanningSession(nextSession, "phase_done");
      } else if (shouldStartNewPlanningSession(nextSession, destCandidate)) {
        nextSession = startNewPlanningSession(nextSession, "destination_change");
      }
    }

    if (!structuredHomeNearbyTurn) {
      nextSession = extractPlanningHintsFromText(trimmed, nextSession);
    }
    nextSession = extractDiscoveryFromText(trimmed, nextSession);
    if (!structuredHomeNearbyTurn) {
      nextSession = extractChatPlanningContextFromText(trimmed, nextSession);
    }

    const styleReselect = isStyleReselectTurn(trimmed, nextSession, merged.context);
    if (styleReselect) {
      markShortcutEngaged();
      const regenSession = applyStyleReselectToSession(nextSession, merged.context, styleReselect);
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);
      persistSession(regenSession);

      setStreaming(true);
      try {
        const applied = await pushDestinationPlaceRecommendationRef.current(
          regenSession,
          trimmed,
          next,
          { forceRegenerate: true, replacePreviousCards: true },
        );
        if (!applied) {
          toast.message("暫時無法重新生成行程，請稍後再試。");
        }
      } finally {
        setStreaming(false);
      }
      return;
    }

    const stylePlanTurn = shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context);
    if (
      stylePlanTurn &&
      (nextSession.pendingQuestion?.type === "ask_trip_style" ||
        nextSession.chatPlanningState === "waitingStyleSelection")
    ) {
      markShortcutEngaged();
      const planningTurn = processAdviceTurn(trimmed, nextSession, merged.context);
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);
      await completeAdviceTurn(planningTurn, nextSession, merged.context, next);
      return;
    }

    try {
      if (isAddAllToTripIntent(trimmed)) {
        markShortcutEngaged();
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        scrollToUserMessage(next.length - 1);

        logAiCreateTripStart();
        const prepared = prepareSessionForCreateTripFromRecommendations(
          nextSession,
          merged.context,
          msgs,
        );
        if (!prepared) {
          logAiCreateTripError("prepare_failed");
          toast.message("目前沒有可加入的推薦地點，請先讓我幫你整理推薦。");
          setMsgs([
            ...next,
            {
              role: "assistant",
              content: "我還沒整理好可加入的地點，要不要我先幫你生成分天推薦？",
            },
          ]);
          return;
        }

        persistSession(prepared.session);
        try {
          await runDirectItineraryRef.current(
            prepared.session,
            prepared.session.travelContext ?? merged.context,
            next,
          );
        } catch (e) {
          logAiCreateTripError(e instanceof Error ? e.message : String(e));
          toast.error("行程建立失敗，請稍後再試。");
        }
        return;
      }

      if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {
        const altCtx = {
          ...(nextSession.travelContext ?? merged.context),
          tripPurpose: "alternative_recommendations" as const,
          setting: "混合" as const,
        };
        nextSession = { ...nextSession, travelContext: altCtx };
        const excludePlaceIds = collectExcludePlaceIds(nextSession, msgs);
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");

        const dest =
          altCtx.destination?.trim() ??
          nextSession.tripPlanningContext?.destination?.trim() ??
          nextSession.tripDestination?.city?.trim();

        if (dest) {
          const applied = await pushAlternativeDestinationPlaceRecommendation(
            { ...nextSession, travelContext: { ...altCtx, destination: dest } },
            trimmed,
            next,
            dest,
            { excludePlaceIds, rejectedPlaceNames: nextSession.rejectedPlaceNames },
          );
          if (applied) return;
        }

        nextSession = await resolveChatLocation(nextSession);
        if (sessionHasLocation(nextSession)) {
          for (const nearbyIntent of ["restaurant", "cafe", "attraction"] as const) {
            setStreaming(true);
            try {
              const applied = await pushNearbyPlaceRecommendation(
                { ...nextSession, travelContext: altCtx },
                trimmed,
                next,
                nearbyIntent,
                {
                  excludePlaceIds,
                  rejectedPlaceNames: nextSession.rejectedPlaceNames,
                  blockedCoreNames: collectBlockedCoreNames(nextSession, msgs),
                  userText: trimmed,
                  cityLabel:
                    nextSession.location?.city ??
                    altCtx.destination ??
                    nextSession.tripDestination?.city,
                },
              );
              if (applied) return;
            } finally {
              setStreaming(false);
            }
          }
        }

        setMsgs([...next, { role: "assistant", content: CHAT_STATE_MACHINE_RECOVERY_MESSAGE }]);
        return;
      }

      const structuredShortcutNegativeFeedback =
        nextSession.normalizedShortcutRequest?.structured === true &&
        nextSession.normalizedShortcutRequest.intent === "nearby_recommendation" &&
        (trimmed === "不喜歡" || trimmed === "不喜欢");
      if (
        shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs) ||
        structuredShortcutNegativeFeedback
      ) {
        const continuationArbitration = resolveChatIntentArbitration(trimmed, nextSession);
        const continueNearbyIntent = resolveRefreshNearbyIntent(
          nextSession,
          nextSession.travelContext ?? merged.context,
        );
        const continuationFollowup =
          matchesContinueRecommendationGrammar(trimmed) || structuredShortcutNegativeFeedback;
        const continuationScene =
          nextSession.activeRecommendationContext?.shortcutScene ??
          resolveNearbyShortcutScene(trimmed, nextSession);
        logShortcutRuntime("[RT_CONTINUATION_INPUT]", {
          text: trimmed,
          resolvedRoute: continuationArbitration.route,
          followup: continuationFollowup,
          previousIntent:
            nextSession.activeRecommendationContext?.intent ??
            resolveActiveCategoryIntent(nextSession) ??
            "",
          shortcutScene: continuationScene ?? "",
          scope:
            nextSession.activeRecommendationContext?.searchScope ??
            (sessionHasLocation(nextSession) ? "current_location" : ""),
          activeContext: Boolean(nextSession.activeRecommendationContext),
        });
        const hasDestinationSnapshot = Boolean(
          nextSession.activeRecommendationContext?.destinationName?.trim() ||
          nextSession.recommendationSession?.destination?.trim() ||
          nextSession.travelContext?.destination?.trim() ||
          nextSession.tripPlanningContext?.destination?.trim() ||
          nextSession.tripDestination?.city?.trim(),
        );
        const isCurrentLocationShortcutSession =
          nextSession.normalizedShortcutRequest?.structured === true &&
          nextSession.normalizedShortcutRequest?.intent === "nearby_recommendation" &&
          Boolean(
            continuationScene ||
            nextSession.activeRecommendationContext?.searchProfile ||
            resolveHomeShortcutSearchProfile(nextSession),
          ) &&
          sessionHasLocation(nextSession);
        if (
          continueNearbyIntent &&
          (!hasDestinationSnapshot || isCurrentLocationShortcutSession) &&
          sessionHasLocation(nextSession)
        ) {
          const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
          setMsgs(next);
          setText("");
          logAiPipeline(
            "[NEARBY_CONTEXT]",
            `followup=1`,
            `intent=${continueNearbyIntent}`,
            `lat=${nextSession.location?.lat ?? ""}`,
            `lng=${nextSession.location?.lng ?? ""}`,
          );
          setStreaming(true);
          try {
            const applied = await pushNearbyPlaceRecommendation(
              {
                ...nextSession,
                travelContext: {
                  ...(nextSession.travelContext ?? merged.context),
                  tripPurpose: "more_place_recommendations",
                },
              },
              trimmed,
              next,
              continueNearbyIntent,
              {
                excludePlaceIds: collectExcludePlaceIds(nextSession, msgs),
                rejectedPlaceNames: nextSession.rejectedPlaceNames,
                blockedCoreNames: collectBlockedCoreNames(nextSession, msgs),
                userText: trimmed,
                cityLabel: nextSession.location?.city ?? undefined,
              },
            );
            if (applied) return;
          } finally {
            setStreaming(false);
          }
          if (isCurrentLocationShortcutSession) {
            logRtNoMoreReason({
              caller: "send.refetch.structured_nearby_continuation",
              route: continuationArbitration.route,
              followup: continuationFollowup,
              hasActiveRecommendationContext: Boolean(nextSession.activeRecommendationContext),
              reason: "continuation_exhausted",
            });
            logRtResponseBranch("no_more");
            const noMoreMsgs = [
              ...next,
              { role: "assistant" as const, content: NO_MORE_RECOMMENDATIONS_MESSAGE },
            ];
            setMsgs(noMoreMsgs);
            persistSession(nextSession, noMoreMsgs);
            return;
          }
        }
        // Continue recommendations must reuse ActiveRecommendationContext / Snapshot
        // whenever present — not only when refinement slots (cuisine/budget) are set.
        if (
          nextSession.activeRecommendationContext ||
          nextSession.recommendationSession ||
          resolveActiveCategoryIntent(nextSession)
        ) {
          const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
          setMsgs(next);
          setText("");
          const arbitration = resolveChatIntentArbitration(trimmed, nextSession);
          const snapCategory =
            resolveActiveCategoryIntent(nextSession) ??
            nextSession.activeRecommendationContext?.intent ??
            "";
          logContinueRecommendationResolved({
            route: arbitration.route,
            category: String(snapCategory),
            destination:
              nextSession.activeRecommendationContext?.destinationDisplayName ||
              nextSession.activeRecommendationContext?.destinationName ||
              nextSession.recommendationSession?.destination ||
              nextSession.travelContext?.destination ||
              "",
          });
          if (
            arbitration.route === "MORE_RECOMMENDATIONS" ||
            arbitration.route === "RECOMMENDATION_REFINEMENT"
          ) {
            const applied = await pushRecommendationRefinement(nextSession, trimmed, next);
            if (applied) return;
          }
          const destForMore =
            nextSession.activeRecommendationContext?.destinationName ||
            nextSession.recommendationSession?.destination ||
            nextSession.travelContext?.destination ||
            nextSession.tripPlanningContext?.destination ||
            nextSession.tripDestination?.city;
          if (destForMore?.trim()) {
            setStreaming(true);
            try {
              const applied = await pushMorePlaceRecommendations(
                {
                  ...nextSession,
                  travelContext: {
                    ...(nextSession.travelContext ?? merged.context),
                    destination: destForMore,
                    tripPurpose: "more_place_recommendations",
                  },
                },
                trimmed,
                next,
                {
                  excludePlaceIds: collectExcludePlaceIds(nextSession, msgs),
                  rejectedPlaceNames: nextSession.rejectedPlaceNames,
                },
              );
              if (applied) return;
            } finally {
              setStreaming(false);
            }
          }
          // Destination-scoped continue exhausted — never fall through to GPS nearby.
          const activeCategoryOnRefresh = resolveActiveCategoryIntent(nextSession);
          logChatMorePlacesNoResultAllowed(true);
          const noMoreCopy =
            activeCategoryOnRefresh === "shopping"
              ? SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE
              : NO_MORE_RECOMMENDATIONS_MESSAGE;
          const noMoreMsgs = [...next, { role: "assistant" as const, content: noMoreCopy }];
          logRtNoMoreReason({
            caller: "send.refetch.active_context",
            route: "MORE_RECOMMENDATIONS",
            followup: true,
            hasActiveRecommendationContext: Boolean(
              nextSession.activeRecommendationContext || nextSession.recommendationSession,
            ),
            reason: "continuation_exhausted",
          });
          setMsgs(noMoreMsgs);
          persistSession(
            {
              ...nextSession,
              pendingQuestion: undefined,
              travelContext: {
                ...(nextSession.travelContext ?? merged.context),
                tripPurpose: "more_place_recommendations",
              },
            },
            noMoreMsgs,
          );
          logRtResponseBranch("no_more");
          return;
        }
        nextSession = applyRefreshRecommendationSession(trimmed, nextSession);
        nextSession = mergeTripSessionUsedPlacesFromMessages(nextSession, msgs);
        const priorFromMsgs = extractRecommendedFromMsgs(msgs);
        if (priorFromMsgs.length && !nextSession.recommendedPlaces.length) {
          nextSession = syncSessionPlaceMemory({
            ...nextSession,
            recommendedPlaces: priorFromMsgs,
          });
        }
        const refreshCtx = {
          ...(nextSession.travelContext ?? merged.context),
          tripPurpose: "more_place_recommendations" as const,
          excludedCategories: nextSession.excludedCategories ?? merged.context.excludedCategories,
          setting:
            nextSession.discovery?.setting ??
            nextSession.travelContext?.setting ??
            merged.context.setting,
        };
        nextSession = { ...nextSession, travelContext: refreshCtx };
        const excludePlaceIds = collectExcludePlaceIds(nextSession, msgs);
        const blockedCoreNames = collectBlockedCoreNames(nextSession, msgs);

        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");

        const dest =
          refreshCtx.destination ??
          nextSession.tripPlanningContext?.destination ??
          nextSession.tripDestination?.city;

        if (dest?.trim()) {
          setStreaming(true);
          try {
            const applied = await pushMorePlaceRecommendations(
              { ...nextSession, travelContext: { ...refreshCtx, destination: dest } },
              trimmed,
              next,
              { excludePlaceIds, rejectedPlaceNames: nextSession.rejectedPlaceNames },
            );
            if (applied) return;
          } finally {
            setStreaming(false);
          }
        }

        // Keep shopping/cafe/restaurant Recommendation Session — never fall into Trip Flow.
        const activeCategoryOnRefresh = resolveActiveCategoryIntent(nextSession);
        if (
          activeCategoryOnRefresh === "shopping" ||
          activeCategoryOnRefresh === "cafe" ||
          activeCategoryOnRefresh === "restaurant" ||
          nextSession.recommendationSession
        ) {
          logChatMorePlacesNoResultAllowed(true);
          const noMoreCopy =
            activeCategoryOnRefresh === "shopping"
              ? SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE
              : NO_MORE_RECOMMENDATIONS_MESSAGE;
          const noMoreMsgs = [...next, { role: "assistant" as const, content: noMoreCopy }];
          logRtNoMoreReason({
            caller: "send.refetch.preserved_session",
            route: "MORE_RECOMMENDATIONS",
            followup: true,
            hasActiveRecommendationContext: Boolean(
              nextSession.activeRecommendationContext || nextSession.recommendationSession,
            ),
            reason: "continuation_exhausted",
          });
          setMsgs(noMoreMsgs);
          persistSession(
            {
              ...nextSession,
              pendingQuestion: undefined,
              travelContext: refreshCtx,
            },
            noMoreMsgs,
          );
          logRtResponseBranch("no_more");
          return;
        }

        // Explicit current-location continue only — never destination+GPS mix.
        const refreshIntent = resolveRefreshNearbyIntent(nextSession, refreshCtx);
        if (
          isExplicitDeviceNearbyRequest(trimmed) &&
          sessionHasLocation(nextSession) &&
          refreshIntent
        ) {
          setStreaming(true);
          try {
            const applied = await pushNearbyPlaceRecommendation(
              { ...nextSession, travelContext: refreshCtx },
              trimmed,
              next,
              refreshIntent,
              {
                excludePlaceIds,
                rejectedPlaceNames: nextSession.rejectedPlaceNames,
                blockedCoreNames,
                userText: trimmed,
                cityLabel:
                  nextSession.location?.city ??
                  refreshCtx.destination ??
                  nextSession.tripDestination?.city,
              },
            );
            if (applied) return;
          } finally {
            setStreaming(false);
          }
        }

        if (!sessionHasLocation(nextSession) && !refreshCtx.destination?.trim()) {
          logAiPipeline("[NEARBY_FALLBACK]", "reason=followup_context_missing");
          setMsgs([
            ...next,
            {
              role: "assistant",
              content: "我可以繼續幫你找，先告訴我你想從哪個地區開始。",
            },
          ]);
          logRtResponseBranch("destination_clarification");
          return;
        }

        logChatMorePlacesNoResultAllowed(true);
        logRtNoMoreReason({
          caller: "send.refetch.final_fallback",
          route: "MORE_RECOMMENDATIONS",
          followup: true,
          hasActiveRecommendationContext: Boolean(
            nextSession.activeRecommendationContext || nextSession.recommendationSession,
          ),
          reason: "nearby_push_failed",
        });
        logRtResponseBranch("no_more");
        setMsgs([...next, { role: "assistant", content: NO_MORE_RECOMMENDATIONS_MESSAGE }]);
        return;
      }

      const placeFetchContext = mergeContextForPlaceFetch(merged.context, nextSession);

      if (placeFetchContext.destination?.trim() && !placeFetchContext.weather) {
        const weather = await prefetchDestinationWeather({
          destination: placeFetchContext.destination,
          locale,
          geocodeFn: geocodeLocationFn,
          fetchWeatherFn: fetchWeather,
        });
        if (weather) {
          nextSession = {
            ...nextSession,
            weather,
            travelContext: {
              ...(nextSession.travelContext ?? placeFetchContext),
              weather,
            },
          };
        }
      }

      const refreshedPlaceCtx = mergeContextForPlaceFetch(
        nextSession.travelContext ?? merged.context,
        nextSession,
      );

      if (shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        const applied = await pushDestinationPlaceRecommendation(
          { ...nextSession, travelContext: refreshedPlaceCtx },
          trimmed,
          next,
        );
        if (applied) return;
        const fallbackApplied = await applyLocalFallback(
          nextSession,
          trimmed,
          next,
          "destination_places_failed",
        );
        if (fallbackApplied) return;
        return;
      }

      const earlyCategoryPlaceQuery = shouldFetchDestinationCategoryPlaces(
        trimmed,
        refreshedPlaceCtx,
        nextSession,
      );
      const earlyNearbyIntent = inferNearbyIntentFromContext(
        refreshedPlaceCtx,
        trimmed,
        nextSession,
      );
      const earlyRouteAuthority = resolveChatRouteAuthority({
        structuredShortcut:
          nextSession.normalizedShortcutRequest?.structured === true &&
          nextSession.normalizedShortcutRequest.intent === "nearby_recommendation",
        explicitNearbyRequest: userExplicitlyWantsNearbyPlaces(trimmed),
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        resolvedNearbyIntent: earlyNearbyIntent,
        categoryPlaceQuery: earlyCategoryPlaceQuery,
      });
      logAiPipeline("[CHAT_ROUTE_AUTHORITY]", {
        nearbyIntent: earlyNearbyIntent ?? "",
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        categoryPlaceQuery: earlyCategoryPlaceQuery,
        selectedAuthority: earlyRouteAuthority,
      });
      logAiPipeline("[AFTER_ROUTE_AUTHORITY]", {
        selectedAuthority: earlyRouteAuthority,
        phase: "early_dispatch",
      });

      if (earlyRouteAuthority === "destination_category") {
        const intents = parseChatPlaceIntents(trimmed);
        const dest =
          resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "";
        console.info(
          "[CHAT_INTENT_ROUTED]",
          `intent=place_recommendation`,
          `destination=${dest}`,
          `category=${intents[0] ?? ""}`,
          `reason=destination_plus_place_category`,
        );
        console.info(
          "[TRIP_FLOW_BYPASSED]",
          "reason=explicit_place_recommendation",
          `destination=${dest}`,
          `category=${intents[0] ?? ""}`,
        );
        console.info(
          "[PLACE_RECOMMENDATION_CONTEXT]",
          `destination=${dest}`,
          `category=${intents[0] ?? ""}`,
          `features=`,
          `followUp=false`,
        );
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        const applied = await pushDestinationCategoryPlaceRecommendation(
          { ...nextSession, travelContext: refreshedPlaceCtx },
          trimmed,
          next,
        );
        if (applied) return;
        logDestinationRecommendationFallbackSummary({
          destination:
            resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? dest,
          sourcePath: "local-recommendation-fallback",
          fallbackDestination:
            nextSession.recommendationSession?.destination ||
            nextSession.travelContext?.destination,
          accepted: false,
          reason: "explicit_destination_builder_empty",
        });

        const destLabel =
          resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ??
          dest ??
          "這個目的地";
        setMsgs((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `目前在${destLabel}暫時找不到符合的地點，可以換個描述或稍後再試。`,
          },
        ]);
        return;
      }

      // Active recommendation refinement — before sticky trip / combination planning.
      if (shouldSkipTripPlanningForRefinement(trimmed, nextSession)) {
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        const arbitration = resolveChatIntentArbitration(trimmed, nextSession);
        if (arbitration.route === "NEW_RECOMMENDATION") {
          const structuredNearbyShortcut =
            nextSession.normalizedShortcutRequest?.structured === true &&
            nextSession.normalizedShortcutRequest?.intent === "nearby_recommendation";
          if (structuredNearbyShortcut) {
            nextSession = await resolveChatLocation(nextSession);
            persistSession(nextSession);
            const nearbyScope = resolveNearbyRecommendationScope(
              nextSession,
              refreshedPlaceCtx.destination,
            );
            const effective = getEffectiveLocationSnapshot();
            logShortcutRuntime("[RT_NEARBY_SCOPE]", {
              isNearbyIntent: true,
              scope: nearbyScope.scope,
              deviceLocationAvailable: nearbyScope.deviceLocationAvailable,
              deviceLocationUsed: nearbyScope.deviceLocationUsed,
              routeMode: conversationMode ?? "",
            });
            const resolvedIntent = resolveChatIntent(trimmed, nextSession);
            const homeMode = nextSession.normalizedShortcutRequest?.mode;
            const nearbyIntent =
              nextSession.normalizedShortcutRequest?.source === "home_mood"
                ? homeMode === "coffee"
                  ? "cafe"
                  : "attraction"
                : isNearbyPlaceIntent(resolvedIntent)
                  ? resolvedIntent
                  : inferNearbyIntentFromContext(
                      nextSession.travelContext ?? merged.context,
                      trimmed,
                      nextSession,
                    );
            const willCall =
              Boolean(nearbyIntent) &&
              nearbyScope.scope === "current_location" &&
              nearbyScope.deviceLocationAvailable;
            const pushCallReason = willCall
              ? "location_ready"
              : !nearbyScope.deviceLocationAvailable
                ? "missing_location"
                : nearbyScope.hasExplicitDestination
                  ? "explicit_destination"
                  : "missing_nearby_intent";
            const homeSearchProfile = resolveHomeShortcutSearchProfile(nextSession);
            logShortcutRuntime("[RT_HOME_SHORTCUT_RESOLVED]", {
              source: nextSession.normalizedShortcutRequest?.source ?? "",
              mode: nextSession.normalizedShortcutRequest?.mode ?? "",
              structured: Boolean(nextSession.normalizedShortcutRequest?.structured),
              shortcutScene: resolveNearbyShortcutScene(trimmed, nextSession) ?? "",
              intent: nearbyIntent ?? nextSession.normalizedShortcutRequest?.intent ?? "",
              resolvedRoute: arbitration.route,
              scope: nearbyScope.scope,
              routeMode: conversationMode ?? "",
              searchProfile: homeSearchProfile ?? "chat_nearby",
              planningStateBefore: planningStateBeforeHomeIsolation,
              planningStateAfterIsolation:
                nextSession.chatPlanningState ?? nextSession.conversationMode ?? "",
              activeRecommendationIntent:
                nextSession.activeRecommendationContext?.intent ??
                nextSession.activeCategoryIntent ??
                "",
              interceptedBy: "",
            });
            logShortcutRuntime("[RT_NEARBY_PUSH_CALL]", {
              willCall,
              reason: pushCallReason,
              scope: nearbyScope.scope,
              latPresent: nextSession.location?.lat != null,
              lngPresent: nextSession.location?.lng != null,
              locationSource:
                effective?.source ?? (nearbyScope.deviceLocationAvailable ? "session" : ""),
            });
            if (willCall && nearbyIntent) {
              setStreaming(true);
              try {
                const appliedNearby = await pushNearbyPlaceRecommendation(
                  nextSession,
                  trimmed,
                  next,
                  nearbyIntent,
                );
                if (appliedNearby) return;
              } finally {
                setStreaming(false);
              }
              logRtResponseBranch("other");
              setMsgs([...next, { role: "assistant", content: t("home.nearbySlowEmpty") }]);
              persistSession(nextSession);
              return;
            }
            if (!nearbyScope.deviceLocationAvailable) {
              logAiPipeline("[NEARBY_FALLBACK]", "reason=missing_location");
              logRtResponseBranch("destination_clarification");
              setMsgs([
                ...next,
                {
                  role: "assistant",
                  content: "我可以幫你找附近推薦，先告訴我你現在在哪個地區或城市。",
                },
              ]);
              persistSession(nextSession);
              return;
            }
            logRtResponseBranch("other");
            setMsgs([...next, { role: "assistant", content: t("home.nearbySlowEmpty") }]);
            persistSession(nextSession);
            return;
          }
          const appliedNew = await pushDestinationCategoryPlaceRecommendation(
            { ...nextSession, travelContext: refreshedPlaceCtx },
            trimmed,
            next,
          );
          if (appliedNew) return;
        }
        if (arbitration.route === "MORE_RECOMMENDATIONS") {
          const destForMore =
            nextSession.activeRecommendationContext?.destinationName ||
            nextSession.recommendationSession?.destination ||
            nextSession.travelContext?.destination ||
            nextSession.tripPlanningContext?.destination ||
            nextSession.tripDestination?.city;
          if (destForMore?.trim()) {
            const appliedMore = await pushMorePlaceRecommendations(
              {
                ...nextSession,
                travelContext: {
                  ...refreshedPlaceCtx,
                  destination: destForMore,
                  tripPurpose: "more_place_recommendations",
                },
              },
              trimmed,
              next,
            );
            if (appliedMore) return;
          }
        }
        const applied = await pushRecommendationRefinement(nextSession, trimmed, next);
        if (applied) return;
        const firstTurnNewRecommendation =
          arbitration.route === "NEW_RECOMMENDATION" &&
          !matchesContinueRecommendationGrammar(trimmed) &&
          !nextSession.activeRecommendationContext &&
          !nextSession.recommendationSession;
        if (firstTurnNewRecommendation) {
          const destLabel =
            resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ??
            refreshedPlaceCtx.destination?.trim() ??
            "";
          if (destLabel) {
            logRtResponseBranch("other");
            setMsgs([
              ...next,
              {
                role: "assistant",
                content: `目前在${destLabel}暫時找不到符合的地點，可以換個描述或稍後再試。`,
              },
            ]);
            persistSession(nextSession);
            return;
          }
          if (!sessionHasLocation(nextSession)) {
            logAiPipeline("[NEARBY_FALLBACK]", "reason=missing_location");
            logRtResponseBranch("destination_clarification");
            const pendingNearbyIntent = earlyRouteAuthority === "nearby" ? earlyNearbyIntent : null;
            const pendingSession = pendingNearbyIntent
              ? {
                  ...nextSession,
                  activeChatIntent: pendingNearbyIntent,
                  activeCategoryIntent:
                    pendingNearbyIntent === "restaurant"
                      ? ("restaurant" as const)
                      : pendingNearbyIntent === "cafe"
                        ? ("cafe" as const)
                        : ("attraction" as const),
                  pendingNearbyLocationRequest: createPendingNearbyLocationRequest(
                    pendingNearbyIntent,
                    trimmed,
                  ),
                }
              : nextSession;
            persistSession(pendingSession, next);
            if (pendingNearbyIntent) {
              const clarificationCopy = buildNearbyLocationClarificationCopy(
                trimmed,
                pendingNearbyIntent,
              );
              console.info("[CHAT_PENDING_NEARBY_CREATED]", {
                nearbyIntent: pendingNearbyIntent,
                originalQuery: trimmed,
                reason: "missing_location_before_refinement_dispatch",
                persisted: true,
              });
              logAiPipeline("[CLARIFICATION_COPY_RESOLVED]", {
                originalQuery: trimmed,
                categoryLabel: clarificationCopy.categoryLabel,
                renderedCopy: clarificationCopy.renderedCopy,
              });
              setMsgs([...next, { role: "assistant", content: clarificationCopy.renderedCopy }]);
              return;
            }
            setMsgs([
              ...next,
              {
                role: "assistant",
                content: "我可以幫你找附近推薦，先告訴我你現在在哪個地區或城市。",
              },
            ]);
            return;
          }
          logRtResponseBranch("other");
          setMsgs([...next, { role: "assistant", content: t("home.nearbySlowEmpty") }]);
          persistSession(nextSession);
          return;
        }
        // Continuation / exhausted recommendation only — never first-turn NEW_RECOMMENDATION.
        logRtNoMoreReason({
          caller: "send.refinement.route",
          route: arbitration.route,
          followup: matchesContinueRecommendationGrammar(trimmed),
          hasActiveRecommendationContext: Boolean(
            nextSession.activeRecommendationContext || nextSession.recommendationSession,
          ),
          reason: "nearby_push_failed",
        });
        logRtResponseBranch("no_more");
        setMsgs([
          ...next,
          {
            role: "assistant",
            content: NO_MORE_RECOMMENDATIONS_MESSAGE,
          },
        ]);
        return;
      }

      const hasActiveRecSession = Boolean(
        nextSession.recommendationSession || nextSession.activeCategoryIntent,
      );
      if (
        (isPlanningTurnActive(nextSession, merged.context) ||
          isDestinationPlanningSession(nextSession, merged.context)) &&
        !shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
        !shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
        !(
          hasActiveRecSession &&
          (isContinueRecommendationRequest(trimmed, nextSession) ||
            isMorePlaceRecommendationsIntent(trimmed))
        ) &&
        !(
          hasCategoryPlaceQuery(trimmed) &&
          !coerceTravelDestination(
            resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed),
          )
        )
      ) {
        const planningCtx = nextSession.travelContext ?? merged.context;
        const next = commitUserMessageWithDiscoveringLoading(trimmed, msgs);
        await yieldToNextPaint();
        try {
          const durationFields = tripDurationFieldsFromContext(planningCtx, nextSession);
          const validDays = resolveValidTripDays(durationFields);
          const discoveryGuard = evaluateCombinationDiscoveryGuard({
            destination: planningCtx.destination,
            destinationType: planningCtx.destinationType,
            destinationCountry: planningCtx.destinationCountry,
            destinationCity: planningCtx.destinationCity,
            destinationCountryCode: planningCtx.destinationCountryCode,
            destinationCoordinates: planningCtx.destinationCoordinates,
            destinationScopeId: planningCtx.destinationScopeId,
            ...durationFields,
            days: validDays,
            pendingQuestion: nextSession.pendingQuestion,
            session: nextSession,
          });
          logCombinationDiscoveryGuard(discoveryGuard, planningCtx.destination);

          // Missing trip days → ask duration. Never Places / Candidate / failure copy.
          if (
            !discoveryGuard.allowed &&
            (discoveryGuard.reason === "missing_trip_duration" ||
              discoveryGuard.reason === "pending_duration_question" ||
              !hasValidTripDuration(durationFields))
          ) {
            const destLabel =
              planningCtx.destination?.trim() || nextSession.tripDestination?.city?.trim() || "";
            if (destLabel && !isCountryLevelDestination(destLabel)) {
              logTripDurationGuard({
                tripDays: validDays ?? null,
                startDate: planningCtx.startDate,
                endDate: planningCtx.endDate,
                valid: false,
                nextState: "waitingTripDays",
              });
              logConversationStateTransition({
                from: nextSession.chatPlanningState ?? planningCtx.conversationState,
                to: "waitingTripDays",
                reason: "destination_selected_duration_missing",
              });
              const dateAsk = buildDateAndDurationQuestionReply(
                destLabel,
                planningCtx.destinationCountry ?? nextSession.travelContext?.destinationCountry,
                {
                  context: planningCtx,
                  userText: trimmed,
                  previousPendingType: nextSession.pendingQuestion?.type,
                  blockedLegacyTemplate: "chat_pipeline_missing_trip_duration",
                },
              );
              stopDiscoveringLoadingAnimation("cancelled");
              setMsgs([
                ...stripDiscoveringLoadingMessage(next),
                { role: "assistant", content: dateAsk.reply },
              ]);
              setStreaming(false);
              persistSession(
                withChatPlanningState(
                  {
                    ...nextSession,
                    pendingQuestion: dateAsk.pendingQuestion,
                    travelContext: {
                      ...planningCtx,
                      destination: destLabel,
                      tripPurpose: "region_selected",
                      conversationState: "awaiting_days",
                      planningDaysConfirmed: false,
                    },
                  },
                  "waitingTripDays",
                  "destination_selected_duration_missing",
                ),
              );
              logRtResponseBranch("trip_duration_question");
              return;
            }
          }

          if (
            canEnterCombinationDiscovery({
              destination: planningCtx.destination,
              destinationType: planningCtx.destinationType,
              destinationCountry: planningCtx.destinationCountry,
              destinationCity: planningCtx.destinationCity,
              destinationCountryCode: planningCtx.destinationCountryCode,
              destinationCoordinates: planningCtx.destinationCoordinates,
              destinationScopeId: planningCtx.destinationScopeId,
              ...durationFields,
              days: validDays,
              pendingQuestion: nextSession.pendingQuestion,
              session: nextSession,
            })
          ) {
            await prepareDestinationCombinations(planningCtx, nextSession);
          }
          const earlyPlanningTurn = processAdviceTurn(trimmed, nextSession, planningCtx);
          if (earlyPlanningTurn.advice.reply) {
            // Duration → combination options (including theme fallback) must never be
            // overwritten by place-discovery failure copy.
            const isPlaceFailureCopy = /暫時無法取得.*景點資料/.test(
              earlyPlanningTurn.advice.reply,
            );
            const isComboOffered =
              earlyPlanningTurn.advice.pendingQuestion?.type === "combination_choice" ||
              earlyPlanningTurn.advice.contextPatch?.tripPurpose ===
                "combination_suggestions_offered";
            if (isPlaceFailureCopy && !isComboOffered) {
              // Fall through to soft failure only when advice truly has no combo path.
            } else {
              await completeAdviceTurn(earlyPlanningTurn, nextSession, merged.context, next);
              return;
            }
          }
          // Discovery failed — never pad with category labels.
          // Distinguish destination_resolution_failed from real_places_below_minimum.
          // Never classify missing tripDays as places-insufficient.
          const destLabel =
            planningCtx.destination?.trim() || nextSession.tripDestination?.city?.trim() || "";
          const days = resolveValidTripDays(
            tripDurationFieldsFromContext(planningCtx, nextSession),
          );
          if (
            !hasValidTripDuration({
              days,
              ...tripDurationFieldsFromContext(planningCtx, nextSession),
            })
          ) {
            logTripDurationGuard({
              tripDays: days ?? null,
              startDate: planningCtx.startDate,
              endDate: planningCtx.endDate,
              valid: false,
              nextState: "waitingTripDays",
            });
            const dateAsk = buildDateAndDurationQuestionReply(
              destLabel || "這趟",
              planningCtx.destinationCountry,
              {
                context: planningCtx,
                userText: trimmed,
                blockedLegacyTemplate: "post_discovery_missing_trip_duration",
              },
            );
            stopDiscoveringLoadingAnimation("cancelled");
            setMsgs([
              ...stripDiscoveringLoadingMessage(next),
              { role: "assistant", content: dateAsk.reply },
            ]);
            setStreaming(false);
            persistSession(
              withChatPlanningState(
                {
                  ...nextSession,
                  pendingQuestion: dateAsk.pendingQuestion,
                  travelContext: {
                    ...planningCtx,
                    tripPurpose: "region_selected",
                    conversationState: "awaiting_days",
                    planningDaysConfirmed: false,
                  },
                },
                "waitingTripDays",
                "missing_trip_duration",
              ),
            );
            logRtResponseBranch("trip_duration_question");
            return;
          }
          const discoveryFailure = getLastCombinationDiscoveryFailure();
          const isDestResolutionFailed =
            discoveryFailure?.reason === "destination_resolution_failed" ||
            discoveryFailure?.detail === "no_coordinates";
          const isDestinationStateDesync =
            discoveryGuard.reason === "destination_state_desync" ||
            discoveryGuard.reason === "missing_destination";
          if (isDestinationStateDesync) {
            console.info(
              "[COMBINATION_FAILURE_UI]",
              "reason=destination_state_desync",
              `destination=${destLabel}`,
              `guardReason=${discoveryGuard.reason}`,
              `hasDestination=${discoveryGuard.hasDestination}`,
            );
          }
          const failureBody = isDestResolutionFailed
            ? buildDestinationRecommendationFailedMessage(
                destLabel,
                discoveryFailure?.reason ?? "destination_resolution_failed",
              )
            : "目前暫時無法取得足夠的實際地點組合，請稍後回「重新整理推薦」再試一次。";
          // Last resort — keep destination/days, offer refresh (not itinerary failure).
          // Note: destination_state_desync uses the same user-facing retry copy but
          // debug logs above record the true primary failure (not candidate scarcity).
          stopDiscoveringLoadingAnimation("failure");
          setMsgs([
            ...stripDiscoveringLoadingMessage(next),
            {
              role: "assistant",
              content: [
                buildDestinationDirectionAck({
                  destination: destLabel || "這趟",
                  tripDays: days,
                  startDate: planningCtx.startDate,
                  endDate: planningCtx.endDate,
                }),
                "",
                failureBody,
              ].join("\n"),
            },
          ]);
          setStreaming(false);
          persistSession({
            ...nextSession,
            pendingQuestion: {
              type: "ask_preference",
              options: [REFRESH_DESTINATION_RECOMMENDATIONS_OPTION],
              baseDestination: destLabel || undefined,
              destinationCountry: planningCtx.destinationCountry,
            },
          });
          return;
        } catch (error) {
          stopDiscoveringLoadingAnimation("failure");
          setStreaming(false);
          setMsgs([
            ...stripDiscoveringLoadingMessage(next),
            {
              role: "assistant",
              content: "目前暫時無法取得景點資料，請稍後再試。",
            },
          ]);
          console.warn("[CHAT_PIPELINE_ERROR]", error);
          return;
        }
      }

      const intent = resolveChatIntent(trimmed, nextSession);

      if (
        intent === "destination_advice" ||
        intent === "best_travel_time" ||
        intent === "trip_planning"
      ) {
        nextSession = {
          ...nextSession,
          activeChatIntent:
            intent === "destination_advice" || intent === "best_travel_time"
              ? "destination_advice"
              : nextSession.activeChatIntent,
          conversationMode: "destination_planning",
        };
      } else if (
        intent === "create_itinerary" &&
        !nextSession.fromMoodFlow &&
        !nextSession.fromMoodCard &&
        !nextSession.homeMoodShortcutEntry
      ) {
        nextSession = {
          ...nextSession,
          conversationMode: "destination_planning",
        };
      }

      if (isFoodPreferenceReply(trimmed) && nextSession.activeChatIntent === "restaurant") {
        const food = parseFoodPreference(trimmed);
        if (food) nextSession = { ...nextSession, foodPreference: food };
      }

      const effectiveConversationMode = nextSession.conversationMode ?? conversationMode;

      const rawCategoryPlaceQuery = shouldFetchDestinationCategoryPlaces(
        trimmed,
        refreshedPlaceCtx,
        nextSession,
      );

      const inferredNearbyIntent = rawCategoryPlaceQuery
        ? inferNearbyIntentFromContext(merged.context, trimmed, nextSession)
        : (effectiveConversationMode === "destination_planning" ||
              effectiveConversationMode === "place_focus" ||
              intent === "destination_advice" ||
              intent === "create_itinerary" ||
              intent === "best_travel_time" ||
              intent === "trip_planning") &&
            !nextSession.fromMoodFlow &&
            !nextSession.fromMoodCard &&
            !nextSession.homeMoodShortcutEntry
          ? null
          : inferNearbyIntentFromContext(merged.context, trimmed, nextSession);

      const resolvedNearbyAuthorityIntent =
        (isNearbyPlaceIntent(intent) ? intent : null) ??
        (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
          ? nextSession.activeChatIntent
          : null) ??
        inferredNearbyIntent;
      const selectedRouteAuthority = resolveChatRouteAuthority({
        structuredShortcut: Boolean(normalizedShortcutFromTurn?.structured),
        explicitNearbyRequest: userExplicitlyWantsNearbyPlaces(trimmed),
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        resolvedNearbyIntent: resolvedNearbyAuthorityIntent,
        categoryPlaceQuery: rawCategoryPlaceQuery,
      });
      const categoryPlaceQuery = selectedRouteAuthority === "destination_category";
      logAiPipeline("[CHAT_ROUTE_AUTHORITY]", {
        nearbyIntent: resolvedNearbyAuthorityIntent ?? "",
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        categoryPlaceQuery: rawCategoryPlaceQuery,
        selectedAuthority: selectedRouteAuthority,
      });
      logAiPipeline("[AFTER_ROUTE_AUTHORITY]", {
        selectedAuthority: selectedRouteAuthority,
        phase: "final_dispatch",
      });

      const logNearbyDispatchSkip = (reason: string, branch: string): void => {
        if (selectedRouteAuthority !== "nearby") return;
        logAiPipeline("[SKIP_NEARBY_PIPELINE]", {
          reason,
          branch,
          selectedAuthority: selectedRouteAuthority,
        });
      };

      if (
        isNearbyPlaceIntent(intent) ||
        nextSession.activeChatIntent === "restaurant" ||
        (nextSession.fromMoodFlow &&
          effectiveConversationMode !== "destination_planning" &&
          intent !== "destination_advice" &&
          intent !== "trip_planning") ||
        inferredNearbyIntent
      ) {
        nextSession = await resolveChatLocation(nextSession);
      }

      if (inferredNearbyIntent && !nextSession.activeChatIntent) {
        nextSession = { ...nextSession, activeChatIntent: inferredNearbyIntent };
      }

      const route = resolveChatRoute(trimmed, merged.context, nextSession, locale, intent);
      if (normalizedShortcutFromTurn) {
        logAiPipeline("[SHORTCUT_ROUTE]", `route=${route.mode}`);
      }
      logShortcutRuntime("[RT_NEARBY_SCOPE]", {
        isNearbyIntent: isNearbyPlaceIntent(intent) || Boolean(inferredNearbyIntent),
        scope:
          merged.context.destination?.trim() ||
          nextSession.travelContext?.destination?.trim() ||
          nextSession.tripDestination?.city?.trim()
            ? "destination"
            : sessionHasLocation(nextSession)
              ? "current_location"
              : "none",
        deviceLocationAvailable: sessionHasLocation(nextSession),
        deviceLocationUsed:
          (isNearbyPlaceIntent(intent) || Boolean(inferredNearbyIntent)) &&
          sessionHasLocation(nextSession) &&
          !(
            merged.context.destination?.trim() ||
            nextSession.travelContext?.destination?.trim() ||
            nextSession.tripDestination?.city?.trim()
          ),
        routeMode: route.mode,
      });
      const tripIntent = parseTripIntentFromText(trimmed, nextSession);

      if (
        (route.mode === "recommend" ||
          tripIntent.readyForRecommendations ||
          isNearbyPlaceIntent(intent) ||
          intent === "refine_recommendations" ||
          nextSession.activeChatIntent === "restaurant" ||
          inferredNearbyIntent) &&
        intent !== "destination_advice" &&
        intent !== "trip_planning" &&
        route.mode !== "advice" &&
        !isDestinationPlanningSession(nextSession, merged.context)
      ) {
        nextSession = { ...nextSession, phase: "recommend" };
      }

      persistSession(nextSession);

      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");

      const tryNearbyRecommendation = async (
        nearbyIntent: import("@/lib/ai/chat-intent").NearbyPlaceIntent,
      ): Promise<boolean> => {
        logAiPipeline("[ENTER_NEARBY_PIPELINE]", {
          selectedAuthority: selectedRouteAuthority,
          nearbyIntent,
        });
        const legacyShouldFetchNearby = shouldFetchNearbyPlaces(nearbyIntent, nextSession, trimmed);
        if (
          !shouldAllowNearbyDispatch({
            selectedAuthority: selectedRouteAuthority,
            nearbyIntent,
            legacyShouldFetch: legacyShouldFetchNearby,
          })
        ) {
          logNearbyDispatchSkip("should_fetch_nearby_places_false", "nearby_fetch_gate");
          const shortcut = resolveChatShortcutContext(trimmed);
          if (shortcut) {
            logShortcutRecommendationRequestNotSent(
              shortcut,
              "nearby",
              shortcut.scene === "quiet_cafe"
                ? ["cafe", "coffee_shop", "bakery"]
                : shortcut.scene === "relax_walk"
                  ? ["tourist_attraction", "park", "museum", "art_gallery"]
                  : ["museum", "shopping_mall", "cafe", "book_store", "tourist_attraction"],
            );
          }
          return false;
        }
        setStreaming(true);
        try {
          logAiPipeline("[BEFORE_PUSH_NEARBY]", {
            selectedAuthority: selectedRouteAuthority,
            nearbyIntent,
          });
          const applied = await pushNearbyPlaceRecommendation(
            nextSession,
            trimmed,
            next,
            nearbyIntent,
          );
          if (applied) return true;
          const noKnownLocation =
            !sessionHasLocation(nextSession) &&
            !(
              nextSession.travelContext?.destination?.trim() ||
              nextSession.activeRecommendationContext?.destinationName?.trim() ||
              nextSession.recommendationSession?.destination?.trim() ||
              nextSession.tripPlanningContext?.destination?.trim() ||
              nextSession.tripDestination?.city?.trim()
            );
          if (noKnownLocation) {
            logAiPipeline("[NEARBY_FALLBACK]", "reason=missing_location");
            const pendingSession: ChatPlanningSession = {
              ...nextSession,
              activeChatIntent: nearbyIntent,
              activeCategoryIntent:
                nearbyIntent === "restaurant"
                  ? "restaurant"
                  : nearbyIntent === "cafe"
                    ? "cafe"
                    : "attraction",
              pendingNearbyLocationRequest: createPendingNearbyLocationRequest(
                nearbyIntent,
                trimmed,
              ),
            };
            persistSession(pendingSession, next);
            const clarificationCopy = buildNearbyLocationClarificationCopy(trimmed, nearbyIntent);
            console.info("[CHAT_PENDING_NEARBY_CREATED]", {
              nearbyIntent,
              originalQuery: trimmed,
              reason: "missing_location_before_nearby_dispatch",
              persisted: true,
            });
            logAiPipeline("[CLARIFICATION_COPY_RESOLVED]", {
              originalQuery: trimmed,
              categoryLabel: clarificationCopy.categoryLabel,
              renderedCopy: clarificationCopy.renderedCopy,
            });
            logRtResponseBranch("destination_clarification");
            setMsgs([
              ...next,
              {
                role: "assistant",
                content: clarificationCopy.renderedCopy,
              },
            ]);
            return true;
          }
          if (nearbyPushRuntimeRef.current?.reason === "provider_zero") {
            logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "provider_failure" });
            setMsgs([
              ...next,
              {
                role: "assistant",
                content: "目前無法連線取得附近地點，請稍後再試。",
              },
            ]);
            return true;
          }
          if (nearbyPushRuntimeRef.current?.reason === "recommendation_processing_failure") {
            logAiPipeline("[NEARBY_FAILURE_REASON]", {
              reason: "recommendation_processing_failure",
            });
            setMsgs([...next, { role: "assistant", content: "推薦結果整理失敗，請再試一次。" }]);
            return true;
          }
          logAiPipeline("[NEARBY_FAILURE_REASON]", { reason: "genuine_zero_results" });
          return await applyLocalFallback(nextSession, trimmed, next, "places_empty");
        } finally {
          setStreaming(false);
        }
      };

      if (route.mode === "itinerary" || isUserConfirmingItinerary(trimmed)) {
        const itineraryDestination =
          merged.context.destination?.trim() ||
          nextSession.tripDestination?.displayLabel?.trim() ||
          nextSession.tripDestination?.city?.trim();
        const itineraryDays = merged.context.days ?? nextSession.tripDays;
        if (itineraryDestination && itineraryDays) {
          logNearbyDispatchSkip("itinerary_route_ready", "direct_itinerary");
          await runDirectItineraryRef.current(
            { ...nextSession, phase: "ready" },
            merged.context,
            next,
          );
          return;
        }
        if (nextSession.selectedPlaces.length < 1) {
          logNearbyDispatchSkip("itinerary_missing_selected_places", "direct_itinerary");
          toast.message("你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線。");
          const hint: ChatMsg = {
            role: "assistant",
            content: "你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線 ☺️",
          };
          setMsgs([...next, hint]);
          return;
        }
        const readySession: ChatPlanningSession = { ...nextSession, phase: "ready" };
        logNearbyDispatchSkip("itinerary_generation", "direct_itinerary");
        persistSession(readySession);
        await handleGenerateItinerary(readySession, next);
        return;
      }

      if (
        nextSession.activeChatIntent === "restaurant" &&
        shouldAskRestaurantCuisine(nextSession, trimmed) &&
        !shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
        !isFoodPreferenceReply(trimmed)
      ) {
        logNearbyDispatchSkip("restaurant_cuisine_required", "restaurant_cuisine_clarification");
        const question = restaurantCuisineQuestion();
        persistSession({ ...nextSession, phase: "recommend" });
        setMsgs([...next, { role: "assistant", content: question }]);
        return;
      }

      if (route.mode === "advice" && route.question) {
        await prepareDestinationCombinations(merged.context, nextSession);
        const turn = processAdviceTurn(trimmed, nextSession, merged.context);
        if (turn.advice.reply) {
          logNearbyDispatchSkip("advice_reply", "advice_route");
          await completeAdviceTurn(turn, nextSession, merged.context, next);
          return;
        }
      }

      if (route.mode === "clarify" && route.question && route.missingKey) {
        if (nextSession.activeChatIntent === "restaurant") {
          logNearbyDispatchSkip("restaurant_clarify", "route_clarification");
          const question = restaurantCuisineQuestion();
          persistSession({ ...nextSession, phase: "recommend" });
          setMsgs([...next, { role: "assistant", content: question }]);
          return;
        }
        const nearbyIntentForClarify =
          inferredNearbyIntent ??
          (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
            ? nextSession.activeChatIntent
            : null);
        const shouldBypassLocationClarify =
          route.missingKey === "destination" &&
          nearbyIntentForClarify != null &&
          sessionHasLocation(nextSession);
        if (
          nearbyIntentForClarify &&
          (conversationMode !== "destination_planning" || shouldBypassLocationClarify)
        ) {
          const applied = await tryNearbyRecommendation(nearbyIntentForClarify);
          if (applied) return;
        }
        nextSession = markAskedClarifyKey(nextSession, route.missingKey);
        persistSession({
          ...nextSession,
          pendingQuestion: route.pendingQuestion,
        });
        logRtResponseBranch(
          route.missingKey === "destination" ? "destination_clarification" : "other",
        );
        setMsgs([...next, { role: "assistant", content: route.question }]);
        logNearbyDispatchSkip(`route_missing_${route.missingKey}`, "route_clarification_fallback");
        return;
      }

      const nearbyIntent = categoryPlaceQuery
        ? inferNearbyIntentFromContext(merged.context, trimmed, nextSession)
        : conversationMode === "destination_planning"
          ? null
          : ((isNearbyPlaceIntent(intent) ? intent : null) ??
            (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
              ? nextSession.activeChatIntent
              : null) ??
            inferredNearbyIntent);

      if (categoryPlaceQuery) {
        logNearbyDispatchSkip("destination_category_selected", "destination_category_dispatch");
        const applied = await pushDestinationCategoryPlaceRecommendation(
          nextSession,
          trimmed,
          next,
        );
        if (applied) return;
      }

      if (nearbyIntent) {
        const applied = await tryNearbyRecommendation(nearbyIntent);
        if (applied) return;
        if (nearbyIntent === "restaurant") {
          logNearbyDispatchSkip("nearby_dispatch_returned_false", "restaurant_empty_toast");
          toast.message("暫時找不到附近餐廳，請稍後再試。");
          return;
        }
        if (nearbyIntent === "camping") {
          const intro = buildCampingIntroReply(merged.context, nextSession);
          persistSession({
            ...nextSession,
            activeChatIntent: "camping",
            phase: "discover",
            travelContext: {
              ...merged.context,
              activity: "camping",
              tripPurpose: "recommend_places",
            },
          });
          setMsgs([...next, { role: "assistant", content: intro }]);
          return;
        }
      }
      if (selectedRouteAuthority === "nearby" && !nearbyIntent) {
        logNearbyDispatchSkip("nearby_intent_missing_after_authority", "nearby_dispatch");
      }

      if (intent === "refine_recommendations" || isBudgetRefinementText(trimmed)) {
        const refineIntent =
          (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
            ? nextSession.activeChatIntent
            : null) ??
          inferNearbyIntentFromContext(
            nextSession.travelContext ?? merged.context,
            trimmed,
            nextSession,
          ) ??
          "attraction";

        if (sessionHasLocation(nextSession)) {
          setStreaming(true);
          try {
            const applied = await pushNearbyPlaceRecommendation(
              nextSession,
              trimmed,
              next,
              refineIntent,
              {
                excludePlaceIds: collectExcludePlaceIds(nextSession, msgs),
                rejectedPlaceNames: nextSession.rejectedPlaceNames,
                blockedCoreNames: collectBlockedCoreNames(nextSession, msgs),
                userText: trimmed,
                cityLabel: nextSession.location?.city ?? merged.context.destination,
              },
            );
            if (applied) return;
          } finally {
            setStreaming(false);
          }
        }

        if (!isBudgetRefinementText(trimmed)) {
          logRtNoMoreReason({
            caller: "send.refinement.budget",
            route: "RECOMMENDATION_REFINEMENT",
            followup: false,
            hasActiveRecommendationContext: Boolean(
              nextSession.activeRecommendationContext || nextSession.recommendationSession,
            ),
            reason: "nearby_push_failed",
          });
          logRtResponseBranch("no_more");
          setMsgs([...next, { role: "assistant", content: NO_MORE_RECOMMENDATIONS_MESSAGE }]);
          return;
        }

        const existingRecs =
          nextSession.recommendedPlaces.length > 0
            ? nextSession.recommendedPlaces
            : ([...msgs]
                .reverse()
                .find((m) => m.role === "assistant" && m.roamie?.recommendations?.length)?.roamie
                ?.recommendations ?? []);

        const refinedItems = refineRecommendationItemsForBudget(existingRecs, "low").slice(0, 5);
        if (refinedItems.length > 0) {
          const summary = buildBudgetRefinementSummary(
            nextSession.travelContext ?? merged.context,
            refinedItems,
          );
          const sessionWithRefine: ChatPlanningSession = {
            ...nextSession,
            activeChatIntent: refineIntent,
            phase: "followup",
          };
          const { summary: displaySummary, recommendations: filteredRecs } =
            finalizeChatRecommendationDisplay(sessionWithRefine, trimmed, summary, refinedItems);
          persistSession(
            syncSessionPlaceMemory({
              ...sessionWithRefine,
              recommendedPlaces: filteredRecs as ChatPlaceItem[],
            }),
          );
          setMsgs([
            ...next,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                title: "Roamie 推薦",
                summary: displaySummary,
                moodTag: sessionWithRefine.mood ?? merged.context.mood ?? "",
                recommendations: filteredRecs,
                itinerary: [],
              },
            },
          ]);
          return;
        }
      }

      if (shouldBlockPlanningFallbackForCategoryQuery(trimmed, merged.context, nextSession)) {
        console.info(
          "[TRIP_FLOW_BYPASSED]",
          "reason=explicit_place_recommendation",
          `text=${trimmed.slice(0, 60)}`,
        );
        const applied = await pushDestinationCategoryPlaceRecommendation(
          nextSession,
          trimmed,
          next,
        );
        if (applied) return;
      } else if (isPlanningTurnActive(nextSession, merged.context)) {
        await prepareDestinationCombinations(merged.context, nextSession);
        const planningTurn = processAdviceTurn(trimmed, nextSession, merged.context);
        if (planningTurn.advice.reply) {
          await completeAdviceTurn(planningTurn, nextSession, merged.context, next);
          return;
        }
        const applied = await applyLocalFallback(nextSession, trimmed, next, "planning_no_reply");
        if (applied) return;
        const offline = buildPlanningOfflineReply(merged.context, nextSession, trimmed);
        if (offline) {
          persistSession(nextSession);
          setMsgs([...next, { role: "assistant", content: offline }]);
          return;
        }
        return;
      }

      await streamChat(next, { phase: route.chatPhase, userText: trimmed }, nextSession);
      logRtResponseBranch("general_chat");
    } catch (error) {
      logAppError("CHAT_STATE_MACHINE_ERROR", error);
      console.warn(
        "[CHAT_STATE_MACHINE_ERROR]",
        error instanceof Error ? error.message : String(error),
      );
      setStreaming(false);

      const errorConversation: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      try {
        const fallbackApplied = await applyLocalFallback(
          session,
          trimmed,
          errorConversation,
          "state_machine_error",
        );
        if (fallbackApplied) {
          setText("");
          return;
        }
      } catch (fallbackError) {
        console.warn(
          "[CHAT_STATE_MACHINE_FALLBACK_FAILED]",
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
      }

      setMsgs((prev) => {
        const hasUserTurn = prev.some(
          (m, i) => i === prev.length - 1 && m.role === "user" && m.content === trimmed,
        );
        const base = hasUserTurn ? prev : [...prev, { role: "user" as const, content: trimmed }];
        const last = base[base.length - 1];
        if (last?.role === "assistant" && last.content === CHAT_STATE_MACHINE_RECOVERY_MESSAGE) {
          return base;
        }
        return [
          ...base,
          { role: "assistant" as const, content: CHAT_STATE_MACHINE_RECOVERY_MESSAGE },
        ];
      });
      setText("");
    }
  };

  const handleGenerateItinerary = async (
    sessionOverride?: ChatPlanningSession,
    msgsOverride?: ChatMsg[],
    creditsHandleOverride?: CreditsOperationHandle | null,
  ) => {
    let activeSession = sessionOverride ?? sessionRef.current;
    const selectionStartedAt = Date.now();
    const selectionSessionId = activeSession.planningSelection?.id ?? "(not-selection)";
    const selectionDestination =
      activeSession.tripDestination?.displayLabel ??
      activeSession.tripDestination?.city ??
      activeSession.travelContext?.destination ??
      "";
    const selectionSelectedCount = isPlanningSelectionMode(activeSession)
      ? resolvePlanningSelectionPlaces(activeSession).length
      : 0;
    const selectionTripDays = activeSession.tripDays ?? activeSession.travelContext?.days ?? 1;
    let selectionLastTimingAt = selectionStartedAt;
    const logSelectionTiming = (stage: string, success = true, failureReason = "") => {
      if (!isPlanningSelectionMode(activeSession)) return;
      const now = Date.now();
      console.info("[PLANNING_SELECTION_GENERATION_TIMING]", {
        stage,
        elapsedMs: now - selectionStartedAt,
        stageDurationMs: now - selectionLastTimingAt,
        selectedCount: selectionSelectedCount,
        tripDays: selectionTripDays,
        success,
        failureReason,
      });
      selectionLastTimingAt = now;
    };
    let selectionGenerateStage = "generate_click";
    const logSelectionStage = (stage: string, success: boolean, failureReason = "") => {
      if (!isPlanningSelectionMode(activeSession)) return;
      selectionGenerateStage = stage;
      console.info("[PLANNING_SELECTION_GENERATE_STAGE]", {
        stage,
        sessionId: selectionSessionId,
        elapsedMs: Date.now() - selectionStartedAt,
        selectedCount: selectionSelectedCount,
        destination: selectionDestination,
        success,
        failureReason,
      });
    };
    logSelectionStage("generate_click", true);
    logSelectionTiming("generate_click");
    if (isPlanningSelectionMode(activeSession) && !generating) {
      selectionLoadingPaintRef.current = {
        startedAt: selectionStartedAt,
        selectedCount: selectionSelectedCount,
        tripDays: selectionTripDays,
        logged: false,
      };
      setGenerating(true);
      setSelectionGenerationStatus("正在整理你選的地點…");
    }
    if (isPlanningSelectionMode(activeSession)) {
      const selectedPlaces = resolvePlanningSelectionPlaces(activeSession);
      activeSession = {
        ...activeSession,
        selectedPlaces,
        plannedStops: selectedPlaces,
        planningSelection: { ...activeSession.planningSelection!, selectedPlaces },
      };
      logSelectionStage(
        "selection_resolved",
        selectedPlaces.length > 0,
        selectedPlaces.length ? "" : "no_selected_places",
      );
      logSelectionTiming(
        "selected_places_resolved",
        selectedPlaces.length > 0,
        selectedPlaces.length ? "" : "no_selected_places",
      );
    }
    const activeMsgs = msgsOverride ?? msgs;
    if (!canGenerateItinerary(activeSession) || generating) {
      if (isPlanningSelectionMode(activeSession) && !generating) {
        setGenerating(false);
        setSelectionGenerationStatus(null);
      }
      return;
    }

    let itinCreditsHandle: CreditsOperationHandle | null = creditsHandleOverride ?? null;
    let itinerarySucceeded = false;
    if (!itinCreditsHandle) {
      if (!ensureSubscriptionHydratedForCredits(activeMsgs)) {
        setGenerating(false);
        setSelectionGenerationStatus(null);
        return;
      }
      const itinGate = await beginItineraryGenerationCredits({
        hasPlusAccess,
        metadata: { path: "handleGenerateItinerary" },
      });
      if (itinGate.blocked) {
        setMsgs((prev) => [
          ...prev,
          { role: "assistant", content: INSUFFICIENT_CREDITS_ITINERARY_MESSAGE },
        ]);
        setGenerating(false);
        setSelectionGenerationStatus(null);
        return;
      }
      itinCreditsHandle = itinGate.handle;
    }
    if (isPlanningSelectionMode(activeSession)) {
      console.info("[PLANNING_SELECTION_CREDITS_READY]", {
        sessionId: selectionSessionId,
        elapsedMs: Date.now() - selectionStartedAt,
        selectedCount: selectionSelectedCount,
        destination: selectionDestination,
        reserved: Boolean(itinCreditsHandle),
      });
      logSelectionStage("credits_reserved", true);
    }

    if (!isPlanningSelectionMode(activeSession)) setGenerating(true);
    logAiState("CREATING_TRIP");
    persistSession({ ...activeSession, phase: "generating", aiItineraryState: "CREATING_TRIP" });

    try {
      logSelectionStage("trip_context_start", true);
      logSelectionStage("start_place_resolve_start", true);
      logSelectionStage(
        "start_place_resolve_done",
        true,
        activeSession.tripOrigin ? "resolved_from_session" : "optional_not_provided",
      );
      logSelectionStage("destination_resolve_start", true);
      logSelectionStage(
        "destination_resolve_done",
        Boolean(activeSession.tripDestination || activeSession.travelContext?.destination),
        activeSession.tripDestination || activeSession.travelContext?.destination
          ? "resolved_from_generate_snapshot"
          : "destination_missing_from_snapshot",
      );
      logSelectionStage("weather_start", true);
      const bundle = activeSession.tripDestination
        ? await buildContextBundleForTrip(activeSession.tripDestination, fetchWeather, {
            weatherBlocking: !isPlanningSelectionMode(activeSession),
          })
        : await buildClientContextBundle(fetchWeather);
      logSelectionStage(
        "weather_done",
        true,
        bundle.weather ? "weather_available" : "weather_unavailable_optional",
      );
      logSelectionStage("trip_context_done", true, "context_ready");
      logSelectionStage("session_prepare_start", true);
      const selectionModeForPrepare = isPlanningSelectionMode(activeSession);
      const [prefs, profile] = selectionModeForPrepare
        ? [bundle.preferences, null]
        : await Promise.all([getAiPreferences(), getUserProfile()]);
      const fashionStyle = resolveFashionStyle({
        travelStyle: profile?.travelStyle,
        interests: prefs.interests,
        style: activeSession.tripStyles || (activeSession.pace === "排滿" ? "緊湊" : "慢旅行"),
      });
      let workingSession = activeSession;
      let places = buildTripFromSelectedPlaces(workingSession);
      const today = new Date().toISOString().slice(0, 10);
      const tripDays = workingSession.tripDays ?? 1;
      const rawDestination =
        (workingSession.tripDestination
          ? formatTripLocationLabel(workingSession.tripDestination)
          : null) ||
        workingSession.travelContext?.destination?.trim() ||
        inferDestinationFromPlaces(places, bundle.location) ||
        bundle.location.city ||
        "目前位置";
      const destination = sanitizeDestinationForGeocode(rawDestination);
      const dayPlan = workingSession.currentDayPlan;
      const lastUserText = [...activeMsgs].reverse().find((m) => m.role === "user")?.content ?? "";
      const selectionDateAuthority = isPlanningSelectionMode(workingSession)
        ? resolvePlanningSelectionDateAuthority(workingSession)
        : null;
      const tripDates = selectionDateAuthority
        ? {
            startDate: selectionDateAuthority.startDate,
            endDate: selectionDateAuthority.endDate,
            days: selectionDateAuthority.tripDays,
            dayDates: selectionDateAuthority.dayDates,
            hasExplicitDates: true,
            source: selectionDateAuthority.source,
          }
        : resolveTripCreateDates({
            context: workingSession.travelContext ?? { interests: [] },
            session: workingSession,
            days: tripDays,
            userText: lastUserText,
          });
      if (isPlanningSelectionMode(workingSession)) {
        logPlanningSelectionDateAuthority(
          "planner_input",
          selectionDateAuthority,
          workingSession.planningSelection?.id,
        );
      }
      logAiCreateTripDates(tripDates);
      const effectiveTripDays = Math.max(1, tripDates.days || tripDays || 1);
      if (
        workingSession.tripDays !== effectiveTripDays ||
        workingSession.travelContext?.days !== effectiveTripDays ||
        (tripDates.startDate && workingSession.travelContext?.startDate !== tripDates.startDate) ||
        (tripDates.endDate && workingSession.travelContext?.endDate !== tripDates.endDate)
      ) {
        workingSession = {
          ...workingSession,
          tripDays: effectiveTripDays,
          tripStartDate: tripDates.startDate ?? workingSession.tripStartDate,
          tripEndDate: tripDates.endDate ?? workingSession.tripEndDate,
          travelContext: workingSession.travelContext
            ? {
                ...workingSession.travelContext,
                days: effectiveTripDays,
                startDate: tripDates.startDate ?? workingSession.travelContext.startDate,
                endDate: tripDates.endDate ?? workingSession.travelContext.endDate,
              }
            : workingSession.travelContext,
        };
      }

      if (
        places.length < 1 &&
        !dayPlan?.items.length &&
        effectiveTripDays > 0 &&
        destination !== "目前位置"
      ) {
        const prepared = await prepareDirectItinerarySession({
          session: workingSession,
          context: {
            ...(workingSession.travelContext ?? { interests: [] }),
            destination,
            days: effectiveTripDays,
          },
          locale,
          searchPlaces: searchNearbyPlaces,
          geocodeFn: geocodeLocationFn,
          fetchWeatherFn: fetchWeather,
          excludePlaceIds: collectExcludePlaceIds(workingSession),
          msgs: activeMsgs,
        });
        if (!prepared.ok) {
          logItineraryFailureReason(prepared.message);
          setMsgs((prev) => [...prev, { role: "assistant", content: prepared.message }]);
          if (prepared.apiEmpty) {
            toast.error(prepared.message);
          }
          persistSession({
            ...workingSession,
            phase: "ready",
            aiItineraryState: "FAILED",
            pendingQuestion: prepared.apiEmpty
              ? {
                  type: "activity_choice",
                  options: ["must_visit_places", "daily_recommendations"],
                  baseDestination: destination,
                }
              : undefined,
          });
          return;
        }
        workingSession = prepared.session;
        places = buildTripFromSelectedPlaces(workingSession);
        persistSession(workingSession);
      }

      const startDate = tripDates.startDate ?? "";
      const endDate = tripDates.endDate ?? "";
      const budget = budgetModeToItineraryTier(resolveBudgetMode(prefs));

      let createResult: Awaited<ReturnType<typeof createItineraryFromSession>>;

      if (dayPlan?.items.length) {
        const rawItineraryItems = buildItineraryFromDayPlan(dayPlan, tripDates);
        const { applyItineraryLocalizationGate } =
          await import("@/lib/ai/itinerary-localization-gate");
        const { buildLegMinutesFromPlaces } =
          await import("@/lib/ai/estimate-place-visit-duration");
        const { resolvePlannerPaceFromProfile } = await import("@/lib/ai/required-anchor-runtime");
        const gated = applyItineraryLocalizationGate(rawItineraryItems, {
          softPassEnglish: true,
        });
        const itineraryItems = gated.items;
        verifyDayPlanItineraryOrder(dayPlan, itineraryItems);
        const itineraryDays = buildItineraryDaysFromDayPlan(dayPlan, tripDates, itineraryItems);
        for (const day of itineraryDays) {
          logAiCreateItineraryDay(day.dayIndex, day.date, day.items.length);
        }
        const recommendations = dayPlanToRecommendations(dayPlan);
        const pace = resolvePlannerPaceFromProfile({
          style: resolvePlannerStyleKey(
            workingSession.tripStyles || (workingSession.pace === "排滿" ? "緊湊" : "慢旅行"),
          ),
          quizPace:
            workingSession.pace === "慢旅" || workingSession.pace === "慢旅行"
              ? "slow"
              : workingSession.pace === "排滿"
                ? "active"
                : "medium",
        });
        createResult = {
          ok: true,
          state: "SUCCESS",
          session: { ...workingSession, aiItineraryState: "SUCCESS", phase: "generating" },
          payload: {
            version: 2,
            title: `${destination} ${effectiveTripDays} 天`,
            summary: `依你選的 ${dayPlan.items.length} 個地點排成 ${effectiveTripDays} 天行程。`,
            moodTag: workingSession.mood ?? "",
            recommendations,
            itinerary: itineraryItems,
            destination,
            days: effectiveTripDays,
            dayPlan,
            itineraryDays,
            tripSettings: {
              tripStartDate: startDate || undefined,
              tripEndDate: endDate || undefined,
              legMinutes: buildLegMinutesFromPlaces(itineraryItems, pace),
            },
            generatedAt: new Date().toISOString(),
          },
          generateResult: { success: true },
        };
      } else {
        const selectionMode = isPlanningSelectionMode(workingSession);
        const requiredAnchors = buildPlannerRequiredAnchors(places, destination, selectionMode);
        const requiredAnchorIds = requiredAnchors.map(
          (place) => place.googlePlaceId?.trim() || `(name:${place.name})`,
        );
        logSelectionStage(
          "session_prepare_done",
          requiredAnchors.length > 0,
          requiredAnchors.length ? "" : "required_anchor_adapter_empty",
        );
        console.info("[PLANNING_SELECTION_PLANNER_INPUT]", {
          destination,
          startDate: startDate || today,
          endDate: endDate || startDate || today,
          tripDays: effectiveTripDays,
          requiredPlaceCount: requiredAnchors.length,
          requiredPlaceIds: requiredAnchorIds,
          requiredPlaceNames: requiredAnchors.map((place) => place.name),
          combinationInputPresent: Boolean(
            workingSession.travelContext?.selectedCombinationIds?.length,
          ),
          optionsInputPresent: Boolean(workingSession.travelContext?.nearbyExtensions?.length),
          generationEntryPoint: "createItineraryFromSession",
          selectionMode,
        });
        const generateInput = {
          destination,
          days: effectiveTripDays,
          budget,
          style: resolvePlannerStyleKey(
            workingSession.tripStyles || (workingSession.pace === "排滿" ? "緊湊" : "慢旅行"),
          ),
          mood: workingSession.mood ?? "",
          interests: buildConversationSummary(workingSession, activeMsgs),
          conversationSummary: buildConversationSummary(workingSession, activeMsgs),
          startDate: startDate || today,
          endDate: endDate || startDate || today,
          origin: workingSession.tripOrigin
            ? formatTripLocationLabel(workingSession.tripOrigin)
            : (bundle.location.city ?? ""),
          travelers: workingSession.tripCompanionCount ?? 1,
          transport: workingSession.transportation ?? "",
          placeAuthority: selectionMode ? ("selected_only" as const) : undefined,
          // InputSchema's transform keeps `types` as an explicit (possibly
          // undefined) field, so mirror that exact planner boundary shape.
          selectedPlaces: requiredAnchors.map((anchor) => ({
            ...anchor,
            types: anchor.types,
          })),
          selectedCombinationIds: workingSession.travelContext?.selectedCombinationIds ?? [],
          nearbyExtensions: workingSession.travelContext?.nearbyExtensions ?? [],
          excludedCategories:
            workingSession.excludedCategories ??
            workingSession.travelContext?.excludedCategories ??
            [],
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: workingSession.startTime || bundle.time,
          fashionStyle: fashionStyle ?? "",
          locale,
          generationStartedAt: selectionMode ? selectionStartedAt : undefined,
          generationTimingId: selectionMode ? selectionSessionId : undefined,
        };

        logAiState("BUILDING_ITINERARY", `places=${places.length}`);
        logSelectionStage("planner_handoff_start", true);
        logSelectionTiming("planner_input_ready");
        setSelectionGenerationStatus("正在安排每天的順序…");
        logSelectionTiming("server_request_start");
        logPlanningSelectionDateAuthority(
          "server_request",
          selectionDateAuthority,
          workingSession.planningSelection?.id,
        );
        createResult = await createItineraryFromSession({
          session: workingSession,
          generateInput,
          generateItineraryFn: generate,
        });
        logSelectionTiming(
          "server_response_received",
          createResult.ok,
          createResult.ok ? "" : createResult.message,
        );
      }

      if (!createResult.ok) {
        logItineraryFailureReason(createResult.message);
        setMsgs((prev) => [...prev, { role: "assistant", content: createResult.message }]);
        if (createResult.offerMustVisit) {
          toast.error(createResult.message);
        }
        persistSession(createResult.session);
        return;
      }

      let itinerary = createResult.payload;
      if (selectionDateAuthority) {
        logPlanningSelectionDateMismatch(
          "server_result",
          selectionDateAuthority,
          itinerary,
          workingSession.planningSelection?.id,
        );
        itinerary = applyPlanningSelectionDateAuthority(itinerary, selectionDateAuthority);
        logPlanningSelectionDateAuthority(
          "server_result",
          selectionDateAuthority,
          workingSession.planningSelection?.id,
        );
      }
      if (isPlanningSelectionMode(activeSession)) {
        setSelectionGenerationStatus("正在確認路線與行程…");
      }

      const itineraryStops = coalesceItineraryItems(itinerary.itinerary);
      logItineraryItemsCoalesced(itineraryStops.length);
      const legPlaces = itineraryStops
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
      // Directions and remote cover are recoverable enrichment. Persist the
      // authoritative itinerary first, then enrich the same saved row in background.
      const routeLegs: Awaited<ReturnType<typeof getTripLegsWithDurations>> = [];
      const weatherSummary = bundle.weather
        ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}C`
        : "天氣資料暫不可用";
      const outfitSuggestion = tripDates.hasExplicitDates
        ? generateOutfitSuggestion(
            {
              destinationPlace: { name: destination },
              startDate,
              endDate,
              transportMode: workingSession.transportation ?? "walk",
            },
            normalizeWeather(bundle.weather),
          )
        : "";
      const cover = getImmediateTripCoverImage();

      logSelectionTiming("stored_itinerary_start");
      let draftPayload: RoamiePayloadV2 = {
        ...itinerary,
        itinerary: itineraryStops,
        userSaved: false,
        weatherSummary,
        outfitSuggestion,
        aiGeneratedCoverImageUrl: cover.url,
        tripSettings: {
          ...itinerary.tripSettings,
          tripStartDate: tripDates.hasExplicitDates ? startDate : undefined,
          tripEndDate: tripDates.hasExplicitDates ? endDate : undefined,
          transport: /開車|自駕|租車|drive/i.test(workingSession.transportation ?? "")
            ? "drive"
            : workingSession.transportation === "大眾運輸"
              ? "transit"
              : workingSession.transportation === "機車"
                ? "scooter"
                : "walk",
          transitLegs: Object.fromEntries(
            routeLegs.map((leg, idx) => [
              `${itineraryStops[idx]?.placeName ?? idx}→${itineraryStops[idx + 1]?.placeName ?? idx + 1}`,
              {
                headline: `${leg.distanceMeters}m`,
                durationMinutes: leg.durationMinutes,
                distanceMeters: leg.distanceMeters,
              },
            ]),
          ),
        },
      };
      const coreDraft: CoreTrip = toCoreTrip({
        id: "draft",
        title: draftPayload.title,
        custom_title: null,
        is_title_customized: false,
        mood: draftPayload.moodTag ?? null,
        cover_image: cover.url,
        cover_image_url: null,
        custom_cover_image_url: null,
        is_cover_customized: false,
        cover_source: "unsplash",
        cover_query: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload: draftPayload,
      });
      draftPayload = attachCoreTripToPayload(draftPayload, coreDraft);
      devVerboseInfo("[CORE_TRIP] created", "draft");
      logItinerarySavePayloadReady(destination, effectiveTripDays, itineraryStops.length);
      logItinerarySaveStart();
      try {
        saveDraftTrip(draftPayload);
        logItinerarySaveSuccess("draft");
      } catch (saveError) {
        const reason = saveError instanceof Error ? saveError.message : String(saveError);
        logItinerarySaveFailed(reason);
        devVerboseInfo("[ITINERARY_SAVE_FAILED_REASON]", reason);
        logItineraryFailureReason(`draft_save:${reason}`);
        throw saveError;
      }
      logSelectionTiming("stored_itinerary_done");
      logPlanningSelectionDateAuthority(
        "stored_itinerary",
        selectionDateAuthority,
        workingSession.planningSelection?.id,
      );

      if (isPlanningSelectionMode(activeSession)) {
        setSelectionGenerationStatus("快完成了…");
      }
      logSelectionTiming("save_start");
      const saved = await confirmSaveTrip(draftPayload, "chat", {
        coverMeta: {
          cover_image: cover.url,
          cover_source: cover.source,
          cover_query: cover.query,
        },
      });
      logSelectionTiming("save_done");
      logPlanningSelectionDateAuthority(
        "render_model",
        selectionDateAuthority,
        workingSession.planningSelection?.id,
      );
      clearDraftTrip();
      if (workingSession.fromPlanAi || workingSession.planAiMode) {
        clearPlanFormDraft();
      }
      logItinerarySaveSuccess(saved.id);
      logAiItinerarySuccess(saved.id);
      logAiCreateTripSuccess(saved.id);
      logAiPipeline(
        "[ITINERARY_RESULT_TRACE]",
        "plannerSuccess=true",
        "itineraryPresent=true",
        `dayCount=${effectiveTripDays}`,
        `stopCount=${itineraryStops.length}`,
        "persistenceAttempted=true",
        "persistenceSuccess=true",
        "finalFailureReason=",
      );

      logTripNav("ChatGeneratedItinerary", saved.id);
      itinerarySucceeded = true;
      // Credit commit is authoritative, not optional enrichment. Settle exactly
      // once before leaving Chat; failure paths still roll back in finally.
      await settleCreditsOperation(itinCreditsHandle, true);
      itinCreditsHandle = null;
      logSelectionTiming("credits_committed");
      logSelectionTiming("navigation_start");
      const navigation = navigate(tripDetailNavigateOptions(saved.id));
      await Promise.resolve(navigation);
      logSelectionTiming("navigation_done");

      // Chat/workspace cleanup is not required for itinerary detail first paint.
      window.setTimeout(() => {
        persistSession(
          clearPlanningSessionState(
            {
              ...workingSession,
              phase: "done",
              aiItineraryState: "SUCCESS",
              draftTrip: undefined,
              lastGeneratedTripId: saved.id,
            },
            "trip_created",
          ),
        );
      }, 0);

      // Enrich the already-authoritatively-saved row without holding navigation.
      void Promise.allSettled([
        getTripLegsWithDurations(
          legPlaces,
          travelLabelToRoutesMode(workingSession.transportation ?? "步行"),
        ),
        getTripCoverImage({
          destination,
          mood: workingSession.mood ?? "",
          moodTag: workingSession.mood ?? "",
          title: itinerary.title,
        }),
      ])
        .then(async ([legsResult, coverResult]) => {
          const enrichedLegs = legsResult.status === "fulfilled" ? legsResult.value : [];
          const enrichedCover = coverResult.status === "fulfilled" ? coverResult.value : cover;
          const persistedPayload = saved.payload as RoamiePayloadV2;
          const enrichedPayload: RoamiePayloadV2 = {
            ...persistedPayload,
            aiGeneratedCoverImageUrl: enrichedCover.url,
            tripSettings: {
              ...persistedPayload.tripSettings,
              transitLegs: Object.fromEntries(
                enrichedLegs.map((leg, idx) => [
                  `${itineraryStops[idx]?.placeName ?? idx}→${itineraryStops[idx + 1]?.placeName ?? idx + 1}`,
                  {
                    headline: `${leg.distanceMeters}m`,
                    durationMinutes: leg.durationMinutes,
                    distanceMeters: leg.distanceMeters,
                  },
                ]),
              ),
            },
          };
          await updateTripMeta(
            saved.id,
            {
              cover_image: enrichedCover.url,
              cover_source: enrichedCover.source,
              cover_query: enrichedCover.query,
            },
            enrichedPayload,
          );
        })
        .catch((error) => {
          console.debug("[ITINERARY_BACKGROUND_ENRICHMENT]", {
            success: false,
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logSelectionStage(selectionGenerateStage, false, reason);
      console.warn("[ITINERARY_GENERATE]", e);
      logItinerarySaveFailed(reason);
      logItineraryFailureReason(`generate_exception:${reason}`);
      persistSession({
        ...activeSession,
        phase: "ready",
        aiItineraryState: "FAILED",
        pendingQuestion: {
          type: "activity_choice",
          options: ["must_visit_places", "daily_recommendations"],
          baseDestination:
            activeSession.tripDestination?.city ?? activeSession.travelContext?.destination,
        },
      });
      setMsgs((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `${ITINERARY_GENERATION_FAILED_MESSAGE}\n\n點選「重新生成」可沿用目前目的地與日期再試一次。`,
        },
      ]);
      // Keep a single error surface — chat card only (no duplicate toast).
    } finally {
      // Render settlement is local; credits still settle through the existing
      // authority and never change Selection pricing/entitlement semantics.
      setGenerating(false);
      setSelectionGenerationStatus(null);
      await settleCreditsOperation(itinCreditsHandle, itinerarySucceeded);
      itinCreditsHandle = null;
      if (isPlanningSelectionMode(activeSession)) {
        console.info("[PLANNING_SELECTION_GENERATE_SETTLED]", {
          sessionId: selectionSessionId,
          elapsedMs: Date.now() - selectionStartedAt,
          selectedCount: selectionSelectedCount,
          destination: selectionDestination,
          success: itinerarySucceeded,
          creditsSettled: true,
          loadingCleared: true,
        });
      }
    }
  };

  runDirectItineraryRef.current = async (
    activeSession: ChatPlanningSession,
    context: CanonicalTravelContext,
    conversation: ChatMsg[],
  ) => {
    if (activeGenerationRequestIdRef.current) {
      console.info(
        "[ITINERARY_REQUEST_BLOCKED]",
        "reason=already_generating",
        `active=${activeGenerationRequestIdRef.current}`,
      );
      return;
    }
    const generationRequestId =
      context.generationRequestId?.trim() ||
      `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    activeGenerationRequestIdRef.current = generationRequestId;
    const contextWithRequest = { ...context, generationRequestId };

    if (!ensureSubscriptionHydratedForCredits(conversation)) {
      activeGenerationRequestIdRef.current = null;
      return;
    }
    const itinGate = await beginItineraryGenerationCredits({
      hasPlusAccess,
      requestId: generationRequestId,
      metadata: { path: "direct_itinerary" },
    });
    if (itinGate.blocked) {
      activeGenerationRequestIdRef.current = null;
      setMsgs([
        ...conversation,
        { role: "assistant", content: INSUFFICIENT_CREDITS_ITINERARY_MESSAGE },
      ]);
      return;
    }
    let itinCreditsHandle: CreditsOperationHandle | null = itinGate.handle;

    setStreaming(true);
    setGenerating(true);
    try {
      const prepared = await prepareDirectItineraryFlow({
        session: activeSession,
        context: contextWithRequest,
        locale,
        searchPlaces: searchNearbyPlaces,
        geocodeFn: geocodeLocationFn,
        fetchWeatherFn: fetchWeather,
        excludePlaceIds: collectExcludePlaceIds(activeSession),
        msgs: conversation,
        fetchPlaceDetails: async (placeId) => {
          const result = await fetchPlaceDetailsFn({ data: { placeId, locale } });
          return result.place;
        },
      });
      if (!prepared.ok) {
        await settleCreditsOperation(itinCreditsHandle, false);
        itinCreditsHandle = null;
        logItineraryFailureReason(
          prepared.diagnostics ? JSON.stringify(prepared.diagnostics) : prepared.failureReason,
        );
        setGenerating(false);
        setStreaming(false);
        const failedSession = {
          ...prepared.session,
          chatPlanningState: "generationFailed" as const,
          pendingQuestion: prepared.session.pendingQuestion ?? {
            type: "activity_choice" as const,
            options: ["重新生成", "must_visit_places", "daily_recommendations"],
            baseDestination: context.destination,
          },
          travelContext: {
            ...(prepared.session.travelContext ?? { interests: [] }),
            ...contextWithRequest,
            generationRequestId,
          },
        };
        if (lastFailureGenerationRequestIdRef.current === generationRequestId) {
          console.info(
            "[ITINERARY_FAILURE_MESSAGE_DEDUPED]",
            `generationRequestId=${generationRequestId}`,
          );
          persistSession(failedSession);
          return;
        }
        lastFailureGenerationRequestIdRef.current = generationRequestId;
        setMsgs([
          ...conversation,
          {
            role: "assistant",
            content: prepared.message.includes("重新生成")
              ? prepared.message
              : `${prepared.message}\n\n點選「重新生成」可沿用目前目的地與日期再試一次。`,
          },
        ]);
        persistSession(failedSession);
        return;
      }
      persistSession(prepared.session);
      await handleGenerateItinerary(prepared.session, conversation, itinCreditsHandle);
      itinCreditsHandle = null;
      lastFailureGenerationRequestIdRef.current = null;
    } catch (e) {
      await settleCreditsOperation(itinCreditsHandle, false);
      itinCreditsHandle = null;
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(
        "[ITINERARY_DIRECT_GEN_ERROR]",
        `generationRequestId=${generationRequestId}`,
        reason,
        e instanceof Error ? e.stack : undefined,
      );
      logItineraryFailureReason(`direct_gen:${reason}`);
      setGenerating(false);
      if (lastFailureGenerationRequestIdRef.current === generationRequestId) {
        console.info(
          "[ITINERARY_FAILURE_MESSAGE_DEDUPED]",
          `generationRequestId=${generationRequestId}`,
        );
      } else {
        lastFailureGenerationRequestIdRef.current = generationRequestId;
        setMsgs([
          ...conversation,
          {
            role: "assistant",
            content: `${ITINERARY_GENERATION_FAILED_MESSAGE}\n\n點選「重新生成」可沿用目前目的地與日期再試一次。`,
          },
        ]);
      }
      persistSession({
        ...activeSession,
        phase: "ready",
        aiItineraryState: "FAILED",
        chatPlanningState: "generationFailed",
        pendingQuestion: {
          type: "activity_choice",
          options: ["重新生成", "must_visit_places", "daily_recommendations"],
          baseDestination: context.destination,
        },
        travelContext: {
          ...(activeSession.travelContext ?? { interests: [] }),
          ...contextWithRequest,
          generationRequestId,
        },
      });
    } finally {
      activeGenerationRequestIdRef.current = null;
      setStreaming(false);
      setGenerating(false);
    }
  };

  const retry = async () => {
    if (!lastFailed || streaming) return;
    await streamChat(lastFailed);
  };

  const confirmClearChat = async () => {
    if (streaming || generating || clearing) return;
    setClearing(true);
    try {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setGenerating(false);

      const recId = session.recommendationId;
      const previous = session;
      await clearChatHistory();
      clearChatSession();
      clearChatUiCache();
      clearDraftTrip();
      clearMoodHandoffStorage(recId);
      handoffStartedRef.current = null;
      chatLifecycleEstablishedRef.current = false;
      restoredWorkspaceIdRef.current = null;

      navigate({
        to: "/chat",
        search: { from: undefined, recommendationId: undefined, fromMoodFlow: undefined },
        replace: true,
      });

      const fresh = beginNewChatSession({
        reason: "chat_reset",
        previous,
        hasPlusAccess,
      });
      persistSession(fresh);
      chatLifecycleEstablishedRef.current = true;
      restoredWorkspaceIdRef.current = null;
      setMsgs([greetingMsg]);
      setLastFailed(null);
      setPartial({});
      setText("");
      setClearDialogOpen(false);
    } catch {
      toast.error("清空失敗");
    } finally {
      setClearing(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      ref={pageRef}
      className="messenger-chat-root chat-page relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header
        ref={headerRef}
        className="messenger-chat-header relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur"
      >
        <BackButton
          preferFallback
          fallback={chatBackNavigation.target}
          onBack={() => {
            logChatNavigationBack({
              entrySource: chatBackNavigation.entrySource,
              resolvedReturnRoute: chatBackNavigation.target.to,
              method: "button",
            });
            if (chatBackNavigation.usedFallback && chatBackNavigation.reason) {
              logChatNavigationFallback({
                entrySource: chatBackNavigation.entrySource,
                reason: chatBackNavigation.reason,
                fallbackRoute: chatBackNavigation.target.to,
              });
            }
          }}
          label={
            chatBackNavigation.entrySource === "trip_detail"
              ? "返回行程"
              : chatBackNavigation.entrySource === "travel_draft"
                ? "返回"
                : chatBackNavigation.entrySource === "plan"
                  ? t("chat.backToPlan")
                  : t("chat.backToHome")
          }
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <RoamieAssistantAvatar className="h-9 w-9" showOnlineIndicator />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-tight">Roamie</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {generating
                ? (selectionGenerationStatus ?? t("chat.statusGenerating"))
                : streaming
                  ? t("chat.statusStreaming")
                  : session.selectedPlaces.length
                    ? t("chat.statusSelectedPlaces", { count: session.selectedPlaces.length })
                    : t("chat.statusDefault")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setClearDialogOpen(true)}
          disabled={streaming || generating || clearing}
          className="relative z-20 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("chat.clearAria")}
          title="清除對話"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </header>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>要清除這段聊天嗎？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm text-muted-foreground">
                <p>清除後目前對話內容會被移除，但不會影響已儲存的行程。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-end">
            <AlertDialogCancel disabled={clearing} className="mt-0 flex-1 sm:flex-none">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none"
              onClick={(e) => {
                e.preventDefault();
                void confirmClearChat();
              }}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : "清除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="messenger-chat-body flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={messagesRef}
          data-keyboard-scroll-root
          className="messenger-chat-messages chat-messages min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5"
          style={{
            flex: "1 1 0%",
            paddingBottom: `${Math.max(messengerLayout.messagesPaddingBottomPx, 0)}px`,
            transition: messengerLayout.keyboardOpen
              ? "padding-bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)"
              : undefined,
          }}
        >
          {hasPlusAccess &&
            travelPrefStatus !== null &&
            !travelPrefStatus.preferenceQuizCompleted &&
            shouldShowTripAddPlacePlusUpsell(session) && (
              <PreferenceQuizCta origin="chat" variant="banner" className="animate-rise" />
            )}
          <ChatMessageList
            msgs={msgs}
            hydrating={hydrating}
            streaming={streaming}
            generating={generating}
            suppressPlaceCards={suppressPlaceCards}
            loadingIndicator={chatLoading}
            partial={partial}
            selectedNames={selectedNames}
            savedNames={savedNames}
            savingName={savingName}
            addToTripLabel={
              selectionMode
                ? "加入這地點"
                : session.fromTripAddPlace
                  ? "加入此行程"
                  : t("chat.addToTrip")
            }
            discussPlaceLabel={t("trip.discussPlace")}
            viewMapLabel={t("chat.viewMap")}
            selectionMode={selectionMode}
            onRecommendationEngage={markShortcutEngaged}
            onSavePlace={(rec) => {
              void handleSavePlace(rec);
            }}
            onAddToTrip={(rec) => {
              if (selectionMode) {
                persistSession(
                  togglePlanningSelectionPlace(sessionRef.current, roamieRecToChatItem(rec)),
                );
              } else {
                void handleAddToTripFromChat(rec);
              }
            }}
            onOpenPlaceDetail={handleOpenPlaceDetail}
            onDiscussPlace={(rec) => {
              void handleDiscussPlace(rec);
            }}
          />
          {lastFailed && !streaming && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80"
              >
                <RotateCcw className="h-3 w-3" /> 重新嘗試
              </button>
            </div>
          )}
          <div ref={bottomAnchorRef} aria-hidden className="h-px w-full shrink-0" />
        </div>

        <div
          ref={composerRef}
          className={cn(
            "messenger-chat-composer",
            messengerLayout.keyboardOpen && "messenger-chat-composer--keyboard-open",
          )}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            marginInline: "auto",
            maxWidth: "440px",
            bottom: `${messengerLayout.composerBottomPx}px`,
            zIndex: 45,
            transition: messengerLayout.keyboardOpen
              ? "bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)"
              : undefined,
          }}
        >
          <ChatComposer
            text={text}
            onTextChange={setText}
            onSend={() => void send()}
            onKeyDown={handleKey}
            onFocus={() => {
              scrollToBottom("keyboard_did_show");
            }}
            disabled={streaming || generating}
            showShortcutChips={showShortcutChips}
            keyboardOpen={keyboardVisible}
            inputRef={inputRef}
            generating={generating}
            streaming={streaming}
            onChipSend={(s) => void send(s, { source: "chat_shortcut" })}
            actionChips={actionChips}
            actionChipsOnly={selectionMode}
          />
        </div>
      </div>
      {isChatKeyboardDebugEnabled() ? (
        <ChatKeyboardDebugOverlay
          active={keyboardVisible}
          composerShellRef={composerRef}
          nativeKeyboardHeightPx={messengerLayout.nativeKeyboardHeightPx}
        />
      ) : null}
    </div>
  );
}
