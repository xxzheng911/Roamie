import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useFormKeyboardOpen } from "@/hooks/use-form-keyboard-open";
import { useI18n } from "@/hooks/use-i18n";
import {
  getPlanBudgetOptions,
  getPlanStyleOptions,
  getPlanTransportOptions,
} from "@/lib/i18n/plan-form-options";
import { Sparkles, Loader2, MapPin } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { buildContextBundleForTrip, daysBetweenDates } from "@/lib/fetch-context";
import { LocationSearchField } from "@/components/LocationSearchField";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { TripLocation } from "@/lib/location/types";
import {
  isValidTripPlaceRef,
  logTripPlace,
  tripLocationToPlaceRef,
} from "@/lib/trip/trip-place-ref";
import { preparePlanTripSession } from "@/lib/plan-trip-handoff";
import { buildPlanFormTripPayload } from "@/lib/plan-form-trip-payload";
import { confirmSaveTrip } from "@/lib/itinerary-storage";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import { savePlanFormDraft, loadPlanFormDraft, clearPlanFormDraft } from "@/lib/plan-form-draft-storage";
import { normalizePlanTravelStyles } from "@/lib/plan-travel-style";
import { saveChatSession, clearChatSession } from "@/lib/chat-session";
import { clearChatHistory } from "@/lib/chat-history";
import { RoamieDatePicker } from "@/components/pickers";
import { getWeather } from "@/lib/weather.functions";
import { resolveTripStop } from "@/lib/trip-stop-search.functions";
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

