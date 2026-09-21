import { useI18n } from "@/hooks/use-i18n";
import { isCurrentGeneratedCopy } from "@/lib/generated-locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion } from "@/lib/outfit/outfit.functions";
import { buildLocalTripOutfitFallback } from "@/lib/outfit/local-trip-outfit-fallback";
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
  tripCenter,
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

  const inputKey = useMemo(
    () =>
      `${locale}|${buildOutfitInputKey({
        destination: resolvedDestination,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
      })}`,
    [locale, resolvedDestination, dateRange.start, dateRange.end, dayCount],
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

  const isCached =
    isCurrentGeneratedCopy(outfitFields.outfitCopy ?? {}, locale) &&
    Boolean(outfitFields.outfitSuggestion) &&
    outfitFields.outfitSuggestionInputKey === inputKey;

  const pendingRegeneration =
    outfitFields.outfitSuggestionInputKey !== inputKey && Boolean(dateRange.start);

  const displayFields = isCached ? outfitFields : { outfitSuggestion: "", weatherSummary: "" };

  const showLoading = loading || (pendingRegeneration && !displayFields.outfitSuggestion);

  useEffect(() => {
    if (!enabled || isCached) return;
    if (!dateRange.start) return;

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
        lat: tripCenter?.lat ?? destinationLocation?.lat ?? null,
        lng: tripCenter?.lng ?? destinationLocation?.lng ?? null,
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
    tripCenter?.lat,
    tripCenter?.lng,
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
