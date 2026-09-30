import { MAX_ITINERARY_DAYS } from "@/lib/ai/itinerary-days";

export const MAX_NORMALIZATION_FAILURES = 4;
export const SLOT_REJECTION_COUNTS = [
  "rejected_order", "rejected_used", "rejected_closed", "rejected_window",
] as const;
export type SlotRejectionCounts = Record<(typeof SLOT_REJECTION_COUNTS)[number], number> & {
  candidate_slots_evaluated: number;
};
export type TimelineNormalizationFailure = SlotRejectionCounts & {
  day: number;
  /** Clock of the entry that could not be assigned, not necessarily the duplicate's clock. */
  failed_entry_time?: string;
};

/** Fixed counts/clock only; no place, category, hours, request identity or arbitrary reason. */
export function sanitizeNormalizationFailures(value: unknown, maxDay = MAX_ITINERARY_DAYS): TimelineNormalizationFailure[] {
  if (!Array.isArray(value)) return [];
  const result: TimelineNormalizationFailure[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const day = source.day;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > maxDay || seen.has(day)) continue;
    const counts = {} as SlotRejectionCounts;
    let valid = true;
    for (const key of ["candidate_slots_evaluated", ...SLOT_REJECTION_COUNTS] as const) {
      const count = source[key];
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 10_000) { valid = false; break; }
      counts[key] = count;
    }
    if (!valid || counts.candidate_slots_evaluated < 1 ||
        SLOT_REJECTION_COUNTS.reduce((sum, key) => sum + counts[key], 0) !== counts.candidate_slots_evaluated) continue;
    const failure: TimelineNormalizationFailure = { day, ...counts };
    if (typeof source.failed_entry_time === "string") {
      const match = /^(\d{1,2}):(\d{2})$/.exec(source.failed_entry_time.trim());
      if (match && Number(match[1]) < 24 && Number(match[2]) < 60) {
        failure.failed_entry_time = `${match[1].padStart(2, "0")}:${match[2]}`;
      }
    }
    result.push(failure); seen.add(day);
    if (result.length === MAX_NORMALIZATION_FAILURES) break;
  }
  return result;
}
