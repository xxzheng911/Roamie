import type { RoamieRequestContext } from "@/lib/ai/context";
import {
  extractKnownDestinationFromText,
  KNOWN_DESTINATION_NAMES,
  normalizeDestination,
} from "@/lib/ai/normalize-destination";
import { isDiscoveryComplete, type ChatPlanningSession } from "@/lib/chat-session";
import type { TravelPreferences } from "@/lib/preferences-storage";

/** 從對話解析出的結構化旅行意圖 */
export type TripIntent = {
  destinationCity?: string;
  destinationArea?: string;
  origin?: string;
  mustVisitPlaces: string[];
  rejectedPlaces: string[];
  travelDate?: string;
  travelDateEnd?: string;
  startTime?: string;
  endTime?: string;
  travelers?: number;
  budget?: string;
  transport?: string;
  travelStyle?: string;
  mood?: string;
  foodPreference?: string;
  settingPreference?: "indoor" | "outdoor" | "either";
  /** 怕熱、怕曬、怕走路等 */
  constraints: string[];
  needsRainBackup?: boolean;
  /** 資訊是否足夠開始推薦 */
  readyForRecommendations: boolean;
  /** 尚缺的关键欄位（供追問） */
  missingKeys: TripIntentMissingKey[];
};

export type TripIntentMissingKey =
  | "destination"
  | "vibe"
  | "setting"
  | "companionship"
  | "date";

const EMPTY_INTENT: TripIntent = {
  mustVisitPlaces: [],
  rejectedPlaces: [],
  constraints: [],
  readyForRecommendations: false,
  missingKeys: [],
};

function uniqPush(arr: string[], value: string): string[] {
  const v = value.trim();
  if (!v || arr.includes(v)) return arr;
  return [...arr, v];
}

const KNOWN_SORTED = KNOWN_DESTINATION_NAMES.split("|").sort((a, b) => b.length - a.length);

const KNOWN_DESTINATION_RE = new RegExp(
  `^(${KNOWN_SORTED.join("|")})(市|縣|都|府)?$`,
  "iu",
);

const KNOWN_DESTINATION_IN_TEXT_RE = new RegExp(
  `(${KNOWN_SORTED.join("|")})(?:市|縣|都|府)?`,
  "iu",
);

const DESTINATION_FALSE_POSITIVES = new Set([
  "比較好",
  "比较好",
  "更好",
  "最好",
  "好玩",
  "方便",
  "適合",
  "合适",
  "附近",
  "這裡",
  "这里",
  "那裡",
  "那里",
  "看看",
  "逛逛",
  "走走",
]);

function isPlausibleDestination(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 16) return false;
  if (DESTINATION_FALSE_POSITIVES.has(trimmed)) return false;
  if (normalizeDestination(trimmed)) return true;
  if (KNOWN_DESTINATION_RE.test(trimmed)) return true;
  return false;
}

