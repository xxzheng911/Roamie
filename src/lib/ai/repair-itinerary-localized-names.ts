/**
 * Hydration repair for legacy itineraries that only stored raw/local names.
 * Runs on open / app restart / shared / collaborative load — does not require regen.
 */
import { applyItineraryLocalizationGate } from "@/lib/ai/itinerary-localization-gate";
import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  hasForeignLocalScript,
  hasLocalLatinDiacritics,
} from "@/lib/place-display-name";

function needsRepair(
  item: RoamieItineraryItem,
  locale: Locale,
): boolean {
  const localized = (item.localizedDisplayName ?? "").trim();
  if (!localized) return true;
  if (hasForeignLocalScript(localized, locale)) return true;
  if (hasLocalLatinDiacritics(localized)) return true;
  const shown = (item.placeName || item.title || "").trim();
  if (shown && hasForeignLocalScript(shown, locale)) return true;
  if (shown && hasLocalLatinDiacritics(shown)) return true;
  return false;
}

/**
 * Re-resolve missing / foreign-script stop names and write localizedDisplayName.
 */
export function repairItineraryLocalizedNames(
  items: readonly RoamieItineraryItem[],
  opts?: { locale?: Locale; tripId?: string },
): { items: RoamieItineraryItem[]; repairedCount: number; gatePass: boolean } {
  const locale = opts?.locale ?? effectiveAppLocale();
  const dirty = items.some((i) => needsRepair(i, locale));
  if (!dirty && items.every((i) => (i.localizedDisplayName ?? "").trim())) {
    return { items: [...items], repairedCount: 0, gatePass: true };
  }

  const before = items.map((i) => (i.localizedDisplayName || i.placeName || i.title || "").trim());
  const gated = applyItineraryLocalizationGate(items, {
    locale,
    tripId: opts?.tripId,
    // Hydration: prefer readable English over foreign script; Gate summary still logs.
    softPassEnglish: true,
  });
  let repairedCount = 0;
  gated.items.forEach((item, idx) => {
    const after = (item.localizedDisplayName || item.placeName || "").trim();
    if (after !== before[idx]) repairedCount += 1;
  });

  return {
    items: gated.items,
    repairedCount,
    gatePass: gated.gatePass,
  };
}

/** Repair itinerary inside a V2 payload; returns a new payload when changes occur. */
export function repairPayloadLocalizedNames(
  payload: RoamiePayloadV2,
  opts?: { locale?: Locale; tripId?: string },
): { payload: RoamiePayloadV2; repairedCount: number; changed: boolean } {
  const itinerary = payload.itinerary ?? [];
  if (!itinerary.length) {
    return { payload, repairedCount: 0, changed: false };
  }
  const result = repairItineraryLocalizedNames(itinerary, opts);
  if (result.repairedCount === 0) {
    // Still sync placeName/title to localizedDisplayName when field was missing but resolve unchanged.
    const synced = result.items;
    const needsSync = itinerary.some(
      (item, i) =>
        (item.localizedDisplayName ?? "") !== (synced[i]?.localizedDisplayName ?? "") ||
        (item.placeName ?? "") !== (synced[i]?.placeName ?? ""),
    );
    if (!needsSync) return { payload, repairedCount: 0, changed: false };
  }
  return {
    payload: { ...payload, itinerary: result.items },
    repairedCount: result.repairedCount,
    changed: true,
  };
}
