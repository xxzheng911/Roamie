import { resolveSessionDestination } from "@/lib/ai/conversation-state";
import {
  addSelectedPlace,
  roamieRecToChatItem,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import {
  curatedTripLocationToPlaceInput,
  resolveCuratedTripLocationByDestination,
} from "@/lib/trip-location-curated";
import { logPlanAiBootstrapSkipped } from "@/lib/plan/plan-ai-generation-log";

/**
 * 規劃頁 AI 生成：不跑 Google Places 搜尋（避免 90s 卡住）。
 * 使用表單目的地錨點 + 已選地點，OpenAI 負責排行程。
 */
export function bootstrapPlanPlacesMinimal(
  session: ChatPlanningSession,
  form: PlanTripFormInput,
): ChatPlanningSession {
  logPlanAiBootstrapSkipped("plan_fast_path_no_places_api");

  const dest =
    resolveSessionDestination(session) ||
    formatTripLocationLabel(form.destination);
  const tripLoc =
    session.tripDestination ??
    resolveCuratedTripLocationByDestination(dest) ??
    form.destination;

  let next: ChatPlanningSession = {
    ...session,
    tripDays: form.days ?? session.tripDays,
    tripDestination: tripLoc,
    tripStyles: form.styles.length ? form.styles.join("、") : session.tripStyles,
    lastItineraryGenerationSource: "plan",
  };

  const existingKeys = new Set(next.selectedPlaces.map(placeIdentityKey));

  for (const rec of form.selectedPlaces ?? []) {
    const item = roamieRecToChatItem(rec);
    const key = placeIdentityKey(item);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    next = addSelectedPlace(next, item, { source: "plan" });
  }

  if (next.selectedPlaces.length < 1 && tripLoc) {
    const anchor = curatedTripLocationToPlaceInput(tripLoc);
    next = addSelectedPlace(
      next,
      {
        ...anchor,
        type: "目的地",
        description: `${dest} — 規劃起點`,
        reason: "規劃表單目的地錨點",
        reasonSource: "template",
        estimatedTime: "約 2 小時",
        recommendationSource: "chat",
        nearbyPlacesSource: "curated_fallback",
      },
      { source: "plan" },
    );
  }

  console.info("[PLAN_AI] minimal places ready", {
    count: next.selectedPlaces.length,
    destination: dest,
  });
  return next;
}
