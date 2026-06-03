import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { updateItinerary } from "@/lib/itinerary-storage";
import { TRIP_EDITOR_AUTO_SAVE_DISABLED } from "@/lib/saved-trip/trip-editor-stable-payload";
import {
  logDebouncedSaveDepChanged,
  logDebouncedSaveDisabledTest,
  logDebouncedSaveEffectTriggered,
  logDebouncedSavePayloadStable,
  resetTripDetailSkipLogs,
} from "@/lib/trip/trip-detail-log";

const SAVE_DEBOUNCE_MS = 700;

type Params = {
  tripId: string;
  payload: RoamiePayloadV2;
  payloadFingerprint: string;
  enabled: boolean;
};

/**
 * 行程編輯器自動儲存。
 * TRIP_EDITOR_AUTO_SAVE_DISABLED 時：不追蹤 fingerprint、不觸發 save effect、不更新 fpRevision。
 */
export function useTripEditorAutoSave({
  tripId,
  payload,
  payloadFingerprint,
  enabled,
}: Params): { saving: boolean; lastSavedAt: number | null; saveError: string | null } {
  const disabled = TRIP_EDITOR_AUTO_SAVE_DISABLED;

  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const versionRef = useRef(0);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const baselineFingerprintRef = useRef<string | null>(null);
  const lastPersistedFingerprintRef = useRef<string | null>(null);
  const lastHandledFingerprintRef = useRef<string | null>(null);
  const baselineLockedRef = useRef(false);
  const stableLoggedRef = useRef(false);
  const disabledLoggedRef = useRef(false);
  const tripIdRef = useRef(tripId);
  const lastFpRef = useRef(payloadFingerprint);
  const [fpRevision, setFpRevision] = useState(0);

  useEffect(() => {
    if (!disabled || !tripId || disabledLoggedRef.current) return;
    disabledLoggedRef.current = true;
    logDebouncedSaveDisabledTest(tripId);
  }, [tripId, disabled]);

  useEffect(() => {
    if (disabled) return;
    if (tripIdRef.current !== tripId) {
      tripIdRef.current = tripId;
      baselineFingerprintRef.current = null;
      lastPersistedFingerprintRef.current = null;
      lastHandledFingerprintRef.current = null;
      baselineLockedRef.current = false;
      stableLoggedRef.current = false;
      lastFpRef.current = payloadFingerprint;
      resetTripDetailSkipLogs(tripId);
    }
  }, [tripId, payloadFingerprint, disabled]);

  useLayoutEffect(() => {
    if (disabled) return;
    const prev = lastFpRef.current;
    const next = payloadFingerprint;
    if (prev === next) return;

    logDebouncedSaveDepChanged({
      tripId,
      changedKeys: ["payloadFingerprint"],
      previousFingerprint: prev.slice(0, 64),
      nextFingerprint: next.slice(0, 64),
    });
    lastFpRef.current = next;
    setFpRevision((r) => r + 1);
  }, [tripId, payloadFingerprint, disabled]);

  useEffect(() => {
    if (disabled) return;
    if (!tripId || !enabled || baselineLockedRef.current) return;
    baselineLockedRef.current = true;
    const fp = lastFpRef.current;
    baselineFingerprintRef.current = fp;
    lastPersistedFingerprintRef.current = fp;
    lastHandledFingerprintRef.current = fp;
    if (!stableLoggedRef.current) {
      stableLoggedRef.current = true;
      logDebouncedSavePayloadStable({ tripId, fingerprint: fp.slice(0, 64) });
    }
  }, [tripId, enabled, disabled]);

  useEffect(() => {
    if (disabled) return;
    if (!enabled || !tripId) return;

    const fp = lastFpRef.current;
    if (fp === lastHandledFingerprintRef.current) {
      return;
    }
    lastHandledFingerprintRef.current = fp;

    const baseline = baselineFingerprintRef.current;
    if (baseline != null && fp === baseline) {
      return;
    }
    if (fp === lastPersistedFingerprintRef.current) {
      return;
    }

    logDebouncedSaveEffectTriggered({
      tripId,
      reason: "fingerprint_changed",
      changedDeps: ["payloadFingerprint"],
      fingerprint: fp.slice(0, 48),
    });

    const version = ++versionRef.current;
    const timer = window.setTimeout(() => {
      setSaving(true);
      const toSave = payloadRef.current;
      void updateItinerary(tripId, toSave, { reason: "editor_debounced" })
        .then(() => {
          if (version !== versionRef.current) return;
          lastPersistedFingerprintRef.current = fp;
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
  }, [tripId, enabled, fpRevision, disabled]);

  return {
    saving: disabled ? false : saving,
    lastSavedAt,
    saveError,
  };
}
