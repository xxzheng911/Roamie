import type { ChatPlanningSession } from "@/lib/chat-session";
import type { WeatherSummary } from "@/lib/weather-types";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { isNearbyPlaceIntent, type ChatIntent } from "@/lib/ai/chat-intent";
import {
  hasRemoteDestination,
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  missingDestinationPlanningKeys,
  normalizeDestinationLabel,
  parseDestinationFromText,
  parseDestinationSelectionFromText,
  resolveDestinationFromText,
  isMoodRecommendationSession,
  type ChatConversationMode,
} from "@/lib/ai/trip-planning-context";
import {
  isDestinationAdviceActive,
  isFlexiblePreferenceReply,
  parseDestinationAdvicePurpose,
} from "@/lib/ai/destination-advice";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import {
  logChatContextBefore,
  logChatContextMerge,
  logChatContextResolved,
  logChatIntentCurrent,
  logChatIntentPrevious,
  parseActivityPreferencesFromText,
  resolveChatContextIntent,
  resolveTripPurposeFromText,
  chatContextIntentToTripPurpose,
} from "@/lib/ai/chat-context-intent";
import {
  applyBudgetRefinementToContext,
  isBudgetRefinementText,
  parseBudgetPreferenceFromText,
} from "@/lib/ai/budget-refinement";
import { applyDestinationPendingSelection } from "@/lib/ai/destination-pending-question";
import { prepareSessionForUserTurn, logConversationStateUpdate } from "@/lib/ai/chat-conversation-state";

/** Canonical travel context — merged on every user turn */
export type CanonicalTravelContext = {
  destination?: string;
  /** 國家層級目的地（城市選定後保留） */
  destinationCountry?: string;
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
  /** 多城市組合（如曼谷＋芭達雅） */
  destinationCities?: string[];
  /** 使用者選定的行程風格／路線組合 */
  selectedTripStyle?: string;
  /** 排除菜系／類型關鍵字（含同義詞） */
  excludedCategories?: string[];
  /** low = 省預算／平價／免費偏好 */
  budgetPreference?: "low" | "medium" | "high";
  priceSensitivity?: boolean;
  /** 結構化行程偏好（attractions / shopping / food …） */
  selectedInterests?: string[];
  /** 已列出必去點清單 */
  mustVisitGenerated?: boolean;
  /** 規劃推薦流程階段 */
  planningStage?: import("@/lib/ai/chat-planning-stage").PlanningRecommendationStage;
  /** 對話階段：準備進入行程規劃 */
  conversationState?: import("@/lib/ai/itinerary-planning").ConversationState;
  /** 活動型推薦（camping 等） */
  activity?: string;
  /** 使用者回「都可以」時採熱門路線預設 */
  useDefaultRecommendation?: boolean;
  /** 行程產生模式：完整行程 / 逐日推薦 */
  selectedPlanMode?: import("@/lib/ai/itinerary-planning").ItineraryPlanMode;
  /** 上一輪解析到的 chat intent（供下一輪 merge 參考，不鎖死回覆） */
  lastIntent?: string;
};

export const EMPTY_TRAVEL_CONTEXT: CanonicalTravelContext = {
  interests: [],
};

/** Reject placeholders and empty values — must not overwrite existing context. */
export function isValidContextValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 && t !== "--" && t !== "—";
  }
  if (typeof v === "number") return !Number.isNaN(v);
  return true;
}

function pickValidContextValue<T>(next: T | undefined | null, prev: T | undefined): T | undefined {
  return isValidContextValue(next) ? (next as T) : prev;
}

export function resolveSessionDestination(session: ChatPlanningSession): string | undefined {
  const candidates = [
    session.travelContext?.destination,
    session.tripPlanningContext?.destination,
    session.tripDestination?.city,
    session.tripDestination?.displayLabel,
    session.preferredArea,
  ];
  for (const c of candidates) {
    if (isValidContextValue(c)) return normalizeDestinationLabel(String(c));
  }
  return undefined;
}

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
  try {
    return parseDestinationFromText(text);
  } catch (e) {
    console.warn("[AI_CONTEXT] parseDestination failed", e);
    return undefined;
  }
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
  return parseDayCountFromText(text);
}

function parseMonth(text: string): string | undefined {
  if (/下個月|下个月|下月/.test(text)) {
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    return `${next.getMonth() + 1}月`;
  }
  if (/這個月|这个月|本月/.test(text)) {
    const now = new Date();
    return `${now.getMonth() + 1}月`;
  }
  const m = text.match(/(\d{1,2})\s*月/);
  if (!m) return undefined;
  return `${Number.parseInt(m[1], 10)}月`;
}

