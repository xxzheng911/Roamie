import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { getPlanBudgetOptions, getPlanTransportOptions } from "@/lib/i18n/plan-form-options";
import {
  getPlanTravelStyleCards,
  resolveStyleLabelsFromIds,
} from "@/lib/i18n/plan-travel-styles";
import { Sparkles } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { daysBetweenDates } from "@/lib/fetch-context";
import {
  executePlanAiGeneration,
  fetchPlanAiBundleWithOptionalWeather,
  logPlanAiPreOpenAiWatchdog,
} from "@/lib/plan/plan-ai-flow";
import {
  executeManualTripCreate,
  loadPlanPrefsWithTimeout,
  logManualTripNavigateFailure,
} from "@/lib/plan/plan-manual-flow";
import { PLAN_PRE_OPENAI_TIMEOUT_MS } from "@/lib/plan/plan-flow-timeouts";
import { PlanItineraryGeneratingScreen } from "@/components/plan/PlanItineraryGeneratingScreen";
import { PlanTripForm } from "@/components/plan/PlanTripForm";
import type { TripLocation } from "@/lib/location/types";
import {
  isValidTripPlaceRef,
  logTripPlace,
  tripLocationToPlaceRef,
} from "@/lib/trip/trip-place-ref";
import { tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import { getWeather } from "@/lib/weather.functions";
import { resolveTripStop } from "@/lib/trip-stop-search.functions";
import { getPlaceDetails } from "@/services/placesService";
import {
  getPreferences,
  savePreferences,
  resolveBudgetMode,
  type BudgetMode,
} from "@/lib/preferences-storage";
import {
  loadItinerarySource,
  type ItinerarySourceContext,
} from "@/lib/itinerary-source";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { generateItinerary } from "@/lib/itinerary.functions";
import {
  logManualTripContextReady,
  logManualTripCreateClicked,
  logManualTripError,
  logManualTripLoadingCleared,
  logManualTripNavigate,
} from "@/lib/trip/trip-persist-log";
import { TRIP_DETAIL_ROUTE } from "@/lib/trip/trip-detail-nav";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { ITINERARY_GENERATION_FAILED_MESSAGE } from "@/lib/ai/itinerary-trigger";
import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import {
  logPlanAiBlocked,
  logPlanAiButtonClicked,
  logPlanAiContextReady,
  logPlanAiError,
  logPlanAiLoadingCleared,
  logPlanAiNavigateFailed,
  logPlanAiNavigateTrip,
} from "@/lib/plan/plan-ai-generation-log";
import { PLAN_PAGE_UI_VERSION } from "@/lib/plan/plan-page-version";
import {
  isSupabaseConnectivityError,
  SUPABASE_UNAVAILABLE_USER_MSG,
} from "@/lib/supabase-connectivity";

type PlanSearch = {
  mood?: string;
  destination?: string;
  recommendationId?: string;
  from?: string;
};

export const Route = createFileRoute("/_app/plan")({
  validateSearch: (s: Record<string, unknown>): PlanSearch => ({
    mood: typeof s.mood === "string" ? s.mood : undefined,
    destination: typeof s.destination === "string" ? s.destination : undefined,
    recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
  }),
  component: PlanPage,
});

function placesToInterestsText(places: RoamieRecommendationItem[]): string {
  return places.map((p) => p.name).join("、");
}

function PlanPage() {
  const { t, locale } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    console.info("[PLAN_PAGE] ui_version=", PLAN_PAGE_UI_VERSION, "from=", search.from ?? "direct");
    console.info("[CREATE_TRIP] screen mounted — no mood/notes sections (v2)");
  }, [search.from]);

  const fetchWeather = useServerFn(getWeather);
  const resolveStopFn = useServerFn(resolveTripStop);
  const searchPlacesServerFn = useServerFn(searchPlaces);
  const searchNearbyPlaces = useMemo(
    () => createUnifiedSearchPlacesFn(searchPlacesServerFn),
    [searchPlacesServerFn],
  );
  const generateItineraryFn = useServerFn(generateItinerary);

  const budgetOptions = useMemo(() => getPlanBudgetOptions(locale), [locale]);
  const transportOptions = useMemo(() => getPlanTransportOptions(locale), [locale]);
  const styleCards = useMemo(() => getPlanTravelStyleCards(locale), [locale]);

  const [sourceCtx, setSourceCtx] = useState<ItinerarySourceContext | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("standard");
  const [styleIds, setStyleIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [origin, setOrigin] = useState<TripLocation | null>(null);
  const [travelers, setTravelers] = useState(1);
  const [travelersCustom, setTravelersCustom] = useState(false);
  const [transport, setTransport] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingBlankTrip, setCreatingBlankTrip] = useState(false);
  const [generatingTrip, setGeneratingTrip] = useState(false);

  const isValidTravelers = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99;

  const validateDestination = (dest: TripLocation | null): boolean => {
    const destRef = dest ? tripLocationToPlaceRef(dest) : null;
    if (!isValidTripPlaceRef(destRef)) {
      logTripPlace("destination", "validation", { reason: "missing_destination" });
      toast.error(t("plan.selectPlaceFromList"));
      return false;
    }
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await loadItinerarySource(search.recommendationId);
        if (cancelled) return;
        setSourceCtx(ctx);
      } catch (e) {
        console.error("[plan] load source failed", e);
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search.recommendationId]);

  useEffect(() => {
    getPreferences().then((p) => setBudgetMode(resolveBudgetMode(p)));
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("plan-route-active");
    void runWhenCapacitorBridgeReady("plan_keyboard_hide", async () => {
      const { Keyboard } = await import("@capacitor/keyboard");
      await Keyboard.hide().catch(() => {});
    });
    return () => {
      document.documentElement.classList.remove("plan-route-active");
    };
  }, []);

  const selectedPlaces: RoamieRecommendationItem[] = sourceCtx?.selectedPlaces ?? [];

  const ensureLocationHasCoords = async (
    loc: TripLocation | null,
    role: "destination" | "start",
  ): Promise<TripLocation | null> => {
    if (!loc) return null;
    if (Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return loc;
    if (!loc.placeId?.trim()) return null;
    try {
      const label = loc.formattedName || loc.name || "";
      const { place, error } = await getPlaceDetails(loc.placeId, {
        locale,
        resolveFn: resolveStopFn,
        fallback: {
          placeId: loc.placeId,
          label,
          secondary: loc.address || "",
        },
      });
      if (!place || place.lat == null || place.lng == null) {
        console.info("[PLACES_DETAILS] error=", error ?? "missing_coordinates");
        return loc;
      }
      const patched: TripLocation = {
        ...loc,
        lat: place.lat,
        lng: place.lng,
        address: loc.address || place.address || label,
        formattedName: loc.formattedName || place.name || label,
      };
      if (role === "destination") setDestination(patched);
      if (role === "start") setOrigin(patched);
      return patched;
    } catch (error) {
      console.error("[PLACES_DETAILS] error=", error instanceof Error ? error.message : String(error));
      return loc;
    }
  };

  const buildFormInput = (
    resolvedDestination: TripLocation,
    resolvedOrigin: TripLocation | null,
    tripDays: number,
  ): PlanTripFormInput => {
    const styleLabels = resolveStyleLabelsFromIds(locale, styleIds);
    return {
      destination: resolvedDestination,
      origin: resolvedOrigin,
      days: tripDays,
      mood: "",
      styles: styleLabels,
      interests: selectedPlaces.length ? placesToInterestsText(selectedPlaces) : "",
      startDate,
      endDate,
      departureTime: "",
      travelers,
      transport: transport.trim(),
      budgetMode,
      selectedPlaces: selectedPlaces.length > 0 ? selectedPlaces : undefined,
    };
  };

  const handleCreateTrip = async () => {
    logManualTripCreateClicked();
    setCreatingBlankTrip(true);

    try {
      const resolvedDestination = destination;
      const destRef = resolvedDestination
        ? tripLocationToPlaceRef(resolvedDestination)
        : null;
      if (!isValidTripPlaceRef(destRef)) {
        logTripPlace("destination", "validation", { reason: "create_trip_missing_destination" });
        toast.error(t("plan.enterDestinationFirst"));
        return;
      }
      if (!isValidTravelers(travelers)) {
        toast.error(t("plan.invalidTravelers"));
        return;
      }
      if (startDate && endDate && endDate < startDate) {
        toast.error(t("plan.dateInvalid"));
        return;
      }

      const tripDays = startDate && endDate ? daysBetweenDates(startDate, endDate) : 2;
      const form = buildFormInput(
        resolvedDestination!,
        origin ?? resolvedDestination!,
        tripDays,
      );
      logManualTripContextReady({
        destination: form.destination.displayLabel || form.destination.formattedName,
        days: form.days,
        travelers: form.travelers,
        hasDates: Boolean(form.startDate && form.endDate),
      });

      const prefs = await loadPlanPrefsWithTimeout();
      void savePreferences({ ...prefs, budgetMode }).catch(() => {});

      const saved = await executeManualTripCreate(form, prefs);
      toast.success(t("plan.blankTripCreated"));
      const navOpts = tripDetailNavigateOptions(saved.id, { from: "plan", replace: true });
      try {
        await navigate(navOpts);
        logManualTripNavigate(saved.id, TRIP_DETAIL_ROUTE);
      } catch (navErr) {
        logManualTripNavigateFailure(saved.id, TRIP_DETAIL_ROUTE, navErr);
        toast.error(t("plan.submitFailed"));
      }
    } catch (err) {
      logManualTripError("create", err);
      console.error("[CREATE_TRIP] blank manual failed", err);
      toast.error(
        isSupabaseConnectivityError(err)
          ? SUPABASE_UNAVAILABLE_USER_MSG
          : ITINERARY_GENERATION_FAILED_MESSAGE,
      );
    } finally {
      setCreatingBlankTrip(false);
      logManualTripLoadingCleared();
    }
  };

  const clearPlanAiLoading = () => {
    setLoading(false);
    setGeneratingTrip(false);
    logPlanAiLoadingCleared();
  };

  /** 「讓 Roamie 幫我安排」— 完整 AI 生成 → 儲存 → 導向行程詳情 */
  const handleRoamieGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    logPlanAiButtonClicked();
    void runWhenCapacitorBridgeReady("plan_ai_hide_keyboard", async () => {
      const { Keyboard } = await import("@capacitor/keyboard");
      await Keyboard.hide().catch(() => {});
    });

    let openAiRequestStarted = false;
    let preOpenAiWatchdog: ReturnType<typeof setTimeout> | null = null;

    let resolvedDestination: TripLocation | null = null;
    let form: PlanTripFormInput | null = null;
    let bundle: Awaited<ReturnType<typeof fetchPlanAiBundleWithOptionalWeather>> | null =
      null;

    setLoading(true);
    try {
      resolvedDestination = destination;
      if (resolvedDestination) setDestination(resolvedDestination);
      if (!validateDestination(resolvedDestination)) {
        logPlanAiBlocked({
          reason: "missing_destination",
          hasDestination: false,
          hasDate: Boolean(startDate && endDate),
          hasStyles: styleIds.length > 0,
          hasWeather: false,
        });
        return;
      }
      if (!isValidTravelers(travelers)) {
        toast.error(t("plan.invalidTravelers"));
        return;
      }
      if (startDate && endDate && endDate < startDate) {
        toast.error(t("plan.dateInvalid"));
        return;
      }
      if (styleIds.length < 1) {
        logPlanAiBlocked({
          reason: "styles_required",
          hasDestination: true,
          hasDate: Boolean(startDate && endDate),
          hasStyles: false,
          hasWeather: false,
        });
        toast.message(t("plan.stylesRequired"));
        return;
      }

      const tripDays = startDate && endDate ? daysBetweenDates(startDate, endDate) : 2;
      form = buildFormInput(
        resolvedDestination!,
        origin ?? resolvedDestination!,
        tripDays,
      );
      logPlanAiContextReady(form);

      const prefs = await loadPlanPrefsWithTimeout();
      bundle = await fetchPlanAiBundleWithOptionalWeather(
        resolvedDestination!,
        fetchWeather,
        prefs,
      );

      void savePreferences({ ...prefs, budgetMode }).catch((prefErr) => {
        console.warn("[PLAN_AI] savePreferences background failed", prefErr);
      });

      setGeneratingTrip(true);

      const blockedCtx = {
        hasDestination: true,
        hasDate: Boolean(form.startDate && form.endDate),
        hasStyles: form.styles.length > 0,
        hasWeather: Boolean(bundle.weather?.available),
      };

      preOpenAiWatchdog = setTimeout(() => {
        if (!openAiRequestStarted) {
          logPlanAiPreOpenAiWatchdog(blockedCtx, form);
        }
      }, PLAN_PRE_OPENAI_TIMEOUT_MS);

      const saved = await executePlanAiGeneration(
        {
          destination: resolvedDestination!,
          form,
          prefs,
          fetchWeather,
          deps: {
            locale,
            searchNearbyPlaces,
            generateItinerary: generateItineraryFn,
          },
          generationOptions: {
            onOpenAiRequestStart: () => {
              openAiRequestStarted = true;
              if (preOpenAiWatchdog) clearTimeout(preOpenAiWatchdog);
            },
          },
        },
        bundle,
      );

      toast.success(t("plan.tripCreated"));
      const navOpts = tripDetailNavigateOptions(saved.id, { from: "plan", replace: true });
      try {
        await navigate(navOpts);
        logPlanAiNavigateTrip({ tripId: saved.id, route: TRIP_DETAIL_ROUTE });
        console.info("[ITINERARY_NAVIGATED]", { tripId: saved.id, path: "plan_form" });
      } catch (navErr) {
        logPlanAiNavigateFailed({
          tripId: saved.id,
          route: TRIP_DETAIL_ROUTE,
          error: navErr,
        });
        logPlanAiError("navigate", navErr);
        toast.error(ITINERARY_GENERATION_FAILED_MESSAGE);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logPlanAiError("submit", err);
      console.error("[PLAN_TRIP] roamie_generate failed", msg, err);
      toast.error(
        isSupabaseConnectivityError(err)
          ? SUPABASE_UNAVAILABLE_USER_MSG
          : ITINERARY_GENERATION_FAILED_MESSAGE,
      );
    } finally {
      if (preOpenAiWatchdog) clearTimeout(preOpenAiWatchdog);
      clearPlanAiLoading();
    }
  };

  const busy = loading || generatingTrip || creatingBlankTrip;
  const roamieArranging = (loading || generatingTrip) && !creatingBlankTrip;
  const tripDaysLabel =
    startDate && endDate
      ? t("plan.daysRange", { days: daysBetweenDates(startDate, endDate) })
      : undefined;

  return (
    <div
      className="plan-page flex min-h-0 flex-1 flex-col pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      data-plan-page-version={PLAN_PAGE_UI_VERSION}
    >
      {generatingTrip ? (
        <PlanItineraryGeneratingScreen
          title={t("plan.generatingTitle")}
          steps={[
            t("plan.generatingStepWeather"),
            t("plan.generatingStepRoute"),
            t("plan.generatingStepExperiences"),
            t("plan.generatingStepFinalize"),
          ]}
        />
      ) : null}

      <header className="z-10 flex shrink-0 items-center gap-3 border-b border-border bg-background px-5 py-3">
        <BackButton fallback={{ to: "/" }} />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h1 className="font-display text-lg">{t("plan.title")}</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain no-scrollbar">
        <PlanTripForm
          t={t}
          busy={busy}
          sourceLoading={sourceLoading}
          selectedPlaces={selectedPlaces}
          destination={destination}
          onDestinationChange={setDestination}
          origin={origin}
          onOriginChange={setOrigin}
          startDate={startDate}
          endDate={endDate}
          onDateRangeChange={(range) => {
            setStartDate(range.start);
            setEndDate(range.end);
          }}
          tripDaysLabel={tripDaysLabel}
          travelers={travelers}
          travelersCustom={travelersCustom}
          onTravelersQuick={(n) => {
            setTravelersCustom(false);
            setTravelers(n);
          }}
          onTravelersCustomToggle={() => setTravelersCustom(true)}
          onTravelersCustomChange={setTravelers}
          budgetOptions={budgetOptions}
          budgetMode={budgetMode}
          onBudgetMode={setBudgetMode}
          transportOptions={transportOptions}
          transport={transport}
          onTransportToggle={(tr) => setTransport(transport === tr ? "" : tr)}
          styleCards={styleCards}
          styleIds={styleIds}
          onToggleStyle={(id) =>
            setStyleIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onSubmit={handleRoamieGenerate}
          onCreateTrip={() => void handleCreateTrip()}
          roamieArranging={roamieArranging}
          creatingTrip={creatingBlankTrip}
          hideFooterActions={generatingTrip}
        />
      </div>
    </div>
  );
}