function parseCityOrArea(text: string): { city?: string; area?: string } {
  const trimmed = text.trim();

  const fromKnown = extractKnownDestinationFromText(trimmed);
  if (fromKnown) {
    console.info("[trip-intent] parsed known destination in text", { input: trimmed, city: fromKnown });
    return { city: fromKnown };
  }

  const knownInText = trimmed.match(KNOWN_DESTINATION_IN_TEXT_RE);
  if (knownInText?.[1]) {
    const city = normalizeDestination(knownInText[1].trim()) ?? knownInText[1].trim();
    console.info("[trip-intent] parsed known destination in text", { input: trimmed, city });
    return { city };
  }

  if (trimmed.length >= 2 && trimmed.length <= 16) {
    const bare = trimmed.match(KNOWN_DESTINATION_RE);
    if (bare) {
      const city = `${bare[1]}${bare[2] ?? ""}`;
      console.info("[trip-intent] parsed bare destination", { input: trimmed, city });
      return { city };
    }
  }

  const cityMatch = trimmed.match(
    /(?:去|到|在|逛|玩|旅行|旅遊|目的地|想去|想去的是)[：:\s]*([^\s，,。！!？?]{2,12}(?:市|縣|區|里|町|府|道|都|國|島)?)/,
  );
  if (cityMatch?.[1]) {
    const city =
      normalizeDestination(cityMatch[1].trim()) ??
      extractKnownDestinationFromText(cityMatch[1]);
    if (city && isPlausibleDestination(city)) return { city };
  }

  const directGo = trimmed.match(/去([\u4e00-\u9fffA-Za-z]{2,8})(?:\s*\d|\s*天|，|。|$)/);
  if (directGo?.[1]) {
    const city =
      normalizeDestination(directGo[1].trim()) ??
      extractKnownDestinationFromText(directGo[1]);
    if (city && isPlausibleDestination(city)) return { city };
  }

  const abroadMatch = trimmed.match(
    /(?:去|到|玩|旅行|旅遊|想去)[^\u4e00-\u9fff]{0,8}?([\u4e00-\u9fff]{2,8})/,
  );
  if (abroadMatch?.[1]) {
    const city =
      normalizeDestination(abroadMatch[1].trim()) ??
      extractKnownDestinationFromText(abroadMatch[1]);
    if (city && isPlausibleDestination(city)) return { city };
  }

  const enCity = trimmed.match(
    /\b(?:in|to|visit|explore)\s+([A-Za-z][A-Za-z\s]{1,24})/i,
  );
  if (enCity?.[1]) return { city: enCity[1].trim() };

  const areaMatch = trimmed.match(
    /(?:從|在|到)(.{2,16}?)(?:開始|逛|走|附近|這一帶|區)/,
  );
  if (areaMatch?.[1]) return { area: areaMatch[1].trim() };

  return {};
}

function parseOrigin(text: string): string | undefined {
  const m = text.match(/(?:從|出發|起點)[：:\s]*(.{2,20}?)(?:出發|去|到|，|。|$)/);
  return m?.[1]?.trim();
}

function parseTravelers(text: string): number | undefined {
  const m = text.match(/(\d+)\s*(?:人|位|個人|travelers?)/i);
  if (m) return Math.min(20, Math.max(1, parseInt(m[1], 10)));
  if (/(一個人|獨自|solo)/i.test(text)) return 1;
  if (/(兩人|情侶|一對|女友|男友|跟女友|和女友|跟男友|和男友|女朋友|男朋友)/.test(text)) {
    return 2;
  }
  if (/(三人|3人)/.test(text)) return 3;
  return undefined;
}

function parseTripDays(text: string): number | undefined {
  const m = text.match(/(\d+)\s*天/);
  if (!m) return undefined;
  return Math.min(30, Math.max(1, parseInt(m[1], 10)));
}