function parseInterests(text: string, mood?: string): string[] {
  const tags: string[] = [...parseActivityPreferencesFromText(text)];
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
  if (parseBudgetPreferenceFromText(text) === "low") return "budget";
  if (/(小資|省一點|budget)/i.test(text)) return "budget";
  if (/(奢華|premium|luxury)/i.test(text)) return "luxury";
  if (/(品質|quality)/i.test(text)) return "quality";
  return undefined;
}

function parseVibe(text: string, mood?: string, opts?: { skipFlexibleVibe?: boolean }): string | undefined {
  if (/^1[\.、)]?$/.test(text.trim()) || /(經典|地標)/.test(text)) return "經典景點";
  if (/^2[\.、)]?$/.test(text.trim()) || /(美食|咖啡)/.test(text)) return "美食咖啡";
  if (/^3[\.、)]?$/.test(text.trim()) || /(動漫|購物)/.test(text)) return "動漫購物";
  if (/^4[\.、)]?$/.test(text.trim()) || /(慢步|散策)/.test(text)) return "慢步調散策";
  if (/(經典|地標|必去景點)/.test(text)) return "經典景點";
  if (/(美食|咖啡|吃貨|小吃)/.test(text)) return "美食咖啡";
  if (/(動漫|購物|逛街|血拼)/.test(text)) return "動漫購物";
  if (/(慢步|散策|慢慢走|慢旅行)/.test(text)) return "慢步調散策";
  if (/(放鬆|放空)/.test(text)) return "放鬆";
  if (/(探索|走走看看)/.test(text)) return "探索";
  if (/(拍照|打卡)/.test(text)) return "拍照";
  if (/(都有|都可以|都行)/.test(text)) {
    if (opts?.skipFlexibleVibe) return undefined;
    return "混合";
  }
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

function parseTravelDateFromText(text: string): string | undefined {
  const now = new Date();
  if (/明天|明日/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/後天|后天/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }
  if (/今天|今日/.test(text)) {
    return now.toISOString().slice(0, 10);
  }
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return undefined;
}

function parseTravelConstraints(text: string): Partial<CanonicalTravelContext> {
  const patch: Partial<CanonicalTravelContext> = {};
  const excluded: string[] = [];

  if (/(不要太熱|怕熱|避開高溫|不要曬|不想曬|避免中午|太熱)/.test(text)) {
    excluded.push("戶外曝曬", "中午戶外");
    patch.setting = "室內";
    patch.vibe = patch.vibe ?? "避暑";
  }
  if (/(不要太冷|怕冷|避寒|太冷)/.test(text)) {
    excluded.push("戶外長時間");
    patch.setting = patch.setting ?? "室內";
  }
  if (/(不要下雨|怕雨|下雨天|避雨)/.test(text)) {
    patch.setting = "室內";
    excluded.push("戶外");
  }
  if (/(少走路|不想走太多|不要走太多)/.test(text)) {
    excluded.push("長距離步行");
  }

  if (excluded.length) {
    patch.excludedCategories = excluded;
  }
  return patch;
}

function parseDestinationFromTurn(
  text: string,
  skipDestParse: boolean,
): string | undefined {
  if (skipDestParse) return undefined;
  return resolveDestinationFromText(text);
}

function mergeDestinationFields(
  prev: CanonicalTravelContext,
  newlyParsed?: string,
): Pick<CanonicalTravelContext, "destination" | "destinationCountry"> {
  if (!newlyParsed) {
    return {
      destination: prev.destination,
      destinationCountry: prev.destinationCountry,
    };
  }

  const label = normalizeDestinationLabel(newlyParsed);

  if (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label)) {
    return { destination: label, destinationCountry: label };
  }

  if (isKnownTouristCityLabel(label)) {
    const country =
      prev.destination && isKnownCountryLabel(prev.destination)
        ? normalizeDestinationLabel(prev.destination)
        : prev.destinationCountry;
    return {
      destination: label,
      destinationCountry: country,
    };
  }

  return {
    destination: label,
    destinationCountry: prev.destinationCountry,
  };
}

