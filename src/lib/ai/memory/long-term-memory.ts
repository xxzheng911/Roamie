import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { listPlaces } from "@/lib/places-storage";
import { listItineraries } from "@/lib/itinerary-storage";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
} from "@/lib/preferences-storage";
import type { LongTermMemorySnapshot } from "@/lib/ai/memory/types";

const PACE_LABEL: Record<string, string> = {
  slow: "慢旅、留白多",
  medium: "中等步調",
  active: "節奏偏緊、想多看",
};
const VIBE_LABEL: Record<string, string> = {
  quiet: "安靜氛圍",
  either: "氛圍彈性",
  lively: "熱鬧一點也可",
};

function inferTraitsFromPrefs(
  prefs: Awaited<ReturnType<typeof getPreferences>>,
  savedCategories: string[],
): string[] {
  const traits: string[] = [];
  if (prefs.pace === "slow") traits.push("偏慢旅");
  if (prefs.vibe === "quiet") traits.push("偏好安靜");
  if (prefs.avoid?.some((a) => /人|擠|吵/.test(a))) traits.push("不太喜歡人多");
  if (prefs.interests?.some((i) => /美食|吃/.test(i))) traits.push("美食導向");
  if (prefs.interests?.some((i) => /拍照|攝影/.test(i))) traits.push("喜歡拍照");
  if (savedCategories.some((c) => /咖啡|甜點/.test(c))) traits.push("常去咖啡甜點");
  if (savedCategories.some((c) => /夜景|河岸|公園/.test(c))) traits.push("喜歡夜景或戶外散步");
  return traits;
}

/** Plus：從 profile、偏好、收藏、行程建立長期記憶 */
export async function buildLongTermMemory(userId: string): Promise<LongTermMemorySnapshot> {
  void userId;
  const [profile, prefs, places, itineraries] = await Promise.all([
    getUserProfile().catch(() => null),
    getPreferences(),
    listPlaces().catch(() => []),
    listItineraries().catch(() => []),
  ]);

  const savedPlaceNames = places.slice(0, 12).map((p) => p.name);
  const savedPlaceCategories = [
    ...new Set(places.map((p) => p.category).filter(Boolean) as string[]),
  ].slice(0, 8);

  const destCounts = new Map<string, number>();
  for (const it of itineraries) {
    const d = it.destination?.trim();
    if (!d) continue;
    destCounts.set(d, (destCounts.get(d) ?? 0) + 1);
  }
  const recentTripDestinations = [...destCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  const bm = resolveBudgetMode(prefs);
  const traits = inferTraitsFromPrefs(prefs, savedPlaceCategories);
  if (profile?.personalityType) traits.push(`旅行人格：${profile.personalityType}`);

  return {
    displayName: profile?.displayName,
    travelStyle: profile?.travelStyle,
    personalityType: profile?.personalityType,
    personalitySummary: profile?.personalitySummary,
    pace: prefs.pace ? PACE_LABEL[prefs.pace] : undefined,
    vibe: prefs.vibe ? VIBE_LABEL[prefs.vibe] : undefined,
    budgetLabel: prefs.onboarded ? BUDGET_MODE_LABELS[bm] : undefined,
    avoid: prefs.avoid,
    interests: prefs.interests,
    savedPlaceNames,
    savedPlaceCategories,
    recentTripDestinations,
    tripCount: itineraries.length,
    traits: [...new Set(traits)],
  };
}

export function formatLongTermMemoryForPrompt(memory: LongTermMemorySnapshot): string {
  const lines: string[] = [];
  if (memory.traits?.length) lines.push(`習慣與傾向：${memory.traits.join("、")}`);
  if (memory.pace) lines.push(`旅行節奏：${memory.pace}`);
  if (memory.vibe) lines.push(`氛圍偏好：${memory.vibe}`);
  if (memory.budgetLabel) lines.push(`預算習慣：${memory.budgetLabel}`);
  if (memory.personalitySummary) lines.push(`人格摘要：${memory.personalitySummary}`);
  if (memory.travelStyle) lines.push(`旅遊風格自述：${memory.travelStyle}`);
  if (memory.savedPlaceNames?.length)
    lines.push(`常收藏的地點類型參考：${memory.savedPlaceNames.slice(0, 6).join("、")}`);
  if (memory.savedPlaceCategories?.length)
    lines.push(`收藏類型：${memory.savedPlaceCategories.join("、")}`);
  if (memory.recentTripDestinations?.length)
    lines.push(`常去城市：${memory.recentTripDestinations.join("、")}`);
  if (memory.tripCount != null && memory.tripCount > 0)
    lines.push(`已規劃過約 ${memory.tripCount} 趟行程`);
  return lines.length ? lines.join("\n") : "（尚無足夠長期資料，請從本輪對話累積）";
}
