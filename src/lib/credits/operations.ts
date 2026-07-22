import {
  beginCreditsOperation,
  newCreditsRequestId,
  type CreditsOperationHandle,
} from "./runtime";
import type { BeginCreditsResult } from "./types";

export const INSUFFICIENT_CREDITS_PLACE_MESSAGE =
  "本月 AI 額度不足，無法取得新的地點推薦。升級 Plus 即可不限次數使用 AI 推薦。";

export const INSUFFICIENT_CREDITS_ITINERARY_MESSAGE =
  "本月 AI 額度不足，無法生成完整行程（需要 7 Credits）。升級 Plus 即可不限次數規劃旅程。";

export async function beginPlaceRecommendationCredits(opts: {
  hasPlusAccess: boolean;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<BeginCreditsResult> {
  return beginCreditsOperation({
    featureType: "PLACE_RECOMMENDATION",
    requestId: opts.requestId ?? newCreditsRequestId("place_rec"),
    hasPlusAccess: opts.hasPlusAccess,
    metadata: {
      billing_unit: "recommendation_batch",
      ...opts.metadata,
    },
  });
}

export async function beginItineraryGenerationCredits(opts: {
  hasPlusAccess: boolean;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<BeginCreditsResult> {
  return beginCreditsOperation({
    featureType: "ITINERARY_GENERATION",
    requestId: opts.requestId ?? newCreditsRequestId("itin_gen"),
    hasPlusAccess: opts.hasPlusAccess,
    metadata: {
      billing_unit: "full_itinerary",
      ...opts.metadata,
    },
  });
}

/** Commit on success delivery; rollback otherwise. Never throws. */
export async function settleCreditsOperation(
  handle: CreditsOperationHandle | null | undefined,
  success: boolean,
): Promise<void> {
  if (!handle || handle.inactive) return;
  try {
    if (success) await handle.commit();
    else await handle.rollback();
  } catch (e) {
    console.warn(
      "[CREDITS_SETTLE]",
      success ? "commit" : "rollback",
      e instanceof Error ? e.message : String(e),
    );
  }
}