export function parseTravelContextFromText(
  text: string,
  session: ChatPlanningSession,
): Partial<CanonicalTravelContext> {
  const t = text.trim();
  if (!t) return {};
  if (session.pendingQuestion) {
    const prev = session.travelContext ?? EMPTY_TRAVEL_CONTEXT;
    const pq = session.pendingQuestion;
    return {
      destination: prev.destination ?? pq.baseDestination,
      destinationCountry: prev.destinationCountry ?? pq.destinationCountry,
      days: parseDays(t) ?? prev.days ?? session.tripDays,
      travelMonth: prev.travelMonth,
      startDate: parseTravelDateFromText(t) ?? prev.startDate ?? session.tripStartDate,
      tripPurpose: prev.tripPurpose,
      vibe: prev.vibe,
      mood: prev.mood,
      selectedInterests: prev.selectedInterests,
      conversationState: prev.conversationState,
      selectedPlanMode: prev.selectedPlanMode,
      destinationCities: prev.destinationCities,
      selectedTripStyle: prev.selectedTripStyle,
      useDefaultRecommendation: prev.useDefaultRecommendation,
      ...parseTravelConstraints(t),
    };
  }
  if (session.adviceSelectionThisTurn) {
    const prev = session.travelContext;
    return {
      days: parseDays(t) ?? prev?.days,
      travelMonth: parseMonth(t) ?? prev?.travelMonth,
      mood: prev?.mood ?? session.mood,
      vibe: prev?.vibe,
      setting: prev?.setting,
      tripPurpose: prev?.tripPurpose,
    };
  }
  const moodHint = session.selectedMood ?? session.mood;
  const preset = moodHint ? MOOD_PRESETS[moodHint] : undefined;
  const skipDestParse = isMoodRecommendationSession(session) && !hasCategoryPlaceQuery(t);
  const adviceActive = isDestinationAdviceActive(session);
  const skipFlexibleVibe =
    adviceActive ||
    session.activeChatIntent === "destination_advice" ||
    session.activeChatIntent === "restaurant" ||
    session.activeChatIntent === "cafe" ||
    isFlexiblePreferenceReply(t);

  if (isFlexiblePreferenceReply(t)) {
    const prev = session.travelContext;
    return {
      destination: prev?.destination ?? session.tripPlanningContext?.destination,
      destinationCountry: prev?.destinationCountry,
      travelMonth: prev?.travelMonth,
      days: prev?.days ?? session.tripDays,
      tripPurpose: prev?.tripPurpose ?? session.travelContext?.tripPurpose,
      vibe: adviceActive ? prev?.vibe : prev?.vibe ?? session.discovery?.vibe ?? preset?.vibe ?? "放鬆",
      setting: prev?.setting ?? session.discovery?.setting ?? preset?.setting ?? "either",
      mood: adviceActive ? prev?.mood : prev?.mood ?? preset?.mood ?? moodHint,
    };
  }

  const tripPurpose = isBudgetRefinementText(t)
    ? "refine_recommendations"
    : resolveTripPurposeFromText(t, session.travelContext?.tripPurpose) ??
      parseDestinationAdvicePurpose(t);

  const budgetRefinement = isBudgetRefinementText(t)
    ? applyBudgetRefinementToContext(t, session.travelContext ?? { interests: [] })
    : {};

  const newlyParsedDest = parseDestinationFromTurn(t, skipDestParse);

  const base: Partial<CanonicalTravelContext> = {
    currentLocation: session.location?.city,
    travelMonth: parseMonth(t),
    startDate: parseTravelDateFromText(t) ?? session.tripStartDate ?? session.travelDate,
    endDate: session.tripEndDate,
    days: parseDays(t) ?? session.tripDays,
    mood: preset?.mood ?? moodHint ?? parseVibe(t),
    companion: parseCompanion(t) ?? session.discovery?.companionship,
    interests: parseInterests(t, moodHint),
    transportMode: parseTransport(t) ?? session.transportation,
    budgetLevel: parseBudget(t) ?? session.budget,
    travelStyle: session.tripStyles ?? session.pace,
    weather: session.weather ?? null,
    tripPurpose: tripPurpose ?? preset?.tripPurpose,
    vibe: parseVibe(t, moodHint, { skipFlexibleVibe }) ?? session.discovery?.vibe,
    setting: parseSetting(t, moodHint) ?? session.discovery?.setting,
    ...parseTravelConstraints(t),
    ...budgetRefinement,
  };

  if (newlyParsedDest) {
    const mergedDest = mergeDestinationFields(
      session.travelContext ?? EMPTY_TRAVEL_CONTEXT,
      newlyParsedDest,
    );
    base.destination = mergedDest.destination;
    base.destinationCountry = mergedDest.destinationCountry;
  }

  return base;
}

