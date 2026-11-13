import { displayMetadataMatchesLabel, sameDisplayCountry, type DestinationDisplayMetadata } from "./destination-display-metadata";
import { globalPlanningTurn, applyGlobalPlanningContext, combinationSwitchDatePatch, isCombinationDestinationSwitchContext, isCombinationSwitchRelistBase } from './global-planning-context';
import { travelDestinationCandidates, travelMonthSignal } from "./travel-language-signals";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type { WeatherSummary } from "@/lib/weather-types";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { planningCalendarSignals } from "./planning-calendar-signals";
import {
  isNearbyPlaceIntent,
  userExplicitlyWantsNearbyPlaces,
  type ChatIntent,
} from "@/lib/ai/chat-intent";
import {
  hasRemoteDestination,
  isCountryCityInquiryText,
  isFutureTripPlanningStatement,
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  missingDestinationPlanningKeys,
  normalizeDestinationLabel,
  coerceTravelDestination,
  parseDestinationFromText,
  parseDestinationSelectionFromText,
  parseNegatedDestinationSwitchTurn,
  resolveDestinationFromText,
  isMoodRecommendationSession,
  isNonPlaceDestinationText,
  stripTravelWishSuffix,
  type ChatConversationMode,
} from "@/lib/ai/trip-planning-context";
import {
  isDestinationAdviceActive,
  isFlexiblePreferenceReply,
  parseDestinationAdvicePurpose,
} from "@/lib/ai/destination-advice";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { resolveDestinationAreaScope } from "@/lib/ai/destination-travel-profile";
import {
  buildDestinationScopeContextPatch,
  getResolvedDestinationScope,
  getTrustedProviderLocation,
} from "@/lib/ai/resolved-destination-scope";
import { isResolvedDestination } from "@/lib/location/destination-authority";
import { normalizeAreaEvidence, stripAdministrativeSuffix } from "@/lib/ai/destination-area-aliases";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { finalizePlanningContextAuthority } from "@/lib/ai/planning-context-authority";
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
  extractItineraryEntitiesFromText,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import {
  isCombinationSelectionContinuationReply,
  isExplicitPrimaryDestinationSwitch,
  parseNearbyExtensionsFromText,
} from "@/lib/ai/combination-selection-reply";
import {
  applyBudgetRefinementToContext,
  isBudgetRefinementText,
  parseBudgetPreferenceFromText,
} from "@/lib/ai/budget-refinement";
import { applyDestinationPendingSelection } from "@/lib/ai/destination-pending-question";
import {
  prepareSessionForUserTurn,
  logConversationStateUpdate,
} from "@/lib/ai/chat-conversation-state";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";
import type { TouristQualityIntent, TouristQualityTier } from "@/lib/tourist-quality-gate";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import {
  parseTravelDateRangeFromText,
  stripTravelDateRangeFromText,
} from "@/lib/ai/parse-travel-date-range";
import { enrichTripDatesInContext } from "@/lib/ai/ai-trip-style";
import {
  resolveDestinationScopeFields,
  logDestinationCitySelected,
  logDestinationSearchScopeUpdated,
} from "@/lib/ai/destination-scope";
import {
  isCountryToCityRefinement,
  isNewTripPlanning,
  maybeResetForNewTripPlanning,
  parseTravelMonthFromText,
  resolveActiveDestination,
  resolveIncomingDestinationFromText,
  prepareDestinationChangeReset,
  commitDestinationChangeReset,
} from "@/lib/ai/trip-planning-session-reset";
import type {
  NewTripPlanningReason,
  PreparedDestinationChangeReset,
} from "@/lib/ai/trip-planning-session-reset";
import { updateSessionPreferenceFromExplicitText } from "@/lib/personalization/resolve-effective-preference";
import {
  dropStaleCombinationConfirm,
  isCombinationChoiceTurn,
  isCombinationHoldReply,
  isTripLengthOnlyCombinationReply,
  withoutDayReferences,
} from "@/lib/ai/combination-partial-modify-reply";

/** Canonical travel context — merged on every user turn */
/** Minimal first-pass Tourist Quality Gate verdict stored on an offered place (no evidence text). */
export type OfferedTouristQualityVerdict = {
  /** Google Place ID the verdict was computed for; reused only on strict equality. */
  placeId: string;
  tier: TouristQualityTier;
  admit: boolean;
  /** Canonical intent the verdict was computed under. */
  intent: TouristQualityIntent;
};

export type CanonicalTravelContext = {
  sessionPreference?: import("@/lib/personalization/types").SessionPreferenceV1;
  destination?: string;
  /** Unverified user text; never coordinates/place authority. */
  destinationCandidate?: { raw: string; countryHint?: string; status: 'pending' | 'unresolved' | 'conflict' | 'resolved'; locale?: string;
    /** Submitted while choosing combinations: once resolved it is a combination-choice destination switch (dates kept, one reset). */
    combinationSwitch?: true;
    /** Submitted on a country-level trip (日本): a geocode-confirmed city of another country is a destination switch. */
    countryTrip?: true;
    /** Re-submitted after an unresolved / conflicting candidate (「熱海, 日本」 after a miss). */
    afterMiss?: true };
  destinationInputNames?: string[];
  destinationClarification?: 'multiple_destinations';
  travelSeason?: 'spring' | 'summer' | 'autumn' | 'winter';
  /** 國家層級目的地（城市選定後保留） */
  destinationCountry?: string;
  /** ISO country code when resolved (SG / JP / …) */
  destinationCountryCode?: string;
  /** Entity resolver type: country / city / city_state / region / … */
  destinationType?: import("@/lib/ai/destination-entity").DestinationEntityType;
  /** City when destination is city-level (or selected under a country) */
  destinationCity?: string;
  /** Region / island / state when applicable */
  destinationRegion?: string;
  /** Locked destination scope id (generation-safe) */
  destinationScopeId?: string;
  /** Locked / resolved destination coordinates */
  destinationCoordinates?: { lat: number; lng: number };
  currentLocation?: string;
  travelMonth?: string;
  /** Absolute year when user said 明年 / 今年 / YYYY */
  travelYear?: number;
  startDate?: string;
  endDate?: string;
  /** AI-suggested start (e.g. mid-month) when user has not locked exact dates yet */
  suggestedStartDate?: string;
  dateProvenance?: import("./resolve-suggested-trip-dates").TripDateProvenance;
  days?: number;
  mood?: string;
  /** Whether mood can ground outward-facing personalization copy. */
  moodEvidenceSource?: import("@/lib/build-place-recommendation-reason").RecommendationPreferenceEvidenceSource;
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
  /** 1-based combination ids locked for this generation (e.g. [1,2,4]) */
  selectedCombinationIds?: number[];
  /** Place names allowed from selected combinations */
  selectedCombinationPlaceNames?: string[];
  /** Places exclusive to unselected combinations — must never enter the itinerary */
  excludedCombinationPlaceNames?: string[];
  /**
   * Near-suburb / day-trip extensions under the primary destination
   * (e.g. Tokyo trip + 橫濱). Must not replace `destination`.
   */
  nearbyExtensions?: string[];
  /** Nearby extensions that could not be geocoded yet — keep context, do not reset days. */
  unresolvedNearbyExtensions?: string[];
  /** How combination selection was resolved for this generation */
  selectionSource?: "user_indexed" | "user_title" | "user_all_or_auto" | "all_selected_by_user";
  /**
   * Structured combination options shown to the user (not just assistant message text).
   * Generator reads these instead of re-parsing chat bubbles.
   */
  offeredCombinations?: Array<{
    id: number;
    title: string;
    /**
     * Stable theme key of the combination the user chose from (discovery `combo.theme`, never the
     * localized title). Canonical Tourist Quality intent source for Replan. Absent on older sessions.
     */
    themeKey?: string;
    places: Array<{
      candidateId?: string;
      /** Stable planner identity copied from the grounded discovery candidate. */
      plannerProvenanceKey?: string;
      sourceCandidateIndex?: number;
      originalName?: string;
      name: string;
      /** App-locale display name — UI / chat must prefer this over name/raw. */
      localizedDisplayName?: string;
      languageCode?: string;
      localizationSource?: string;
      searchQuery: string;
      destination?: string;
      sourceCombinationId: number;
      isRequiredBySelection?: boolean;
      googlePlaceId?: string;
      latitude?: number;
      longitude?: number;
      address?: string;
      types?: string[];
      primaryType?: string | null;
      /** Category-contract result shared with itinerary generation. */
      normalizedCategory?: string;
      combinationId?: string | number;
      rating?: number | null;
      userRatingCount?: number | null;
      businessStatus?: string | null;
      resolutionStatus: "named" | "resolved" | "unresolved" | "pending";
      /**
       * First-pass Tourist Quality Gate verdict, bound to a Google Place ID. Absent on older
       * sessions or when the place had no Google Place ID (Replan then re-judges).
       */
      touristQuality?: OfferedTouristQualityVerdict;
    }>;
  }>;
  /**
   * Country→city/region/island options from the previous assistant turn.
   * Destination Anchor matches user replies against this metadata first.
   */
  destinationDisplay?: DestinationDisplayMetadata;
  offeredDestinationOptions?: import("@/lib/ai/destination-anchor").DestinationOptionMetadata[];
  /** Stable id for one Places mapping / itinerary generation attempt */
  generationRequestId?: string;
  /** Last itinerary Places failure root cause (tech, not user copy) */
  lastItineraryFailure?: {
    code: string;
    stage: string;
    attemptedCandidates?: number;
    resolvedCandidates?: number;
    retryCount?: number;
    searchRetryCount?: number;
    candidateRegenerationCount?: number;
    detailRetryCount?: number;
    fallbackCandidateCount?: number;
    generationRequestId?: string;
  };
  /**
   * Places successfully mapped in a previous failed generation.
   * Regenerate reuses these instead of re-querying all candidates.
   */
  partiallyResolvedPlaces?: import("@/lib/chat-session").ChatPlaceItem[];
  /** Failed combination ids from last mapping attempt */
  failedCombinationIds?: number[];
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
  /** 使用者已確認天數（awaiting_trip_duration 流程） */
  planningDaysConfirmed?: boolean;
  /** 行程風格選項（classic_landmarks / local_life / slow_nature / mixed） */
  planningTripStyle?: import("@/lib/ai/ai-trip-style").TripStyleKey;
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
    const coerced = coerceTravelDestination(isValidContextValue(c) ? String(c) : undefined);
    if (coerced) return coerced;
  }
  return undefined;
}

