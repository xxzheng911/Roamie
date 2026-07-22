/**
 * Itinerary Validator — public API（P4.2）
 *
 * Places → PIE → Recommendation Engine → Recommendation Validator → Planner → **Itinerary Validator**
 *
 * 注意：replan / from-payload 請從子路徑匯入，避免把 Planner 重組模組拉進驗證腳本造成循環依賴。
 */

export {
  isItineraryValidatorEnabled,
  setItineraryValidatorEnabledOverride,
  setItineraryValidatorStorageFlag,
  resolveItineraryValidatorFlag,
  ITINERARY_VALIDATOR_STORAGE_KEY,
} from "@/lib/ai/itinerary-validator/feature-flag";

export {
  validateItineraryPlan,
  getLastItineraryValidationResult,
  resetLastItineraryValidationResult,
  compareItineraryPersistenceDayCounts,
  logItineraryDeliveryAllowed,
  logItineraryDeliveryBlocked,
  dayCountsOfPlans,
  shouldBlockItineraryDelivery,
  isOnlySoftRepairableFailures,
  hasHardBlockFailures,
} from "@/lib/ai/itinerary-validator/validate";

export {
  ITINERARY_VALIDATOR_VERSION,
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
  MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS,
  SOFT_REPAIRABLE_RULE_CODES,
  HARD_BLOCK_RULE_CODES,
  SOFT_PASS_MIN_PLACES_PER_FULL_DAY,
  type SoftPassQualityCheck,
  type ItineraryFailedRule,
  type ItineraryRuleCode,
  type ItineraryValidationResult,
  type ItineraryValidatorInput,
  type ItineraryWarning,
  type ItineraryComposedDayPlanLike,
  type ItineraryPlanEntryLike,
  type NearbyExtensionCoverage,
  type PersistenceDayCountsCompareInput,
  type PersistenceDayCountsCompareResult,
} from "@/lib/ai/itinerary-validator/types";
