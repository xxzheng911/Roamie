import type { Locale } from "@/lib/i18n/types";
import { resolveSessionDestination } from "@/lib/ai/conversation-state";
import {
  addSelectedPlace,
  mapPlaceResultToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { filterVerifiedPlaceResults } from "@/lib/place-verification";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import {
  curatedTripLocationToPlaceInput,
  resolveCuratedTripLocationByDestination,
} from "@/lib/trip-location-curated";
import type { TripLocation } from "@/lib/location/types";
import { normalizeDestination } from "@/lib/ai/normalize-destination";

/** AI 候選真實地標（再以 Google Places 驗證） */
const DESTINATION_LANDMARKS: Record<string, string[]> = {
  釜山: [
    "海雲台海水浴場",
    "甘川文化村",
    "廣安里海水浴場",
    "札嘎其市場",
    "西面市場",
    "南浦洞",
    "釜山塔",
    "太宗台",
    "機張市場",
    "松島天空步道",
  ],
  首爾: [
    "景福宮",
    "北村韓屋村",
    "弘大",
    "明洞",
    "南山首爾塔",
    "梨泰院",
    "東大門",
    "汉江公园",
  ],
  東京: ["淺草寺", "東京鐵塔", "上野公園", "新宿御苑", "澀谷", "秋葉原", "明治神宮"],
  大阪: ["大阪城", "道頓堀", "通天閣", "環球影城", "心齋橋", "黑門市場"],
  京都: ["清水寺", "伏見稻荷大社", "嵐山", "金閣寺", "祇園", "二条城"],
};

function landmarkCandidates(destination: string): string[] {
  const norm = normalizeDestination(destination) ?? destination;
  if (DESTINATION_LANDMARKS[norm]) return DESTINATION_LANDMARKS[norm];
  return [`${norm} 景點`, `${norm} 美食`, `${norm} 市場`, `${norm} 公園`];
}

function destinationFallbackPlace(
  session: ChatPlanningSession,
  tripLoc: TripLocation,
): ChatPlaceItem {
  const base = curatedTripLocationToPlaceInput(tripLoc);
  return {
    ...base,
    name: base.name,
    placeName: base.placeName,
    type: "目的地",
    description: `${tripLoc.displayLabel} — 可依喜好再調整景點`,
    reason: "依對話條件自動納入的目的地錨點",
    reasonSource: "template",
    estimatedTime: "半天",
    recommendationSource: "chat",
    nearbyPlacesSource: "places_search",
  };
}

async function searchLandmark(
  searchFn: SearchPlacesFn,
  query: string,
  tripLoc: TripLocation,
  locale: Locale,
): Promise<ChatPlaceItem[]> {
  const { places, error } = await searchFn({
    data: {
      query,
      lat: tripLoc.lat,
      lng: tripLoc.lng,
      mode: "text",
      locale,
      radius: 30_000,
    },
  });
  if (error) console.warn("[COMPANION_BOOTSTRAP] search error", query, error);
  return filterVerifiedPlaceResults(places).slice(0, 2).map((p) =>
    mapPlaceResultToChatItem(p, {
      locale,
      currentTime: new Date(),
    }),
  );
}

/**
 * 使用者確認排行程但尚未選點時：以目的地地標候選 + Places 驗證建立 selectedPlaces。
 */
export async function bootstrapCompanionTripPlaces(
  session: ChatPlanningSession,
  searchFn: SearchPlacesFn,
  locale: Locale = "zh-TW",
): Promise<ChatPlanningSession> {
  const dest = resolveSessionDestination(session);
  const days = session.conversationState?.days ?? session.tripDays ?? 5;
  const targetCount = Math.min(12, Math.max(6, days * 2));

  const tripLoc =
    (dest ? resolveCuratedTripLocationByDestination(dest) : null) ??
    session.tripDestination ??
    null;

  let next: ChatPlanningSession = {
    ...session,
    tripDays: days,
    tripDestination: tripLoc ?? session.tripDestination,
    lastItineraryGenerationSource: "chat",
  };

  const existingKeys = new Set(next.selectedPlaces.map(placeIdentityKey));
  const collected: ChatPlaceItem[] = [...next.selectedPlaces];

  if (tripLoc && collected.length < targetCount) {
    for (const landmark of landmarkCandidates(dest ?? tripLoc.city)) {
      if (collected.length >= targetCount) break;
      const query = landmark.includes(dest ?? "") ? landmark : `${dest ?? tripLoc.city} ${landmark}`;
      try {
        const items = await searchLandmark(searchFn, query, tripLoc, locale);
        for (const item of items) {
          const key = placeIdentityKey(item);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          collected.push(item);
        }
      } catch (e) {
        console.warn("[COMPANION_BOOTSTRAP] landmark failed", query, e);
      }
    }
  }

  if (collected.length < 1 && tripLoc) {
    collected.push(destinationFallbackPlace(next, tripLoc));
  }

  for (const place of collected) {
    if (next.selectedPlaces.some((p) => placeIdentityKey(p) === placeIdentityKey(place))) {
      continue;
    }
    next = addSelectedPlace(next, place, { source: "chat" });
  }

  const state = next.conversationState;
  if (state) {
    next = {
      ...next,
      conversationState: {
        ...state,
        stage: "planning_confirmed",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  console.info("[COMPANION_BOOTSTRAP] places=", next.selectedPlaces.length, "dest=", dest);
  return next;
}
