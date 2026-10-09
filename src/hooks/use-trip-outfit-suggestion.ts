import { isFreshTripOutfit, tripCalendarDates, unavailableTripWeatherCopy, tripWeatherMode } from "@/lib/outfit/trip-weather-policy";
import { useI18n } from "@/hooks/use-i18n";
import { isCurrentGeneratedCopy } from "@/lib/generated-locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion } from "@/lib/outfit/outfit.functions";
import { buildLocalTripOutfitFallback, resolveLocalTripOutfit } from "@/lib/outfit/local-trip-outfit-fallback";
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
  moodTag?: string;
  enabled?: boolean;
  /** 僅在伺服器新生成穿搭建議時呼叫（不於 mount / cache hit / 本地 fallback 觸發） */
  onGenerated?: (fields: TripOutfitSuggestionFields) => void;
};

function outfitFieldsFingerprint(fields: TripOutfitSuggestionFields): string {
  return JSON.stringify({
    outfitCopy: fields.outfitCopy ?? null,
    outfitSuggestion: fields.outfitSuggestion ?? null,
    outfitSuggestionUpdatedAt: fields.outfitSuggestionUpdatedAt ?? null,
    weatherSummary: fields.weatherSummary ?? null,
    weatherSource: fields.weatherSource ?? null,
    outfitSuggestionInputKey: fields.outfitSuggestionInputKey ?? null,
  });
}

function itemsOutfitSignature(items: RoamieItineraryItem[]): string {
  return items
    .map((item) =>
      [
        item.date ?? "",
        item.placeType ?? "",
        item.title,
        item.placeName ?? "",
      ].join("|"),
    )
    .join("\n");
}

function normalizeServerOutfitResult(
  result: Awaited<ReturnType<typeof generateTripOutfitSuggestion>>,
  inputKey: string,
): TripOutfitSuggestionFields {
  const raw = result as TripOutfitSuggestionFields & {
    suggestion?: string;
    generatedAt?: string;
  };
  return {
    outfitCopy: raw.outfitCopy,
    outfitSuggestion: raw.outfitSuggestion ?? raw.suggestion ?? "",
    weatherSummary: raw.weatherSummary ?? "",
    weatherSource: raw.weatherSource ?? "openweather",
    outfitSuggestionUpdatedAt:
      raw.outfitSuggestionUpdatedAt ?? raw.generatedAt ?? new Date().toISOString(),
    outfitSuggestionInputKey: inputKey,
  };
}

