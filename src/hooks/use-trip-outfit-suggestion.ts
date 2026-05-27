import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion } from "@/lib/outfit/outfit.functions";
import { buildOutfitInputKey } from "@/lib/outfit/trip-outfit-context";
import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";

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

  const resolvedDestination =
    destination !== "尚未設定" ? destination : fallbackDestination ?? "";

  const inputKey = useMemo(
    () =>
      buildOutfitInputKey({
        destination: resolvedDestination,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
      }),
    [resolvedDestination, dateRange.start, dateRange.end, dayCount],
  );

  const [outfitFields, setOutfitFields] = useState<TripOutfitSuggestionFields>(() => ({
    outfitSuggestion: initialFields.outfitSuggestion,
    weatherSummary: initialFields.weatherSummary,
    weatherSource: initialFields.weatherSource,
    outfitSuggestionUpdatedAt: initialFields.outfitSuggestionUpdatedAt,
    outfitSuggestionInputKey: initialFields.outfitSuggestionInputKey,
  }));

  const [loading, setLoading] = useState(false);

  const isCached =
    Boolean(outfitFields.outfitSuggestion) &&
    outfitFields.outfitSuggestionInputKey === inputKey;

  const pendingRegeneration =
    outfitFields.outfitSuggestionInputKey !== inputKey && Boolean(dateRange.start);
  const showLoading = loading || pendingRegeneration;
  const displayFields =
    outfitFields.outfitSuggestionInputKey === inputKey ? outfitFields : {};

  useEffect(() => {
    if (!enabled || isCached || generatingRef.current) return;
    if (!dateRange.start) return;

    generatingRef.current = true;
    setLoading(true);

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
      },
    })
      .then((result) => {
        setOutfitFields({
          outfitSuggestion: result.outfitSuggestion,
          weatherSummary: result.weatherSummary,
          weatherSource: result.weatherSource,
          outfitSuggestionUpdatedAt: result.outfitSuggestionUpdatedAt,
          outfitSuggestionInputKey: inputKey,
        });
      })
      .catch((e) => {
        console.warn("[useTripOutfitSuggestion] generation failed", e);
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
    items,
    settings.transport,
    tripCenter,
    destinationLocation?.lat,
    destinationLocation?.lng,
    moodTag,
    fetchSuggestion,
  ]);

  return {
    loading: showLoading,
    outfitFields: displayFields,
    isCached,
  };
}