export function mergeTravelContext(
  session: ChatPlanningSession,
  userText: string,
  lastAssistantReply?: string,
): { context: CanonicalTravelContext; session: ChatPlanningSession } {
  try {
    if (session.fromTripAddPlace && session.tripAddPlaceContext) {
      const ctx = session.tripAddPlaceContext;
      const prev = session.travelContext ?? EMPTY_TRAVEL_CONTEXT;
      const lat = ctx.lastPlace?.lat ?? ctx.destinationLocation?.lat;
      const lng = ctx.lastPlace?.lng ?? ctx.destinationLocation?.lng;
      const merged: CanonicalTravelContext = {
        ...prev,
        destination: ctx.destination,
        currentLocation: ctx.currentPlaces.map((p) => p.name).join("、") || ctx.destination,
        tripPurpose: "trip_add_place",
        mood: ctx.travelStyle ?? prev.mood ?? session.mood,
        transportMode: ctx.transportationMode ?? prev.transportMode ?? session.transportation,
        budgetLevel: ctx.budget ?? prev.budgetLevel ?? session.budget,
        days: ctx.tripDates.dayCount ?? prev.days ?? session.tripDays,
        startDate: ctx.tripDates.start ?? prev.startDate ?? session.tripStartDate,
        endDate: ctx.tripDates.end ?? prev.endDate ?? session.tripEndDate,
        weather: ctx.weather ?? session.weather ?? prev.weather ?? null,
      };
      const followUpIntent =
        /(三餐|早餐|午餐|晚餐|宵夜|早午餐|吃飯|用餐|找餐廳|找美食|想吃|安排.{0,4}餐|餐廳|美食|吃什麼)/.test(
          userText.trim(),
        )
          ? "restaurant"
          : /(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(userText)
            ? "cafe"
            : /(散步|景點|走走|逛逛|參觀|景觀|下午茶)/.test(userText)
              ? "attraction"
              : undefined;
      const nextSession: ChatPlanningSession = {
        ...session,
        fromTripAddPlace: true,
        tripAddPlaceContext: ctx,
        conversationMode: "trip_add_place",
        travelContext: merged,
        preferredArea: ctx.destination,
        activeChatIntent: followUpIntent ?? session.activeChatIntent,
        location:
          lat != null && lng != null && (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
            ? {
                lat,
                lng,
                city: ctx.destination,
                ...(session.location?.placeId ? { placeId: session.location.placeId } : {}),
              }
            : session.location,
        phase: session.phase === "discover" ? "followup" : session.phase,
      };
      return { context: merged, session: nextSession };
    }

    const prepared = prepareSessionForUserTurn(session, lastAssistantReply);
    const prev = prepared.travelContext ?? EMPTY_TRAVEL_CONTEXT;

    logChatContextBefore({
      destination: prev.destination,
      travelDate: prev.startDate ?? prev.travelMonth,
      tripDays: prev.days,
      preferences: prev.interests,
      interests: prev.interests,
      lastIntent: prev.lastIntent ?? prev.tripPurpose,
      pendingQuestion: prepared.pendingQuestion?.type,
    });
    logChatIntentPrevious(prev.lastIntent ?? prev.tripPurpose);

    const currentIntent = resolveChatContextIntent(userText, prev.lastIntent ?? prev.tripPurpose);
    logChatIntentCurrent(currentIntent);

    const pendingSelection = applyDestinationPendingSelection(userText, prepared);
    const workingSession = pendingSelection.session;
    if (pendingSelection.selectedOption) {
      logConversationStateUpdate(
        { ...prev, ...pendingSelection.contextPatch, interests: prev.interests },
        undefined,
      );
    }

    const parsed = parseTravelContextFromText(userText, workingSession);
    const moodKey = workingSession.selectedMood ?? workingSession.mood;
    const preset = moodKey ? MOOD_PRESETS[moodKey] : undefined;
    const skipDestParse =
      (isMoodRecommendationSession(workingSession) || Boolean(pendingSelection.selectedOption)) &&
      !hasCategoryPlaceQuery(userText);

    const parsedDest = isValidContextValue(parsed.destination) ? parsed.destination : undefined;
    const prevDest = isValidContextValue(prev.destination) ? prev.destination : undefined;
    const sessionDest = resolveSessionDestination(workingSession);

    const destMerge = pendingSelection.selectedOption
      ? {
          destination: pickValidContextValue(
            pendingSelection.contextPatch.destination,
            prevDest ?? sessionDest,
          ),
          destinationCountry: pickValidContextValue(
            pendingSelection.contextPatch.destinationCountry,
            prev.destinationCountry,
          ),
        }
      : parsedDest
        ? {
            destination: parsedDest,
            destinationCountry:
              pickValidContextValue(parsed.destinationCountry, prev.destinationCountry) ??
              prev.destinationCountry,
          }
        : {
            destination: prevDest ?? sessionDest,
            destinationCountry: prev.destinationCountry,
          };

    const merged: CanonicalTravelContext = {
      ...prev,
      ...pendingSelection.contextPatch,
      ...Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, v]) =>
            isValidContextValue(v) && key !== "destination" && key !== "destinationCountry",
        ),
      ),
      ...destMerge,
      currentLocation: workingSession.location?.city ?? prev.currentLocation,
      mood: parsed.mood ?? preset?.mood ?? prev.mood ?? moodKey,
      vibe: parsed.vibe ?? preset?.vibe ?? prev.vibe ?? workingSession.discovery?.vibe,
      setting: parsed.setting ?? preset?.setting ?? prev.setting ?? workingSession.discovery?.setting,
      companion:
        parsed.companion ??
        prev.companion ??
        workingSession.discovery?.companionship,
      days: pickValidContextValue(parsed.days, prev.days) ?? workingSession.tripDays,
      travelMonth: pickValidContextValue(parsed.travelMonth, prev.travelMonth),
      startDate: parsed.startDate ?? prev.startDate ?? workingSession.tripStartDate,
      endDate: parsed.endDate ?? prev.endDate ?? workingSession.tripEndDate,
      transportMode: parsed.transportMode ?? prev.transportMode ?? workingSession.transportation,
      budgetLevel: parsed.budgetLevel ?? prev.budgetLevel ?? workingSession.budget,
      travelStyle:
        pendingSelection.contextPatch.travelStyle ??
        parsed.travelStyle ??
        prev.travelStyle ??
        workingSession.tripStyles,
      weather: workingSession.weather ?? prev.weather ?? null,
      interests: uniqStrings([...prev.interests, ...(parsed.interests ?? [])]),
      tripPurpose:
        pendingSelection.contextPatch.tripPurpose ??
        parsed.tripPurpose ??
        chatContextIntentToTripPurpose(currentIntent) ??
        preset?.tripPurpose ??
        (currentIntent === "general_chat" ? prev.tripPurpose : undefined),
      lastIntent: currentIntent,
      destinationCities: pendingSelection.contextPatch.destinationCities ?? prev.destinationCities,
      selectedTripStyle:
        pendingSelection.contextPatch.selectedTripStyle ?? prev.selectedTripStyle,
      selectedInterests:
        pendingSelection.contextPatch.selectedInterests ?? prev.selectedInterests,
      mustVisitGenerated:
        pendingSelection.contextPatch.mustVisitGenerated ?? prev.mustVisitGenerated,
      conversationState:
        pendingSelection.contextPatch.conversationState ?? prev.conversationState,
      selectedPlanMode:
        pendingSelection.contextPatch.selectedPlanMode ?? prev.selectedPlanMode,
      excludedCategories: uniqStrings([
        ...(workingSession.excludedCategories ?? []),
        ...(prev.excludedCategories ?? []),
        ...(parsed.excludedCategories ?? []),
      ]),
    };

    console.info("[AI_CONTEXT] parsed", logTravelContext(merged));

    const discovery = { ...workingSession.discovery };
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
      ...workingSession,
      travelContext: merged,
      discovery,
      mood: merged.mood ?? workingSession.mood,
      tripDays: merged.days ?? workingSession.tripDays,
      travelDate: merged.startDate ?? workingSession.travelDate,
      tripStartDate: merged.startDate ?? workingSession.tripStartDate,
      tripEndDate: merged.endDate ?? workingSession.tripEndDate,
      transportation: merged.transportMode ?? workingSession.transportation,
      budget: merged.budgetLevel ?? workingSession.budget,
      preferredArea: skipDestParse
        ? workingSession.preferredArea
        : merged.destination ?? workingSession.preferredArea,
    };

    logChatContextMerge({
      destination: merged.destination,
      tripDays: merged.days,
      travelDate: merged.startDate ?? merged.travelMonth,
      preferences: merged.interests,
      tripPurpose: merged.tripPurpose,
      lastIntent: merged.lastIntent,
    });
    logChatContextResolved({
      destination: merged.destination,
      tripDays: merged.days,
      travelDate: merged.startDate ?? merged.travelMonth,
      preferences: merged.interests,
      lastIntent: merged.lastIntent,
      tripPurpose: merged.tripPurpose,
    });

    console.info("[AI_CONTEXT] updated", logTravelContext(merged));
    return { context: merged, session: nextSession };
  } catch (e) {
    console.warn("[AI_CONTEXT] mergeTravelContext failed", e);
    return {
      context: session.travelContext ?? EMPTY_TRAVEL_CONTEXT,
      session,
    };
  }
}

