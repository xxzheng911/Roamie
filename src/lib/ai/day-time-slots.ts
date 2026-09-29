/**
 * Shared deterministic day clocks.
 * Selected-place scheduling and same-day duplicate repair must use these
 * lists instead of inventing another clock authority.
 */

/** Index slots assigned by the selected-place day scheduler. */
export const SCHEDULED_DAY_TIME_SLOTS = [
  "09:30",
  "11:00",
  "12:30",
  "14:00",
  "15:30",
  "17:00",
  "19:00",
  "20:30",
] as const;

/** Free clocks already used when a scheduled slot is taken. */
export const DEDUPE_DAY_TIME_SLOTS = [
  "08:30",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
] as const;

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

/** Chronological union of the two existing slot lists. */
export const LEGAL_DAY_TIME_SLOTS: readonly string[] = [
  ...new Set<string>([...SCHEDULED_DAY_TIME_SLOTS, ...DEDUPE_DAY_TIME_SLOTS]),
].sort((left, right) => clockMinutes(left) - clockMinutes(right));
