import { canonicalWeatherTimezone, readWeatherSourceAvailability, type WeatherSourceAvailability } from "@/lib/outfit/weather-source-availability";
import { isFreshTripOutfit, tripCalendarDates, unavailableTripWeatherCopy, tripWeatherMode, validWeatherCoords } from "@/lib/outfit/trip-weather-policy";
import { useI18n } from "@/hooks/use-i18n";
import { isCurrentGeneratedCopy } from "@/lib/generated-locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion, getTripWeatherSourceAvailability } from "@/lib/outfit/outfit.functions";
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
    weatherSourceAvailability: fields.weatherSourceAvailability ?? null,
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
    weatherSourceAvailability: raw.weatherSourceAvailability,
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
  const fetchAvailability = useServerFn(getTripWeatherSourceAvailability);
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
    weatherSourceAvailability: initialFields.weatherSourceAvailability,
    outfitSuggestionUpdatedAt: initialFields.outfitSuggestionUpdatedAt,
    outfitSuggestionInputKey: initialFields.outfitSuggestionInputKey,
  }));

  const [loading, setLoading] = useState(false);
  // Presentation settlement only; does not change cache authority or request admission.
  const [settledInputKey, setSettledInputKey] = useState<string | null>(null);
  const [availabilityFailedKey, setAvailabilityFailedKey] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ key: string; version: WeatherSourceAvailability } | null>(null);
  const checkAvailability = enabled && weatherMode === "climate" &&
    validWeatherCoords(destinationLocation?.lat, destinationLocation?.lng) &&
    !(["openweather", "visual-crossing-stats"] as string[]).includes(outfitFields.weatherSource ?? "");
  const availabilityVersion = availability?.key === inputKey ? availability.version : undefined;
  useEffect(() => {
    if (!checkAvailability) return;
    let cancelled = false;
    void readWeatherSourceAvailability(() => fetchAvailability()).then(version => {
      if (!cancelled) setAvailability({ key: inputKey, version });
    }).catch(() => {
      if (!cancelled) setAvailabilityFailedKey(inputKey);
      // Capability failed: show existing fallback; do not retry providers.
    });
    return () => { cancelled = true; };
  }, [checkAvailability, inputKey, fetchAvailability]);


  const localOutfit = resolveLocalTripOutfit({
    locale, destination: resolvedDestination, startDate: dateRange.start, endDate: dateRange.end,
    lat: destinationLocation?.lat, lng: destinationLocation?.lng,
    timezone: destinationLocation?.timezone, utcOffsetMinutes: destinationLocation?.utcOffsetMinutes,
    items, transport: settings.transport, inputKey,
  });
  const isCached = (
    isCurrentGeneratedCopy(outfitFields.outfitCopy ?? {}, locale) &&
    isFreshTripOutfit(outfitFields, inputKey, Date.now(), availabilityVersion));

  const hasDates = tripCalendarDates(dateRange.start, dateRange.end).length > 0;
  const pendingRegeneration = enabled && !isCached && hasDates;

  const displayFields: TripOutfitSuggestionFields = isCached ? outfitFields : localOutfit ?? {
    outfitSuggestion: hasDates && enabled ? "" : unavailableTripWeatherCopy(locale),
    weatherSummary: "", weatherSource: "unavailable",
  };

  const successfulCache = isCached && ["openweather", "visual-crossing-stats"].includes(outfitFields.weatherSource ?? "");
  const capabilityPending = checkAvailability && !availabilityVersion && availabilityFailedKey !== inputKey;
  const showLoading = enabled && hasDates &&
    validWeatherCoords(destinationLocation?.lat, destinationLocation?.lng) &&
    !successfulCache && availabilityFailedKey !== inputKey &&
    (capabilityPending || loading || (pendingRegeneration && settledInputKey !== inputKey));

  useEffect(() => {
    if (!enabled || isCached || (checkAvailability && !availabilityVersion)) return;
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
        timezone: canonicalWeatherTimezone(destinationLocation?.timezone),
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
            { ...buildLocalTripOutfitFallback({
              locale,
              destination: resolvedDestination,
              lat: destinationLocation?.lat, lng: destinationLocation?.lng,
              startDate: dateRange.start,
              endDate: dateRange.end || dateRange.start,
              items: itemsRef.current,
              transport: settings.transport,
              inputKey,
            }), weatherSourceAvailability: availabilityVersion },
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
          { ...buildLocalTripOutfitFallback({
            locale,
            destination: resolvedDestination,
            lat: destinationLocation?.lat, lng: destinationLocation?.lng,
            startDate: dateRange.start,
            endDate: dateRange.end || dateRange.start,
            items: itemsRef.current,
            transport: settings.transport,
            inputKey,
          }), weatherSourceAvailability: availabilityVersion },
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSettledInputKey(inputKey);
        }
      });
    return () => { cancelled = true; };
  }, [
    locale,
    enabled,
    isCached,
    checkAvailability,
    availabilityVersion,
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
