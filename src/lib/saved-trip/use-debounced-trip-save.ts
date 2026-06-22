import { useCallback, useEffect, useRef, useState } from "react";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { updateItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { tripPayloadFingerprint } from "@/lib/saved-trip/trip-payload-fingerprint";

const SAVE_DEBOUNCE_MS = 700;

type Options = {
  onSaved?: (stored: StoredItinerary) => void;
};

export function useDebouncedTripSave(
  tripId: string,
  payload: RoamiePayloadV2,
  enabled: boolean,
  options?: Options,
): {
  saving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  saveNow: () => Promise<void>;
  cancelPending: () => void;
  markSynced: (syncedPayload: RoamiePayloadV2) => void;
} {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const lastSavedFingerprintRef = useRef<string | null>(null);
  const seededRef = useRef(false);
  const payloadRef = useRef(payload);
  const timerRef = useRef<number | null>(null);
  const onSavedRef = useRef(options?.onSaved);
  onSavedRef.current = options?.onSaved;
  payloadRef.current = payload;

  const persistPayload = useCallback(
    async (nextPayload: RoamiePayloadV2, fingerprint: string) => {
      if (!tripId || !enabled) return;
      const version = ++versionRef.current;
      setSaving(true);
      try {
        const updated = await updateItinerary(tripId, nextPayload);
        if (version !== versionRef.current) return;
        lastSavedFingerprintRef.current = fingerprint;
        setLastSavedAt(Date.now());
        setSaveError(null);
        if (updated) onSavedRef.current?.(updated);
      } catch (e) {
        if (version !== versionRef.current) return;
        setSaveError(e instanceof Error ? e.message : "儲存失敗");
        throw e;
      } finally {
        if (version === versionRef.current) setSaving(false);
      }
    },
    [tripId, enabled],
  );

  const cancelPending = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markSynced = useCallback((syncedPayload: RoamiePayloadV2) => {
    lastSavedFingerprintRef.current = tripPayloadFingerprint(syncedPayload);
    cancelPending();
  }, [cancelPending]);

  const saveNow = useCallback(async () => {
    if (!tripId || !enabled) return;
    cancelPending();
    const nextPayload = payloadRef.current;
    const fingerprint = tripPayloadFingerprint(nextPayload);
    if (fingerprint === lastSavedFingerprintRef.current) return;
    await persistPayload(nextPayload, fingerprint);
  }, [tripId, enabled, persistPayload, cancelPending]);

  useEffect(() => {
    if (!enabled || !tripId) return;

    const fingerprint = tripPayloadFingerprint(payload);

    if (!seededRef.current) {
      seededRef.current = true;
      lastSavedFingerprintRef.current = fingerprint;
      return;
    }

    if (fingerprint === lastSavedFingerprintRef.current) return;

    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (fingerprint === lastSavedFingerprintRef.current) return;
      void persistPayload(payload, fingerprint);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [tripId, payload, enabled, persistPayload]);

  useEffect(() => {
    return () => {
      if (!enabled || !tripId) return;
      const nextPayload = payloadRef.current;
      const fingerprint = tripPayloadFingerprint(nextPayload);
      if (fingerprint === lastSavedFingerprintRef.current) return;
      void updateItinerary(tripId, nextPayload)
        .then((updated) => {
          lastSavedFingerprintRef.current = fingerprint;
          if (updated) onSavedRef.current?.(updated);
        })
        .catch(() => {
          /* best-effort flush on unmount */
        });
    };
  }, [tripId, enabled]);

  return { saving, lastSavedAt, saveError, saveNow, cancelPending, markSynced };
}