const MOOD_PRESETS: Record<
  string,
  Partial<Pick<CanonicalTravelContext, "mood" | "vibe" | "setting" | "tripPurpose" | "interests">>
> = {
  深夜散步: {
    mood: "深夜散步",
    vibe: "探索",
    setting: "室外",
    tripPurpose: "night_walk",
    interests: ["夜景", "散步"],
  },
  下雨天: {
    mood: "下雨天",
    vibe: "放鬆",
    setting: "室內",
    tripPurpose: "rainy_day",
    interests: ["室內", "咖啡"],
  },
  找咖啡: {
    mood: "找咖啡",
    vibe: "放鬆",
    setting: "室內",
    tripPurpose: "cafe",
    interests: ["咖啡", "安靜"],
  },
  想放空: {
    mood: "想放空",
    vibe: "放鬆",
    setting: "either",
    tripPurpose: "relax",
    interests: ["療癒", "慢步"],
  },
  一個人: { mood: "一個人", vibe: "探索", companion: "一個人", interests: ["獨處"] },
  看海: {
    mood: "看海",
    vibe: "放鬆",
    setting: "室外",
    tripPurpose: "coastal",
    interests: ["海邊", "散步"],
  },
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
  if (withMatch?.[1]) {
    const candidate = withMatch[1];
    // 「1、2跟橫濱」中的城市是近郊延伸，不是同行對象
    if (KNOWN_CITIES.test(candidate) || isKnownTouristCityLabel(candidate)) {
      return undefined;
    }
    return candidate;
  }
  return undefined;
}

function parseDays(text: string): number | undefined {
  return parseDayCountFromText(text);
}

function parseMonth(text: string): string | undefined {
  const signal = travelMonthSignal(text);
  if (signal) return signal;
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

/** Resolve travel year from 明年 / 今年 / explicit YYYY near a month mention. */
function parseTravelYear(text: string, now = new Date()): number | undefined {
  const explicit = text.match(/(20\d{2})\s*年/);
  if (explicit) {
    const y = Number.parseInt(explicit[1], 10);
    if (y >= 2000 && y <= 2100) return y;
  }
  if (/明年/.test(text)) return now.getFullYear() + 1;
  if (/今年/.test(text)) return now.getFullYear();
  if (/後年|后年/.test(text)) return now.getFullYear() + 2;
  return undefined;
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

function parseVibe(
  text: string,
  mood?: string,
  opts?: { skipFlexibleVibe?: boolean },
): string | undefined {
  if (/^1[.、)]?$/.test(text.trim()) || /(經典|地標)/.test(text)) return "經典景點";
  if (/^2[.、)]?$/.test(text.trim()) || /(美食|咖啡)/.test(text)) return "美食咖啡";
  if (/^3[.、)]?$/.test(text.trim()) || /(動漫|購物)/.test(text)) return "動漫購物";
  if (/^4[.、)]?$/.test(text.trim()) || /(慢步|散策)/.test(text)) return "慢步調散策";
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

export function resolveMoodEvidenceSource(
  text: string,
  mood: string | undefined,
  inheritedSource?: CanonicalTravelContext["moodEvidenceSource"],
): CanonicalTravelContext["moodEvidenceSource"] {
  if (!mood) return undefined;
  if (inheritedSource) return inheritedSource;
  if (/(?:我|今天|現在)?\s*(?:想|想要|想喝|想吃|喜歡|偏好|心情)|放鬆|放空/.test(text)) {
    return "USER_MESSAGE";
  }
  return "CATEGORY_DERIVED";
}

function parseSetting(text: string, mood?: string): string | undefined {
  if (/(室內|下雨|雨天|雨)/.test(text)) return "室內";
  if (/(室外|戶外|散步|公園|海)/.test(text)) return "室外";
  if (mood && MOOD_PRESETS[mood]?.setting) return MOOD_PRESETS[mood].setting;
  return undefined;
}

const EN_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const EN_WEEKDAY = EN_WEEKDAYS.join("|");
const KO_WEEKDAYS = "일월화수목금토";
const EN_KO_RELATIVE_DAY_RE = /\btoday\b|\btomorrow\b|오늘|내일/i;
/**
 * en trip nouns only (plan / stay / change / move / switch alone are everyday words). A noun modifier
 * ("travel ban", "vacation rental") is not a trip.
 */
const EN_TRIP_CONTEXT_RE =
  /\b(?:trips?|travel(?:s|ing|ling|ed|led)?|itinerar(?:y|ies)|vacations?|journeys?)\b(?!\s+(?:bans?|restrictions?|advisor(?:y|ies)|warnings?|alerts?|insurance|agenc(?:y|ies)|agents?|rentals?|homes?|deals?|news|mode|size|bags?|pillows?|time)\b)|\bthe\s+dates?\b/i;
/** ko trip wording: 「오늘부터 시작」 counts only inside a trip sentence (「오늘부터 여행 시작」). */
const KO_TRIP_CONTEXT_RE = /여행|일정|휴가|트립/;
/** Weather / rain wording in four locales (雪梨 is Sydney; 熱門／怕熱／寒假／暑假 are not weather). */
const WEATHER_RE = new RegExp(
  [
    "\\b(?:weather|rain(?:s|y|ing|ed)?|forecasts?|cold(?:er)?|hot(?:ter)?|snow(?:s|y|ing|ed)?|sunny)\\b",
    "날씨",
    "(?<![가-힣])비\\s*(?:가|는|도)?\\s*(?:와|온|오|올|내|예보|소식)",
    "(?<![가-힣])눈\\s*(?:이|은|도)?\\s*(?:와|온|오|올|내)",
    "춥|추워|추운|덥|더워|더운",
    "天氣|天气|天気|下雨|雨(?!林)|(?<![太怕避不])冷(?!門|门|氣|气|凍|冻)|(?<![太怕避不])熱(?!門|门|鬧|闹|情|點|点|炒|狗)|寒(?!假)|暑(?!假|期)|雪(?!梨)",
  ].join("|"),
  "i",
);
/**
 * Inside a weather sentence only a date phrase right before trip wording (「從明天開始玩」「明天開始去東京玩」
 * 「明日から3日間京都旅行」「내일부터 여행」「明天出發」) or a reschedule verb (「改成明天」「に変更」「로 바꿔」
 * "change it to tomorrow") is a trip date; a bare range (「明天到週五都會下雨，行程要改嗎」) is not.
 */
const WEATHER_TRIP_DATE_RE = new RegExp(
  [
    "(?:今天|今日|明天|明日(?!香)|明晚|後天|后天)\\s*(?:就)?\\s*(?:開始|开始|起)?\\s*(?:玩|旅行|旅遊|旅游|出發|出发|出遊|出游|啟程|启程|行程|去[^\\s，,。.!！?？、]{1,8}?(?:玩|旅行|旅遊|旅游))",
    "(?:今日|明日(?!香))\\s*(?:から\\s*(?:\\d+\\s*日間\\s*)?[\\p{Script=Han}\\p{Script=Katakana}ー]{0,8}(?:旅行|観光|出発)|(?:出発|発))",
    "(?:오늘|내일)\\s*(?:부터\\s*(?:\\d+\\s*일(?:\\s*간)?(?:\\s*동안)?\\s*)?여행|(?:부터\\s*|에\\s*)?(?:출발|떠나))",
    "(?:改成|改到|改為|改为|換成|换成|提前到|延到|延後到|延后到)\\s*(?:今天|今日|明天|明日|明晚|後天|后天)",
    "(?:に|へ)\\s*(?:変更|ずら)|(?:으로|로)\\s*(?:바꿔|변경|옮겨)",
    "\\b(?:change|move|switch|reschedule|shift)\\b[^.!?]*\\b(?:today|tomorrow)\\b",
  ].join("|"),
  "iu",
);
/** A weather / rain sentence is never a trip date unless WEATHER_TRIP_DATE_RE holds (「明天到週五會下雨嗎」「今日から寒くなる」). */
function isWeatherWithoutTripNoun(text: string): boolean {
  return WEATHER_RE.test(text) && !WEATHER_TRIP_DATE_RE.test(text);
}
/** ko attributive verb (「출발하는 비행기」「떠나는 사람」「시작하는 축제」) modifies a noun; 걸／거／것 (「출발하는 걸로」) still counts. */
const KO_ATTRIBUTIVE = `(?!(?:하|되)?는\\s*(?!걸|거|것)[가-힣])`;

type RelativeTripDateState = { hasTripDates?: boolean; awaitingDates?: boolean };

/**
 * en / ko explicit trip start wording → day offset from today (0 today, 1 tomorrow). Counts only with
 * (a) a trip noun, (b) a reschedule verb on it / them / the dates (or no object) while the session has
 * dates or is asking for them, or (c) a sentence that is only the date phrase. A whole-sentence phrase
 * with days or a weekday end ("starting today for 3 days", 「오늘부터 금요일까지」) always counts; a bare
 * one ("from today", 「오늘부터」) only while dates are being asked.
 */
