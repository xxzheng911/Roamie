import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { roamieRecToChatItem, type ChatPlaceItem } from "@/lib/chat-session";
import type { AiDayPlan } from "@/lib/ai/ai-day-plan-source";
import type { PlaceResult } from "@/lib/place-result";
import { dayPlanToChatPlaces } from "@/lib/ai/ai-day-plan-source";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  extractPlaceIds,
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
  isSimilarPlaceName,
  normalizePlaceName,
  placeIdentityKey,
  type PlaceLike,
} from "@/lib/place-planning-memory";
import { isExcludedRetailPlace } from "@/lib/ai/ai-day-plan-slot-rules";
import { isRefreshRecommendationsRequest } from "@/lib/ai/chat-recommendation-refresh";

export type TripUsedPlaces = {
  usedPlaceIds: string[];
  usedPlaceNames: string[];
  usedAreaKeys: string[];
};

const ITINERARY_LINE_RE =
  /^\s*-\s*(\d{1,2}:\d{2})\s+[^：:—\-]+[：:—\-]\s*(.+?)\s*$/;
const NUMBERED_LINE_RE = /^\s*\d+[\.、)]\s*(.+?)\s*$/;

const AREA_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "旗津", re: /旗津/i },
  { key: "駁二", re: /駁二|pier-?2/i },
  { key: "西子灣", re: /西子灣|西子湾/i },
  { key: "愛河", re: /愛河/i },
  { key: "蓮池潭", re: /蓮池潭/i },
  { key: "佛光山", re: /佛光山/i },
  { key: "美術館", re: /美術館|美術館區/i },
  { key: "六合夜市", re: /六合夜市|六合/i },
];

export function logAiFollowupMoreDetected(text: string): void {
  logAiPipeline("[AI_FOLLOWUP_MORE_DETECTED]", text.slice(0, 80));
}

export function logAiFollowupUsedPlacesCollected(counts: TripUsedPlaces): void {
  logAiPipeline(
    "[AI_FOLLOWUP_USED_PLACES_COLLECTED]",
    `ids=${counts.usedPlaceIds.length}`,
    `names=${counts.usedPlaceNames.length}`,
    `areas=${counts.usedAreaKeys.length}`,
  );
}

export function logAiFollowupDuplicateDropped(name: string, reason: string): void {
  logAiPipeline("[AI_FOLLOWUP_DUPLICATE_DROPPED]", `name=${name}`, `reason=${reason}`);
}

export function logAiFollowupNewResults(count: number): void {
  logAiPipeline("[AI_FOLLOWUP_NEW_RESULTS]", `count=${count}`);
}

export function logAiFollowupSessionUsedUpdated(counts: TripUsedPlaces): void {
  logAiPipeline(
    "[AI_FOLLOWUP_SESSION_USED_UPDATED]",
    `ids=${counts.usedPlaceIds.length}`,
    `names=${counts.usedPlaceNames.length}`,
    `areas=${counts.usedAreaKeys.length}`,
  );
}

export function isFollowUpMoreRequest(text: string): boolean {
  return isRefreshRecommendationsRequest(text);
}

export function resolveAreaKey(place: PlaceLike): string | null {
  const blob = [place.name, place.address, place.placeName].filter(Boolean).join(" ");
  for (const { key, re } of AREA_PATTERNS) {
    if (re.test(blob)) return key;
  }
  const district = blob.match(/([\u4e00-\u9fff]{2,5}區)/);
  return district?.[1] ?? null;
}

/** 從 assistant 訊息中的 dayPlan 收集地點卡 */
function extractDayPlanPlacesFromMsgs(msgs: ChatMsg[]): ChatPlaceItem[] {
  const all: ChatPlaceItem[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    const dayPlan = (m.roamie as { dayPlan?: AiDayPlan } | undefined)?.dayPlan;
    if (!dayPlan?.items.length) continue;
    for (const place of dayPlanToChatPlaces(dayPlan)) {
      const key = placeIdentityKey(place);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(place);
    }
  }
  return all;
}

/** 從所有 assistant 訊息收集已渲染的 place cards（非僅最後一批） */
export function extractAllRecommendedFromMsgs(msgs: ChatMsg[]): ChatPlaceItem[] {
  const all: ChatPlaceItem[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !m.roamie?.recommendations?.length) continue;
    for (const rec of m.roamie.recommendations) {
      const item = roamieRecToChatItem(rec);
      const key = placeIdentityKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
  }
  for (const place of extractDayPlanPlacesFromMsgs(msgs)) {
    const key = placeIdentityKey(place);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(place);
  }
  return all;
}

