import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { distanceMeters } from "@/lib/map-explore";
import type { WeatherSummary } from "@/lib/weather-types";
import type { TravelPreferences } from "@/lib/preferences-storage";
import {
  createEmptySession,
  loadRecPagePicks,
  placeDisplayName,
  roamieRecToChatItem,
  type ChatPlaceItem,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import type { StoredRecommendation } from "@/lib/recommendation-storage";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { isLateNightMode } from "@/lib/recommend-place-ranking";
import { isLateNightMood } from "@/lib/late-night-scene-recommendations";
import {
  buildPlanningMemoryContext,
  filterAlreadySelectedPlaces,
  mergeRecommendationsWithSelected,
  syncSessionPlaceMemory,
} from "@/lib/place-planning-memory";
import { mergeTravelContext } from "@/lib/ai/travel-context";

const MOOD_HANDOFF_DONE_PREFIX = "roamie:mood-handoff-done:";

export type MoodFlowHandoffInput = {
  record: StoredRecommendation;
  payload: RoamiePayloadV2;
  bundle: ClientContextBundle;
  preferences?: TravelPreferences;
  existing?: ChatPlanningSession;
};

function formatDistanceLabel(meters: number): string {
  if (meters < 1000) return `約 ${Math.round(meters)} 公尺`;
  return `約 ${(meters / 1000).toFixed(1)} 公里`;
}

/** 為已選地點補上與使用者位置的距離 */
export function enrichPlacesWithDistance(
  places: RoamieRecommendationItem[],
  location?: RoamieLocation | null,
): ChatPlaceItem[] {
  if (!location?.lat || !location?.lng) {
    return places.map(roamieRecToChatItem);
  }
  const origin = { lat: location.lat, lng: location.lng };
  return places.map((p) => {
    const item = roamieRecToChatItem(p);
    if (item.lat == null || item.lng == null) return item;
    const m = Math.round(distanceMeters(origin, { lat: item.lat, lng: item.lng }));
    return {
      ...item,
      distanceMeters: m,
      distanceLabel: formatDistanceLabel(m),
    };
  });
}

function formatPlaceLine(p: ChatPlaceItem, index: number): string {
  const parts = [
    `${index}. ${placeDisplayName(p)}`,
    `類型：${p.type || "地點"}`,
    p.address ? `地址：${p.address}` : "",
    p.openStatusLabel ? `營業狀態：${p.openStatusLabel}` : "",
    p.todayHoursLabel ? p.todayHoursLabel : "",
    p.nextOpenHint ? `下次營業：${p.nextOpenHint}` : "",
    p.distanceLabel ? `距離：${p.distanceLabel}` : "",
    p.reason ? `推薦理由：${p.reason.slice(0, 120)}` : "",
  ].filter(Boolean);
  return parts.join("｜");
}

/** 供 AI 全程記住的結構化上下文 */
export function buildInitialChatContext(session: ChatPlanningSession): string {
  const timeLabel = session.location
    ? new Date().toLocaleString("zh-TW", {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Taipei",
      })
    : "（未知）";

  const loc = session.location;
  const locLine = loc
    ? `${loc.city ?? "目前位置"}（${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}）`
    : "（未取得）";

  const lines = [
    "【心情卡片 → 聊天規劃｜初始上下文】",
    `selectedMood：${session.selectedMood ?? session.mood ?? "（未指定）"}`,
    `selectedCategory：${session.selectedCategory ?? session.mood ?? "（未指定）"}`,
    `currentTime：${timeLabel}`,
    `userLocation：${locLine}`,
    session.lateNightMode ? "lateNightMode：是" : "",
    session.weather
      ? `weather：${session.weather.city} ${session.weather.condition}`
      : "",
  ].filter(Boolean);

  if (session.selectedPlaces.length) {
    lines.push("selectedPlaces（使用者已勾選，全程優先安排）：");
    session.selectedPlaces.forEach((p, i) => lines.push(formatPlaceLine(p, i + 1)));
  } else {
    lines.push("selectedPlaces：（使用者尚未勾選，請從候選邀請選一個）");
  }

  if (session.recommendedPlaces.length) {
    lines.push("recommendedCandidates（推薦頁候選）：");
    session.recommendedPlaces.slice(0, 8).forEach((p, i) => lines.push(formatPlaceLine(p, i + 1)));
  }

  lines.push(buildPlanningMemoryContext(session));
  lines.push(
    "請全程記住上述已選地點與心情，後續每一輪對話都要銜接，不要重新開場或忘記使用者選過什麼；新推薦不得重複已選名稱。",
  );

  return lines.join("\n");
}

function isPlaceClosedNow(p: ChatPlaceItem): boolean {
  return p.openStatusLabel === "目前未營業" && !p.nextOpenHint?.trim();
}

function closedPlaceNote(places: ChatPlaceItem[]): string {
  const closed = places.filter(isPlaceClosedNow);
  if (!closed.length) return "";
  const names = closed.map((p) => placeDisplayName(p)).join("、");
  return `順帶一提，${names} 這個時間可能休息了，但我可以幫你找附近還開著、氛圍相近的地方。`;
}

function vibeHintForPlace(p: ChatPlaceItem, mood?: string): string {
  if (p.reason?.trim()) return p.reason.trim().slice(0, 60);
  const blob = `${p.name} ${p.type}`.toLowerCase();
  if (/夜市|night market/i.test(blob)) return "很適合今晚慢慢逛";
  if (/公園|河岸|步道/i.test(blob)) return "適合慢慢散步";
  if (/咖啡|cafe/i.test(blob)) return "適合坐著待一下";
  if (mood) return `很符合你「${mood}」的感覺`;
  return "氛圍蠻適合你現在的心情";
}

const PLANNING_FOLLOWUP =
  "你還有沒有想去的地方？想用走路、騎車、開車還是大眾運輸？想安排輕鬆一點還是緊湊一點？如果差不多了，跟我說一聲，我幫你把這幾個點排成一段舒服的路線 ☺️";

/** 情境開場（本地 fallback + 即時顯示） */
export function buildContextualMoodHandoffOpening(session: ChatPlanningSession): string {
  const mood = session.selectedMood?.trim() || session.mood?.trim();
  const closedNote = closedPlaceNote(session.selectedPlaces);

  if (session.selectedPlaces.length === 1) {
    const p = session.selectedPlaces[0];
    const name = placeDisplayName(p);
    const vibe = vibeHintForPlace(p, mood);
    if (isPlaceClosedNow(p)) {
      return `剛剛看你選了「${name}」，我先把它放進這趟小行程裡。不過這個時間可能休息了，我可以幫你找附近還開著、氛圍相近的地方。${closedNote ? `\n\n${closedNote}` : ""}\n\n${PLANNING_FOLLOWUP}`;
    }
    return `剛剛看你選了「${name}」，我先把它放進這趟小行程裡。這個點${vibe}。接下來我可以幫你找附近順路、但不重複的地點，讓路線更完整一點。${closedNote ? `\n\n${closedNote}` : ""}\n\n${PLANNING_FOLLOWUP}`;
  }

  if (session.selectedPlaces.length > 1) {
    const names = session.selectedPlaces.map((p) => `「${placeDisplayName(p)}」`).join("和");
    return `剛剛看你選了${names}，我先把它們放進這趟小行程裡。接下來我可以幫你找附近順路、但不重複的地點，讓路線更完整一點。${closedNote ? `\n\n${closedNote}` : ""}\n\n${PLANNING_FOLLOWUP}`;
  }

  if (
    isLateNightMood(mood) &&
    session.recommendedPlaces.length > 0 &&
    session.selectedPlaces.length === 0
  ) {
    const names = session.recommendedPlaces
      .map((p) => placeDisplayName(p))
      .slice(0, 4)
      .join("、");
    return `剛剛你選了深夜散步，我先幫你保留幾個適合夜晚走走的地方（${names}）。\n\n接下來可以再接夜景、深夜咖啡廳，或順路的宵夜，把路線串成一小段舒服的夜間散步。${closedNote ? `\n\n${closedNote}` : ""}\n\n${PLANNING_FOLLOWUP}`;
  }

  const candidates = session.recommendedPlaces.map((p) => placeDisplayName(p)).slice(0, 4).join("、");
  const cat = session.selectedCategory ?? mood;
  const lead = cat ? `照著「${cat}」的心情，我整理了 ${candidates} 幾個地方。` : `我整理了 ${candidates} 幾個地方。`;
  return `${lead}\n\n你想先從哪一個有感覺的開始？選好跟我說，我們再往下排。\n\n${PLANNING_FOLLOWUP}`;
}

export function resolveSelectedPlacesFromMoodFlow(
  recommendations: RoamieRecommendationItem[],
  recommendationId: string,
  fallbackSelected: ChatPlaceItem[],
  location?: RoamieLocation | null,
): ChatPlaceItem[] {
  const pickNames = loadRecPagePicks(recommendationId);
  let selected: RoamieRecommendationItem[] = [];
  if (pickNames.length) {
    const pickSet = new Set(pickNames);
    selected = recommendations.filter((r) => pickSet.has(r.name));
  } else if (fallbackSelected.length) {
    selected = fallbackSelected;
  }
  return enrichPlacesWithDistance(selected, location);
}

/** 從推薦頁進聊天：合併 picks、建立 initialChatContext */
export function prepareMoodFlowSession(input: MoodFlowHandoffInput): ChatPlanningSession {
  const { record, payload, bundle, preferences, existing } = input;
  const moodTag = payload.moodTag ?? record.mood ?? undefined;
  const recommended = payload.recommendations.map(roamieRecToChatItem);
  const selected = resolveSelectedPlacesFromMoodFlow(
    payload.recommendations,
    record.id,
    existing?.selectedPlaces ?? [],
    bundle.location,
  );

  const base: ChatPlanningSession = {
    ...createEmptySession(),
    mood: moodTag,
    selectedMood: moodTag,
    selectedCategory: moodTag,
    conversationSummary: payload.summary,
    recommendationTitle: payload.title || record.title,
    recommendedPlaces: recommended,
    selectedPlaces: selected,
    selectedPlaceFromMood: selected[0],
    phase: selected.length ? "followup" : "collect",
    discovery: moodTag ? { vibe: moodTag } : {},
    recommendationId: record.id,
    location: bundle.location,
    weather: bundle.weather,
    preferences,
    fromMoodCard: true,
    fromMoodFlow: true,
    lateNightMode: isLateNightMode(new Date(bundle.time)),
    pendingHandoff: true,
    moodHandoffDone: false,
  };

  const merged: ChatPlanningSession = {
    ...base,
    ...existing,
    mood: moodTag ?? existing?.mood,
    selectedMood: moodTag ?? existing?.selectedMood,
    selectedCategory: moodTag ?? existing?.selectedCategory,
    recommendedPlaces: recommended.length ? recommended : (existing?.recommendedPlaces ?? []),
    selectedPlaces: selected.length ? selected : (existing?.selectedPlaces ?? []),
    selectedPlaceFromMood: selected[0] ?? existing?.selectedPlaceFromMood,
    location: bundle.location,
    weather: bundle.weather,
    preferences: preferences ?? existing?.preferences,
    fromMoodCard: true,
    fromMoodFlow: true,
    lateNightMode: isLateNightMode(new Date(bundle.time)),
    recommendationId: record.id,
    pendingHandoff: existing?.moodHandoffDone ? false : true,
    moodHandoffDone: existing?.moodHandoffDone ?? false,
  };

  merged.initialChatContext = buildInitialChatContext(merged);
  const withContext = mergeTravelContext(
    merged,
    moodTag ? `我想${moodTag}，幫我看看附近適合去哪裡。` : "",
  );
  return syncSessionPlaceMemory(withContext.session);
}

export function markMoodHandoffComplete(session: ChatPlanningSession): ChatPlanningSession {
  if (typeof window !== "undefined" && session.recommendationId) {
    sessionStorage.setItem(`${MOOD_HANDOFF_DONE_PREFIX}${session.recommendationId}`, "1");
  }
  return {
    ...session,
    pendingHandoff: false,
    moodHandoffDone: true,
    fromMoodFlow: true,
    initialChatContext: session.initialChatContext ?? buildInitialChatContext(session),
  };
}

export function isMoodHandoffDoneForRec(recommendationId: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(`${MOOD_HANDOFF_DONE_PREFIX}${recommendationId}`) === "1";
}

/** 清除聊天時一併移除心情 handoff 標記，避免重新帶入上一段選擇 */
export function clearMoodHandoffStorage(recommendationId?: string): void {
  if (typeof window === "undefined") return;
  if (recommendationId) {
    sessionStorage.removeItem(`${MOOD_HANDOFF_DONE_PREFIX}${recommendationId}`);
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(MOOD_HANDOFF_DONE_PREFIX)) keys.push(k);
  }
  for (const k of keys) sessionStorage.removeItem(k);
}

export function buildHandoffRoamiePayload(
  session: ChatPlanningSession,
  summary: string,
  aiRecs?: ChatPlaceItem[],
): {
  title: string;
  summary: string;
  moodTag: string;
  recommendations: ChatPlaceItem[];
  itinerary: [];
} {
  const synced = syncSessionPlaceMemory(session);
  const selected = synced.selectedPlaces;
  let recs: ChatPlaceItem[];
  if (selected.length > 0) {
    const extra = filterAlreadySelectedPlaces(
      (aiRecs ?? synced.recommendedPlaces).map(roamieRecToChatItem),
      selected,
    ) as ChatPlaceItem[];
    recs = mergeRecommendationsWithSelected(selected, extra, {
      maxNew: 4,
      location: synced.location ?? null,
    }) as ChatPlaceItem[];
  } else {
    recs = synced.recommendedPlaces.slice(0, 5);
  }
  return {
    title: synced.recommendationTitle ?? synced.mood ?? "你的慢旅行",
    summary,
    moodTag: synced.selectedMood ?? synced.mood ?? "",
    recommendations: recs,
    itinerary: [],
  };
}
