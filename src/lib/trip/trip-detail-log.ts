const reloadSkipLogged = new Set<string>();

export function resetTripDetailSkipLogs(tripId?: string): void {
  if (!tripId) {
    reloadSkipLogged.clear();
    return;
  }
  for (const key of [...reloadSkipLogged]) {
    if (key.startsWith(`${tripId}:`)) reloadSkipLogged.delete(key);
  }
}

export function logTripDetailMount(tripId: string): void {
  console.info("[TRIP_DETAIL_MOUNT]", { tripId });
}

export function logTripDetailRender(meta: {
  tripId: string;
  renderCount: number;
  changedDeps: string[];
}): void {
  console.info("[TRIP_DETAIL_RENDER]", meta);
}

export function logDebouncedSaveEffectTriggered(meta: {
  tripId: string;
  reason: string;
  changedDeps: string[];
  fingerprint?: string;
}): void {
  console.info("[DEBOUNCED_SAVE_EFFECT_TRIGGERED]", meta);
}

export function logDebouncedSaveDisabledTest(tripId: string): void {
  console.info("[DEBOUNCED_SAVE_DISABLED_TEST]", { tripId, autoSave: false });
}

export function logDebouncedSavePayloadStable(meta: {
  tripId: string;
  fingerprint: string;
}): void {
  console.info("[DEBOUNCED_SAVE_PAYLOAD_STABLE]", meta);
}

export function logDebouncedSaveDepChanged(meta: {
  tripId: string;
  changedKeys: string[];
  previousFingerprint: string;
  nextFingerprint: string;
}): void {
  console.info("[DEBOUNCED_SAVE_DEP_CHANGED]", meta);
}

/** 同一 tripId + reason 只 log 一次，避免 console 連刷 */
export function logTripDetailReloadSkipped(
  tripId: string,
  reason: string,
  meta?: {
    source?: string;
    effect?: string;
    fingerprint?: string;
    baseline?: string | null;
  },
): void {
  const key = `${tripId}:${reason}:${meta?.source ?? ""}`;
  if (reloadSkipLogged.has(key)) return;
  reloadSkipLogged.add(key);
  console.info("[TRIP_DETAIL_RELOAD_SKIPPED]", {
    tripId,
    reason,
    ...meta,
  });
}

export function logTripDetailNavSkipped(tripId: string, reason: string): void {
  console.info("[TRIP_DETAIL_NAV_SKIPPED]", { tripId, reason });
}

export function logOutfitSuggestionSkipped(tripId: string, reason: string): void {
  console.info("[OUTFIT_SUGGESTION_SKIPPED]", { tripId, reason });
}
