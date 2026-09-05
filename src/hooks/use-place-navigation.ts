import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import {
  applyRecommendedMode,
  estimateTravelModesLocal,
  mergeTravelDurations,
  recommendTransportMode,
  TAXI_NAV_TOAST,
  TRAVEL_MODE_LABEL,
  type TravelModeEstimate,
  type TravelModeId,
} from "@/lib/estimate-travel-mode";
import { fetchPlaceTravelDurations } from "@/lib/place-navigation.functions";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import { distanceMeters, isTaiwanCoordinates } from "@/lib/map-explore";
import type { WeatherSummary } from "@/lib/weather-types";

const MODE_TO_GOOGLE: Record<TravelModeId, "walking" | "driving" | "transit"> = {
  walk: "walking",
  motorcycle: "driving",
  drive: "driving",
  transit: "transit",
  taxi: "driving",
};

export const INITIAL_PLACE_TRANSPORT_MODE: TravelModeId | null = null;

type Args = {
  origin: LatLng | null;
  destination: LatLng | null;
  weather?: WeatherSummary | null;
  profile?: UserProfileForReason | null;
  enabled?: boolean;
};

export function usePlaceNavigation({
  origin,
  destination,
  weather,
  profile,
  enabled = true,
}: Args) {
  const fetchDurations = useServerFn(fetchPlaceTravelDurations);
  const [modes, setModes] = useState<TravelModeEstimate[]>([]);
  const [selectedMode, setSelectedModeState] = useState<TravelModeId | null>(
    INITIAL_PLACE_TRANSPORT_MODE,
  );
  const [loading, setLoading] = useState(false);
  const [aiTip, setAiTip] = useState("");
  const destinationKeyRef = useRef<string | null>(null);

  const distM = useMemo(() => {
    if (!origin || !destination) return 0;
    return distanceMeters(origin, destination);
  }, [origin, destination]);

  const inTaiwan = useMemo(
    () => Boolean(origin && isTaiwanCoordinates(origin.lat, origin.lng)),
    [origin?.lat, origin?.lng],
  );

  const applyDefaultSelection = useCallback(
    (nextModes: TravelModeEstimate[], dist: number) => {
      const hour = new Date().getHours();
      const ctx = { weather, hour, profile, distanceMeters: dist, inTaiwan };
      const rec = recommendTransportMode(nextModes, ctx);
      setModes(applyRecommendedMode(nextModes, rec.modeId));
      setAiTip(rec.tip);
    },
    [weather, profile, inTaiwan],
  );

  const setSelectedMode = useCallback((mode: TravelModeId) => {
    setSelectedModeState(mode);
  }, []);

  useEffect(() => {
    if (!enabled || !origin || !destination) {
      setModes([]);
      setSelectedModeState(null);
      return;
    }

    const destKey = `${destination.lat},${destination.lng}`;
    if (destinationKeyRef.current !== destKey) {
      destinationKeyRef.current = destKey;
      setSelectedModeState(null);
    }

    let cancelled = false;
    const local = estimateTravelModesLocal(distM);
    applyDefaultSelection(local, distM);

    setLoading(true);
    void fetchDurations({
      data: {
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: destination.lat,
        destLng: destination.lng,
      },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.durations) {
          const merged = mergeTravelDurations(local, res.durations);
          applyDefaultSelection(merged, res.durations.distanceMeters || distM);
        }
      })
      .catch(() => {
        /* keep local estimates */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    destination?.lat,
    destination?.lng,
    origin?.lat,
    origin?.lng,
    distM,
    applyDefaultSelection,
    fetchDurations,
  ]);

  const startNavigation = useCallback(() => {
    if (!origin || !destination || !selectedMode) return;
    if (selectedMode === "taxi") {
      toast.message(TAXI_NAV_TOAST, { duration: 5000 });
    }
    const url = buildDirectionsUrl(destination, {
      origin,
      travelMode: MODE_TO_GOOGLE[selectedMode],
    });
    openExternal(url);
  }, [destination, origin, selectedMode]);

  const selectedModeLabel = selectedMode ? TRAVEL_MODE_LABEL[selectedMode] : null;

  return {
    modes,
    selectedMode,
    selectedModeLabel,
    setSelectedMode,
    loading,
    aiTip,
    distanceMeters: distM,
    startNavigation,
  };
}