/** 從行程文字（Day 計畫摘要）解析地點名稱 */
export function extractPlaceNamesFromItineraryMessages(msgs: ChatMsg[]): string[] {
  const names = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !m.content?.trim()) continue;
    for (const line of m.content.split("\n")) {
      const itinerary = line.match(ITINERARY_LINE_RE);
      if (itinerary?.[2]) {
        names.add(itinerary[2].trim());
        continue;
      }
      const numbered = line.match(NUMBERED_LINE_RE);
      if (numbered?.[1] && !/Day\d/i.test(line)) {
        names.add(numbered[1].trim());
      }
    }
  }
  return [...names];
}

export function collectUsedPlaces(
  session: ChatPlanningSession,
  msgs?: ChatMsg[],
): TripUsedPlaces {
  const fromCards = extractAllRecommendedFromMsgs(msgs ?? []);
  const fromItinerary = extractPlaceNamesFromItineraryMessages(msgs ?? []);
  const fromSession = session.recommendedPlaces ?? [];
  const fromDayPlan = session.currentDayPlan?.items.length
    ? dayPlanToChatPlaces(session.currentDayPlan)
    : [];

  const usedPlaceIds = new Set<string>([
    ...(session.usedPlaceIds ?? []),
    ...(session.recommendedPlaceIds ?? []),
    ...extractPlaceIds(fromCards),
    ...extractPlaceIds(fromSession),
    ...extractPlaceIds(fromDayPlan),
    ...extractPlaceIds(session.selectedPlaces ?? []),
    ...extractPlaceIds(session.plannedStops ?? []),
  ]);

  const usedPlaceNames = new Set<string>([
    ...(session.usedPlaceNames ?? []),
    ...(session.recommendedNormalizedNames ?? []),
    ...fromItinerary.map((n) => normalizePlaceName(n)).filter(Boolean),
    ...fromCards.map((p) => normalizePlaceName(p.name)).filter(Boolean),
    ...fromSession.map((p) => normalizePlaceName(p.name)).filter(Boolean),
    ...fromDayPlan.map((p) => normalizePlaceName(p.name)).filter(Boolean),
  ]);

  const usedAreaKeys = new Set<string>([...(session.usedAreaKeys ?? [])]);
  for (const place of [...fromCards, ...fromSession, ...fromDayPlan]) {
    const area = resolveAreaKey(place);
    if (area) usedAreaKeys.add(area);
  }

  return {
    usedPlaceIds: [...usedPlaceIds],
    usedPlaceNames: [...usedPlaceNames],
    usedAreaKeys: [...usedAreaKeys],
  };
}

export function mergeTripSessionUsedPlacesFromMessages(
  session: ChatPlanningSession,
  msgs: ChatMsg[],
): ChatPlanningSession {
  const used = collectUsedPlaces(session, msgs);
  logAiFollowupUsedPlacesCollected(used);
  return {
    ...session,
    usedPlaceIds: used.usedPlaceIds,
    usedPlaceNames: used.usedPlaceNames,
    usedAreaKeys: used.usedAreaKeys,
    recommendedPlaceIds: used.usedPlaceIds,
    recommendedNormalizedNames: used.usedPlaceNames,
  };
}

export function excludeUsedPlacesFromFollowUp<T extends PlaceLike>(
  candidates: T[],
  used: TripUsedPlaces,
): T[] {
  let list = filterExcludedPlaceIds(candidates, used.usedPlaceIds);
  list = filterAlreadyRecommendedPlaces(list, {
    blockedCoreNames: used.usedPlaceNames,
    rejectedNames: [],
  });

  return list.filter((place) => {
    if (isExcludedRetailPlace(place as PlaceResult)) {
      logAiFollowupDuplicateDropped(place.placeName ?? place.name ?? "", "excluded_retail");
      return false;
    }
    const name = place.placeName ?? place.name ?? "";
    const core = normalizePlaceName(name);
    if (core && used.usedPlaceNames.some((u) => isSimilarPlaceName(u, core))) {
      logAiFollowupDuplicateDropped(name, "similar_name");
      return false;
    }
    const area = resolveAreaKey(place);
    if (area && used.usedAreaKeys.includes(area)) {
      logAiFollowupDuplicateDropped(name, `area:${area}`);
      return false;
    }
    return true;
  });
}

export function stripPreviousPlaceCardMessages(msgs: ChatMsg[]): ChatMsg[] {
  return msgs.filter((m) => !(m.role === "assistant" && (m.roamie?.recommendations?.length ?? 0) > 0));
}
