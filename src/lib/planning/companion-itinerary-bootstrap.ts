import type { Locale } from "@/lib/i18n/types";
import { resolveSessionDestination } from "@/lib/ai/conversation-state";
import {
  addSelectedPlace,
  mapPlaceResultToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { withTimeout } from "@/lib/async/with-timeout";
import { filterVerifiedPlaceResults } from "@/lib/place-verification";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import {
  curatedTripLocationToPlaceInput,
  resolveCuratedTripLocationByDestination,
} from "@/lib/trip-location-curated";
import type { TripLocation } from "@/lib/location/types";
import { normalizeDestination } from "@/lib/ai/normalize-destination";
import {
  buildStyleAwarePlaceSearchQueries,
  parsePlanStyleLabels,
  shouldSkipGenericDestinationLandmarks,
} from "@/lib/plan/plan-style-itinerary";

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
  東京: [
    "淺草寺",
    "東京鐵塔",
    "上野公園",
    "新宿御苑",
    "澀谷",
    "秋葉原",
    "明治神宮",
    "富士山",
    "哈利波特影城",
  ],
  大阪: ["大阪城", "道頓堀", "通天閣", "環球影城", "心齋橋", "黑門市場"],
  京都: ["清水寺", "伏見稻荷大社", "嵐山", "金閣寺", "祇園", "二条城"],
};

function landmarkCandidates(destination: string): string[] {
  const norm = normalizeDestination(destination) ?? destination;
  if (DESTINATION_LANDMARKS[norm]) return DESTINATION_LANDMARKS[norm];
  return [`${norm} 景點`, `${norm} 美食`, `${norm} 市場`, `${norm} 公園`];
}

function curatedLandmarkPlace(
  tripLoc: TripLocation,
  landmark: string,
  destination: string,
): ChatPlaceItem {
  return {
    name: landmark,
    placeName: landmark,
    lat: tripLoc.lat,
    lng: tripLoc.lng,
    type: "景點",
    address: `${destination} ${landmark}`,
    description: `${landmark} — 可依喜好調整停留時間`,
    reason: "精選地標（稍後可補齊座標）",
    reasonSource: "template",
    estimatedTime: "約 2 小時",
    recommendationSource: "chat",
    nearbyPlacesSource: "curated_fallback",
  };
}

