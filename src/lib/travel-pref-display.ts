import type { TravelPreferences } from "@/lib/preferences-storage";
import { t, type MessageKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

const PACE_KEYS: Record<NonNullable<TravelPreferences["pace"]>, MessageKey> = {
  slow: "profile.paceSlow",
  medium: "profile.paceMedium",
  active: "profile.paceActive",
};

const VIBE_KEYS: Record<NonNullable<TravelPreferences["vibe"]>, MessageKey> = {
  quiet: "profile.vibeQuiet",
  either: "profile.vibeEither",
  lively: "profile.vibeLively",
};

export function formatTravelPaceLabel(
  locale: Locale,
  pace?: TravelPreferences["pace"],
): string | null {
  if (!pace) return null;
  return t(locale, PACE_KEYS[pace] ?? "profile.paceMedium");
}

export function formatTravelVibeLabel(
  locale: Locale,
  vibe?: TravelPreferences["vibe"],
): string | null {
  if (!vibe) return null;
  return t(locale, VIBE_KEYS[vibe] ?? "profile.vibeEither");
}