function enKoExplicitTripDayOffset(text: string, state: RelativeTripDateState = {}): number | undefined {
  if (!EN_KO_RELATIVE_DAY_RE.test(text)) return undefined;
  const whole = text.trim().replace(/[\s.!?~,。！？]+$/u, "");
  const enTrip = EN_TRIP_CONTEXT_RE.test(text);
  const koTrip = KO_TRIP_CONTEXT_RE.test(text);
  const tripState = Boolean(state.hasTripDates || state.awaitingDates);
  const awaiting = Boolean(state.awaitingDates);
  const enDays = `\\s*(?:,\\s*)?for\\s+(?:\\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:days?|nights?)\\b`;
  const enRange = `\\s*(?:,\\s*)?(?:through|thru|until|till|to)\\s+(?:${EN_WEEKDAY})\\b`;
  const enAfter = `(?:${enDays}|${enRange}|\\s*$|\\s*[.!,])`;
  const enStart = `(?:starting|start|starts|beginning|from)`;
  const enVerb = `(?:change|move|switch|reschedule|shift)`;
  const koDays = `(?:\\d+\\s*박(?:\\s*\\d+\\s*일)?|\\d+\\s*일)(?:\\s*간)?(?:\\s*동안)?`;
  const koRange = `[${KO_WEEKDAYS}]요일\\s*까지`;
  const koChange = `(?:으로|로)\\s*(?:바꿔|변경|옮겨)`;
  const matches = (enWord: string, koWord: string): boolean => {
    // 「today's menu」「tomorrow's forecast」 are never a trip date.
    const en = `(?:${enWord})\\b(?!['’]s)`;
    const ko = `(?:${koWord})`;
    const enRes: string[] = [
      // (c) whole sentence is the date phrase with days or a weekday end.
      `^(?:${enStart}\\s+)?${en}(?:${enDays}(?:${enRange})?|${enRange})$`,
      `^(?:(?:please|can\\s+you|could\\s+you)\\s+)?${enVerb}\\s+(?:(?:it|them)\\s+)?(?:to|for)\\s+${en}(?:${enRange}|${enDays})$`,
    ];
    if (awaiting) enRes.push(`^(?:${enStart}\\s+)?${en}$`);
    if (tripState) enRes.push(`\\b${enVerb}\\s+(?:(?:it|them|(?:the|my|our)\\s+dates?)\\s+)?(?:to|for)\\s+${en}`);
    if (enTrip) {
      enRes.push(
        `\\b${enStart}\\s+${en}(?=${enAfter})`,
        `\\b${en}${enRange}`,
        `\\b${enVerb}\\s+(?:(?:it|them|(?:the|my|our)\\s+(?:trip|dates?|itinerary|travel))\\s+)?(?:to|for)\\s+${en}`,
      );
    }
    const koRes: string[] = [
      `${ko}\\s*(?:부터\\s*|에\\s*)?(?:출발|떠나)${KO_ATTRIBUTIVE}`,
      `^${ko}\\s*부터\\s*(?:${koDays}|${koRange}|${koDays}\\s*${koRange})(?:\\s*${koChange}[가-힣]*)?$`,
      `^${ko}\\s*[~\\-–]\\s*[${KO_WEEKDAYS}]요일(?:\\s*까지)?(?:\\s*${koChange}[가-힣]*)?$`,
    ];
    if (awaiting) koRes.push(`^${ko}\\s*(?:부터)?$`);
    if (tripState) {
      koRes.push(`(?:^|(?:그거|이거|그것|이것|그걸|이걸|날짜)\\s*(?:을|를|은|는|도)?\\s*)${ko}\\s*${koChange}`);
    }
    if (koTrip) {
      koRes.push(
        `${ko}\\s*부터(?=\\s*(?:${koDays}|${koRange}|여행|시작${KO_ATTRIBUTIVE}|$|[,.!~]))`,
        `${ko}\\s*${koChange}`,
        `${ko}\\s*[~\\-–]\\s*[${KO_WEEKDAYS}]요일`,
      );
    }
    const target = (re: string) => (re.startsWith("^") ? whole : text);
    return (
      enRes.some((re) => new RegExp(re, "i").test(target(re))) ||
      koRes.some((re) => new RegExp(re).test(target(re)))
    );
  };
  // 「day after tomorrow」「내일모레」 are not tomorrow.
  if (matches("(?<!after\\s)tomorrow", "내일(?!\\s*모레)")) return 1;
  if (matches("today", "오늘")) return 0;
  return undefined;
}

/** en 「through Friday」 / ko 「금요일까지」 → weekday index (0 = Sunday). */
function enKoRangeEndWeekday(text: string): number | undefined {
  const en = text.match(new RegExp(`\\b(?:through|thru|until|till|to)\\s+(${EN_WEEKDAY})\\b`, "i"));
  if (en) return EN_WEEKDAYS.indexOf(en[1].toLowerCase() as (typeof EN_WEEKDAYS)[number]);
  const ko = text.match(new RegExp(`(?:([${KO_WEEKDAYS}])요일\\s*까지|[~\\-–]\\s*([${KO_WEEKDAYS}])요일)`));
  if (ko) return KO_WEEKDAYS.indexOf(ko[1] ?? ko[2]);
  return undefined;
}

function parseTravelDateFromText(text: string, opts?: RelativeTripDateState): string | undefined {
  const now = new Date();
  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Weather / rain sentences (「明天到週五會下雨嗎」「明日から3日間雨が降るらしい」"will it rain from today
  // through Friday") never set a relative trip day unless a trip noun is present.
  if (isWeatherWithoutTripNoun(text)) {
    const iso = text.match(/\d{4}-\d{2}-\d{2}/);
    return iso ? iso[0] : undefined;
  }
  // 「今天天氣如何」「明天要下雨嗎」「明天開始下雨嗎」「明天至少要帶傘嗎」「今天到底要去哪」 are not
  // trip dates; only explicit trip-date wording sets the start date: 「今天出發」「明晚出發」
  // 「從明天開始（玩／N天）」「今天到週五」「改成明天到週五」「明日から」. 開始／起 must be followed by
  // travel wording or days, 到／至 by a date or weekday. A bare 「（要）去」(「我明天要去台北」) only
  // counts while the session has no trip dates yet. 明日香 is a place, never 明日.
  // 「明天開始去東京玩」: 去 + a short place + 玩／旅行 is trip wording too.
  const TRIP_AFTER = `\\s*(?:玩|旅行|旅遊|旅游|出發|出发|出遊|出游|行程|去[^\\s，,。.!！?？、]{1,8}?(?:玩|旅行|旅遊|旅游)|(?:\\d+|[一二三四五六七八九十兩两]+)\\s*天|$|[，,。.!！])`;
  const DATE_AFTER = `\\s*(?:\\d|[一二三四五六七八九十]+\\s*[月號号日]|週|周|星期|禮拜|礼拜|明天|後天|后天|下週|下周|下星期|月底|月初)`;
  const explicitTripDay = (word: string, allowGo: boolean): boolean =>
    new RegExp(
      `(?:改成|改到|改為|改为|換成|换成|提前到|延到|延後到|延后到)\\s*(?:${word})` +
        `|(?:從|从|自)\\s*(?:${word})\\s*(?:(?:開始|开始|起)(?=${TRIP_AFTER})|(?=${TRIP_AFTER})|[到至~～〜\\-—–](?=${DATE_AFTER}))` +
        `|(?:${word})\\s*(?:就)?\\s*(?:出發|出发|啟程|启程|動身|动身|から|出発|発)` +
        `|(?:${word})\\s*(?:就)?\\s*(?:開始|开始|起)(?=${TRIP_AFTER})` +
        `|(?:${word})\\s*[到至~～〜\\-—–](?=${DATE_AFTER})` +
        (allowGo && !opts?.hasTripDates ? `|(?:${word})\\s*(?:要|會|会)?(?:去|飛|飞)` : ""),
    ).test(text);
  const TOMORROW = "明天|明日(?!香)|明晚";
  if (new RegExp(TOMORROW).test(text) && explicitTripDay(TOMORROW, true)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toLocalIso(d);
  }
  if (/後天|后天/.test(text) && explicitTripDay("後天|后天", true)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return toLocalIso(d);
  }
  if (/今天|今日/.test(text) && explicitTripDay("今天|今日", false)) {
    return toLocalIso(now);
  }
  // en / ko: the same explicit trip-date wording only — "starting/from today for 3 days",
  // "change it to today through Friday", 「오늘부터 3일」「내일부터 금요일까지」. Weather / plain go
  // questions ("will it rain tomorrow", "let's go tomorrow", 「내일 비 와?」) never match.
  const enKoOffset = enKoExplicitTripDayOffset(text, opts);
  if (enKoOffset !== undefined) {
    const d = new Date(now);
    d.setDate(d.getDate() + enKoOffset);
    return toLocalIso(d);
  }
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return undefined;
}

/**
 * 「今天出發」「從明天開始」「明日から」「改成明天到週五」 on a trip that already has dates: the new start
 * date keeps the trip length (or ends on the named weekday / parsed end date / stated days), so the
 * old end date never stretches the trip (11/10～12/14). Without existing dates only the start is set.
 */
function parseRelativeTripDateRange(
  text: string,
  existing: { startDate?: string; endDate?: string; days?: number },
  parsedEndDate?: string,
  awaitingDates?: boolean,
): { startDate: string; endDate?: string; days?: number } | undefined {
  const startDate = parseTravelDateFromText(text, { hasTripDates: Boolean(existing.startDate), awaitingDates });
  if (!startDate) return undefined;
  if (!/今天|今日|明天|明日|明晚|後天|后天/.test(text) && !EN_KO_RELATIVE_DAY_RE.test(text)) return { startDate };
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const DAY = 86_400_000;
  const startMs = toUtc(startDate);
  if (parsedEndDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedEndDate) && toUtc(parsedEndDate) >= startMs) {
    return { startDate, endDate: parsedEndDate, days: Math.round((toUtc(parsedEndDate) - startMs) / DAY) + 1 };
  }
  // 「到週五」 or ja 「から金曜日まで」 (日月火水木金土 → the same weekday index).
  const jaWeekday = text.match(/(?:から|[~～〜])\s*([日月火水木金土])曜(?:日)?\s*まで/);
  const weekday = text.match(/[到至~～〜\-—–]\s*(?:週|周|星期|禮拜|礼拜)\s*([一二三四五六日天])/)
    ?? (jaWeekday ? [jaWeekday[0], "日一二三四五六"["日月火水木金土".indexOf(jaWeekday[1])]] : null);
  const enKoWeekday = weekday ? undefined : enKoRangeEndWeekday(text);
  if (weekday || enKoWeekday !== undefined) {
    const target = weekday ? "日一二三四五六".indexOf(weekday[1] === "天" ? "日" : weekday[1]) : enKoWeekday!;
    const offset = (target - new Date(startMs).getUTCDay() + 7) % 7;
    return { startDate, endDate: toIso(startMs + offset * DAY), days: offset + 1 };
  }
  const stated = parseDays(text);
  const span =
    existing.startDate && existing.endDate && toUtc(existing.endDate) >= toUtc(existing.startDate)
      ? Math.round((toUtc(existing.endDate) - toUtc(existing.startDate)) / DAY) + 1
      : existing.days;
  const days = stated ?? (existing.startDate ? span : undefined);
  if (!days || days < 1) return { startDate };
  return { startDate, endDate: toIso(startMs + (days - 1) * DAY), days };
}

/** The session is asking for the trip dates / length (ask_days, duration or date confirmation). */
function isAwaitingTripDates(session: ChatPlanningSession): boolean {
  const type = session.pendingQuestion?.type;
  return type === "ask_days" || type === "duration_choice" || type === "date_confirmation";
}