function appendCuratedLandmarksWithoutSearch(
  collected: ChatPlaceItem[],
  existingKeys: Set<string>,
  tripLoc: TripLocation,
  destination: string,
  targetCount: number,
): void {
  for (const landmark of landmarkCandidates(destination)) {
    if (collected.length >= targetCount) break;
    const key = placeIdentityKey({ placeName: landmark, name: landmark });
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    collected.push(curatedLandmarkPlace(tripLoc, landmark, destination));
  }
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

export type CompanionBootstrapOptions = {
  /** 風格導向搜尋最多嘗試幾個 query（規劃頁建議 5–6，避免長時間 loading） */
  maxStyleQueries?: number;
  /** 單次 Places 搜尋逾時（毫秒） */
  searchTimeoutMs?: number;
};

async function searchLandmark(
  searchFn: SearchPlacesFn,
  query: string,
  tripLoc: TripLocation,
  locale: Locale,
  searchTimeoutMs?: number,
): Promise<ChatPlaceItem[]> {
  const run = searchFn({
    data: {
      query,
      lat: tripLoc.lat,
      lng: tripLoc.lng,
      mode: "text",
      locale,
      radius: 30_000,
    },
  });
  const { places, error } = searchTimeoutMs
    ? await withTimeout(run, searchTimeoutMs, `places_search:${query.slice(0, 40)}`).catch(
        (e) => {
          console.warn("[COMPANION_BOOTSTRAP] search timeout", query, e);
          return { places: [] as Awaited<ReturnType<SearchPlacesFn>>["places"], error: String(e) };
        },
      )
    : await run;
  if (error) {
    console.warn("[COMPANION_BOOTSTRAP] search error", query, error);
    /** 已有 selectedPlaces 時不應因搜尋失敗中斷；此處僅記 log */
  }
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
  options?: CompanionBootstrapOptions,
): Promise<ChatPlanningSession> {
  const maxStyleQueries = options?.maxStyleQueries ?? 14;
  const searchTimeoutMs = options?.searchTimeoutMs ?? 20_000;
  const dest = resolveSessionDestination(session);
  const days = session.conversationState?.days ?? session.tripDays ?? 5;

  if (session.selectedPlaces.length > 0) {
    const tripLoc =
      (dest ? resolveCuratedTripLocationByDestination(dest) : null) ??
      session.tripDestination ??
      null;
    console.info("[SELECTED_PLACES_READY]", {
      count: session.selectedPlaces.length,
      destination: dest,
      days,
      skipPlacesSearch: true,
    });
    return {
      ...session,
      tripDays: days,
      tripDestination: tripLoc ?? session.tripDestination,
      lastItineraryGenerationSource: session.lastItineraryGenerationSource ?? "chat",
    };
  }

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

  const mustInclude =
    session.travelContext?.mustIncludePlaces ??
    session.conversationContext?.mustIncludePlaces ??
    [];

  const styleLabels = parsePlanStyleLabels(session.tripStyles);
  const skipGenericLandmarks = shouldSkipGenericDestinationLandmarks(styleLabels);

  if (tripLoc && styleLabels.length > 0) {
    const styleQueries = buildStyleAwarePlaceSearchQueries(dest ?? tripLoc.city, styleLabels).slice(
      0,
      maxStyleQueries,
    );
    console.info("[COMPANION_BOOTSTRAP] style-first search", {
      destination: dest,
      styles: styleLabels,
      queryCount: styleQueries.length,
      skipGenericLandmarks,
    });
    for (const query of styleQueries) {
      if (collected.length >= targetCount) break;
      try {
        const items = await searchLandmark(
          searchFn,
          query,
          tripLoc,
          locale,
          searchTimeoutMs,
        );
        for (const item of items) {
          const key = placeIdentityKey(item);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          collected.push(item);
        }
      } catch (e) {
        console.warn("[COMPANION_BOOTSTRAP] style search failed", query, e);
      }
    }
  }

  if (tripLoc && mustInclude.length > 0) {
    for (const place of mustInclude) {
      const query = place.includes(dest ?? tripLoc.city)
        ? place
        : `${dest ?? tripLoc.city} ${place}`;
      try {
        const items = await searchLandmark(searchFn, query, tripLoc, locale, searchTimeoutMs);
        for (const item of items) {
          const key = placeIdentityKey(item);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          collected.push(item);
        }
        if (items.length === 0) {
          const key = placeIdentityKey({ placeName: place, name: place });
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            collected.push(curatedLandmarkPlace(tripLoc, place, dest ?? tripLoc.city));
          }
        }
      } catch (e) {
        console.warn("[COMPANION_BOOTSTRAP] must-include search failed", query, e);
        const key = placeIdentityKey({ placeName: place, name: place });
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          collected.push(curatedLandmarkPlace(tripLoc, place, dest ?? tripLoc.city));
        }
      }
    }
  }

  if (tripLoc && collected.length < targetCount && !skipGenericLandmarks) {
    for (const landmark of landmarkCandidates(dest ?? tripLoc.city)) {
      if (collected.length >= targetCount) break;
      const query = landmark.includes(dest ?? "") ? landmark : `${dest ?? tripLoc.city} ${landmark}`;
      try {
        const items = await searchLandmark(searchFn, query, tripLoc, locale, searchTimeoutMs);
        for (const item of items) {
          const key = placeIdentityKey(item);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          collected.push(item);
        }
        if (items.length === 0) {
          const landmarkName = landmark.replace(new RegExp(`^${dest ?? tripLoc.city}\\s*`), "").trim() || landmark;
          const key = placeIdentityKey({ placeName: landmarkName, name: landmarkName });
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            collected.push(curatedLandmarkPlace(tripLoc, landmarkName, dest ?? tripLoc.city));
          }
        }
      } catch (e) {
        console.warn("[COMPANION_BOOTSTRAP] landmark failed", query, e);
        const landmarkName = landmark.replace(new RegExp(`^${dest ?? tripLoc.city}\\s*`), "").trim() || landmark;
        const key = placeIdentityKey({ placeName: landmarkName, name: landmarkName });
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          collected.push(curatedLandmarkPlace(tripLoc, landmarkName, dest ?? tripLoc.city));
        }
      }
    }

    if (collected.length < Math.min(4, targetCount)) {
      appendCuratedLandmarksWithoutSearch(
        collected,
        existingKeys,
        tripLoc,
        dest ?? tripLoc.city,
        targetCount,
      );
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