function parseMonthHint(text: string): string | undefined {
  const m = text.match(/(\d{1,2})\s*月/);
  if (!m) return undefined;
  const month = Math.min(12, Math.max(1, parseInt(m[1], 10)));
  const year = new Date().getFullYear();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseFoodPreference(text: string): string | undefined {
  if (/(素食|vegan|vegetarian)/i.test(text)) return "素食";
  if (/(海鮮|seafood)/i.test(text)) return "海鮮";
  if (/(咖啡|café|cafe)/i.test(text)) return "咖啡";
  if (/(甜點|下午茶|dessert)/i.test(text)) return "甜點";
  if (/(在地小吃|street food|夜市)/i.test(text)) return "在地小吃";
  if (/(米其林|fine dining|精緻)/i.test(text)) return "精緻餐飲";
  return undefined;
}

function parseConstraints(text: string): string[] {
  const out: string[] = [];
  if (/(不想走太多|少走路|不想走|怕走路|少走|不要走太多)/.test(text)) out.push("少走路");
  if (/(怕熱|怕晒|怕曬|不想曬|不要曬)/.test(text)) out.push("怕熱怕曬");
  if (/(怕吵|太吵|不要吵|安靜)/.test(text)) out.push("要安靜");
  if (/(怕擠|人多|不要人太多)/.test(text)) out.push("怕人多");
  if (/(預算|省一點|小資|不要太貴)/.test(text)) out.push("預算有限");
  if (/(無障礙|輪椅|推車)/.test(text)) out.push("無障礙");
  return out;
}

function parseRejectedPlaces(text: string): string[] {
  const out: string[] = [];
  const m1 = text.match(/(?:不要|不想|不喜歡|排除)(.{2,24}?)(?:店|餐廳|地方|點|的|，|。)/);
  if (m1?.[1]) out.push(m1[1].trim());
  const m2 = text.match(/(?:不要|不想)去(.{2,20}?)(?:，|。|$)/);
  if (m2?.[1]) out.push(m2[1].trim());
  return out;
}

function parseMustVisit(text: string): string[] {
  const out: string[] = [];
  const m = text.match(
    /(?:想去|想去看看|一定要去|有想去的|必去)[：:\s]*(.+?)(?:，|。|$)/,
  );
  if (m?.[1]) out.push(m[1].trim().slice(0, 80));
  return out;
}

export function parseTripIntentFromText(
  text: string,
  session: ChatPlanningSession,
): TripIntent {
  const t = text.trim();
  const base = parseTripIntentFromSession(session);
  if (!t) return base;

  const { city, area } = parseCityOrArea(t);
  const origin = parseOrigin(t);
  const travelers = parseTravelers(t);
  const food = parseFoodPreference(t);
  const constraints = [...new Set([...base.constraints, ...parseConstraints(t)])];
  const rejected = [...base.rejectedPlaces];
  for (const r of parseRejectedPlaces(t)) {
    if (!rejected.includes(r)) rejected.push(r);
  }
  const mustVisit = [...base.mustVisitPlaces];
  for (const m of parseMustVisit(t)) {
    if (!mustVisit.includes(m)) mustVisit.push(m);
  }

  let settingPreference = base.settingPreference;
  if (/(室內|indoor|冷氣|下雨)/i.test(t) && /(想|要|偏好|prefer)/.test(t)) {
    settingPreference = "indoor";
  } else if (/(室外|戶外|outdoor|散步|公園)/i.test(t) && /(想|要|偏好)/.test(t)) {
    settingPreference = "outdoor";
  }

  const needsRainBackup =
    base.needsRainBackup ||
    /(下雨|雨天|備案|rain)/i.test(t) && /(備案|plan b|備用|如果)/i.test(t);

  const transportMatch = t.match(/(開車|走路|步行|捷運|公車|地鐵|騎車|單車|計程車|Uber|transit|drive|walk)/i);

  const budgetMatch = t.match(/(?:預算|budget)?\s*(\d{3,5})\s*(?:元|塊|NT|USD)?/i);

  const dateMatch = t.match(/\d{4}-\d{2}-\d{2}/);
  const monthHint = parseMonthHint(t);

  const mood =
    base.mood ||
    (/(都有|都可以|都行|混合)/i.test(t) ? "混合" : undefined) ||
    (/(放空|relax|放鬆)/i.test(t) ? "放鬆" : undefined) ||
    (/(拍照|photo)/i.test(t) ? "拍照" : undefined) ||
    (/(美食|吃)/.test(t) ? "美食" : undefined);

  const merged: TripIntent = {
    ...base,
    destinationCity: city || base.destinationCity || session.location?.city,
    destinationArea: area || base.destinationArea || session.preferredArea,
    origin: origin || base.origin,
    mustVisitPlaces: mustVisit,
    rejectedPlaces: rejected,
    travelers: travelers ?? base.travelers,
    foodPreference: food || base.foodPreference,
    settingPreference,
    constraints,
    needsRainBackup,
    transport: transportMatch?.[1] || base.transport || session.transportation,
    budget: budgetMatch ? `${budgetMatch[1]} 元左右` : base.budget || session.budget,
    travelDate: dateMatch?.[0] || monthHint || base.travelDate || session.travelDate,
    startTime: base.startTime || session.startTime,
    endTime: base.endTime || session.endTime,
    mood: mood || base.mood || session.mood,
    travelStyle: base.travelStyle || session.tripStyles,
  };

  return finalizeTripIntent(merged, session);
}

export function parseTripIntentFromSession(session: ChatPlanningSession): TripIntent {
  const d = session.discovery ?? {};
  const intent: TripIntent = {
    ...EMPTY_INTENT,
    destinationCity:
      session.tripDestination?.city ||
      session.tripDestination?.displayLabel ||
      session.location?.city,
    destinationArea: session.preferredArea,
    origin: session.tripOrigin?.displayLabel || session.tripOrigin?.city,
    mustVisitPlaces: d.mustVisit && d.mustVisit !== "沒有特別" ? [d.mustVisit] : [],
    rejectedPlaces: [...(session.rejectedPlaceNames ?? [])],
    travelDate: session.travelDate || session.tripStartDate,
    travelDateEnd: session.tripEndDate,
    startTime: session.startTime,
    endTime: session.endTime,
    transport: session.transportation,
    budget: session.budget,
    mood: session.selectedMood || session.mood || d.vibe,
    travelStyle: session.tripStyles || session.pace,
    foodPreference: undefined,
    settingPreference:
      d.setting === "室內" ? "indoor" : d.setting === "室外" ? "outdoor" : "either",
    constraints: [...(session.avoidTypes ?? [])],
    needsRainBackup: d.setting === "室內" && /雨/.test(session.mood ?? ""),
  };

  if (session.avoidTypes?.some((a) => /戶外|曬/.test(a))) intent.constraints.push("怕熱怕曬");
  if (session.avoidTypes?.some((a) => /吵|人多/.test(a))) intent.constraints.push("怕人多");

  return finalizeTripIntent(intent, session);
}

function sessionHasTripDestination(session: ChatPlanningSession): boolean {
  return Boolean(
    session.tripDestination?.displayLabel?.trim() ||
      session.tripDestination?.city?.trim() ||
      session.location?.city?.trim() ||
      session.preferredArea?.trim(),
  );
}

function finalizeTripIntent(intent: TripIntent, session: ChatPlanningSession): TripIntent {
  const missing: TripIntentMissingKey[] = [];
  const d = session.discovery ?? {};
  const hasDestination =
    Boolean(intent.destinationCity?.trim()) ||
    Boolean(intent.destinationArea?.trim()) ||
    Boolean(session.tripDestination) ||
    Boolean(session.preferredArea?.trim()) ||
    Boolean(session.location?.city?.trim());

  const hasGpsAnchor =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);

  const moodLabel = session.selectedMood ?? session.mood ?? intent.mood;
  const hasVibe = Boolean(d.vibe?.trim() || intent.mood || moodLabel);
  const hasCompanionship = Boolean(
    d.companionship?.trim() ||
      intent.travelers ||
      session.travelContext?.companion ||
      /不一定|彈性|視情況/.test(d.companionship ?? ""),
  );
  const hasSetting = Boolean(
    d.setting?.trim() ||
      session.travelContext?.setting ||
      /散步|咖啡|雨|海|夜景/.test(moodLabel ?? ""),
  );
  const tripDestinationKnown = hasDestination || sessionHasTripDestination(session);
  const moodFlow = session.fromMoodCard || session.fromMoodFlow;

  if (!hasDestination && !hasGpsAnchor && session.fromPlanForm !== true && !moodFlow) {
    missing.push("destination");
  }
  if (!hasVibe) missing.push("vibe");
  if (!hasCompanionship && !moodFlow) missing.push("companionship");
  if (!hasSetting && !tripDestinationKnown && !moodFlow) missing.push("setting");

  const tripPlanningReady = tripDestinationKnown && hasVibe && hasCompanionship;
  const localDayReady = hasVibe && hasCompanionship && hasSetting;
  const nearbyReady =
    (hasGpsAnchor && hasVibe && hasCompanionship) ||
    (moodFlow && hasGpsAnchor && moodLabel);

  const readyForRecommendations =
    session.selectedPlaces.length > 0 ||
    session.fromPlanForm === true ||
    session.fromMoodFlow === true ||
    session.fromMoodCard === true ||
    tripPlanningReady ||
    localDayReady ||
    nearbyReady;

  return {
    ...intent,
    missingKeys: missing,
    readyForRecommendations,
  };
}