/** 「明日から3日間雨が降るらしい」「오늘부터 3일 동안 비 온대」: weather with a relative day sets neither dates nor days. */
function isRelativeDayWeatherSentence(text: string): boolean {
  return (
    (/今天|今日|明天|明日(?!香)|明晚|後天|后天/.test(text) || EN_KO_RELATIVE_DAY_RE.test(text)) &&
    isWeatherWithoutTripNoun(text)
  );
}

function relativeTripDateProvenance(range: { startDate: string; endDate?: string }): CanonicalTravelContext["dateProvenance"] {
  return { source: "user_date", confirmed: true, startDate: range.startDate, endDate: range.endDate ?? range.startDate };
}

/**
 * The relative trip range (「從今天開始玩3天」「今日から3日間」「改成今天到週五」) a global planning turn
 * must carry: a relative start word with a resolved end only. Without one (「3天」) the global turn
 * keeps its own rule.
 */
function globalTurnRelativeTripDateRange(
  session: ChatPlanningSession,
  text: string,
): { startDate: string; endDate: string; days: number } | undefined {
  if (!/今天|今日|明天|明日(?!香)|明晚|後天|后天/.test(text) && !EN_KO_RELATIVE_DAY_RE.test(text)) return undefined;
  const dateRange = parseTravelDateRangeFromText(text);
  if (dateRange.startDate) return undefined;
  const prev = session.travelContext;
  const range = parseRelativeTripDateRange(
    text,
    {
      startDate: prev?.startDate ?? session.tripStartDate,
      endDate: prev?.endDate ?? session.tripEndDate,
      days: prev?.days ?? session.tripDays,
    },
    dateRange.endDate,
    isAwaitingTripDates(session),
  );
  if (!range?.endDate || !range.days) return undefined;
  return { startDate: range.startDate, endDate: range.endDate, days: range.days };
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

function parseDestinationFromTurn(text: string, skipDestParse: boolean): string | undefined {
  if (skipDestParse) return undefined;
  // 「大阪不去了，換金澤」: the negated place is never parsed. Only the wording after the negated
  // clause is read, exactly as the same turn without it (same as trip-planning-session-reset).
  // Extended form (「我不想去大阪了，換金澤」): no destination is read from this turn (dates still
  // come from the full turn); the switch target is applied only via applyConfirmedDestinationSwitch.
  const negatedSwitch = parseNegatedDestinationSwitchTurn(text);
  if (negatedSwitch?.form === "extended") return undefined;
  const source = negatedSwitch?.remainderText ?? text;
  // Dates are parsed from the full turn separately; the destination must not include them.
  // 「東京へ行きたい」「도쿄에 가고 싶어」: the travel-wish wording is never part of the place.
  const body = stripTravelWishSuffix(stripTravelDateRangeFromText(source));
  if (body !== source.trim()) {
    // 「11/25-11/30に東京へ行きます」: resolve the single extracted candidate, not the sentence.
    const candidates = travelDestinationCandidates(source);
    const fromCandidate =
      candidates.length === 1 ? resolveDestinationFromText(candidates[0]!) : undefined;
    if (fromCandidate) return fromCandidate;
  }
  // 「沖縄へ旅行」「日本へ旅行中」「X観光」: trip wording is never part of a destination name.
  const ok = (label: string | undefined) => (label && !TRAVEL_WORD_LABEL_RE.test(label) ? label : undefined);
  const area = resolveDestinationAreaScope(body)?.displayLabel;
  if (area) return ok(area) ?? ok(resolveDestinationFromText(body));
  return ok(resolveDestinationFromText(body));
}

const TRAVEL_WORD_LABEL_RE = /(?:旅行|観光)中?$|(?:への|へ)\s*(?:旅行|観光)/u;

type DeferredStaleScopeClear = { oldDestination: string; newLabel: string };

/**
 * While non-null (only inside applyConfirmedDestinationSwitch's Prepare merge), stale-destination
 * scope clears are collected here instead of being scheduled; null keeps the original behavior.
 */
let deferredStaleScopeClearSink: DeferredStaleScopeClear[] | null = null;

function withDeferredStaleScopeClears<T>(sink: DeferredStaleScopeClear[], run: () => T): T {
  const previous = deferredStaleScopeClearSink;
  deferredStaleScopeClearSink = sink;
  try {
    return run();
  } finally {
    deferredStaleScopeClearSink = previous;
  }
}

function scheduleStaleDestinationScopeClear(oldDestination: string, newLabel: string): void {
  void import("@/lib/ai/resolved-destination-scope").then((m) => {
    m.clearResolvedDestinationScope(oldDestination);
    void import("@/lib/ai/ai-pipeline-log").then(({ logAiPipeline }) => {
      logAiPipeline(
        "[STALE_DESTINATION_COORDINATES_BLOCKED]",
        `oldDestination=${normalizeDestinationLabel(oldDestination)}`,
        `newDestination=${newLabel}`,
      );
    });
  });
}

function requestStaleDestinationScopeClear(oldDestination: string, newLabel: string): void {
  if (deferredStaleScopeClearSink) {
    deferredStaleScopeClearSink.push({ oldDestination, newLabel });
    return;
  }
  scheduleStaleDestinationScopeClear(oldDestination, newLabel);
}

function mergeDestinationFields(
  prev: CanonicalTravelContext,
  newlyParsed?: string,
): Pick<
  CanonicalTravelContext,
  "destination" | "destinationCountry" | "destinationType" | "destinationCity" | "destinationRegion"
> {
  if (!newlyParsed) {
    return {
      destination: prev.destination,
      destinationCountry: prev.destinationCountry,
      destinationType: prev.destinationType,
      destinationCity: prev.destinationCity,
      destinationRegion: prev.destinationRegion,
    };
  }

  const label = normalizeDestinationLabel(newlyParsed);
  const prevWasCountry =
    Boolean(prev.destination) &&
    isKnownCountryLabel(prev.destination!) &&
    !isKnownTouristCityLabel(prev.destination!);

  if (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label)) {
    const scope = resolveDestinationScopeFields(label);
    // City-states share country/city label — never treat as bare country refinement.
    if (scope.destinationType === "city_state") {
      return {
        destination: scope.destinationName,
        destinationCountry: scope.destinationCountry,
        destinationType: "city_state",
        destinationCity: scope.destinationCity ?? scope.destinationName,
        destinationRegion: undefined,
      };
    }
    return {
      destination: scope.destinationName,
      destinationCountry: scope.destinationCountry,
      destinationType: scope.destinationType,
      destinationCity: undefined,
      destinationRegion: undefined,
    };
  }

  if (isKnownTouristCityLabel(label)) {
    const country =
      prev.destination && isKnownCountryLabel(prev.destination)
        ? normalizeDestinationLabel(prev.destination)
        : prev.destinationCountry;
    const scope = resolveDestinationScopeFields(label, country);
    if (prevWasCountry || (country && country !== label)) {
      logDestinationCitySelected({ country: scope.destinationCountry ?? country, city: label });
      logDestinationSearchScopeUpdated({
        from: prevWasCountry ? "country" : (prev.destinationType ?? "unknown"),
        to: scope.destinationType,
        city: label,
      });
    }
    // City change invalidates prior destination coordinates (never reuse Taiwan etc.).
    if (prev.destination && normalizeDestinationLabel(prev.destination) !== label) {
      requestStaleDestinationScopeClear(prev.destination, label);
    }
    return {
      destination: scope.destinationName,
      destinationCountry: scope.destinationCountry ?? country,
      destinationType: scope.destinationType,
      destinationCity: scope.destinationCity,
      destinationRegion: scope.destinationRegion,
    };
  }

  const scope = resolveDestinationScopeFields(label, prev.destinationCountry);
  if (prev.destination && normalizeDestinationLabel(prev.destination) !== label) {
    requestStaleDestinationScopeClear(prev.destination, label);
  }
  return {
    destination: scope.destinationName,
    destinationCountry: scope.destinationCountry ?? prev.destinationCountry,
    destinationType: scope.destinationType,
    destinationCity: scope.destinationCity,
    destinationRegion: scope.destinationRegion,
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
    const pendingDestIncoming = resolveDestinationFromText(t);
    const prevDestLabel = prev.destination
      ? normalizeDestinationLabel(prev.destination)
      : pq.baseDestination
        ? normalizeDestinationLabel(pq.baseDestination)
        : undefined;
    const comboContinuation =
      pq.type === "combination_choice" &&
      isCombinationSelectionContinuationReply(t, {
        pendingType: pq.type,
        primaryDestination: prevDestLabel ?? pq.baseDestination,
        combinationCount: prev.offeredCombinations?.length,
        hasOfferedCombinations: Boolean(prev.offeredCombinations?.length),
      });
    const explicitSwitch = isExplicitPrimaryDestinationSwitch(t);
    // A clearly different destination means a new trip — do not trap in pending early-return.
    // Exception: combo reply with nearby extension (「1、2跟橫濱」) must keep primary + days.
    if (
      pendingDestIncoming &&
      prevDestLabel &&
      normalizeDestinationLabel(pendingDestIncoming) !== prevDestLabel &&
      !comboContinuation &&
      (explicitSwitch || pq.type !== "combination_choice")
    ) {
      // fall through to normal parse
    } else {
      const nearby = comboContinuation
        ? parseNearbyExtensionsFromText(t, prevDestLabel ?? pq.baseDestination)
        : undefined;
      const relativeRange = parseRelativeTripDateRange(
        t,
        {
          startDate: prev.startDate ?? session.tripStartDate,
          endDate: prev.endDate ?? session.tripEndDate,
          days: prev.days ?? session.tripDays,
        },
        undefined,
        isAwaitingTripDates(session),
      );
      return {
        destination: prev.destination ?? pq.baseDestination,
        destinationCountry: prev.destinationCountry ?? pq.destinationCountry,
        days:
          relativeRange?.days ??
          (isRelativeDayWeatherSentence(t) ? undefined : parseDays(t)) ??
          prev.days ??
          session.tripDays,
        travelMonth: parseMonth(t) ?? prev.travelMonth,
        ...(relativeRange?.endDate
          ? { endDate: relativeRange.endDate, dateProvenance: relativeTripDateProvenance(relativeRange) }
          : {}),
        startDate: relativeRange?.startDate ?? prev.startDate ?? session.tripStartDate,
        tripPurpose: prev.tripPurpose,
        vibe: prev.vibe,
        mood: prev.mood,
        selectedInterests: prev.selectedInterests,
        conversationState: prev.conversationState,
        selectedPlanMode: prev.selectedPlanMode,
        destinationCities: prev.destinationCities,
        selectedTripStyle: prev.selectedTripStyle,
        useDefaultRecommendation: prev.useDefaultRecommendation,
        ...(nearby?.length
          ? {
              nearbyExtensions: nearby,
              unresolvedNearbyExtensions: nearby,
            }
          : {}),
        ...parseTravelConstraints(t),
      };
    }
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
  // A current-location category request owns a keyword, not a trip destination.
  // In particular, nouns such as 餐酒館 / 居酒屋 / 咖啡廳 must never be
  // promoted into destination authority before Nearby routing runs.
  const skipDestParse =
    (isMoodRecommendationSession(session) && !hasCategoryPlaceQuery(t)) ||
    userExplicitlyWantsNearbyPlaces(t);
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
      vibe: adviceActive
        ? prev?.vibe
        : (prev?.vibe ?? session.discovery?.vibe ?? preset?.vibe ?? "放鬆"),
      setting: prev?.setting ?? session.discovery?.setting ?? preset?.setting ?? "either",
      mood: adviceActive ? prev?.mood : (prev?.mood ?? preset?.mood ?? moodHint),
    };
  }

  const tripPurpose = isBudgetRefinementText(t)
    ? "refine_recommendations"
    : (resolveTripPurposeFromText(t, session.travelContext?.tripPurpose) ??
      parseDestinationAdvicePurpose(t));

  const budgetRefinement = isBudgetRefinementText(t)
    ? applyBudgetRefinementToContext(t, session.travelContext ?? { interests: [] })
    : {};

  const newlyParsedDest = parseDestinationFromTurn(t, skipDestParse);
  const dateRange = parseTravelDateRangeFromText(t);
  // Only return dates/days found in THIS turn. Session fallbacks belong in merge —
  // otherwise a new destination inherits the previous trip's startDate/endDate/days.
  const relativeRange = dateRange.startDate
    ? undefined
    : parseRelativeTripDateRange(
        t,
        newlyParsedDest
          ? { startDate: session.travelContext?.startDate ?? session.tripStartDate }
          : {
              startDate: session.travelContext?.startDate ?? session.tripStartDate,
              endDate: session.travelContext?.endDate ?? session.tripEndDate,
              days: session.travelContext?.days ?? session.tripDays,
            },
        dateRange.endDate,
        isAwaitingTripDates(session),
      );
  const startFromText = dateRange.startDate ?? relativeRange?.startDate;
  const endFromText = dateRange.endDate ?? relativeRange?.endDate;
  const daysFromText =
    dateRange.days ?? relativeRange?.days ?? (isRelativeDayWeatherSentence(t) ? undefined : parseDays(t));

  const parsedMood = preset?.mood ?? moodHint ?? parseVibe(t);
  const inheritedMoodEvidenceSource: CanonicalTravelContext["moodEvidenceSource"] | undefined =
    session.homeMoodShortcutEntry || session.fromMoodFlow || session.fromMoodCard
      ? "HOME_MOOD_ENTRY"
      : session.selectedMood
        ? "SESSION_CONTEXT"
        : (session.travelContext?.moodEvidenceSource ??
          (moodHint ? "SYSTEM_SYNTHESIZED" : undefined));
  const base: Partial<CanonicalTravelContext> = {
    currentLocation: session.location?.city,
    travelMonth: parseMonth(t),
    travelYear: parseTravelYear(t),
    ...(startFromText ? { startDate: startFromText } : {}),
    ...(endFromText ? { endDate: endFromText } : {}),
    ...(relativeRange?.endDate ? { dateProvenance: relativeTripDateProvenance(relativeRange) } : {}),
    ...(daysFromText != null ? { days: daysFromText } : {}),
    mood: parsedMood,
    moodEvidenceSource: resolveMoodEvidenceSource(t, parsedMood, inheritedMoodEvidenceSource),
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
    ...(daysFromText && startFromText && endFromText ? { planningDaysConfirmed: true } : {}),
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

/**
 * Internal reset control for applyConfirmedDestinationSwitch only (never set by other callers).
 * "prepared": the turn's reset is the already prepared one (must come from this same base), the
 * merge must not reset itself; resetSession overrides the prepared Session after a Commit recompute.
 * "no_reset": merge without its own reset.
 */
type LegacyMergeResetControl =
  | {
      kind: "prepared";
      prepared: PreparedDestinationChangeReset;
      resetSession?: ChatPlanningSession;
    }
  | { kind: "no_reset" };

function resolveLegacyMergeTripReset(
  session: ChatPlanningSession,
  userText: string,
  control: LegacyMergeResetControl | undefined,
): { session: ChatPlanningSession; didReset: boolean; reason?: NewTripPlanningReason } {
  if (!control) return maybeResetForNewTripPlanning(session, userText);
  if (control.kind === "no_reset") return { session, didReset: false };
  if (control.prepared.base !== session) {
    throw new Error("prepared destination reset does not belong to this base session");
  }
  return {
    session: control.resetSession ?? control.prepared.session,
    didReset: true,
    reason: control.prepared.reason,
  };
}

function mergeTravelContextLegacy(
  session: ChatPlanningSession,
  userText: string,
  lastAssistantReply?: string,
  resetControl?: LegacyMergeResetControl,
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

    // New trip (destination/month/date change) must reset BEFORE parse/merge,
    // otherwise stale Tokyo dates are injected into a Taitung context.
    const tripReset = resolveLegacyMergeTripReset(session, userText, resetControl);
    const sessionForTurn = tripReset.session;

    const prepared = prepareSessionForUserTurn(sessionForTurn, lastAssistantReply);
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

    const hasPendingState = Boolean(prepared.pendingQuestion);
    const explicitPendingTransition =
      Boolean(parseItineraryPlanModeIntent(userText)) || isCreateItineraryIntent(userText);
    // New future-trip narrative must not inherit stale place_recommendation under pending.
    const futureTripBreaksSticky =
      isFutureTripPlanningStatement(userText) || isCountryCityInquiryText(userText);

    const currentIntentRaw =
      hasPendingState && !explicitPendingTransition && !futureTripBreaksSticky
        ? prev.lastIntent === "create_itinerary"
          ? "create_itinerary"
          : prev.lastIntent === "best_travel_time"
            ? "best_travel_time"
            : prev.lastIntent === "place_recommendation"
              ? "place_recommendation"
              : prev.lastIntent === "trip_planning"
                ? "trip_planning"
                : "general_chat"
        : resolveChatContextIntent(userText, prev.lastIntent ?? prev.tripPurpose);
    // Structured travel data wins over a stale general_chat classifier result.
    const currentIntent =
      currentIntentRaw === "general_chat" &&
      (Boolean(prev.destination) ||
        /要去|想去|旅行|旅遊|旅游|[\u4e00-\u9fff]{2,8}/.test(userText)) &&
      (Boolean(prev.days) ||
        Boolean(prev.startDate) ||
        /\d{1,2}\s*[/\-月]\s*\d{1,2}/.test(userText) ||
        /(?:\d+|[一二三四五六七八九十兩两]+)\s*天/.test(userText))
        ? "trip_planning"
        : currentIntentRaw;
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

    // 「京都以外」「京都不要」「京都はやめて」: exclusion wording is never a destination.
    const parsedDest =
      isValidContextValue(parsed.destination) && !isNonPlaceDestinationText(parsed.destination) ? parsed.destination : undefined;
    const prevDest = isValidContextValue(prev.destination) ? prev.destination : undefined;
    const sessionDest = resolveSessionDestination(workingSession);

    const itineraryExtracted =
      currentIntent === "create_itinerary" && (!hasPendingState || explicitPendingTransition)
        ? extractItineraryEntitiesFromText(userText)
        : undefined;

    let destMerge: ReturnType<typeof mergeDestinationFields> = pendingSelection.selectedOption
      ? mergeDestinationFields(
          prev,
          pickValidContextValue(pendingSelection.contextPatch.destination, prevDest ?? sessionDest),
        )
      : parsedDest
        ? mergeDestinationFields(prev, parsedDest)
        : mergeDestinationFields(prev, prevDest ?? sessionDest);

    if (pendingSelection.selectedOption?.destinationCountry) {
      destMerge = {
        ...destMerge,
        destinationCountry:
          pickValidContextValue(
            pendingSelection.contextPatch.destinationCountry,
            destMerge.destinationCountry,
          ) ?? destMerge.destinationCountry,
      };
    }

    if (itineraryExtracted?.destination) {
      const clean = normalizeDestinationLabel(itineraryExtracted.destination);
      destMerge = mergeDestinationFields(prev, clean);
    }

    if (destMerge.destination) {
      let label = coerceTravelDestination(destMerge.destination);
      if (label) {
        const explicitArea = resolveDestinationAreaScope(label);
        if (explicitArea) {
          destMerge = {
            ...mergeDestinationFields(prev, explicitArea.displayLabel),
            destination: explicitArea.displayLabel,
          };
        } else {
          const sanitized = sanitizeDestinationForGeocode(label);
          label = coerceTravelDestination(sanitized) ?? label;
          destMerge = {
            ...mergeDestinationFields(prev, sanitized || label),
            destination: label,
          };
        }
      } else {
        const explicitArea = resolveDestinationAreaScope(destMerge.destination);
        if (explicitArea) {
          destMerge = {
            ...mergeDestinationFields(prev, explicitArea.displayLabel),
            destination: explicitArea.displayLabel,
          };
        } else {
          destMerge = mergeDestinationFields(
            prev,
            coerceTravelDestination(prevDest) ?? coerceTravelDestination(sessionDest),
          );
        }
      }
    }

    const prevDestNorm = prevDest ? normalizeDestinationLabel(prevDest) : undefined;
    const nextDestNorm = destMerge.destination
      ? normalizeDestinationLabel(destMerge.destination)
      : undefined;
    const countryRefinement = prev.destinationType === "country" && destMerge.destinationCountry === prev.destinationCountry;
    const destinationSwitched = Boolean(
      !countryRefinement && prevDestNorm && nextDestNorm && prevDestNorm !== nextDestNorm && !tripReset.didReset,
    );

    // After a destination switch (or explicit new-trip reset), never inherit
    // previous trip dates / combinations / generated planning artifacts.
    const inheritTripBoundFields = !destinationSwitched && !tripReset.didReset;

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
      setting:
        parsed.setting ?? preset?.setting ?? prev.setting ?? workingSession.discovery?.setting,
      companion: parsed.companion ?? prev.companion ?? workingSession.discovery?.companionship,
      days:
        itineraryExtracted?.days ??
        pendingSelection.contextPatch.days ??
        (inheritTripBoundFields
          ? (pickValidContextValue(parsed.days, prev.days) ?? workingSession.tripDays)
          : parsed.days),
      travelMonth: inheritTripBoundFields
        ? pickValidContextValue(parsed.travelMonth, prev.travelMonth)
        : parsed.travelMonth,
      travelYear: inheritTripBoundFields
        ? pickValidContextValue(parsed.travelYear, prev.travelYear)
        : parsed.travelYear,
      startDate: inheritTripBoundFields
        ? (pendingSelection.contextPatch.startDate ??
          parsed.startDate ??
          prev.startDate ??
          workingSession.tripStartDate)
        : (pendingSelection.contextPatch.startDate ?? parsed.startDate),
      endDate: inheritTripBoundFields
        ? (pendingSelection.contextPatch.endDate ??
          parsed.endDate ??
          prev.endDate ??
          workingSession.tripEndDate)
        : (pendingSelection.contextPatch.endDate ?? parsed.endDate),
      suggestedStartDate: inheritTripBoundFields ? prev.suggestedStartDate : undefined,
      // 「今天出發」「從明天開始」 on a dated trip: this turn's explicit start (with its kept length) is a user date.
      dateProvenance: parsed.dateProvenance ?? (inheritTripBoundFields ? prev.dateProvenance : undefined),
      planningDaysConfirmed: inheritTripBoundFields
        ? (pendingSelection.contextPatch.planningDaysConfirmed ??
          parsed.planningDaysConfirmed ??
          prev.planningDaysConfirmed)
        : (pendingSelection.contextPatch.planningDaysConfirmed ?? parsed.planningDaysConfirmed),
      transportMode: parsed.transportMode ?? prev.transportMode ?? workingSession.transportation,
      budgetLevel: parsed.budgetLevel ?? prev.budgetLevel ?? workingSession.budget,
      travelStyle:
        pendingSelection.contextPatch.travelStyle ??
        parsed.travelStyle ??
        prev.travelStyle ??
        workingSession.tripStyles,
      weather: inheritTripBoundFields
        ? (workingSession.weather ?? prev.weather ?? null)
        : (workingSession.weather ?? null),
      interests: uniqStrings([...prev.interests, ...(parsed.interests ?? [])]),
      tripPurpose:
        pendingSelection.contextPatch.tripPurpose ??
        parsed.tripPurpose ??
        chatContextIntentToTripPurpose(currentIntent) ??
        preset?.tripPurpose ??
        (currentIntent === "general_chat" && inheritTripBoundFields ? prev.tripPurpose : undefined),
      lastIntent: currentIntent,
      destinationCities: inheritTripBoundFields
        ? (pendingSelection.contextPatch.destinationCities ?? prev.destinationCities)
        : pendingSelection.contextPatch.destinationCities,
      selectedTripStyle: inheritTripBoundFields
        ? (pendingSelection.contextPatch.selectedTripStyle ?? prev.selectedTripStyle)
        : pendingSelection.contextPatch.selectedTripStyle,
      selectedCombinationIds: inheritTripBoundFields
        ? (pendingSelection.contextPatch.selectedCombinationIds ?? prev.selectedCombinationIds)
        : (pendingSelection.contextPatch.selectedCombinationIds ?? []),
      selectedCombinationPlaceNames: inheritTripBoundFields
        ? (pendingSelection.contextPatch.selectedCombinationPlaceNames ??
          prev.selectedCombinationPlaceNames)
        : pendingSelection.contextPatch.selectedCombinationPlaceNames,
      excludedCombinationPlaceNames: inheritTripBoundFields
        ? (pendingSelection.contextPatch.excludedCombinationPlaceNames ??
          prev.excludedCombinationPlaceNames)
        : pendingSelection.contextPatch.excludedCombinationPlaceNames,
      nearbyExtensions: inheritTripBoundFields
        ? (pendingSelection.contextPatch.nearbyExtensions ??
          parsed.nearbyExtensions ??
          prev.nearbyExtensions)
        : (pendingSelection.contextPatch.nearbyExtensions ?? parsed.nearbyExtensions),
      unresolvedNearbyExtensions: inheritTripBoundFields
        ? (pendingSelection.contextPatch.unresolvedNearbyExtensions ??
          parsed.unresolvedNearbyExtensions ??
          prev.unresolvedNearbyExtensions)
        : (pendingSelection.contextPatch.unresolvedNearbyExtensions ??
          parsed.unresolvedNearbyExtensions),
      selectionSource: inheritTripBoundFields
        ? (pendingSelection.contextPatch.selectionSource ?? prev.selectionSource)
        : pendingSelection.contextPatch.selectionSource,
      offeredCombinations: inheritTripBoundFields ? prev.offeredCombinations : undefined,
      offeredDestinationOptions: inheritTripBoundFields
        ? (pendingSelection.contextPatch.offeredDestinationOptions ??
          prev.offeredDestinationOptions)
        : pendingSelection.contextPatch.offeredDestinationOptions,
      generationRequestId: inheritTripBoundFields
        ? (pendingSelection.contextPatch.generationRequestId ?? prev.generationRequestId)
        : pendingSelection.contextPatch.generationRequestId,
      lastItineraryFailure: inheritTripBoundFields
        ? (pendingSelection.contextPatch.lastItineraryFailure ?? prev.lastItineraryFailure)
        : undefined,
      partiallyResolvedPlaces: inheritTripBoundFields
        ? (pendingSelection.contextPatch.partiallyResolvedPlaces ?? prev.partiallyResolvedPlaces)
        : undefined,
      failedCombinationIds: inheritTripBoundFields
        ? (pendingSelection.contextPatch.failedCombinationIds ?? prev.failedCombinationIds)
        : undefined,
      selectedInterests: pendingSelection.contextPatch.selectedInterests ?? prev.selectedInterests,
      mustVisitGenerated: inheritTripBoundFields
        ? (pendingSelection.contextPatch.mustVisitGenerated ?? prev.mustVisitGenerated)
        : false,
      conversationState: inheritTripBoundFields
        ? (pendingSelection.contextPatch.conversationState ?? prev.conversationState)
        : (pendingSelection.contextPatch.conversationState ?? "awaiting_days"),
      selectedPlanMode: inheritTripBoundFields
        ? (pendingSelection.contextPatch.selectedPlanMode ?? prev.selectedPlanMode)
        : pendingSelection.contextPatch.selectedPlanMode,
      planningStage: inheritTripBoundFields ? prev.planningStage : undefined,
      planningTripStyle: inheritTripBoundFields ? prev.planningTripStyle : undefined,
      excludedCategories: uniqStrings([
        ...(workingSession.excludedCategories ?? []),
        ...(prev.excludedCategories ?? []),
        ...(parsed.excludedCategories ?? []),
      ]),
    };

    devVerboseInfo("[AI_CONTEXT] parsed", logTravelContext(merged));

    const discovery = { ...workingSession.discovery };
    if (merged.vibe && !discovery.vibe) discovery.vibe = merged.vibe;
    if (merged.companion && !discovery.companionship) {
      discovery.companionship = merged.companion === "女友" ? "情侶" : merged.companion;
    }
    if (merged.setting && !discovery.setting) discovery.setting = merged.setting;

    if (merged.companion === "女友" || merged.companion === "男友") {
      merged.vibe = merged.vibe ?? "情侶";
      merged.mood = merged.mood ?? "情侶旅行";
      merged.tripPurpose = merged.tripPurpose ?? "couple_trip";
      if (!discovery.companionship) discovery.companionship = "情侶";
    }

    const datePatch =
      inheritTripBoundFields ||
      parsed.startDate ||
      parsed.endDate ||
      parsed.days ||
      pendingSelection.contextPatch.days ||
      pendingSelection.contextPatch.startDate
        ? enrichTripDatesInContext(userText, merged, workingSession)
        : {};
    const resolvedSessionPreference = updateSessionPreferenceFromExplicitText(
      workingSession.sessionPreference ?? prev.sessionPreference,
      userText,
      `turn_${Date.now().toString(36)}`,
    );
    const mergedWithDates: CanonicalTravelContext = {
      ...merged,
      ...datePatch,
      sessionPreference: resolvedSessionPreference,
    };

    const nextSession: ChatPlanningSession = {
      ...workingSession,
      travelContext: mergedWithDates,
      sessionPreference: resolvedSessionPreference,
      discovery,
      mood: mergedWithDates.mood ?? workingSession.mood,
      tripDays: inheritTripBoundFields
        ? (mergedWithDates.days ?? workingSession.tripDays)
        : mergedWithDates.days,
      travelDate: inheritTripBoundFields
        ? (mergedWithDates.startDate ?? workingSession.travelDate)
        : mergedWithDates.startDate,
      tripStartDate: inheritTripBoundFields
        ? (mergedWithDates.startDate ?? workingSession.tripStartDate)
        : mergedWithDates.startDate,
      tripEndDate: inheritTripBoundFields
        ? (mergedWithDates.endDate ?? workingSession.tripEndDate)
        : mergedWithDates.endDate,
      transportation: merged.transportMode ?? workingSession.transportation,
      budget: merged.budgetLevel ?? workingSession.budget,
      preferredArea: skipDestParse
        ? workingSession.preferredArea
        : (mergedWithDates.destination ?? workingSession.preferredArea),
      ...(inheritTripBoundFields ? {} : { weather: workingSession.weather }),
    };

    logChatContextMerge({
      destination: mergedWithDates.destination,
      tripDays: mergedWithDates.days,
      startDate: mergedWithDates.startDate,
      endDate: mergedWithDates.endDate,
      travelDate: mergedWithDates.startDate ?? mergedWithDates.travelMonth,
      preferences: mergedWithDates.interests,
      tripPurpose: mergedWithDates.tripPurpose,
      lastIntent: mergedWithDates.lastIntent,
    });
    logChatContextResolved({
      destination: mergedWithDates.destination,
      tripDays: mergedWithDates.days,
      startDate: mergedWithDates.startDate,
      endDate: mergedWithDates.endDate,
      travelDate: mergedWithDates.startDate ?? mergedWithDates.travelMonth,
      preferences: mergedWithDates.interests,
      lastIntent: mergedWithDates.lastIntent,
      tripPurpose: mergedWithDates.tripPurpose,
    });

    devVerboseInfo("[AI_CONTEXT] updated", logTravelContext(mergedWithDates));
    return finalizePlanningContextAuthority({
      before: sessionForTurn,
      context: mergedWithDates,
      session: nextSession,
      destinationSwitched,
      didReset: tripReset.didReset,
    });
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
    session.fromMoodCard ||
    session.homeMoodShortcutEntry ||
    session.shortcutContext,
  );

  if (
    hasGps &&
    hasMoodContext &&
    intent !== "trip_planning" &&
    !hasRemoteDestination(ctx, session)
  ) {
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

  if (!hasDestination && !hasGps && !session.fromPlanForm && !session.fromPlanAi)
    missing.push("destination");
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
    ctx.destination && (ctx.mood || ctx.vibe) && (ctx.companion || ctx.days),
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

export type ConfirmedDestinationSwitchStopReason =
  /** base is not the turn's reset base (planningSessionId / planVersion differ). */
  | "stale_turn_base"
  /** Trip → add-place sessions never switch destination here. */
  | "trip_add_place"
  /** Applying the label would need a second Planner reset this turn. */
  | "second_reset_required"
  /** After the single merge the active destination is not the label. */
  | "destination_not_applied";

export type ConfirmedDestinationSwitchResult =
  | { applied: false }
  | { applied: true; session: ChatPlanningSession }
  | { stop: ConfirmedDestinationSwitchStopReason };

function isDestinationSwitchResetReason(reason: string | undefined): boolean {
  return reason === "destination_changed" || reason === "country_changed" || reason === "city_changed";
}

/**
 * Applies a destination switch whose label the Destination Authority already trusted this turn
 * (the caller passes only that label; a lexical classify target is never enough). Prepare →
 * Validate → Commit: the reset is prepared purely, every stop check runs on the prepared result,
 * and only then is the single Planner reset committed; no global planning, no provider call.
 * `{applied:false}`: nothing to apply (already reset this turn, unsafe wording, same trip);
 * `{stop}`: fail closed, the caller must not persist / search / reserve.
 */
export function applyConfirmedDestinationSwitch(
  base: ChatPlanningSession,
  opts: {
    label: string;
    requestText: string;
    turnResetBase?: Pick<ChatPlanningSession, "planningSessionId" | "planVersion">;
    resetAlreadyThisTurn: boolean;
    /** Center the Destination Authority trusted this turn (cross-check for the scope lock). */
    trustedCenter?: { lat: number; lng: number };
    /** The Authority's own provider answer this turn (same request that verified the center), if any. */
    trustedLocation?: ChatPlanningSession["tripDestination"] | null;
  },
): ConfirmedDestinationSwitchResult {
  if (opts.resetAlreadyThisTurn) return { applied: false };
  const label = opts.label?.trim() ?? "";
  const requestText = opts.requestText?.trim() ?? "";
  if (!label || !requestText) return { applied: false };
  if (
    opts.turnResetBase &&
    (base.planningSessionId !== opts.turnResetBase.planningSessionId ||
      base.planVersion !== opts.turnResetBase.planVersion)
  ) {
    return { stop: "stale_turn_base" };
  }
  if (base.fromTripAddPlace) return { stop: "trip_add_place" };

  const target = normalizeDestinationLabel(label);
  const noOtherDestination = (value: string | undefined) =>
    !value || normalizeDestinationLabel(value) === target;
  if (
    !target ||
    !noOtherDestination(resolveIncomingDestinationFromText(label)) ||
    !noOtherDestination(resolveIncomingDestinationFromText(requestText))
  ) {
    return { applied: false };
  }
  const labelDates = parseTravelDateRangeFromText(label);
  if (parseTravelMonthFromText(label) || labelDates.startDate || labelDates.endDate) {
    return { applied: false };
  }
  const requestDates = parseTravelDateRangeFromText(requestText);
  if (requestDates.endDate && !requestDates.startDate) return { applied: false };

  const prev = resolveActiveDestination(base);
  if (
    prev &&
    (prev === target ||
      isCountryToCityRefinement(prev, base.travelContext?.destinationCountry?.trim() || undefined, label))
  ) {
    return { applied: false };
  }

  const pre = isNewTripPlanning(base, requestText);
  // Path A: the reset the merge would have done itself (same detection, same options).
  // Path B (date / month / finished-trip reason or a label the turn wording does not resolve
  // locally): one compensating destination reset, then the merge must not reset again.
  const useMergeReset = Boolean(
    pre.isNew &&
      isDestinationSwitchResetReason(pre.reason) &&
      pre.incomingDestination &&
      normalizeDestinationLabel(pre.incomingDestination) === target,
  );

  // Prepare: expected new Session only (no Planner / scope cleanup, no Reset log).
  const prepared = useMergeReset
    ? prepareDestinationChangeReset(base, {
        reason: pre.reason!,
        incomingDestination: pre.incomingDestination,
        incomingTravelMonth: pre.incomingTravelMonth,
        userText: requestText,
      })
    : prepareDestinationChangeReset(base, {
        reason: "destination_changed",
        incomingDestination: label,
        userText: requestText,
      });

  // Validate (all on the prepared result; every stop discards prepared + sink).
  if (!useMergeReset && isNewTripPlanning(prepared.session, requestText).isNew) {
    return { stop: "second_reset_required" };
  }
  // The merge never resets here; stale-scope clears it requests are collected, not scheduled.
  const mergeOnReset = (resetSession: ChatPlanningSession, sink: DeferredStaleScopeClear[]) =>
    withDeferredStaleScopeClears(sink, () =>
      useMergeReset
        ? mergeTravelContextLegacy(base, requestText, undefined, {
            kind: "prepared",
            prepared,
            resetSession,
          })
        : mergeTravelContextLegacy(resetSession, requestText, undefined, { kind: "no_reset" }),
    );
  const withSwitchedLocation = (merged: ChatPlanningSession): ChatPlanningSession => {
    const city = merged.location?.city?.trim();
    if (prev && city && merged.location && normalizeDestinationLabel(city) === prev) {
      return { ...merged, location: { ...merged.location, city: label } };
    }
    return merged;
  };

  const preparedSink: DeferredStaleScopeClear[] = [];
  const merged = mergeOnReset(prepared.session, preparedSink);
  if (isNewTripPlanning(merged.session, requestText).isNew) {
    return { stop: "second_reset_required" };
  }
  let session = withSwitchedLocation(merged.session);
  if (resolveActiveDestination(session) !== target) return { stop: "destination_not_applied" };

  // Commit: the single formal reset. From here on nothing is thrown out of this function;
  // a failing step is logged and the switch rolls forward (no rollback).
  const warnCommitStep = (step: string, error?: unknown) =>
    console.warn(
      "[TRIP_RESET_COMMIT_STEP_FAILED]",
      `step=${step}`,
      `oldSessionId=${base.planningSessionId ?? "none"}`,
      `newSessionId=${prepared.newSessionId}`,
      ...(error === undefined ? [] : [error instanceof Error ? error.message : String(error)]),
    );
  try {
    const committed = commitDestinationChangeReset(prepared, { onStepError: "continue" });
    let sinkToSchedule = preparedSink;
    if (prepared.hydrationDependsOnClearedScope) {
      // Hydration was recomputed after the scope clear: re-merge on the committed Session (no
      // reset) and re-check the three stop conditions as assertions only.
      const committedSink: DeferredStaleScopeClear[] = [];
      if (!useMergeReset && isNewTripPlanning(committed, requestText).isNew) {
        warnCommitStep("post_commit_assert_reset_session_is_new");
      }
      const remerged = mergeOnReset(committed, committedSink);
      if (remerged.session === base) {
        // Re-merge failed (its catch returned the old base): keep the validated new Session.
        warnCommitStep("post_commit_remerge");
      } else {
        if (isNewTripPlanning(remerged.session, requestText).isNew) {
          warnCommitStep("post_commit_assert_merged_session_is_new");
        }
        session = withSwitchedLocation(remerged.session);
        if (resolveActiveDestination(session) !== target) {
          warnCommitStep("post_commit_assert_destination_applied");
        }
        sinkToSchedule = committedSink;
      }
    }
    for (const clear of sinkToSchedule) {
      scheduleStaleDestinationScopeClear(clear.oldDestination, clear.newLabel);
    }
  } catch (error) {
    warnCommitStep("commit", error);
  }
  // 「不去雪梨了，改去京都」while choosing combinations: the same spec as the global combination
  // switch — previous dates / days kept (unless this turn gives its own), combinations re-listed.
  // A candidate submitted while choosing combinations (geocode miss → re-asked) is the same switch.
  // After a combination was picked / the itinerary was generated: the same switch (isCombinationSwitchRelistBase).
  if (isCombinationSwitchRelistBase(base)) {
    session = withCombinationSwitchDates(base, session, requestText);
    // The previous destination's generation (crashed mid-way) never stays on the new destination.
    if (session.phase === "generating") session = { ...session, phase: "discover" };
  }
  session = withTrustedSwitchScope(session, target, opts.trustedCenter, opts.trustedLocation);
  return { applied: true, session };
}

const nearCenter = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, tolerance: number) =>
  Math.abs(a.lat - b.lat) <= tolerance && Math.abs(a.lng - b.lng) <= tolerance;

