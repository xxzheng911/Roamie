import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  classifyPlanPlaceKind,
  type ComposedDayPlan,
  type DayPlanEntry,
} from "@/lib/ai/ai-day-plan-source";
import { filterExcludedRetailPlaces, isExcludedRetailPlace } from "@/lib/ai/ai-day-plan-slot-rules";
import { placeHasValidCoordinates } from "@/lib/ai/planning-place-geocode";
import { logItineraryRenderWithPartialDetails } from "@/lib/ai/planning-place-id";
import { logChatGeocodeSkip } from "@/lib/ai/chat-place-flow-log";
import { dedupePlaceCardsForRender, resolvePlaceCardDedupeKey, resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";

function entryPlaceId(entry: DayPlanEntry): string {
  return (entry.place.id ?? "").trim();
}

function matchPlaceInPool(entry: DayPlanEntry, pool: PlaceResult[]): PlaceResult | undefined {
  const entryId = entryPlaceId(entry);
  if (entryId) {
    const byId = pool.find((p) => p.id === entryId);
    if (byId) return byId;
  }
  const entryName = normalizePlaceName(entry.name);
  return pool.find((p) => normalizePlaceName(p.name) === entryName);
}

function slotTypeLabel(entry: DayPlanEntry): string {
  const kind = classifyPlanPlaceKind(entry.place);
  if (kind === "restaurant" || kind === "night_market") return "餐廳";
  if (kind === "cafe") return "咖啡廳";
  if (kind === "shopping") return "商圈";
  return entry.label || "景點";
}

function dedupeByPlaceIdOnly(items: RoamieRecommendationItem[]): RoamieRecommendationItem[] {
  return dedupePlaceCardsForRender(items);
}

export function logAiDayPlanItems(count: number): void {
  logAiPipeline("[AI_DAY_PLAN_ITEMS]", `count=${count}`);
}

export function logAiPushPlaceCards(count: number, expected: number): void {
  logAiPipeline("[AI_PUSH_PLACE_CARDS]", `count=${count}`, `expected=${expected}`);
}

export async function resolveDayPlanPlaceCards(params: {
  composedPlans: ComposedDayPlan[];
  placesPool: PlaceResult[];
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  context: CanonicalTravelContext;
  searchPlaces: PlaceSearchFn;
}): Promise<RoamieRecommendationItem[]> {
  const {
    composedPlans,
    placesPool,
    destination,
    lat,
    lng,
    locale,
    context,
    searchPlaces,
  } = params;

  const entries = composedPlans.flatMap((plan) =>
    plan.entries.filter((entry) => !isExcludedRetailPlace(entry.place)),
  );
  logAiDayPlanItems(entries.length);

  const resolved: RoamieRecommendationItem[] = [];
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    if (!entry.name?.trim()) continue;

    const entryKey =
      resolveTripPlaceId(entry.place) ||
      resolvePlaceCardDedupeKey({ name: entry.name, address: entry.place.address });
    if (entryKey && seenKeys.has(entryKey)) continue;
    if (entryKey) seenKeys.add(entryKey);

    const typeLabel = slotTypeLabel(entry);
    logAiPipeline("[AI_PLACE_CARD_RESOLVE_START]", `name=${entry.name}`, `type=${typeLabel}`);

    let place = matchPlaceInPool(entry, placesPool);

    if (!place || (!place.id && (place.lat == null || place.lng == null))) {
      try {
        const search = await searchPlaces({
          data: {
            query: `${destination} ${entry.name}`,
            lat,
            lng,
            mode: "text",
            locale,
            placesCaller: "day_plan_text_search",
            placesScreen: "chat",
            destinationName: destination,
            searchMode: "destination",
          },
        });
        const found =
          search.places?.find(
            (p) => normalizePlaceName(p.name) === normalizePlaceName(entry.name),
          ) ?? search.places?.[0];
        if (found && !isExcludedRetailPlace(found)) {
          place = found;
          logAiPipeline(
            "[AI_PLACE_CARD_RESOLVE_SUCCESS]",
            `name=${entry.name}`,
            `placeId=${found.id}`,
          );
        }
      } catch {
        // fall through to basic card
      }
    } else {
      logAiPipeline(
        "[AI_PLACE_CARD_RESOLVE_SUCCESS]",
        `name=${entry.name}`,
        `placeId=${place.id}`,
      );
    }

    if (!place) {
      place = entry.place;
      logItineraryRenderWithPartialDetails(1);
    }

    if (!place?.name?.trim()) {
      logChatGeocodeSkip(entry.name, "resolve_failed");
      continue;
    }

    if (!placeHasValidCoordinates(place)) {
      logItineraryRenderWithPartialDetails(1);
    }

    const card = mapPlaceResultToChatItem(place, {
      mood: context.mood,
      locale,
      categoryLabel: typeLabel,
    });
    if (!card.name?.trim()) {
      logAiPipeline("[AI_PLACE_CARD_MISSING]", `name=${entry.name}`, "reason=empty_card");
      continue;
    }
    const cardKey = resolvePlaceCardDedupeKey(card) || entryKey;
    if (cardKey && seenKeys.has(cardKey)) continue;
    if (cardKey) seenKeys.add(cardKey);
    resolved.push(card);
  }

  const deduped = dedupeByPlaceIdOnly(resolved);
  logAiPushPlaceCards(deduped.length, entries.length);
  if (deduped.length < entries.length) {
    const resolvedNames = new Set(deduped.map((r) => normalizePlaceName(r.name)));
    for (const entry of entries) {
      if (!resolvedNames.has(normalizePlaceName(entry.name))) {
        logAiPipeline("[AI_PLACE_CARD_MISSING]", `name=${entry.name}`, "reason=not_in_output");
      }
    }
  }
  return deduped;
}
