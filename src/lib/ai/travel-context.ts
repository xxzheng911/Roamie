import type { ChatPlanningSession } from "@/lib/chat-session";
import type { WeatherSummary } from "@/lib/weather-types";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";

/** Canonical travel context — merged on every user turn */
export type CanonicalTravelContext = {
  destination?: string;
  currentLocation?: string;
  travelMonth?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  mood?: string;
  companion?: string;
  interests: string[];
  transportMode?: string;
  budgetLevel?: string;
  travelStyle?: string;
  weather?: WeatherSummary | null;
  outfitSuggestion?: string;
  tripPurpose?: string;
  vibe?: string;
  setting?: string;
};

export const EMPTY_TRAVEL_CONTEXT: CanonicalTravelContext = {
  interests: [],
};

const MOOD_PRESETS: Record<
  string,
  Partial<Pick<CanonicalTravelContext, "mood" | "vibe" | "setting" | "tripPurpose" | "interests">>
> = {
  深夜散步: { mood: "深夜散步", vibe: "探索", setting: "室外", tripPurpose: "night_walk", interests: ["夜景", "散步"] },
  下雨天: { mood: "下雨天", vibe: "放鬆", setting: "室內", tripPurpose: "rainy_day", interests: ["室內", "咖啡"] },
  找咖啡: { mood: "找咖啡", vibe: "放鬆", setting: "室內", tripPurpose: "cafe", interests: ["咖啡", "安靜"] },
  想放空: { mood: "想放空", vibe: "放鬆", setting: "either", tripPurpose: "relax", interests: ["療癒", "慢步"] },
  一個人: { mood: "一個人", vibe: "探索", companion: "一個人", interests: ["獨處"] },
  看海: { mood: "看海", vibe: "放鬆", setting: "室外", tripPurpose: "coastal", interests: ["海邊", "散步"] },
};

const KNOWN_CITIES =
  /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|花蓮|台東|臺東|宜蘭|澎湖|金門|馬祖|京都|大阪|東京|橫濱|名古屋|福岡|首爾|釜山|香港|澳門|新加坡|曼谷|清邁|巴黎|倫敦|紐約|洛杉磯|舊金山|雪梨|墨爾本)(市|縣|都|府)?$/i;

function uniqStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())).map((v) => v!.trim()))];
}

function parseDestination(text: string): string | undefined {
  const t = text.trim();
  const direct = t.match(/去([\u4e00-\u9fffA-Za-z]{2,8})(?:\s*\d|\s*天|，|。|$)/);
  if (direct?.[1] && (KNOWN_CITIES.test(direct[1]) || direct[1].length >= 2)) {
    return direct[1].replace(/(市|縣|都|府)$/, "");
  }
  const abroad = t.match(/(?:去|到|玩|旅行|旅遊|想去)[^\u4e00-\u9fff]{0,4}?([\u4e00-\u9fff]{2,8})/);
  if (abroad?.[1] && KNOWN_CITIES.test(abroad[1])) return abroad[1];
  const bare = t.match(KNOWN_CITIES);
  if (bare) return `${bare[1]}${bare[2] ?? ""}`;
  return undefined;
}

function parseCompanion(text: string): string | undefined {
  if (/(一個人|獨自|solo)/i.test(text)) return "一個人";
  if (/(女友|男友|情侶|女朋友|男朋友|跟女友|和女友|跟男友|和男友)/.test(text)) return "女友";
  if (/(朋友|閨蜜|同學|同事)/.test(text)) return "朋友";
  if (/(家人|爸媽|父母|小孩|親子)/.test(text)) return "家人";
  const withMatch = text.match(/跟([\u4e00-\u9fffA-Za-z]{1,8})/);
  if (withMatch?.[1]) return withMatch[1];
  return undefined;
}

function parseDays(text: string): number | undefined {
  const m = text.match(/(\d+)\s*天/);
  if (!m) return undefined;
  return Math.min(30, Math.max(1, Number.parseInt(m[1], 10)));
}

function parseMonth(text: string): string | undefined {
  const m = text.match(/(\d{1,2})\s*月/);
  if (!m) return undefined;
  return `${Number.parseInt(m[1], 10)}月`;
}

function parseInterests(text: string, mood?: string): string[] {
  const tags: string[] = [];
  if (/(放鬆|放空|療癒)/.test(text)) tags.push("放鬆");
  if (/(拍照|打卡|攝影)/.test(text)) tags.push("拍照");
  if (/(美食|吃|小吃|餐廳)/.test(text)) tags.push("美食");
  if (/(咖啡|café|cafe)/i.test(text)) tags.push("咖啡");
  if (/(夜景|晚上|深夜)/.test(text)) tags.push("夜景");
  if (/(散步|走走|慢步)/.test(text)) tags.push("散步");
  if (/(室內|下雨|雨天)/.test(text)) tags.push("室內");
  if (/(自然|公園|海)/.test(text)) tags.push("自然");
  if (mood && MOOD_PRESETS[mood]?.interests) tags.push(...(MOOD_PRESETS[mood].interests ?? []));
  return uniqStrings(tags);
}