/**
 * The provider's name for the switch target: equal after normalisation, or equal once script
 * variants (臺／台, 區／区) and one administrative suffix are folded (海雲臺區 = 海雲台). Two-character
 * 府 / 都 / 縣 names keep their last character (別府 = 別府市, never 別).
 */
function sameSwitchTargetName(value: string | undefined, target: string): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  if (normalizeDestinationLabel(raw) === target) return true;
  const fold = (label: string) => {
    const trimmed = label.trim();
    const stem = /^\p{Script=Han}[府都縣县]$/u.test(trimmed) ? trimmed : stripAdministrativeSuffix(trimmed);
    return normalizeAreaEvidence(stem);
  };
  const a = fold(raw);
  return a.length >= 2 && a === fold(target);
}

/**
 * A provider-verified switch target the local tables do not know (熱海): the Authority already
 * locked its center + country this turn (resolveTrustedRecommendationSearchScope). Copy that lock
 * into the switched travelContext so discovery does not see a label-only destination (desync).
 * No provider call; known destinations (type already resolved / coordinates present) unchanged.
 */
function withTrustedSwitchScope(
  session: ChatPlanningSession,
  target: string,
  trustedCenter: { lat: number; lng: number } | undefined,
  trustedLocation: ChatPlanningSession["tripDestination"] | null | undefined,
): ChatPlanningSession {
  const ctx = session.travelContext;
  if (!ctx || normalizeDestinationLabel(ctx.destination ?? "") !== target) return session;
  const typeKnown = Boolean(ctx.destinationType && (ctx.destinationType as string) !== "unknown");
  if (typeKnown && ctx.destinationCoordinates) return session;
  const scope = getResolvedDestinationScope(target);
  if (!scope || normalizeDestinationLabel(scope.normalizedName) !== target) return session;
  if (!Number.isFinite(scope.latitude) || !Number.isFinite(scope.longitude)) return session;
  const scopeCenter = { lat: scope.latitude, lng: scope.longitude };
  if (trustedCenter && !nearCenter(trustedCenter, scopeCenter, 0.5)) return session;
  // The Authority's provider answer for this very label (same center): the resolved trip
  // destination (Place ID / country / coordinates), so later turns are not label-only either.
  // provider_locked (no request this turn): the same verified answer kept with the scope lock.
  const providerLocation = trustedLocation ?? getTrustedProviderLocation(target);
  const providerNames = isResolvedDestination(providerLocation)
    ? [providerLocation.city, providerLocation.region, providerLocation.displayLabel, providerLocation.formattedName]
    : [];
  const matchedLocation =
    isResolvedDestination(providerLocation) &&
    nearCenter(providerLocation, trustedCenter ?? scopeCenter, 0.05) &&
    providerNames.some((value) => sameSwitchTargetName(value, target))
      ? providerLocation
      : undefined;
  // Matched only up to script / suffix (海雲臺區 for 海雲台): the display label is the switched
  // destination's own label, so every later same-label check reads this same resolved place.
  const location =
    matchedLocation &&
    !providerNames.some((value) => Boolean(value?.trim()) && normalizeDestinationLabel(value!) === target)
      ? { ...matchedLocation, displayLabel: ctx.destination?.trim() || target }
      : matchedLocation;
  const patch = buildDestinationScopeContextPatch(scope);
  // The trusted switch target is a city / area below a country (the Authority never trusts a
  // country here); a lock without its own type is a city.
  const lockedType = patch.destinationType && patch.destinationType !== "unknown" && patch.destinationType !== "country"
    ? patch.destinationType
    : "city";
  const travelContext: CanonicalTravelContext = {
    ...ctx,
    destinationType: typeKnown
      ? ctx.destinationType
      : (lockedType as CanonicalTravelContext["destinationType"]),
    destinationCountry: ctx.destinationCountry?.trim() || location?.country || patch.destinationCountry,
    destinationCountryCode: ctx.destinationCountryCode?.trim() || patch.destinationCountryCode,
    destinationCity: ctx.destinationCity?.trim() || patch.destinationCity,
    destinationRegion: ctx.destinationRegion?.trim() || patch.destinationRegion,
    destinationScopeId: ctx.destinationScopeId || patch.destinationScopeId,
    destinationCoordinates: ctx.destinationCoordinates ?? patch.destinationCoordinates,
  };
  return { ...session, travelContext, ...(location ? { tripDestination: location } : {}) };
}

