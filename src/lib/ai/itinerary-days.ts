/**
 * Single itinerary duration authority shared by parsers, client validation,
 * and server generate schemas. Safe for client + server imports.
 */
export const MIN_ITINERARY_DAYS = 1;
export const MAX_ITINERARY_DAYS = 30;

/**
 * generate-itinerary selectedPlaces schema capacity.
 * Aligned with long-trip oversample (days × 4) so a full-length trip that
 * reaches resolvedTarget is not rejected as Zod too_big.
 */
export const MAX_ITINERARY_SELECTED_PLACES = MAX_ITINERARY_DAYS * 4;

export function isValidItineraryDayCount(days: unknown): days is number {
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    days >= MIN_ITINERARY_DAYS &&
    days <= MAX_ITINERARY_DAYS
  );
}

/** Inclusive calendar-day count from YYYY-MM-DD. Unclamped; validity is separate. */
export function computeInclusiveItineraryDays(
  startIso?: string | null,
  endIso?: string | null,
): number | undefined {
  const start = startIso?.trim();
  const end = endIso?.trim();
  if (!start || !end) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return undefined;
  }
  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((endMs - startMs) / dayMs) + 1;
  if (days < MIN_ITINERARY_DAYS) return undefined;
  return days;
}

export function isItineraryDurationValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    name?: unknown;
    issues?: Array<{ path?: unknown[]; code?: string }>;
  };
  if (record.name !== "ZodError" && !Array.isArray(record.issues)) return false;
  const issues = Array.isArray(record.issues) ? record.issues : [];
  return issues.some((issue) => {
    const path = Array.isArray(issue.path) ? issue.path : [];
    const leaf = path[path.length - 1];
    return (
      leaf === "days" && (issue.code === "too_big" || issue.code === "too_small")
    );
  });
}