export function logTravelContext(ctx: CanonicalTravelContext): string {
  return JSON.stringify({
    destination: ctx.destination ?? "—",
    destinationCountry: ctx.destinationCountry ?? "—",
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
  intent: ChatIntent = "general",
): TripIntentMissingKey[] {
  const hasGps =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);
  const hasDestination = Boolean(ctx.destination?.trim() || session.tripDestination);
  const hasMoodContext = Boolean(
    ctx.mood?.trim() ||
      ctx.vibe?.trim() ||
      ctx.interests.length > 0 ||
      session.mood?.trim() ||
      session.fromMoodFlow ||
      session.fromMoodCard,
  );

  if (hasGps && hasMoodContext && intent !== "trip_planning" && !hasRemoteDestination(ctx, session)) {
    return [];
  }

  if (
    session.conversationMode === "destination_planning" ||
    session.tripPlanningContext?.intent === "destination_planning" ||
    intent === "trip_planning" ||
    intent === "destination_advice" ||
    isDestinationAdviceActive(session, ctx)
  ) {
    if (isDestinationAdviceActive(session, ctx) || intent === "destination_advice") {
      const dest = ctx.destination ?? session.tripPlanningContext?.destination;
      return dest?.trim() ? [] : ["destination"];
    }
    return missingDestinationPlanningKeys(ctx, session);
  }

  if (isNearbyPlaceIntent(intent)) {
    if (hasGps || hasDestination) return [];
    return ["destination"];
  }

  const missing: TripIntentMissingKey[] = [];
  const hasMoodFlow = session.fromMoodCard || session.fromMoodFlow || Boolean(ctx.mood);

  if (!hasDestination && !hasGps && !session.fromPlanForm && !session.fromPlanAi) missing.push("destination");
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
  intent: ChatIntent = "general",
): boolean {
  if (isDestinationAdviceActive(session, ctx) || intent === "destination_advice") {
    return false;
  }
  if (isPlaceDetailChatActive(session)) return false;
  if (session.selectedPlaces.length > 0) return true;
  if (session.fromPlanForm || session.fromPlanAi) return true;
  if (session.fromMoodFlow || session.fromMoodCard) return true;
  if (session.conversationMode === "destination_planning") {
    return missingContextKeys(ctx, session, "trip_planning").length === 0;
  }

  if (isNearbyPlaceIntent(intent)) {
    const hasGps =
      session.location?.lat != null &&
      session.location?.lng != null &&
      (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);
    return hasGps || Boolean(ctx.destination?.trim() || session.tripDestination);
  }

  if (intent === "trip_planning") {
    return missingContextKeys(ctx, session, intent).length === 0;
  }

  const hasGps =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);
  const hasMoodContext = Boolean(
    ctx.mood?.trim() ||
      ctx.vibe?.trim() ||
      ctx.interests.length > 0 ||
      session.mood?.trim() ||
      session.fromMoodFlow ||
      session.fromMoodCard,
  );
  if (hasGps && hasMoodContext) return true;

  const missing = missingContextKeys(ctx, session, intent);
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
  if (ctx.destinationCountry) lines.push(`destinationCountry: ${ctx.destinationCountry}`);
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
  if (ctx.selectedInterests?.length) {
    lines.push(`selectedInterests: ${ctx.selectedInterests.join("、")}`);
  }
  if (ctx.mustVisitGenerated) lines.push("mustVisitGenerated: true");
  if (ctx.conversationState) lines.push(`conversationState: ${ctx.conversationState}`);
  if (ctx.budgetPreference) lines.push(`budgetPreference: ${ctx.budgetPreference}`);
  if (ctx.priceSensitivity) lines.push(`priceSensitivity: true`);
  if (ctx.weather) {
    lines.push(
      `weather: ${ctx.weather.city} ${ctx.weather.condition} ${ctx.weather.tempC ?? ""}°C`,
    );
  }
  return lines.join("\n");
}