/** Carries the combination-choice trip's dates / days onto the switched session (combinationSwitchDatePatch). */
function withCombinationSwitchDates(
  base: ChatPlanningSession,
  session: ChatPlanningSession,
  requestText: string,
): ChatPlanningSession {
  const prev = base.travelContext ?? EMPTY_TRAVEL_CONTEXT;
  const range = parseTravelDateRangeFromText(requestText);
  const signals = planningCalendarSignals(requestText, new Date(), base.tripDestination?.timezone);
  const hasRange = Boolean(range.startDate && range.endDate);
  const days = parseDayCountFromText(requestText) ?? (hasRange ? range.days : undefined) ?? prev.days ?? base.tripDays;
  if (!days) return session;
  const patch = combinationSwitchDatePatch(prev, requestText, {
    ...signals,
    ...(hasRange ? { startDate: range.startDate, endDate: range.endDate } : {}),
  });
  const current = session.travelContext ?? EMPTY_TRAVEL_CONTEXT;
  const travelContext: CanonicalTravelContext = {
    ...current,
    travelMonth: prev.travelMonth,
    travelYear: prev.travelYear,
    ...(signals.travelMonth ? { travelMonth: signals.travelMonth } : {}),
    ...(signals.travelYear ? { travelYear: signals.travelYear } : {}),
    ...patch,
    days,
    // As the global combination switch: the reset's "awaiting_days" no longer applies (days carried).
    conversationState: undefined,
  };
  travelContext.planningDaysConfirmed = Boolean(travelContext.startDate && travelContext.endDate);
  return {
    ...session,
    travelContext,
    tripDays: days,
    travelDate: travelContext.startDate,
    tripStartDate: travelContext.startDate,
    tripEndDate: travelContext.endDate,
    tripPlanningContext: session.tripPlanningContext
      ? {
          ...session.tripPlanningContext,
          travelMonth: travelContext.travelMonth,
          startDate: travelContext.startDate,
          endDate: travelContext.endDate,
          days,
        }
      : undefined,
  };
}

