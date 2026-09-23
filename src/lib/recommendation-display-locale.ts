import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "@/lib/build-place-recommendation-reason";
import { isCurrentGeneratedCopy } from "@/lib/generated-locale";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import { getLocalizedPlaceCategoryLabel } from "@/lib/place-category";
import type { StoredRecommendation } from "@/lib/recommendation-storage";

/** A read-only view of generated recommendations. Never write this projection back to storage.
 * Unknown legacy language is treated as a mismatch. IDs, coordinates, dates, ordering,
 * official names and addresses survive; original generated prose remains in storage.
 * This deliberately does not process editable saved-trip notes or user-created titles.
 */
export function recommendationDisplayForLocale(
  record: StoredRecommendation,
  locale: Locale,
): StoredRecommendation {
  if (isCurrentGeneratedCopy(record, locale)) return record;
  const title = translate(locale, "productionUi.savedRecommendations");
  return {
    ...record,
    title,
    mood: null,
    payload: {
      ...record.payload,
      title,
      summary: translate(locale, "productionUi.savedLocaleNotice"),
      moodTag: "",
      recommendations: record.payload.recommendations.map((place) => ({
        ...place,
        description: "",
        reason: buildPlaceRecommendationReason(
          resolveRecommendationReasonPlace(place),
          null,
          null,
          undefined,
          undefined,
          locale,
        ),
        reasonSource: "template",
        estimatedTime: "",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
      })),
      itinerary: record.payload.itinerary.map((stop) => ({
        ...stop,
        title: stop.placeName || translate(locale, "uiCoverage.category_unknown"),
        description: "",
        notes: "",
        recommendationReason: "",
        openStatusLabel: "",
        todayHoursLabel: "",
      })),
    },
  };
}
