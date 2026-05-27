import { useEffect, useRef, useState } from "react";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { updateItinerary } from "@/lib/itinerary-storage";

const SAVE_DEBOUNCE_MS = 700;

export function useDebouncedTripSave(
  tripId: string,
  payload: RoamiePayloadV2,
  enabled: boolean,
): { saving: boolean; lastSavedAt: number | null; saveError: string | null } {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const isFirstRef = useRef(true);

  useEffect(() => {
    if (!enabled || !tripId) return;
    if (isFirstRef.current) {
      isFirstRef.current = false;
      return;
    }
    const version = ++versionRef.current;
    const timer = window.setTimeout(() => {
      setSaving(true);
      void updateItinerary(tripId, payload)
        .then(() => {
          if (version !== versionRef.current) return;
          setLastSavedAt(Date.now());
          setSaveError(null);
        })
        .catch((e) => {
          if (version !== versionRef.current) return;
          setSaveError(e instanceof Error ? e.message : "儲存失敗");
        })
        .finally(() => {
          if (version !== versionRef.current) return;
          setSaving(false);
        });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tripId, payload, enabled]);

  return { saving, lastSavedAt, saveError };
}