export function useTripOutfitSuggestion({
  initialFields,
  items,
  settings,
  destination,
  fallbackDestination,
  destinationLocation,
  dateRange,
  dayCount,
  moodTag,
  enabled = true,
  onGenerated,
}: Params) {
  const fetchSuggestion = useServerFn(generateTripOutfitSuggestion);
  const { locale } = useI18n();
  const onGeneratedRef = useRef(onGenerated);
  onGeneratedRef.current = onGenerated;
  const initialFieldsFpRef = useRef(outfitFieldsFingerprint(initialFields));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const resolvedDestination =
    destination !== "尚未設定" ? destination : fallbackDestination ?? "";

  const [weatherClock, setWeatherClock] = useState(Date.now);
  useEffect(() => {
    const input = { startDate: dateRange.start, endDate: dateRange.end,
      timezone: destinationLocation?.timezone, utcOffsetMinutes: destinationLocation?.utcOffsetMinutes };
    const updateMode = () => setWeatherClock(previous => {
      const next = Date.now();
      // Wake only for a source transition; do not turn cache expiry into a retry timer.
      return tripWeatherMode(input, previous) === tripWeatherMode(input, next) ? previous : next;
    });
    updateMode();
    const timer = setInterval(updateMode, 60_000);
    return () => clearInterval(timer);
  }, [dateRange.start, dateRange.end, destinationLocation?.timezone, destinationLocation?.utcOffsetMinutes]);
  const weatherMode = tripWeatherMode({ startDate: dateRange.start, endDate: dateRange.end,
    timezone: destinationLocation?.timezone, utcOffsetMinutes: destinationLocation?.utcOffsetMinutes }, weatherClock);

  const inputKey = useMemo(
    () =>
      `${locale}|${buildOutfitInputKey({
        destination: resolvedDestination,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
        lat: destinationLocation?.lat, lng: destinationLocation?.lng,
        timezone: destinationLocation?.timezone, utcOffsetMinutes: destinationLocation?.utcOffsetMinutes,
        now: weatherClock,
      })}`,
    [locale, resolvedDestination, dateRange.start, dateRange.end, dayCount, destinationLocation?.lat, destinationLocation?.lng, destinationLocation?.timezone, destinationLocation?.utcOffsetMinutes, weatherMode],
  );

  const itemsSignature = useMemo(() => itemsOutfitSignature(items), [items]);

  const [outfitFields, setOutfitFields] = useState<TripOutfitSuggestionFields>(() => ({
    outfitCopy: initialFields.outfitCopy,
    outfitSuggestion: initialFields.outfitSuggestion,
    weatherSummary: initialFields.weatherSummary,
    weatherSource: initialFields.weatherSource,
    outfitSuggestionUpdatedAt: initialFields.outfitSuggestionUpdatedAt,
    outfitSuggestionInputKey: initialFields.outfitSuggestionInputKey,
  }));

  const [loading, setLoading] = useState(false);

  const localOutfit = resolveLocalTripOutfit({
    locale, destination: resolvedDestination, startDate: dateRange.start, endDate: dateRange.end,
    lat: destinationLocation?.lat, lng: destinationLocation?.lng,
    timezone: destinationLocation?.timezone, utcOffsetMinutes: destinationLocation?.utcOffsetMinutes,
    items, transport: settings.transport, inputKey,
  });
  const isCached = (
    isCurrentGeneratedCopy(outfitFields.outfitCopy ?? {}, locale) &&
    isFreshTripOutfit(outfitFields, inputKey));

  const hasDates = tripCalendarDates(dateRange.start, dateRange.end).length > 0;
  const pendingRegeneration = enabled && !isCached && hasDates;

  const displayFields: TripOutfitSuggestionFields = isCached ? outfitFields : localOutfit ?? {
    outfitSuggestion: hasDates && enabled ? "" : unavailableTripWeatherCopy(locale),
    weatherSummary: "", weatherSource: "unavailable",
  };

  const showLoading = !localOutfit && enabled && hasDates && (loading || (pendingRegeneration && !displayFields.outfitSuggestion));

  useEffect(() => {
    if (!enabled || isCached) return;
    if (!hasDates) return;

    let cancelled = false;
    setLoading(true);

    void fetchSuggestion({
      data: {
        locale,
        destination: resolvedDestination || undefined,
        startDate: dateRange.start,
        endDate: dateRange.end || dateRange.start,
        dayCount,
        items: itemsRef.current,
        transport: settings.transport ?? null,
        lat: destinationLocation?.lat ?? null,
        lng: destinationLocation?.lng ?? null,
        timezone: destinationLocation?.timezone,
        utcOffsetMinutes: destinationLocation?.utcOffsetMinutes,
        mood: moodTag,
      },
    })
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        const nextFields = normalizeServerOutfitResult(result, inputKey);
        if (!nextFields.outfitSuggestion?.trim() || !isCurrentGeneratedCopy(nextFields.outfitCopy ?? {}, locale)) {
          setOutfitFields(
            buildLocalTripOutfitFallback({
              locale,
              destination: resolvedDestination,
              lat: destinationLocation?.lat, lng: destinationLocation?.lng,
              startDate: dateRange.start,
              endDate: dateRange.end || dateRange.start,
              items: itemsRef.current,
              transport: settings.transport,
              inputKey,
            }),
          );
          return;
        }
        setOutfitFields(nextFields);
        const initialFp = initialFieldsFpRef.current;
        const nextFp = outfitFieldsFingerprint(nextFields);
        if (nextFp !== initialFp) {
          onGeneratedRef.current?.(nextFields);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        console.warn("[useTripOutfitSuggestion] generation failed", e);
        setOutfitFields(
          buildLocalTripOutfitFallback({
            locale,
            destination: resolvedDestination,
            lat: destinationLocation?.lat, lng: destinationLocation?.lng,
            startDate: dateRange.start,
            endDate: dateRange.end || dateRange.start,
            items: itemsRef.current,
            transport: settings.transport,
            inputKey,
          }),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    locale,
    enabled,
    isCached,
    inputKey,
    dateRange.start,
    dateRange.end,
    dayCount,
    resolvedDestination,
    itemsSignature,
    settings.transport,
    hasDates,
    destinationLocation?.timezone,
    destinationLocation?.utcOffsetMinutes,
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
