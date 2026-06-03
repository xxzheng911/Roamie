import type { Locale } from "@/lib/i18n/types";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  generateItineraryViaBundledApi,
  shouldUseBundledGenerateItineraryApi,
} from "@/lib/generate-itinerary-api";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import { buildLocalItineraryFallback, isAiItineraryServiceUnavailableError } from "@/lib/ai/local-itinerary-fallback";
import { confirmSaveTrip, type StoredItinerary, type TripCoverMeta } from "@/lib/itinerary-storage";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { buildTripFromSelectedPlaces } from "@/lib/place-planning-memory";
import { normalizePlacesForItinerary } from "@/lib/trip-planning-state";
import { bootstrapPlanPlacesMinimal } from "@/lib/plan/plan-places-bootstrap";
import {
  curatedTripLocationToPlaceInput,
  resolveCuratedTripLocationByDestination,
} from "@/lib/trip-location-curated";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { preparePlanTripSession, type PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { BudgetMode, TravelPreferences } from "@/lib/preferences-storage";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { ensureSelectedPlacesInItinerary } from "@/lib/trip-planning-state";
import { attachDayPlansToPayload } from "@/lib/trip/build-day-plans";
import { getTripCoverImage } from "@/services/placeImageService";
import { getTripLegsWithDurations, travelLabelToRoutesMode } from "@/services/routesService";
import { buildOutfitInputKey, buildTripItemsFingerprint } from "@/lib/outfit/trip-outfit-context";
import { supabase } from "@/lib/supabase";
import { buildPlanFormContextForAi } from "@/lib/plan/plan-style-itinerary";
import {
  buildSafeItineraryGeneratorPayload,
  logItineraryGeneratorFailed,
  logItinerarySafePayloadReady,
} from "@/lib/trip/safe-itinerary-payload";
import {
  appendPlusMemoryToSummary,
  resolvePlusMemoryForItinerary,
} from "@/lib/ai/plus-memory-for-itinerary";
import {
  logPlanAiBeforeOpenai,
  logPlanAiError,
  logPlanAiOpenAiRequestStart,
  logPlanAiOpenAiResponseReceived,
  logPlanAiParseSuccess,
  logPlanAiSaveSuccess,
  logPlanAiTripCreated,
} from "@/lib/plan/plan-ai-generation-log";
import { withTimeout } from "@/lib/async/with-timeout";
import { PLAN_AI_SAVE_TIMEOUT_MS } from "@/lib/plan/plan-flow-timeouts";
import {
  logItineraryCreated,
  logOpenAiRequest,
  logOpenAiResponse,
  logTripGenerationContext,
  logTripGenerationError,
  logTripGenerationStart,
  logTripSaveSuccess,
} from "@/lib/trip/trip-generation-log";

export type PlanItineraryProgressStep =
  | "context"
  | "places"
  | "weather"
  | "generate"
  | "save";

export type GenerateItineraryFromPlanDeps = {
  locale: Locale;
  searchNearbyPlaces: SearchPlacesFn;
  generateItinerary: (input: { data: ItineraryInput }) => Promise<{ itinerary?: RoamiePayloadV2 }>;
};

export type GenerateItineraryFromPlanOptions = {
  /** 已送出 OpenAI 請求時回呼（用於解除 pre-OpenAI watchdog） */
  onOpenAiRequestStart?: () => void;
};

function buildPlanConversationSummary(form: PlanTripFormInput): string {
  const destLabel = formatTripLocationLabel(form.destination);
  const originLabel = form.origin ? formatTripLocationLabel(form.origin) : null;
  return buildPlanFormContextForAi({
    destinationLabel: destLabel,
    originLabel,
    startDate: form.startDate,
    endDate: form.endDate,
    days: form.days,
    travelers: form.travelers,
    budgetMode: form.budgetMode,
    transport: form.transport,
    styles: form.styles,
  });
}

export async function generateAndSaveItineraryFromPlan(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  prefs: TravelPreferences,
  deps: GenerateItineraryFromPlanDeps,
  sessionOverride?: ChatPlanningSession,
  onProgress?: (step: PlanItineraryProgressStep) => void,
  options?: GenerateItineraryFromPlanOptions,
): Promise<StoredItinerary> {
  logTripGenerationStart("plan_form");
  logTripGenerationContext(form);
  onProgress?.("context");

  let session =
    sessionOverride ??
    preparePlanTripSession(form, bundle, prefs, { skipOriginValidation: true });
  session = {
    ...session,
    phase: "ready",
    tripStyles: form.styles.length ? form.styles.join("、") : session.tripStyles,
    transportation: form.transport || session.transportation,
    budget: form.budgetMode,
  };

  console.info("[ITINERARY_CONTEXT_READY]", {
    destination: formatTripLocationLabel(form.destination),
    days: form.days,
    styles: form.styles,
  });

  onProgress?.("places");
  session = bootstrapPlanPlacesMinimal(session, form);

  let rawPlaces = buildTripFromSelectedPlaces(session);
  let places = normalizePlacesForItinerary(rawPlaces);
  const destLabelEarly = formatTripLocationLabel(form.destination);
  if (places.length < 1) {
    const tripLoc =
      session.tripDestination ??
      resolveCuratedTripLocationByDestination(destLabelEarly) ??
      null;
    if (tripLoc) {
      const anchor = curatedTripLocationToPlaceInput(tripLoc);
      places = normalizePlacesForItinerary([
        {
          name: anchor.name,
          placeName: anchor.placeName,
          lat: tripLoc.lat,
          lng: tripLoc.lng,
          type: "目的地",
          address: formatTripLocationLabel(form.destination),
          description: "目的地錨點",
          reason: "規劃表單目的地",
          reasonSource: "template",
        },
      ]);
    }
  }
  if (places.length < 1) {
    logPlanAiError("no_places", new Error("無法建立行程地點"));
    throw new Error("無法建立行程地點，請稍後再試");
  }

  onProgress?.("weather");
  let fashionStyle = "";
  try {
    const profile = await withTimeout(getUserProfile(), 2_500, "plan_profile_for_outfit");
    fashionStyle =
      resolveFashionStyle({
        travelStyle: profile.travelStyle,
        interests: prefs.interests,
        style: session.tripStyles || "慢旅行",
      }) ?? "";
  } catch (e) {
    console.warn("[PLAN_AI] profile/outfit context skipped", e);
  }
  const destination =
    formatTripLocationLabel(form.destination) ||
    inferDestinationFromPlaces(places, bundle.location) ||
    bundle.location.city ||
    "目的地";
  const today = new Date().toISOString().slice(0, 10);
  const startDate = form.startDate || today;
  const endDate = form.endDate || startDate;
  const tripDays = form.days;
  const budget = budgetModeToItineraryTier(
    resolveBudgetMode({ ...prefs, budgetMode: form.budgetMode as BudgetMode }),
  );
  let summary = buildPlanConversationSummary(form);
  const styleLine = form.styles.length ? form.styles.join("、") : session.tripStyles || "";

  let plusMemBlock = "";
  try {
    const plusMem = await withTimeout(
      resolvePlusMemoryForItinerary(destination),
      3_000,
      "plan_plus_memory",
    );
    plusMemBlock = plusMem.memoryBlock;
  } catch (e) {
    console.warn("[PLAN_AI] plus memory skipped", e);
  }
  summary = appendPlusMemoryToSummary(summary, plusMemBlock);

  const generatePayload: ItineraryInput = buildSafeItineraryGeneratorPayload({
    destination,
    days: tripDays,
    budget,
    style: styleLine || "慢旅行",
    mood: "",
    interests: summary,
    conversationSummary: summary,
    startDate,
    endDate,
    origin: form.origin ? formatTripLocationLabel(form.origin) : (bundle.location.city ?? ""),
    travelers: form.travelers,
    transport: form.transport,
    selectedPlaces: places,
    preferences: prefs as ItineraryInput["preferences"],
    location: bundle.location,
    weather: bundle.weather,
    time: bundle.time,
    fashionStyle: fashionStyle ?? "",
    locale: deps.locale,
    destinationLocation: form.destination,
  });
  logItinerarySafePayloadReady(generatePayload);
  logPlanAiBeforeOpenai({
    destination,
    days: tripDays,
    selectedPlacesCount: places.length,
    bootstrapSkipped: true,
  });
  logOpenAiRequest(generatePayload);
  logPlanAiOpenAiRequestStart({
    destination,
    days: tripDays,
    style: styleLine || "慢旅行",
    transport: form.transport,
    selectedPlacesCount: places.length,
  });
  options?.onOpenAiRequestStart?.();

  onProgress?.("generate");
  await new Promise<void>((r) => setTimeout(r, 0));
  let itinerary: RoamiePayloadV2;
  let usedLocalFallback = false;
  const localFallbackInput = {
    destination,
    days: tripDays,
    startDate,
    endDate,
    mood: "",
    style: session.tripStyles || "慢旅行",
    transport: form.transport,
    selectedPlaces: places,
    weather: bundle.weather,
    destinationLocation: form.destination,
    origin: form.origin ? formatTripLocationLabel(form.origin) : (bundle.location.city ?? ""),
    travelers: form.travelers,
  };

  const applyLocalFallback = (reason: string) => {
    console.warn("[TRIP_GENERATION_ERROR] plan local fallback:", reason);
    itinerary = buildLocalItineraryFallback(localFallbackInput);
    usedLocalFallback = true;
  };

  try {
    if (shouldUseBundledGenerateItineraryApi()) {
      const { data: authSession } = await supabase.auth.getSession();
      const token = authSession.session?.access_token;
      const apiResult = await withTimeout(
        generateItineraryViaBundledApi(generatePayload, { token: token ?? undefined }),
        120_000,
        "plan_generate_itinerary_api",
      );
      if (apiResult.itinerary) {
        itinerary = apiResult.itinerary;
      } else if (
        isAiItineraryServiceUnavailableError(apiResult.error ?? "") ||
        /格式錯誤|HTTP|timeout|逾時/i.test(apiResult.error ?? "")
      ) {
        applyLocalFallback(apiResult.error ?? "bundled_api_unavailable");
      } else {
        throw new Error(apiResult.error ?? "生成行程失敗");
      }
    } else {
      try {
        const response = await withTimeout(
          deps.generateItinerary({ data: generatePayload }),
          120_000,
          "plan_generate_itinerary_server_fn",
        );
        if (!response?.itinerary) throw new Error("生成行程失敗（伺服器無回應）");
        itinerary = response.itinerary;
      } catch (genErr) {
        const genMsg = genErr instanceof Error ? genErr.message : "生成行程失敗";
        if (isAiItineraryServiceUnavailableError(genMsg) || /逾時|timeout/i.test(genMsg)) {
          applyLocalFallback(genMsg);
        } else {
          throw genErr;
        }
      }
    }
  } catch (genOuter) {
    logPlanAiError("openai", genOuter);
    logTripGenerationError("openai", genOuter);
    logItineraryGeneratorFailed("generate", genOuter);
    if (places.length > 0) {
      applyLocalFallback(genOuter instanceof Error ? genOuter.message : String(genOuter));
    } else {
      throw genOuter;
    }
  }

  logOpenAiResponse({
    title: itinerary.title,
    itemCount: itinerary.itinerary?.length ?? 0,
    dayCount: tripDays,
  });
  logPlanAiOpenAiResponseReceived({
    title: itinerary.title,
    itemCount: itinerary.itinerary?.length ?? 0,
    usedLocalFallback,
  });

  const mergedItinerary = ensureSelectedPlacesInItinerary(
    itinerary.itinerary ?? [],
    rawPlaces,
    startDate,
  );
  itinerary.itinerary = mergedItinerary;

  if (mergedItinerary.length < 1) {
    logPlanAiError("empty_itinerary", new Error("AI 回傳空行程"));
    if (!usedLocalFallback && places.length > 0) {
      itinerary = buildLocalItineraryFallback(localFallbackInput);
      itinerary.itinerary = ensureSelectedPlacesInItinerary(
        itinerary.itinerary ?? [],
        rawPlaces,
        startDate,
      );
      usedLocalFallback = true;
    }
    if ((itinerary.itinerary?.length ?? 0) < 1) {
      logTripGenerationError("empty_itinerary", new Error("AI 回傳空行程"));
      throw new Error("行程內容為空，請稍後再試");
    }
  }

  logPlanAiParseSuccess({
    itemCount: itinerary.itinerary?.length ?? 0,
    title: itinerary.title,
    usedLocalFallback,
  });

  const finalItineraryItems = itinerary.itinerary ?? [];

  logItineraryCreated({
    title: itinerary.title,
    itemCount: finalItineraryItems.length,
    days: tripDays,
  });

  const legPlaces = finalItineraryItems
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
  let routeLegs: Array<{ durationMinutes: number; distanceMeters: number }> = [];
  try {
    routeLegs = await withTimeout(
      getTripLegsWithDurations(
        legPlaces,
        travelLabelToRoutesMode(form.transport || "步行"),
      ),
      5_000,
      "plan_trip_route_legs",
    );
  } catch {
    console.warn("[PLAN_AI] route legs skipped");
  }

  const weatherSummary = bundle.weather
    ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}°C`
    : "天氣資料暫不可用";

  let coverUrl = "";
  try {
    const cover = await withTimeout(
      getTripCoverImage({
        destination,
        mood: "",
        moodTag: "",
        title: itinerary.title,
      }),
      3_000,
      "plan_trip_cover",
    );
    coverUrl = cover.url;
  } catch {
    console.warn("[PLAN_AI] cover resolve skipped");
  }

  const transportMode =
    /開車|自驾|自駕|drive|car|租車/.test(form.transport)
      ? "drive"
      : /大眾|捷運|地鐵|transit|mrt|metro/.test(form.transport)
        ? "transit"
        : /機車|scooter|摩托/.test(form.transport)
          ? "scooter"
          : "walk";

  const tripPayload = attachDayPlansToPayload({
    ...itinerary,
    version: 2,
    destination,
    destinationLocation: form.destination,
    originLocation: form.origin ?? undefined,
    days: tripDays,
    userSaved: true,
    weatherSummary,
    outfitAdvice: itinerary.outfitAdvice,
    outfitAdviceInputKey: buildOutfitInputKey({
      destination,
      startDate,
      endDate,
      dayCount: tripDays,
      itemsFingerprint: buildTripItemsFingerprint(mergedItinerary),
    }),
    aiGeneratedCoverImageUrl: coverUrl || undefined,
    tripSettings: {
      ...itinerary.tripSettings,
      tripStartDate: startDate,
      tripEndDate: endDate,
      transport: transportMode,
      transitLegs: Object.fromEntries(
        routeLegs.map((leg, idx) => [
          `${itinerary.itinerary[idx]?.placeName ?? idx}→${itinerary.itinerary[idx + 1]?.placeName ?? idx + 1}`,
          {
            headline: `${leg.distanceMeters}m`,
            durationMinutes: leg.durationMinutes,
            distanceMeters: leg.distanceMeters,
          },
        ]),
      ),
    },
  });

  onProgress?.("save");
  const coverMeta: TripCoverMeta = {
    cover_image: coverUrl || null,
    cover_source: coverUrl ? "unsplash" : null,
    cover_query: destination,
    destination_name: destination,
    normalized_destination_key: destination,
    ai_generated_destination_cover_url: coverUrl || null,
  };

  let saved: StoredItinerary;
  try {
    saved = await withTimeout(
      confirmSaveTrip(tripPayload, "plan", {
        skipCoverResolve: true,
        coverMeta,
        staged: true,
      }),
      PLAN_AI_SAVE_TIMEOUT_MS,
      "plan_save_trip",
    );
  } catch (saveErr) {
    logPlanAiError("save", saveErr);
    logTripGenerationError("save", saveErr);
    throw saveErr;
  }
  logTripSaveSuccess({ tripId: saved.id, title: saved.title });
  logPlanAiSaveSuccess({ tripId: saved.id, title: saved.title });
  logPlanAiTripCreated({ tripId: saved.id, title: saved.title });
  console.info("[ITINERARY_SAVED]", { tripId: saved.id, title: saved.title });
  return saved;
}
