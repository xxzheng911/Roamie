import type { ChatPlanningSession } from "@/lib/chat-session";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";
import type { SavedPlace } from "@/lib/places-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";

export type HomePersonalizationInsightInput = {
  savedPlaces: SavedPlace[];
  prefs?: TravelPreferences | null;
  selectedMood?: string | null;
  weather?: WeatherSummary | null;
  nearbyPicks?: HomeNearbyPick[];
  latestTripTitle?: string | null;
  chatSession?: ChatPlanningSession | null;
};

function topSavedCategories(saved: SavedPlace[], limit = 2): string[] {
  const counts = new Map<string, number>();
  for (const p of saved) {
    const key = p.category?.trim() || "地點";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, limit);
}

function recentChatHint(session?: ChatPlanningSession | null): string | null {
  const intent = session?.lastUserIntent?.trim();
  if (intent && intent.length >= 4) {
    return intent.length > 36 ? `${intent.slice(0, 36)}…` : intent;
  }
  const summary = session?.conversationSummary?.trim();
  if (summary && summary.length >= 6) {
    return summary.length > 40 ? `${summary.slice(0, 40)}…` : summary;
  }
  return null;
}

/** Plus 首頁「個人化旅遊中心」動態一句描述 */
export function buildHomePlusInsight(input: HomePersonalizationInsightInput): string {
  const {
    savedPlaces,
    prefs,
    selectedMood,
    weather,
    nearbyPicks = [],
    latestTripTitle,
    chatSession,
  } = input;

  const savedCats = topSavedCategories(savedPlaces);
  const nearbyTypes = [
    ...new Set(nearbyPicks.slice(0, 5).map((p) => getExploreCategoryDisplayLabel(p)).filter(Boolean)),
  ].slice(0, 2);
  const chatHint = recentChatHint(chatSession);
  const rainy = weather?.condition?.includes("雨");
  const hour = new Date().getHours();
  const evening = hour >= 18 || hour < 5;

  if (selectedMood && savedCats.length) {
    return `你選了「${selectedMood}」，又常收藏${savedCats.join("、")}類地點——今天很適合照這個節奏慢慢走。`;
  }

  if (savedCats.length >= 2) {
    return `依照你最近收藏的${savedCats.join("與")}，今天很適合慢步調、留一點空白的小旅行。`;
  }

  if (savedCats.length === 1 && nearbyTypes.length) {
    return `依照你收藏的${savedCats[0]}與附近的${nearbyTypes.join("、")}，今天可以串成一條剛剛好的路線。`;
  }

  if (chatHint && selectedMood) {
    return `記得你剛才提到「${chatHint}」，配上「${selectedMood}」的心情，我們可以從輕鬆的一步開始規劃。`;
  }

  if (chatHint) {
    return `照你最近的對話「${chatHint}」，我會用比較像旅伴的方式，陪你慢慢收斂今天的路線。`;
  }

  if (prefs?.vibe && prefs.pace) {
    return `你的旅行節奏偏${prefs.pace}、喜歡${prefs.vibe}——今天可以往這個方向找剛剛好的去處。`;
  }

  if (prefs?.personalitySummary?.trim()) {
    const short =
      prefs.personalitySummary.length > 28
        ? `${prefs.personalitySummary.slice(0, 28)}…`
        : prefs.personalitySummary;
    return `${short}——我會把這個風格放進今天的推薦裡。`;
  }

  if (latestTripTitle?.trim()) {
    return `你最近在規劃「${latestTripTitle}」——要不要順著這個方向，聊聊今天想怎麼過？`;
  }

  if (rainy) {
    return "外面可能會下雨，今天很適合室內咖啡、展覽，或能躲雨的巷弄散步。";
  }

  if (evening && nearbyTypes.length) {
    return `入夜了，附近的${nearbyTypes.join("與")}很適合今晚慢慢走、不用趕行程。`;
  }

  if (selectedMood) {
    return `照著「${selectedMood}」的心情，我們可以從一個小問題開始，慢慢聊出適合你的路線。`;
  }

  if (nearbyTypes.length) {
    return `附近現在有${nearbyTypes.join("、")}的選擇——跟我說你今天想怎麼過，我來幫你收斂。`;
  }

  return "我會記住你的收藏、偏好與對話節奏——跟我聊聊，我們一起把今天排得剛剛好。";
}