export function parseTripIntentFromRoamieContext(ctx: RoamieRequestContext): TripIntent {
  const hints = ctx.planningHints;
  return parseTripIntentFromSession({
    recommendedPlaces: [],
    selectedPlaces: ctx.selectedPlaces ?? [],
    phase: ctx.chatPhase === "discover" ? "discover" : "followup",
    discovery: {
      vibe: hints?.vibe,
      companionship: hints?.companionship,
      setting: hints?.setting,
      mustVisit: hints?.mustVisit,
    },
    mood: ctx.mood,
    selectedMood: ctx.selectedMood,
    location: ctx.location,
    preferredArea: ctx.preferredArea ?? hints?.preferredArea,
    rejectedPlaceNames: ctx.rejectedPlaceNames ?? hints?.rejectedPlaceNames,
    avoidTypes: ctx.avoidTypes ?? hints?.avoidTypes,
    transportation: hints?.transportation,
    budget: hints?.budget,
    pace: hints?.pace,
    travelDate: hints?.travelDate,
    startTime: hints?.startTime,
    endTime: hints?.endTime,
    fromPlanForm: ctx.fromPlanForm,
    fromMoodFlow: ctx.fromMoodFlow,
    updatedAt: ctx.time ?? new Date().toISOString(),
  });
}

