import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import {
  applyRecommendedMode,
  estimateTravelModesLocal,
  getDefaultTransportMode,
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

type Args = {
  origin: LatLng;
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
  const [selectedMode, setSelectedModeState] = useState<TravelModeId>("walk");
  const [loading, setLoading] = useState(false);
  const [aiTip, setAiTip] = useState("");
  const userPickedRef = useRef(false);
  const destinationKeyRef = useRef<string | null>(null);

  const distM = useMemo(() => {
    if (!destination) return 0;
    return distanceMeters(origin, destination);
  }, [origin, destination]);

  const inTaiwan = useMemo(
    () => isTaiwanCoordinates(origin.lat, origin.lng),
    [origin.lat, origin.lng],
  );

  const applyDefaultSelection = useCallback(
    (nextModes: TravelModeEstimate[], dist: number) => {
      const hour = new Date().getHours();
      const ctx = { weather, hour, profile, distanceMeters: dist, inTaiwan };
      const defaultId = getDefaultTransportMode(ctx);
      const rec = recommendTransportMode(nextModes, ctx);
      setModes(applyRecommendedMode(nextModes, rec.modeId));
      if (!userPickedRef.current) {
        setSelectedModeState(defaultId);
      }
      setAiTip(rec.tip);
    },
    [weather, profile, inTaiwan],
  );

  const setSelectedMode = useCallback((mode: TravelModeId) => {
    userPickedRef.current = true;
    setSelectedModeState(mode);
  }, []);

  useEffect(() => {
    if (!enabled || !destination) {
      setModes([]);
      return;
    }

    const destKey = `${destination.lat},${destination.lng}`;
    if (destinationKeyRef.current !== destKey) {
      destinationKeyRef.current = destKey;
      userPickedRef.current = false;
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
    origin.lat,
    origin.lng,
    distM,
    applyDefaultSelection,
    fetchDurations,
  ]);

  const startNavigation = useCallback(() => {
    if (!destination) return;
    if (selectedMode === "taxi") {
      toast.message(TAXI_NAV_TOAST, { duration: 5000 });
    }
    const url = buildDirectionsUrl(destination, {
      origin,
      travelMode: MODE_TO_GOOGLE[selectedMode],
    });
    openExternal(url);
  }, [destination, origin, selectedMode]);

  const selectedModeLabel = TRAVEL_MODE_LABEL[selectedMode];

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
