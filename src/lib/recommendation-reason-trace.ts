import type { PlaceResult } from "@/lib/place-result";
import type { ReviewSignal } from "@/lib/place-review-evidence";
import { isDevVerboseLog } from "@/lib/dev-verbose-log";

/** No raw review text or author data; safe summary shared by runtime and controlled verification. */
export function buildRecommendationReasonTrace(
  place: PlaceResult,
  surface: string,
  finalReason: string,
  acceptedSignals: ReviewSignal[],
  hours: string,
) {
  const review = place.reviewEvidence;
  const trace = review?.trace;
  return {
    placeId: place.id,
    placeName: place.name,
    surface,
    rawReviewsCount: trace?.rawReviewsCount ?? null,
    normalizedReviewsCount: trace?.normalizedReviewsCount ?? null,
    reviewsWithTextCount: trace?.reviewsWithTextCount ?? null,
    candidateSignals: trace?.candidateSignals ?? [],
    acceptedSignals,
    rejectedSignals: [
      ...(trace?.rejectedSignals ?? []),
      ...(review?.signals ?? [])
        .filter(
          (s) => !acceptedSignals.some((a) => a.topic === s.topic && a.sentiment === s.sentiment),
        )
        .map((s) => ({
          topic: s.topic,
          supportCount: s.supportCount,
          reason: "conflicting_or_unselected_signal",
        })),
    ],
    rejectionReasons: trace?.rejectionReasons ?? ["review_capability_unavailable"],
    placeType: place.primaryType ?? place.types?.[0] ?? null,
    openingHoursAvailable: !!(
      place.currentOpeningHours ||
      place.regularOpeningHours ||
      place.todayHoursLabel
    ),
    openingHoursRendered: !!hours,
    ratingAvailable: place.rating != null,
    reviewCountAvailable: place.userRatingCount != null,
    reasonEvidenceSources: [
      "place_identity",
      ...(acceptedSignals.length ? ["google_review_sample"] : []),
      ...(place.reasonClaimEvidence?.length ? ["factual_features"] : []),
      ...(hours ? ["opening_hours"] : []),
    ],
    finalReason,
  };
}

const lastTrace = new Map<string, string>();
export function emitRecommendationReasonTrace(
  trace: ReturnType<typeof buildRecommendationReasonTrace>,
): void {
  let scoped = false;
  try {
    scoped =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("roamie:reason-trace-place-id") === trace.placeId;
  } catch {
    /* storage unavailable */
  }
  if (!scoped && !isDevVerboseLog()) return;
  const key = `${trace.placeId}|${trace.surface}`;
  const signature = JSON.stringify(trace);
  if (lastTrace.get(key) === signature) return;
  if (lastTrace.size >= 120) lastTrace.delete(lastTrace.keys().next().value!);
  lastTrace.set(key, signature);
  console.info("[RECOMMENDATION_REASON_TRACE]", trace);
}