/** 合併文字解析結果至 session（聊天每則訊息呼叫） */
export function applyTripIntentToSession(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const intent = parseTripIntentFromText(text, session);
  const rejected = new Set(session.rejectedPlaceNames ?? []);
  for (const r of intent.rejectedPlaces) rejected.add(r);

  const avoid = new Set(session.avoidTypes ?? []);
  if (intent.constraints.includes("少走路")) avoid.add("長距離步行");
  if (intent.constraints.includes("怕熱怕曬")) avoid.add("長時間戶外曝曬");
  if (intent.constraints.includes("怕人多")) avoid.add("人多吵雜");

  const destCity = intent.destinationCity?.trim();
  const destArea = intent.destinationArea?.trim();
  const destLabel = destCity || destArea;

  const nextLocation =
    destCity && session.location
      ? { ...session.location, city: destCity }
      : destCity
        ? { lat: session.location?.lat ?? 0, lng: session.location?.lng ?? 0, city: destCity }
        : session.location;

  if (destLabel) {
    console.info("[trip-intent] session destination updated", { destLabel, destCity, destArea });
  }

  const tripDays = parseTripDays(text);
  const discovery = { ...session.discovery };
  if (intent.mood && !discovery.vibe) {
    discovery.vibe = intent.mood;
  }
  if (!discovery.companionship) {
    if (intent.travelers === 1 || /(一個人|獨自|solo)/i.test(text)) {
      discovery.companionship = "一個人";
    } else if (
      intent.travelers === 2 ||
      /(女友|男友|情侶|女朋友|男朋友|跟女友|和女友|跟男友|和男友)/.test(text)
    ) {
      discovery.companionship = "情侶";
    } else if (intent.travelers && intent.travelers >= 3) {
      discovery.companionship = "朋友";
    }
  }

  const nextSession: ChatPlanningSession = {
    ...session,
    location: nextLocation,
    preferredArea: destArea || destCity || session.preferredArea,
    mood: intent.mood || session.mood,
    transportation: intent.transport || session.transportation,
    budget: intent.budget || session.budget,
    travelDate: intent.travelDate || session.travelDate,
    startTime: intent.startTime || session.startTime,
    endTime: intent.endTime || session.endTime,
    tripDays: tripDays ?? session.tripDays,
    rejectedPlaceNames: [...rejected],
    avoidTypes: [...avoid],
    discovery: {
      ...discovery,
      mustVisit: intent.mustVisitPlaces[0] || session.discovery?.mustVisit,
    },
  };

  if (isDiscoveryComplete(nextSession) && nextSession.phase === "discover") {
    nextSession.phase = "recommend";
  }

  return nextSession;
}