function parseTransport(text: string): string | undefined {
  if (/(步行|走路|walk)/i.test(text)) return "walk";
  if (/(開車|drive)/i.test(text)) return "drive";
  if (/(捷運|公車|地鐵|大眾運輸|transit)/i.test(text)) return "transit";
  return undefined;
}

function parseBudget(text: string): string | undefined {
  if (/(小資|省一點|budget)/i.test(text)) return "budget";
  if (/(奢華|premium|luxury)/i.test(text)) return "luxury";
  if (/(品質|quality)/i.test(text)) return "quality";
  return undefined;
}

function parseVibe(text: string, mood?: string): string | undefined {
  if (/(放鬆|放空)/.test(text)) return "放鬆";
  if (/(探索|走走看看)/.test(text)) return "探索";
  if (/(拍照|打卡)/.test(text)) return "拍照";
  if (/(都有|都可以|都行)/.test(text)) return "混合";
  if (mood && MOOD_PRESETS[mood]?.vibe) return MOOD_PRESETS[mood].vibe;
  if (mood) return mood;
  return undefined;
}

function parseSetting(text: string, mood?: string): string | undefined {
  if (/(室內|下雨|雨天|雨)/.test(text)) return "室內";
  if (/(室外|戶外|散步|公園|海)/.test(text)) return "室外";
  if (mood && MOOD_PRESETS[mood]?.setting) return MOOD_PRESETS[mood].setting;
  return undefined;
}

export function parseTravelContextFromText(
  text: string,
  session: ChatPlanningSession,
): Partial<CanonicalTravelContext> {
  const t = text.trim();
  if (!t) return {};
  const moodHint = session.selectedMood ?? session.mood;
  const preset = moodHint ? MOOD_PRESETS[moodHint] : undefined;

  const tiredMood = /(累|疲|倦|沒力)/.test(t) ? "今天有點累" : undefined;

  return {
    destination:
      parseDestination(t) ??
      session.tripDestination?.city ??
      session.tripDestination?.displayLabel ??
      session.preferredArea,
    currentLocation: session.location?.city,
    travelMonth: parseMonth(t),
    startDate: session.tripStartDate ?? session.travelDate,
    endDate: session.tripEndDate,
    days: parseDays(t) ?? session.tripDays,
    mood: preset?.mood ?? moodHint ?? tiredMood ?? parseVibe(t),
    companion: parseCompanion(t) ?? session.discovery?.companionship,
    interests: parseInterests(t, moodHint),
    transportMode: parseTransport(t) ?? session.transportation,
    budgetLevel: parseBudget(t) ?? session.budget,
    travelStyle: session.tripStyles ?? session.pace,
    weather: session.weather ?? null,
    tripPurpose: preset?.tripPurpose,
    vibe: parseVibe(t, moodHint) ?? session.discovery?.vibe,
    setting: parseSetting(t, moodHint) ?? session.discovery?.setting,
  };
}

export function mergeTravelContext(
  session: ChatPlanningSession,
  userText: string,
): { context: CanonicalTravelContext; session: ChatPlanningSession } {
  const prev = session.travelContext ?? EMPTY_TRAVEL_CONTEXT;
  const parsed = parseTravelContextFromText(userText, session);
  const moodKey = session.selectedMood ?? session.mood;
  const preset = moodKey ? MOOD_PRESETS[moodKey] : undefined;

  const merged: CanonicalTravelContext = {
    ...prev,
    ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && v !== "")),
    destination: parsed.destination ?? prev.destination,
    currentLocation: session.location?.city ?? prev.currentLocation,
    mood: parsed.mood ?? preset?.mood ?? prev.mood ?? moodKey,
    vibe: parsed.vibe ?? preset?.vibe ?? prev.vibe ?? session.discovery?.vibe,
    setting: parsed.setting ?? preset?.setting ?? prev.setting ?? session.discovery?.setting,
    companion:
      parsed.companion ??
      prev.companion ??
      session.discovery?.companionship,
    days: parsed.days ?? prev.days ?? session.tripDays,
    travelMonth: parsed.travelMonth ?? prev.travelMonth,
    startDate: parsed.startDate ?? prev.startDate ?? session.tripStartDate,
    endDate: parsed.endDate ?? prev.endDate ?? session.tripEndDate,
    transportMode: parsed.transportMode ?? prev.transportMode ?? session.transportation,
    budgetLevel: parsed.budgetLevel ?? prev.budgetLevel ?? session.budget,
    travelStyle: parsed.travelStyle ?? prev.travelStyle ?? session.tripStyles,
    weather: session.weather ?? prev.weather ?? null,
    interests: uniqStrings([...prev.interests, ...(parsed.interests ?? [])]),
    tripPurpose: parsed.tripPurpose ?? preset?.tripPurpose ?? prev.tripPurpose,
  };

  console.info("[AI_CONTEXT] parsed", logTravelContext(merged));

  const discovery = { ...session.discovery };
  if (merged.vibe && !discovery.vibe) discovery.vibe = merged.vibe;
  if (merged.companion && !discovery.companionship) {
    discovery.companionship =
      merged.companion === "女友" ? "情侶" : merged.companion;
  }
  if (merged.setting && !discovery.setting) discovery.setting = merged.setting;

  if (merged.companion === "女友" || merged.companion === "男友") {
    merged.vibe = merged.vibe ?? "情侶";
    merged.mood = merged.mood ?? "情侶旅行";
    merged.tripPurpose = merged.tripPurpose ?? "couple_trip";
    if (!discovery.companionship) discovery.companionship = "情侶";
  }

  const nextSession: ChatPlanningSession = {
    ...session,
    travelContext: merged,
    discovery,
    mood: merged.mood ?? session.mood,
    tripDays: merged.days ?? session.tripDays,
    travelDate: merged.startDate ?? session.travelDate,
    tripStartDate: merged.startDate ?? session.tripStartDate,
    tripEndDate: merged.endDate ?? session.tripEndDate,
    transportation: merged.transportMode ?? session.transportation,
    budget: merged.budgetLevel ?? session.budget,
    preferredArea: merged.destination ?? session.preferredArea,
  };

  console.info("[AI_CONTEXT] updated", logTravelContext(merged));
  return { context: merged, session: nextSession };
}

