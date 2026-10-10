const codes: ReadonlySet<string> = new Set(["bar_too_early", "breakfast_bad_time", "breakfast_invalid", "closed_at_time", "culture_creative_as_meal", "day_count_mismatch", "dinner_bad_time", "dinner_invalid", "disallowed_label", "duplicate_cafe", "duplicate_place_id", "empty_day", "empty_morning", "excluded_retail", "food_at_morning_scenic", "generated_days", "geographic_scope_violation", "incomplete_day", "invalid_cafe", "invalid_dinner", "invalid_lunch", "invalid_scenic", "label_place_mismatch", "lunch_bad_time", "lunch_invalid", "lunch_not_restaurant", "missing_day", "missing_dinner", "missing_lunch", "missing_meals", "missing_required_slot", "mixed_missing_composition", "mixed_too_many_restaurants", "museum_at_dinner", "night_market_at_lunch", "night_market_too_early", "no_scenic", "opening_hours_heuristic_mismatch", "opening_hours_known_closed", "opening_hours_time_window_conflict", "opening_hours_unknown_hours", "overflow_day", "parent_landmark_dup", "placeholder_day", "placeholder_name", "required_anchor_missing", "route_backtrack", "route_invalid", "route_too_far", "single_item_day", "slow_nature_food_at_morning", "slow_nature_too_few_scenic", "slow_nature_too_many_restaurants", "sparse_day", "synthetic_place", "time_conflict", "too_few_items", "too_few_landmarks", "too_few_scenic"]);
/** Only fixed prefixes survive; never include the suffix with names, IDs or times. */
export function plannerFailureCounts(reasons: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const reason of reasons) {
    const prefix = reason.split(":", 1)[0];
    const code = codes.has(prefix) ? prefix : "unmapped_validation_reason";
    result[code] = (result[code] ?? 0) + 1;
  }
  return result;
}