export function formatTripIntentForAi(intent: TripIntent, prefs?: TravelPreferences): string {
  const lines: string[] = ["【Structured Trip Intent】"];
  if (intent.destinationCity) lines.push(`目的地城市：${intent.destinationCity}`);
  if (intent.destinationArea) lines.push(`想逛區域：${intent.destinationArea}`);
  if (intent.origin) lines.push(`出發地：${intent.origin}`);
  if (intent.mustVisitPlaces.length) lines.push(`必去：${intent.mustVisitPlaces.join("、")}`);
  if (intent.rejectedPlaces.length) lines.push(`不要：${intent.rejectedPlaces.join("、")}`);
  if (intent.travelDate) lines.push(`日期：${intent.travelDate}${intent.travelDateEnd ? ` ~ ${intent.travelDateEnd}` : ""}`);
  if (intent.startTime || intent.endTime) lines.push(`時段：${intent.startTime ?? "?"} - ${intent.endTime ?? "?"}`);
  if (intent.travelers) lines.push(`人數：${intent.travelers}`);
  if (intent.budget) lines.push(`預算：${intent.budget}`);
  if (intent.transport) lines.push(`交通：${intent.transport}`);
  if (intent.mood) lines.push(`心情：${intent.mood}`);
  if (intent.foodPreference) lines.push(`餐飲偏好：${intent.foodPreference}`);
  if (intent.settingPreference) {
    lines.push(
      `室內外：${intent.settingPreference === "indoor" ? "偏室內" : intent.settingPreference === "outdoor" ? "偏室外" : "都可以"}`,
    );
  }
  if (intent.constraints.length) lines.push(`限制：${intent.constraints.join("、")}`);
  if (intent.needsRainBackup) lines.push(`需要雨天備案：是`);
  if (prefs?.avoid?.length) lines.push(`偏好測驗想避開：${prefs.avoid.join("、")}`);
  lines.push(`可開始推薦：${intent.readyForRecommendations ? "是" : "否（先追問 missing）"}`);
  if (intent.missingKeys.length && !intent.readyForRecommendations) {
    lines.push(`尚缺：${intent.missingKeys.join("、")}`);
  }
  return lines.join("\n");
}

export function buildClarifyingQuestion(
  intent: TripIntent,
  locale: import("@/lib/i18n/types").Locale = "zh-TW",
): string {
  const key = intent.missingKeys[0];
  const zh: Record<TripIntentMissingKey, string> = {
    destination: intent.destinationCity
      ? `好的，我們從${intent.destinationCity}出發。這趟比較想放鬆、拍照，還是吃美食？`
      : "你想從哪個地區開始逛呢？",
    vibe: "這趟比較想放鬆、拍照，還是吃美食？",
    setting: "今天比較想待在室內，還是戶外走走？",
    companionship: "這次是一個人，還是跟朋友／家人一起？",
    date: "大概哪一天出門呢？",
  };
  const en: Record<TripIntentMissingKey, string> = {
    destination: "Which area would you like to start from?",
    vibe: "More into relaxing, photos, or food today?",
    setting: "Prefer indoors or outdoors?",
    companionship: "Solo trip or with friends/family?",
    date: "Which day are you heading out?",
  };
  const map = locale === "en" ? en : zh;
  return key ? map[key] : locale === "en" ? "Tell me a bit more about today's vibe?" : "跟我多說一點今天想怎麼過？";
}