export function logTravelContext(ctx: CanonicalTravelContext): string {
  return JSON.stringify({
    destination: ctx.destination ?? "—",
    mood: ctx.mood ?? "—",
    days: ctx.days ?? "—",
    companion: ctx.companion ?? "—",
    interests: ctx.interests.slice(0, 5),
    travelMonth: ctx.travelMonth ?? "—",
  });
}

export function missingContextKeys(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): TripIntentMissingKey[] {
  const missing: TripIntentMissingKey[] = [];
  const hasGps =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);
  const hasDestination = Boolean(ctx.destination?.trim() || session.tripDestination);
  const hasMoodFlow = session.fromMoodCard || session.fromMoodFlow || Boolean(ctx.mood);

  if (!hasDestination && !hasGps && !session.fromPlanForm) missing.push("destination");
  if (!ctx.vibe && !ctx.mood) missing.push("vibe");

  const hasCompanion = Boolean(ctx.companion?.trim() || session.discovery?.companionship?.trim());
  if (!hasCompanion && !hasMoodFlow && !ctx.destination) missing.push("companionship");

  const hasSetting = Boolean(ctx.setting?.trim() || session.discovery?.setting?.trim());
  if (!hasSetting && !hasDestination && !hasMoodFlow && hasGps) {
    // Nearby mood chat: infer setting from mood preset, don't block
  } else if (!hasSetting && !hasDestination && !hasMoodFlow) {
    missing.push("setting");
  }

  return missing;
}

export function isReadyForRecommendation(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  if (session.selectedPlaces.length > 0) return true;
  if (session.fromPlanForm) return true;
  if (session.fromMoodFlow || session.fromMoodCard) return true;

  const missing = missingContextKeys(ctx, session);
  const hasTripPlan = Boolean(
    ctx.destination &&
      (ctx.mood || ctx.vibe) &&
      (ctx.companion || ctx.days),
  );
  const hasNearbyMood =
    Boolean(ctx.mood) &&
    Boolean(ctx.companion || session.discovery?.companionship) &&
    session.location?.lat != null;

  return missing.length === 0 || hasTripPlan || hasNearbyMood;
}

export function formatTravelContextForAi(ctx: CanonicalTravelContext): string {
  const lines = ["【Canonical Travel Context】"];
  if (ctx.destination) lines.push(`destination: ${ctx.destination}`);
  if (ctx.currentLocation) lines.push(`currentLocation: ${ctx.currentLocation}`);
  if (ctx.travelMonth) lines.push(`travelMonth: ${ctx.travelMonth}`);
  if (ctx.startDate) lines.push(`startDate: ${ctx.startDate}`);
  if (ctx.endDate) lines.push(`endDate: ${ctx.endDate}`);
  if (ctx.days) lines.push(`days: ${ctx.days}`);
  if (ctx.mood) lines.push(`mood: ${ctx.mood}`);
  if (ctx.companion) lines.push(`companion: ${ctx.companion}`);
  if (ctx.vibe) lines.push(`vibe: ${ctx.vibe}`);
  if (ctx.setting) lines.push(`setting: ${ctx.setting}`);
  if (ctx.interests.length) lines.push(`interests: ${ctx.interests.join("、")}`);
  if (ctx.transportMode) lines.push(`transportMode: ${ctx.transportMode}`);
  if (ctx.budgetLevel) lines.push(`budgetLevel: ${ctx.budgetLevel}`);
  if (ctx.travelStyle) lines.push(`travelStyle: ${ctx.travelStyle}`);
  if (ctx.tripPurpose) lines.push(`tripPurpose: ${ctx.tripPurpose}`);
  if (ctx.weather) {
    lines.push(
      `weather: ${ctx.weather.city} ${ctx.weather.condition} ${ctx.weather.tempC ?? ""}°C`,
    );
  }
  return lines.join("\n");
}