/**
 * Pure prediction (A2 second-reset guard): would mergeTravelContext(session, userText) run its own
 * trip reset? Mirrors exactly the reset route of mergeTravelContext → mergeTravelContextLegacy
 * (no reset control) → maybeResetForNewTripPlanning, reusing the same isNewTripPlanning detection.
 * Performs no reset, no Session / Planner / scope-cache / storage write.
 */
export function wouldMergeTravelContextResetTrip(
  session: ChatPlanningSession,
  userText: string,
): boolean {
  if (session.fromTripAddPlace) {
    // mergeTravelContextLegacy: the trip add-place branch returns before any reset.
    if (session.tripAddPlaceContext) return false;
  } else {
    // Same pre-merge steps as mergeTravelContext (hold reply keeps the context; day references dropped).
    if (isCombinationChoiceTurn(session) && isTripLengthOnlyCombinationReply(userText)) {
      userText = withoutDayReferences(userText);
    }
    if (isCombinationChoiceTurn(session) && isCombinationHoldReply(userText)) return false;
    const turn = globalPlanningTurn(session, userText);
    // applyGlobalPlanningContext route: resets only for the combination-choice destination switch
    // (applyCombinationDestinationSwitch); every other global turn merges without a reset. A
    // combination-choice switch candidate resets this turn too, once resolveGlobalPlanningCandidate resolves it.
    if (turn) return isCombinationDestinationSwitchContext(session, turn)
      || Boolean(turn.destinationCandidate?.status === 'pending' && turn.destinationCandidate.combinationSwitch);
  }
  const detected = isNewTripPlanning(session, userText);
  return Boolean(detected.isNew && detected.reason);
}

