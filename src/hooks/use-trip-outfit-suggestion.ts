import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion } from "@/lib/outfit/outfit.functions";
import {
  buildOutfitInputKey,
  buildTripItemsFingerprint,
} from "@/lib/outfit/trip-outfit-context";
import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";
import { WEATHER_CACHE_TTL_MS, ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";

type Params = {
  initialFields: TripOutfitSuggestionFields;
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  destination: string;
  fallbackDestination?: string;
  destinationLocation?: TripLocation | null;
  dateRange: { start: string; end: string };
  dayCount: number;
  tripCenter?: { lat: number; lng: number };
  moodTag?: string;
  enabled?: boolean;
};

export function useTripOutfitSuggestion({
  initialFields,
  items,
  settings,
  destination,
  fallbackDestination,
  destinationLocation,
  dateRange,
  dayCount,
  tripCenter,
  moodTag,
  enabled = true,
}: Params) {
  const fetchSuggestion = useServerFn(generateTripOutfitSuggestion);
  const generatingRef = useRef(false);
  const [weatherRefreshTick, setWeatherRefreshTick] = useState(0);

  const resolvedDestination =
    destination !== "尚未設定" ? destination : fallbackDestination ?? "";

  const itemsFingerprint = useMemo(() => buildTripItemsFingerprint(items), [items]);

  const [weatherSignature, setWeatherSignature] = useState("");

  const inputKey = useMemo(
    () =>
      buildOutfitInputKey({
        destination: resolvedDestination,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
        itemsFingerprint,
        weatherSignature,
        weatherRefreshTick,
      }),
    [
      resolvedDestination,
      dateRange.start,
      dateRange.end,
      dayCount,
      itemsFingerprint,
      weatherSignature,
      weatherRefreshTick,
    ],
  );

  const [outfitFields, setOutfitFields] = useState<TripOutfitSuggestionFields>(() => ({
    outfitSuggestion: initialFields.outfitSuggestion,
    weatherSummary: initialFields.weatherSummary,
    weatherSource: initialFields.weatherSource,
    outfitSuggestionUpdatedAt: initialFields.outfitSuggestionUpdatedAt,
    outfitSuggestionInputKey: initialFields.outfitSuggestionInputKey,
    outfitTags: initialFields.outfitTags,
    weatherTempC: initialFields.weatherTempC,
    weatherFeelsLikeC: initialFields.weatherFeelsLikeC,
    weatherCondition: initialFields.weatherCondition,
    weatherIconType: initialFields.weatherIconType,
    weatherIsDaytime: initialFields.weatherIsDaytime,
    weatherPrecipPercent: initialFields.weatherPrecipPercent,
    outfitTier: initialFields.outfitTier,
  }));

  const [loading, setLoading] = useState(false);
  const [outfitError, setOutfitError] = useState<string | null>(null);

  const isCached =
    Boolean(outfitFields.outfitSuggestion) &&
    outfitFields.outfitSuggestionInputKey === inputKey;

  const pendingRegeneration =
    outfitFields.outfitSuggestionInputKey !== inputKey && Boolean(dateRange.start);
  const showLoading = loading || pendingRegeneration;
  const displayFields =
    outfitFields.outfitSuggestionInputKey === inputKey ? outfitFields : {};

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWeatherRefreshTick((t) => t + 1);
    }, WEATHER_CACHE_TTL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!enabled || isCached || generatingRef.current) return;
    if (!dateRange.start) return;

    generatingRef.current = true;
    setLoading(true);
    setOutfitError(null);

    void fetchSuggestion({
      data: {
        destination: resolvedDestination || undefined,
        startDate: dateRange.start,
        endDate: dateRange.end || dateRange.start,
        dayCount,
        items,
        transport: settings.transport ?? null,
        lat: tripCenter?.lat ?? destinationLocation?.lat ?? null,
        lng: tripCenter?.lng ?? destinationLocation?.lng ?? null,
        mood: moodTag,
        destinationLocation: destinationLocation ?? null,
      },
    })
      .then((result) => {
        setWeatherSignature(result.weatherInputSignature);
        const savedKey = buildOutfitInputKey({
          destination: resolvedDestination,
          startDate: dateRange.start,
          endDate: dateRange.end,
          dayCount,
          itemsFingerprint,
          weatherSignature: result.weatherInputSignature,
          weatherRefreshTick,
        });
        setOutfitFields({
          outfitSuggestion: result.outfitSuggestion,
          weatherSummary: result.weatherSummary,
          weatherSource: result.weatherSource,
          outfitSuggestionUpdatedAt: result.outfitSuggestionUpdatedAt,
          outfitSuggestionInputKey: savedKey,
          outfitTags: result.outfitTags,
          weatherTempC: result.weatherTempC,
          weatherFeelsLikeC: result.weatherFeelsLikeC,
          weatherCondition: result.weatherCondition,
          weatherIconType: result.weatherIconType,
          weatherIsDaytime: result.weatherIsDaytime,
          weatherPrecipPercent: result.weatherPrecipPercent,
          outfitTier: result.outfitTier,
        });
      })
      .catch((e) => {
        console.warn("[useTripOutfitSuggestion] generation failed", e);
        const msg = e instanceof Error ? e.message : "穿搭建議暫時無法取得";
        setOutfitError(msg);
        setOutfitFields({
          outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
          weatherSummary: "",
          weatherSource: "unavailable",
          outfitSuggestionUpdatedAt: new Date().toISOString(),
          outfitSuggestionInputKey: inputKey,
          outfitTags: [],
          weatherTempC: null,
          weatherFeelsLikeC: null,
          weatherCondition: "",
          weatherIconType: "03",
          weatherIsDaytime: true,
          weatherPrecipPercent: null,
          outfitTier: "free",
        });
      })
      .finally(() => {
        generatingRef.current = false;
        setLoading(false);
      });
  }, [
    enabled,
    isCached,
    inputKey,
    dateRange.start,
    dateRange.end,
    dayCount,
    resolvedDestination,
    itemsFingerprint,
    items,
    settings.transport,
    tripCenter,
    destinationLocation?.lat,
    destinationLocation?.lng,
    destinationLocation,
    moodTag,
    weatherRefreshTick,
    fetchSuggestion,
  ]);

  return {
    loading: showLoading,
    outfitFields: displayFields,
    outfitError,
    isCached,
  };
}