function PlanPage() {
  const { t, locale } = useI18n();
  const { scrollInputAboveKeyboard } = useFormKeyboardOpen("plan-keyboard-open");
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fetchWeather = useServerFn(getWeather);
  const resolveStopFn = useServerFn(resolveTripStop);
  const budgetOptions = useMemo(() => getPlanBudgetOptions(locale), [locale]);
  const transportOptions = useMemo(() => getPlanTransportOptions(locale), [locale]);
  const styleOptions = useMemo(() => getPlanStyleOptions(locale), [locale]);

  const [sourceCtx, setSourceCtx] = useState<ItinerarySourceContext | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("standard");
  const [styles, setStyles] = useState<string[]>([]);
  const [mood, setMood] = useState<string>(search.mood ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [origin, setOrigin] = useState<TripLocation | null>(null);
  const [travelers, setTravelers] = useState(1);
  const [travelersCustom, setTravelersCustom] = useState(false);
  const [transport, setTransport] = useState("");
  const [loading, setLoading] = useState(false);

  const TRAVELER_QUICK = [1, 2, 3, 4] as const;

  const isValidTravelers = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99;

  const validateTripPlaces = (dest: TripLocation | null, start: TripLocation | null): boolean => {
    const destRef = dest ? tripLocationToPlaceRef(dest) : null;
    if (!isValidTripPlaceRef(destRef)) {
      logTripPlace("destination", "validation", { reason: "missing_destination" });
      toast.error(t("plan.selectPlaceFromList"));
      return false;
    }
    if (!start) {
      logTripPlace("start", "validation", { reason: "missing_start" });
      toast.error(t("plan.pickPlaceFromResults"));
      return false;
    }
    const startRef = tripLocationToPlaceRef(start);
    if (!isValidTripPlaceRef(startRef)) {
      logTripPlace("start", "validation", { reason: "invalid_start" });
      toast.error(t("plan.selectPlaceFromList"));
      return false;
    }
    if (
      destRef!.placeId === startRef.placeId &&
      Math.abs(destRef!.lat - startRef.lat) < 1e-6 &&
      Math.abs(destRef!.lng - startRef.lng) < 1e-6
    ) {
      logTripPlace("destination", "validation", { reason: "same_as_start" });
      toast.error(t("plan.samePlace"));
      return false;
    }
    return true;
  };

  useEffect(() => {
    const draft = loadPlanFormDraft();
    if (!draft) return;
    if (draft.destination) setDestination(draft.destination);
    if (draft.origin) setOrigin(draft.origin);
    setBudgetMode(draft.budgetMode);
    if (draft.styles.length) setStyles(draft.styles);
    if (draft.mood) setMood(draft.mood);
    if (draft.startDate) setStartDate(draft.startDate);
    if (draft.endDate) setEndDate(draft.endDate);
    setTravelers(draft.travelers);
    setTravelersCustom(draft.travelersCustom);
    if (draft.transport) setTransport(draft.transport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await loadItinerarySource(search.recommendationId);
        if (cancelled) return;
        setSourceCtx(ctx);

        if (ctx?.selectedPlaces?.length) {
          if (ctx.moodTag) setMood((m) => m || ctx.moodTag!);
        }
        if (search.mood) setMood((m) => m || search.mood!);
      } catch (e) {
        console.error("[plan] load source failed", e);
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search.recommendationId, search.mood, search.destination]);

  useEffect(() => {
    getPreferences().then((p) => setBudgetMode(resolveBudgetMode(p)));
  }, []);

  const toggle = (list: string[], v: string, set: (l: string[]) => void) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  const selectedPlaces: RoamieRecommendationItem[] = sourceCtx?.selectedPlaces ?? [];

  const ensureLocationHasCoords = async (
    loc: TripLocation | null,
    role: "destination" | "start",
  ): Promise<TripLocation | null> => {
    if (!loc) return null;
    if (Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return loc;
    if (!loc.placeId?.trim()) return null;
    try {
      const resolved = await resolveStopFn({ data: { placeId: loc.placeId, locale } });
      const stop = resolved.stop;
      if (!stop || stop.lat == null || stop.lng == null) return loc;
      const patched: TripLocation = {
        ...loc,
        lat: stop.lat,
        lng: stop.lng,
        address: loc.address || stop.address || loc.formattedName,
      };
      if (role === "destination") setDestination(patched);
      if (role === "start") setOrigin(patched);
      return patched;
    } catch (error) {
      console.error("[PLACES_DETAILS] error=", error instanceof Error ? error.message : String(error));
      return loc;
    }
  };

  const saveCurrentDraft = (
    dest: TripLocation | null,
    start: TripLocation | null,
  ) => {
    savePlanFormDraft({
      destination: dest,
      origin: start,
      budgetMode,
      styles,
      mood,
      startDate,
      endDate,
      travelers,
      travelersCustom,
      transport,
    });
  };

  type ResolvedPlanForm = {
    dest: TripLocation;
    start: TripLocation;
    tripDays: number;
  };

  const resolvePlanFormForSubmit = async (): Promise<ResolvedPlanForm | null> => {
    const [resolvedDestination, resolvedOrigin] = await Promise.all([
      ensureLocationHasCoords(destination, "destination"),
      ensureLocationHasCoords(origin, "start"),
    ]);
    if (resolvedDestination) setDestination(resolvedDestination);
    if (resolvedOrigin) setOrigin(resolvedOrigin);
    if (!validateTripPlaces(resolvedDestination, resolvedOrigin)) return null;
    if (!isValidTravelers(travelers)) {
      toast.error(t("plan.invalidTravelers"));
      return null;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error(t("plan.dateInvalid"));
      return null;
    }
    const tripDays = startDate && endDate ? daysBetweenDates(startDate, endDate) : 2;
    return {
      dest: resolvedDestination!,
      start: resolvedOrigin!,
      tripDays,
    };
  };

  const handleCreateTripDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolved = await resolvePlanFormForSubmit();
    if (!resolved) return;

    const { dest, start, tripDays } = resolved;
    const budgetLabel = budgetOptions.find((b) => b.value === budgetMode)?.label ?? budgetMode;
    const normalizedStyles = normalizePlanTravelStyles(styles, styleOptions);

    setLoading(true);
    try {
      const payload = buildPlanFormTripPayload({
        destination: dest,
        origin: start,
        days: tripDays,
        mood,
        styles,
        normalizedStyles,
        startDate,
        endDate,
        departureTime: "",
        travelers,
        transport: transport.trim(),
        budgetMode,
        budgetLabel,
        selectedPlaces: selectedPlaces.length > 0 ? selectedPlaces : undefined,
      });

      const saved = await confirmSaveTrip(payload, "plan");
      saveCurrentDraft(dest, start);
      clearPlanFormDraft();
      toast.success(t("plan.tripCreated"));
      logTripNav("PlanDirectCreate", saved.id);
      navigate(tripDetailNavigateOptions(saved.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("plan.tripCreateFailed");
      console.error("[Plan] direct create failed", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const startPlanChat = async (planAiMode: boolean) => {
    const resolved = await resolvePlanFormForSubmit();
    if (!resolved) return;

    const { dest, start, tripDays } = resolved;

    setLoading(true);
    try {
      const [bundle, prefs] = await Promise.all([
        buildContextBundleForTrip(dest, fetchWeather),
        getPreferences(),
      ]);
      const effectiveBudgetMode = budgetMode;
      await savePreferences({ ...prefs, budgetMode: effectiveBudgetMode });

      const mergedPlaces = selectedPlaces.length > 0 ? selectedPlaces : [];
      const normalizedStyles = normalizePlanTravelStyles(styles, styleOptions);

      const destRef = tripLocationToPlaceRef(dest);
      const startRef = tripLocationToPlaceRef(start);
      logTripPlace("destination", "saved", destRef);
      logTripPlace("start", "saved", startRef);
      console.info("[Roamie AI] plan submit → chat", {
        destination: destRef.name,
        destinationPlaceId: destRef.placeId,
        startPlaceId: startRef.placeId,
        travelers,
        days: tripDays,
        places: mergedPlaces.length,
        planAiMode,
      });

      saveCurrentDraft(dest, start);

      clearChatSession();
      await clearChatHistory();
      const session = preparePlanTripSession(
        {
          destination: dest,
          origin: start,
          days: tripDays,
          mood,
          styles,
          normalizedStyles,
          startDate,
          endDate,
          departureTime: "",
          travelers,
          transport: transport.trim(),
          budgetMode: effectiveBudgetMode,
          selectedPlaces: mergedPlaces,
        },
        bundle,
        prefs,
        { planAiMode, localeStyleOptions: styleOptions },
      );
      saveChatSession(session);
      navigate({
        to: "/chat",
        search: { from: planAiMode ? "plan-ai" : "plan" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("plan.submitFailed");
      console.error("[Roamie AI] plan failed", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAiAssist = async () => {
    await startPlanChat(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="z-10 flex shrink-0 items-center gap-3 border-b border-border bg-background px-5 py-3">
        <BackButton fallback={{ to: "/" }} />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h1 className="font-display text-lg">{t("plan.title")}</h1>
        </div>
      </header>

      <div className="plan-page-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain no-scrollbar">
        <form onSubmit={handleCreateTripDirect} className="space-y-6 px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {sourceLoading ? (
            <div className="flex items-center gap-2 rounded-2xl bg-secondary/80 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("plan.loadingPlaces")}
            </div>
          ) : selectedPlaces.length > 0 ? (
            <div className="rounded-2xl border border-border bg-secondary/50 px-4 py-3">
              <p className="text-sm font-medium">
                {t("plan.importedPlaces", { count: selectedPlaces.length })}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {selectedPlaces.map((p) => (
                  <li key={p.name} className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {p.name} · {p.type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <LocationSearchField
            fieldRole="destination"
            searchMode="place"
            label={t("plan.destination")}
            required
            value={destination}
            onChange={setDestination}
            placeholder={t("plan.destinationPlaceholder")}
            disabled={loading}
            onFocusInput={scrollInputAboveKeyboard}
          />

          <LocationSearchField
            fieldRole="start"
            searchMode="place"
            label={t("plan.origin")}
            required
            value={origin}
            onChange={setOrigin}
            placeholder={t("plan.originPlaceholder")}
            disabled={loading}
            onFocusInput={scrollInputAboveKeyboard}
          />

          <section>
            <label className="text-sm font-medium">{t("plan.travelDates")}</label>
            <div className="mt-2">
              <RoamieDatePicker
                mode="range"
                displayWithYear
                value={{ start: startDate, end: endDate }}
                onChange={(range) => {
                  setStartDate(range.start);
                  setEndDate(range.end);
                }}
                placeholder={t("plan.datePlaceholder")}
                disabled={loading}
              />
            </div>
          </section>
          {startDate && endDate && (
            <p className="text-xs text-muted-foreground">
              {t("plan.daysRange", { days: daysBetweenDates(startDate, endDate) })}
            </p>
          )}

          <section>
            <label className="text-sm font-medium">{t("plan.travelers")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRAVELER_QUICK.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTravelersCustom(false);
                    setTravelers(n);
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                    !travelersCustom && travelers === n
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card"
                  }`}
                >
                  {n} 人
                </button>
              ))}
              <button
                type="button"
                disabled={loading}
                onClick={() => setTravelersCustom(true)}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  travelersCustom
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                {t("plan.travelersCustom")}
              </button>
            </div>
            {travelersCustom ? (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={String(travelers)}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  if (!raw) {
                    setTravelers(0);
                    return;
                  }
                  setTravelers(Math.min(99, Number.parseInt(raw, 10)));
                }}
                placeholder="1–99"
                className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={loading}
              />
            ) : null}
          </section>

          <section>
            <label className="text-sm font-medium">{t("plan.budget")}</label>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {budgetOptions.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setBudgetMode(b.value)}
                  disabled={loading}
                  className={`flex min-h-[3.25rem] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center transition ${
                    budgetMode === b.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card"
                  }`}
                >
                  <span className="block h-5 text-sm font-medium leading-5">{b.label}</span>
                  <span className="mt-1 block h-3.5 whitespace-nowrap text-[10px] leading-[14px] opacity-70">
                    {b.hint}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="text-sm font-medium">{t("plan.transport")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {transportOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(transport === t ? "" : t)}
                  disabled={loading}
                  className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                    transport === t
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="text-sm font-medium">{t("plan.styles")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {styleOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(styles, s, setStyles)}
                  disabled={loading}
                  className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                    styles.includes(s)
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-3">
            <button
              type="submit"
              disabled={loading || sourceLoading}
              aria-busy={loading}
              className="flex w-full items-center justify-center rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground shadow-lift transition disabled:opacity-60"
            >
              {loading ? (
                <span
                  key="plan-submit-loading"
                  className="inline-flex items-center justify-center gap-2.5"
                >
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span className="leading-none">{t("plan.submitting")}</span>
                </span>
              ) : (
                <span
                  key="plan-submit-idle"
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="leading-none">{t("plan.submit")}</span>
                </span>
              )}
            </button>

            <button
              type="button"
              disabled={loading || sourceLoading}
              onClick={() => void handleAiAssist()}
              className="flex w-full items-center justify-center rounded-full border border-border bg-card py-4 text-[15px] font-medium text-foreground transition disabled:opacity-60"
            >
              {t("plan.aiAssist")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