/** General language input is merged before legacy geographic heuristics can discard it. */
export function mergeTravelContext(session: ChatPlanningSession, userText: string, lastAssistantReply?: string): {context: CanonicalTravelContext; session: ChatPlanningSession} {
  // The 「第2組的第一天改一下」confirm only covers the very next turn: anything but the confirm
  // reply drops it, so e.g. 「全部」selects all again.
  session = dropStaleCombinationConfirm(session, userText, lastAssistantReply ?? session.lastAssistantReply);
  if (session.fromTripAddPlace) return mergeTravelContextLegacy(session,userText,lastAssistantReply);
  // 「都不錯但第二天改一下」while choosing combinations: 「第二天」is a day ordinal, not trip days,
  // and nothing is selected — keep the context as it is; the advice turn asks a follow-up.
  // 1c 「2日目を5日間に変えて」: trip-length parsers read the first number, so drop day references.
  if (isCombinationChoiceTurn(session) && isTripLengthOnlyCombinationReply(userText)) {
    userText = withoutDayReferences(userText);
  }
  if (isCombinationChoiceTurn(session) && isCombinationHoldReply(userText)) {
    return {context: session.travelContext ?? {interests: []}, session};
  }
  const rawGlobalTurn = globalPlanningTurn(session,userText);
  // 「明日から3日間雨が降るらしい」"it's going to rain starting today for 3 days": a weather sentence never
  // changes the trip length either (the global turn reads 3日間 / 3 days as trip days).
  const globalTurn = rawGlobalTurn && isRelativeDayWeatherSentence(userText)
    ? {...rawGlobalTurn,days:session.travelContext?.days ?? session.tripDays}
    : rawGlobalTurn;
  // 「從今天開始玩3天」「今日から3日間」 on a trip with a destination: the global turn only reads the
  // length, so the relative start (today / tomorrow …) and its end are applied here, as the legacy parse does.
  const relativeRange = globalTurn ? globalTurnRelativeTripDateRange(session, userText) : undefined;
  const turn = globalTurn && relativeRange
    ? {...globalTurn,startDate:relativeRange.startDate,endDate:relativeRange.endDate,days:relativeRange.days,
      suggestedStartDate:undefined,dateProvenance:relativeTripDateProvenance(relativeRange)}
    : globalTurn;
  const applied = turn ? applyGlobalPlanningContext(session,turn) : mergeTravelContextLegacy(session,userText,lastAssistantReply);
  const result = relativeRange
    ? {...applied,session:{...applied.session,tripStartDate:relativeRange.startDate,tripEndDate:relativeRange.endDate,
      travelDate:relativeRange.startDate,tripDays:relativeRange.days}}
    : applied;
  const label = result.context.destinationCandidate?.raw ?? result.context.destinationCity ?? result.context.destination;
  const candidates = [session.travelContext?.destinationDisplay, ...(session.travelContext?.offeredDestinationOptions ?? []).map(option => option.destinationDisplay)].filter(Boolean) as DestinationDisplayMetadata[];
  const matched = candidates.filter(candidate => displayMetadataMatchesLabel(candidate, label ?? "") && sameDisplayCountry(candidate.country, result.context.destinationCountry ?? ""));
  const unique = [...new Map(matched.map(candidate => [JSON.stringify(candidate), candidate])).values()];
  const destinationDisplay = unique.length === 1 ? unique[0] : undefined;
  return {...result, context:{...result.context,destinationDisplay},session:{...result.session,travelContext:{...result.context,destinationDisplay}}};
}
