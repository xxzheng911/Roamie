import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useAccess } from "@/hooks/use-access";
import { getPlanBudgetOptions, getPlanTransportOptions } from "@/lib/i18n/plan-form-options";
import {
  getPlanTravelStyleCards,
  resolveStyleLabelsFromIds,
} from "@/lib/i18n/plan-travel-styles";
import { Sparkles } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { buildContextBundleForTrip, daysBetweenDates } from "@/lib/fetch-context";
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
import { generateAndSaveItineraryFromPlan } from "@/lib/trip/generate-itinerary-from-plan";
import {
  preparePlanTripSession,
  type PlanTripFormInput,
} from "@/lib/plan-trip-handoff";
import { saveChatSession } from "@/lib/chat-session";
import { ITINERARY_GENERATION_FAILED_MESSAGE } from "@/lib/ai/itinerary-trigger";
import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import { PLAN_PAGE_UI_VERSION } from "@/lib/plan/plan-page-version";

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
  const { hasPlusAccess } = useAccess();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedDestination = await ensureLocationHasCoords(destination, "destination");
    const resolvedOrigin = origin
      ? await ensureLocationHasCoords(origin, "start")
      : resolvedDestination;
    if (resolvedDestination) setDestination(resolvedDestination);
    if (resolvedOrigin && origin) setOrigin(resolvedOrigin);
    if (!validateDestination(resolvedDestination)) return;
    if (!isValidTravelers(travelers)) {
      toast.error(t("plan.invalidTravelers"));
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error(t("plan.dateInvalid"));
      return;
    }
    if (styleIds.length < 1) {
      toast.message(t("plan.stylesRequired"));
      return;
    }

    const tripDays = startDate && endDate ? daysBetweenDates(startDate, endDate) : 2;
    const form = buildFormInput(resolvedDestination!, resolvedOrigin ?? resolvedDestination!, tripDays);

    setLoading(true);
    console.info("[CREATE_TRIP] submit ui=v2 plus=", hasPlusAccess);
    try {
      const [bundle, prefs] = await Promise.all([
        buildContextBundleForTrip(resolvedDestination!, fetchWeather),
        getPreferences(),
      ]);
      await savePreferences({ ...prefs, budgetMode });

      if (hasPlusAccess) {
        const session = preparePlanTripSession(form, bundle, prefs, {
          plusConsultant: true,
          skipOriginValidation: true,
        });
        saveChatSession(session);
        console.info("[PLAN_TRIP] plus → AI consultant chat (not legacy notes)");
        navigate({ to: "/chat", search: { from: "plan" } });
        return;
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      setGeneratingTrip(true);
      await new Promise<void>((r) => setTimeout(r, 50));

      const saved = await generateAndSaveItineraryFromPlan(form, bundle, prefs, {
        locale,
        searchNearbyPlaces,
        generateItinerary: generateItineraryFn,
      });
      console.info("[ITINERARY_NAVIGATED]", { tripId: saved.id, path: "plan_form" });
      toast.success(t("plan.tripCreated"));
      setGeneratingTrip(false);
      await new Promise<void>((r) => setTimeout(r, 80));
      navigate(tripDetailNavigateOptions(saved.id, { from: "plan", replace: true }));
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PLAN_TRIP] submit failed", msg, err);
      toast.message(ITINERARY_GENERATION_FAILED_MESSAGE);
    } finally {
      setLoading(false);
      setGeneratingTrip(false);
    }
  };

  const busy = loading || generatingTrip;
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
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
