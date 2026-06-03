import type { Locale } from "@/lib/i18n/types";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  generateItineraryViaBundledApi,
  shouldUseBundledGenerateItineraryApi,
} from "@/lib/generate-itinerary-api";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import { buildLocalItineraryFallback, isAiItineraryServiceUnavailableError } from "@/lib/ai/local-itinerary-fallback";
import { confirmSaveTrip, type StoredItinerary } from "@/lib/itinerary-storage";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { buildTripFromSelectedPlaces } from "@/lib/place-planning-memory";
import { normalizePlacesForItinerary } from "@/lib/trip-planning-state";
import { bootstrapCompanionTripPlaces } from "@/lib/planning/companion-itinerary-bootstrap";
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
import { buildPlanConsultantConstraintsText } from "@/lib/plan/plus-plan-consultant";
import {
  buildSafeItineraryGeneratorPayload,
  logItineraryGeneratorFailed,
  logItinerarySafePayloadReady,
} from "@/lib/trip/safe-itinerary-payload";

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

function buildPlanConversationSummary(
  session: ChatPlanningSession,
  form: PlanTripFormInput,
): string {
  const parts = [
    `【規劃新行程】目的地：${formatTripLocationLabel(form.destination)}，${form.days} 天`,
    form.styles.length ? `旅行風格：${form.styles.join("、")}` : "",
    form.transport ? `交通：${form.transport}` : "",
    `預算：${form.budgetMode}`,
    form.startDate && form.endDate ? `日期：${form.startDate}～${form.endDate}` : "",
    `旅伴：${form.travelers} 人`,
    buildPlanConsultantConstraintsText(session),
  ].filter(Boolean);
  return parts.join("\n");
}

export async function generateAndSaveItineraryFromPlan(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  prefs: TravelPreferences,
  deps: GenerateItineraryFromPlanDeps,
  sessionOverride?: ChatPlanningSession,
  onProgress?: (step: PlanItineraryProgressStep) => void,
): Promise<StoredItinerary> {
  console.info("[ITINERARY_TRIGGERED]", { path: "plan_form" });
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
  session = await bootstrapCompanionTripPlaces(session, deps.searchNearbyPlaces, deps.locale);
  await new Promise<void>((r) => setTimeout(r, 0));

  let rawPlaces = buildTripFromSelectedPlaces(session);
  let places = normalizePlacesForItinerary(rawPlaces);
  if (places.length < 1) {
    throw new Error("無法建立行程地點，請稍後再試");
  }

  onProgress?.("weather");
  const [profile] = await Promise.all([getUserProfile()]);
  const fashionStyle = resolveFashionStyle({
    travelStyle: profile.travelStyle,
    interests: prefs.interests,
    style: session.tripStyles || "慢旅行",
  });
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
  const summary = buildPlanConversationSummary(session, form);

  const generatePayload: ItineraryInput = buildSafeItineraryGeneratorPayload({
    destination,
    days: tripDays,
    budget,
    style: session.tripStyles || "慢旅行",
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

  onProgress?.("generate");
  await new Promise<void>((r) => setTimeout(r, 0));
  let itinerary: RoamiePayloadV2;
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

  try {
    if (shouldUseBundledGenerateItineraryApi()) {
      const { data: authSession } = await supabase.auth.getSession();
      const token = authSession.session?.access_token;
      const apiResult = await generateItineraryViaBundledApi(generatePayload, {
        token: token ?? undefined,
      });
      if (apiResult.itinerary) {
        itinerary = apiResult.itinerary;
      } else if (isAiItineraryServiceUnavailableError(apiResult.error ?? "")) {
        itinerary = buildLocalItineraryFallback(localFallbackInput);
      } else {
        throw new Error(apiResult.error ?? "生成行程失敗");
      }
    } else {
      try {
        const response = await deps.generateItinerary({ data: generatePayload });
        if (!response?.itinerary) throw new Error("生成行程失敗（伺服器無回應）");
        itinerary = response.itinerary;
      } catch (genErr) {
        const genMsg = genErr instanceof Error ? genErr.message : "生成行程失敗";
        if (isAiItineraryServiceUnavailableError(genMsg)) {
          itinerary = buildLocalItineraryFallback(localFallbackInput);
        } else {
          throw genErr;
        }
      }
    }
  } catch (genOuter) {
    logItineraryGeneratorFailed("generate", genOuter);
    throw genOuter;
  }

  const mergedItinerary = ensureSelectedPlacesInItinerary(
    itinerary.itinerary ?? [],
    rawPlaces,
    startDate,
  );
  itinerary.itinerary = mergedItinerary;

  console.info("[ITINERARY_JSON_CREATED]", {
    title: itinerary.title,
    items: mergedItinerary.length,
  });

  const legPlaces = mergedItinerary
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
  let routeLegs: Array<{ durationMinutes: number; distanceMeters: number }> = [];
  try {
    routeLegs = await getTripLegsWithDurations(
      legPlaces,
      travelLabelToRoutesMode(form.transport || "步行"),
    );
  } catch {
    /* optional */
  }

  const weatherSummary = bundle.weather
    ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}°C`
    : "天氣資料暫不可用";

  let coverUrl = "";
  try {
    const cover = await getTripCoverImage({
      destination,
      mood: "",
      moodTag: "",
      title: itinerary.title,
    });
    coverUrl = cover.url;
  } catch {
    /* optional */
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
  const saved = await confirmSaveTrip(tripPayload, "plan");
  console.info("[ITINERARY_SAVED]", { tripId: saved.id, title: saved.title });
  return saved;
}
