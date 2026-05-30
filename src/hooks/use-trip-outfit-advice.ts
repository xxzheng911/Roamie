import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripDailyOutfitAdvice } from "@/lib/outfit/outfit-daily.functions";
import {
  buildOutfitInputKey,
  buildTripItemsFingerprint,
} from "@/lib/outfit/trip-outfit-context";
import {
  normalizeOutfitAdvicePayload,
  outfitAdviceDays,
  type OutfitAdvicePayload,
} from "@/lib/outfit/types";
import { ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";

type Params = {
  initialAdvice?: OutfitAdvicePayload;
  initialInputKey?: string;
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  destination: string;
  destinationLocation?: TripLocation | null;
  dateRange: { start: string; end: string };
  dayCount: number;
  lat?: number | null;
  lng?: number | null;
  moodTag?: string;
  enabled?: boolean;
};

export function useTripOutfitAdvice({
  initialAdvice,
  initialInputKey,
  items,
  destination,
  destinationLocation,
  dateRange,
  dayCount,
  lat,
  lng,
  moodTag,
  enabled = true,
}: Params) {
  const fetchAdvice = useServerFn(generateTripDailyOutfitAdvice);
  const generatingRef = useRef(false);
  const attemptedKeyRef = useRef<string | null>(null);

  const itemsFingerprint = useMemo(() => buildTripItemsFingerprint(items), [items]);

  const inputKey = useMemo(
    () =>
      buildOutfitInputKey({
        destination: destination.trim(),
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
        itemsFingerprint,
      }),
    [destination, dateRange.start, dateRange.end, dayCount, itemsFingerprint],
  );

  const [outfitAdvice, setOutfitAdvice] = useState<OutfitAdvicePayload | undefined>(() =>
    normalizeOutfitAdvicePayload(initialAdvice),
  );
  const [storedInputKey, setStoredInputKey] = useState(initialInputKey ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adviceDays = useMemo(() => outfitAdviceDays(outfitAdvice), [outfitAdvice]);
  const hasAdviceDays = adviceDays.length > 0;

  useEffect(() => {
    if (inputKey !== attemptedKeyRef.current) {
      attemptedKeyRef.current = null;
    }
  }, [inputKey]);

  const weatherUnavailable =
    !loading && !hasAdviceDays && (outfitAdvice?.status === "weather_unavailable" || Boolean(error));
  const pendingRegeneration =
    !hasAdviceDays && storedInputKey !== inputKey && Boolean(dateRange.start);
  const showLoading = loading || pendingRegeneration;

  useEffect(() => {
    if (!enabled || !dateRange.start || generatingRef.current) return;
    if (hasAdviceDays && storedInputKey === inputKey) return;
    if (attemptedKeyRef.current === inputKey && !hasAdviceDays) return;

    let cancelled = false;
    generatingRef.current = true;
    attemptedKeyRef.current = inputKey;
    setLoading(true);
    setError(null);

    void fetchAdvice({
      data: {
        destination,
        destinationLocation,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
        items,
        lat,
        lng,
        mood: moodTag,
      },
    })
      .then((result) => {
        if (cancelled) return;
        const normalized = normalizeOutfitAdvicePayload(result);
        setOutfitAdvice(normalized);
        setStoredInputKey(inputKey);
        if (outfitAdviceDays(normalized).length === 0) {
          setError(normalized?.statusMessage ?? ROAMIE_WEATHER_UNAVAILABLE_OUTFIT);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "穿搭建議生成失敗");
        setOutfitAdvice({
          destination,
          generatedAt: new Date().toISOString(),
          days: [],
          status: "weather_unavailable",
          statusMessage: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
        });
        setStoredInputKey(inputKey);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          generatingRef.current = false;
        }
      });

    return () => {
      cancelled = true;
      generatingRef.current = false;
    };
  }, [
    enabled,
    inputKey,
    storedInputKey,
    dateRange.start,
    dateRange.end,
    dayCount,
    destination,
    destinationLocation,
    items,
    lat,
    lng,
    moodTag,
    fetchAdvice,
    hasAdviceDays,
  ]);

  const adviceByDate = useMemo(
    () => new Map(adviceDays.map((d) => [d.date, d])),
    [adviceDays],
  );

  return {
    outfitAdvice,
    outfitAdviceInputKey: storedInputKey === inputKey ? storedInputKey : inputKey,
    adviceByDate,
    loading: showLoading,
    error,
    weatherUnavailable,
    unavailableMessage: outfitAdvice?.statusMessage ?? ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
  };
}
