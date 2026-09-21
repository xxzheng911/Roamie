import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import { isCurrentGeneratedCopy, type GeneratedLocaleContract } from "@/lib/generated-locale";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { getLocalizedPlaceCategoryLabel } from "@/lib/place-category";

/** Read-only projection for NEW UI/handoffs, not historical conversation rendering.
 * No identities, coordinates, ordering, external names or user notes are translated.
 */
export function generatedPlacesForLocale(
  places: RoamieRecommendationItem[], provenance: GeneratedLocaleContract, locale: Locale,
): RoamieRecommendationItem[] {
  if (isCurrentGeneratedCopy(provenance, locale)) return places;
  return places.map((place) => ({ ...place,
    description: "",
    reason: translate(locale, "productionUi.placeCategory", {
      category: getLocalizedPlaceCategoryLabel(place, locale),
    }),
    reasonSource: "template",
    estimatedTime: "", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  }));
}

/** Availability enrichment must not append cached zh-TW labels to current AI prose. */
export function localizedAvailabilityCopy(place: RoamieRecommendationItem, locale: Locale, openStatus: string): RoamieRecommendationItem {
  const hint = openStatus === "closing_soon" || Boolean(place.closingSoonNote)
    ? translate(locale, "destinationEditorial.closing_hint")
    : openStatus === "closed_now" || openStatus === "closed_today"
      ? translate(locale, "destinationEditorial.closed_hint") : "";
  return { ...place, reason: [place.reason, hint].filter(Boolean).join(" "),
    openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" };
}
