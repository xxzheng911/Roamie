export type TripEntryType = "advice" | "direct_intent" | "regenerate";
const enums = {
  entryType: ["advice", "direct_intent", "regenerate"],
  contextBundle: ["destination", "device", "unknown"],
  coordinateSource: ["geocode", "approximate", "fixed_fallback", "unresolved"],
  failureCode: ["candidate_insufficient", "planner_not_renderable", "none"],
} as const;
/** Counts are stage-local, not a monotonic funnel. Unknown measurements remain null. */
export function logTripRuntime(stage: "entry" | "loading_state" | "context" | "coordinates" | "discovery" | "eligibility" | "assembly" | "final", details: Record<string, unknown>): void {
  try {
    if (!["entry", "loading_state", "context", "coordinates", "discovery", "eligibility", "assembly", "final"].includes(stage)) return;
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
      const value = details[key];
      if (typeof value === "string" && (enums[key] as readonly string[]).includes(value)) safe[key] = value;
    }
    for (const key of ["hasChatLoading", "generating", "finalRenderable"]) {
      if (typeof details[key] === "boolean") safe[key] = details[key];
    }
    for (const key of ["discoveryInitial", "afterCanonicalDedupe", "afterGeographicFilter", "afterEligibility", "beforeAssembly", "afterAssembly", "finalAvailable"]) {
      const value = details[key];
      if (value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) safe[key] = value;
    }
    console.warn(`[AI_TRIP_RUNTIME] ${stage}`, JSON.stringify(safe));
  } catch { /* Logging cannot affect planning. */ }
}
