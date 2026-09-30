import { useSyncExternalStore } from "react";
import { getTripCoverUpdate, SAVED_TRIPS_CHANGED_EVENT } from "./cover-live-state";

function subscribe(listener: () => void) {
  window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, listener);
}

export function useLiveTripCover(tripId: string) {
  return useSyncExternalStore(
    subscribe,
    () => getTripCoverUpdate(tripId),
    () => undefined,
  );
}
