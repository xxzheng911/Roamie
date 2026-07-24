/**
 * Itinerary Validator 契約（P4.2 → Auto Repair）
 *
 * 行程層閘門：驗證本身不重組。失敗且僅為可修復規則時，交由 Auto Repair Flow
 * （最多 {@link MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS} 次）修正後再驗。
 */

export const ITINERARY_VALIDATOR_VERSION = "1.2.0-auto-repair";

/** 失敗後回覆使用者（硬錯誤／不可修復） */
export const ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE =
  "目前找到的合適地點不足以完成這趟行程，我需要重新整理候選地點後再試一次。";

/** Auto Repair 最多重試次數 */
export const MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS = 3;

export type ItineraryRuleCode =
  | "days_date_consistency"
  | "day_place_count"
  | "day_capacity_pace_lock"
  | "missing_days"
  | "place_duplicate"
  | "user_exclusions"
  | "unsuitable_place"
  | "meal_slot_category"
  | "nightlife_timing"
  | "business_hours_cover"
  | "route_travel_time"
  | "route_backtrack"
  | "timeline_conflict"
  | "nearby_extension_coverage"
  | "multi_day_balance"
  | "persistence_mismatch";

/**
 * 可交由 Auto Repair 修正的規則 — 不得直接擋下整份行程交付。
 * （arrival_before_feasible 掛在 timeline_conflict warning 下）
 */
export const SOFT_REPAIRABLE_RULE_CODES: readonly ItineraryRuleCode[] = [
  "timeline_conflict",
  "business_hours_cover",
  "multi_day_balance",
  "route_travel_time",
  "route_backtrack",
  "meal_slot_category",
  "nightlife_timing",
];

/** 真正不可修復、應阻擋交付的結構性錯誤 */
export const HARD_BLOCK_RULE_CODES: readonly ItineraryRuleCode[] = [
  "missing_days",
  "days_date_consistency",
  "persistence_mismatch",
];

/**
 * Soft Pass 最低可接受品質（Auto Repair 3 次後仍有 soft error 時）。
 * 不以 Stop 百分比決定是否交付。
 */
export const SOFT_PASS_MIN_PLACES_PER_FULL_DAY = 2;

export type SoftPassQualityCheck = {
  ok: boolean;
  dayStructureOk: boolean;
  preferencesOk: boolean;
  noDuplicates: boolean;
  noObviousHoursConflict: boolean;
  reasons: string[];
};

export type SoftRepairableRuleCode = (typeof SOFT_REPAIRABLE_RULE_CODES)[number];
export type HardBlockRuleCode = (typeof HARD_BLOCK_RULE_CODES)[number];

export type ItineraryFailedRule = {
  code: ItineraryRuleCode;
  message: string;
  day?: number;
  placeIds?: string[];
  severity: "fail";
};

export type ItineraryWarning = {
  code: ItineraryRuleCode;
  message: string;
  day?: number;
  placeIds?: string[];
};

export type NearbyExtensionCoverage = {
  expectedExtensions: string[];
  coveredExtensions: string[];
  missingExtensions: string[];
  affectedDays: number[];
  affectedPlaceIds: string[];
  /** extension → day indices that contain matching places */
  daysByExtension: Record<string, number[]>;
  /** extension → place count on its primary concentrated day */
  concentratedCounts: Record<string, number>;
};

export type ItineraryValidationResult = {
  pass: boolean;
  /** 0–100；失敗規則扣分，warnings 輕扣 */
  score: number;
  failedRules: ItineraryFailedRule[];
  warnings: ItineraryWarning[];
  affectedDays: number[];
  affectedPlaceIds: string[];
  validatorVersion: string;
  /** 建議上游重新規劃的原因（Validator 本身不重組） */
  replanReasons: string[];
  /** pass_through = Flag OFF；validator = Flag ON 實閘 */
  path: "pass_through" | "validator";
  nearbyCoverage?: NearbyExtensionCoverage;
};

export type ItineraryPlanEntryLike = {
  time: string;
  label: string;
  name: string;
  place: import("@/lib/place-result").PlaceResult;
};

export type ItineraryComposedDayPlanLike = {
  day: number;
  entries: readonly ItineraryPlanEntryLike[];
  isIncomplete?: boolean;
};

export type ItineraryValidatorInput = {
  plans: readonly ItineraryComposedDayPlanLike[];
  requestedDays: number;
  style?: import("@/lib/ai/ai-trip-style").TripStyleKey;
  plannedDate?: string;
  endDate?: string;
  excludePlaceIds?: readonly string[];
  rejectedPlaceNames?: readonly string[];
  lockedPlaceIds?: readonly string[];
  /** Selected combination / user-locked place names — never remove or replace. */
  lockedPlaceNames?: readonly string[];
  userText?: string;
  /** session / context 已解析的排除關鍵字（火鍋、義式…） */
  excludedCategories?: readonly string[];
  /** slow_travel / 輕行程 → 較低每日容量 */
  slowTravel?: boolean;
  /** 近郊延伸（如「橫濱」）；有值時必須實際覆蓋 */
  nearbyExtensions?: readonly string[];
  /**
   * 明確標示為 partial day 的 day 編號（抵達／離境日）。
   * 僅這些天可低於一般最低容量。
   */
  partialDays?: readonly number[];
  /** shopping / nightlife / nature intent — 避免全域黑名單誤殺 */
  intents?: {
    shopping?: boolean;
    nightlife?: boolean;
    nature?: boolean;
  };
  /** log 用：style | direct | selected_places | regen */
  creationPath?: "style" | "direct" | "selected_places" | "regen" | "chat_add";
  destination?: string;
};

export type PersistenceDayCountsCompareInput = {
  plannerDayCounts: number[];
  validatedDayCounts: number[];
  persistedDayCounts: number[];
  uiDayCounts: number[];
};

export type PersistenceDayCountsCompareResult = {
  matched: boolean;
  plannerDayCounts: number[];
  validatedDayCounts: number[];
  persistedDayCounts: number[];
  uiDayCounts: number[];
};
