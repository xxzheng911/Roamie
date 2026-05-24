import type { TravelPreferences } from "@/lib/preferences-storage";

export const PREFS_UPDATED_EVENT = "roamie:prefs-updated";

export function broadcastPreferencesUpdate(prefs: TravelPreferences): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFS_UPDATED_EVENT, { detail: prefs }));
}
