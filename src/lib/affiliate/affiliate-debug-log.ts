/**
 * Affiliate logging — quiet by default so Planner / Places / Validator stay readable.
 *
 * DEBUG_AFFILIATE / VITE_DEBUG_AFFILIATE=true → full decision traces.
 * Otherwise: one [AFFILIATE_SUMMARY] or [AFFILIATE_SKIP] per place (deduped).
 */

export function isDebugAffiliateEnabled(): boolean {
  const vite = import.meta.env.VITE_DEBUG_AFFILIATE;
  if (vite === "1" || vite === "true" || vite === true) return true;
  // Non-Vite runtimes / scripts may set DEBUG_AFFILIATE
  try {
    const raw =
      typeof process !== "undefined"
        ? (process as { env?: Record<string, string | undefined> }).env?.DEBUG_AFFILIATE
        : undefined;
    if (raw === "1" || raw === "true") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function affiliateDebugInfo(...args: unknown[]): void {
  if (!isDebugAffiliateEnabled()) return;
  console.info(...args);
}

export function affiliateDebugWarn(...args: unknown[]): void {
  if (!isDebugAffiliateEnabled()) return;
  console.warn(...args);
}

const loggedPlaceKeys = new Set<string>();

function placeLogKey(place: string, category?: string): string {
  return `${place.trim().toLowerCase()}|${(category ?? "").trim().toLowerCase()}`;
}

export function normalizeAffiliateSkipReason(
  reason: string,
  placeTypes?: string,
): string {
  const r = reason.trim().toLowerCase();
  const types = (placeTypes ?? "").toLowerCase();
  if (!r) return "skip";
  if (r.includes("generic_park") || r === "excluded_generic_park") return "generic_park";
  if (
    types.includes("station") ||
    types.includes("transit") ||
    types.includes("airport") ||
    r.includes("station")
  ) {
    return "generic_station";
  }
  if (
    types.includes("hotel") ||
    types.includes("lodging") ||
    types.includes("motel") ||
    types.includes("hostel") ||
    r.includes("hotel") ||
    r.includes("lodging")
  ) {
    return "generic_hotel";
  }
  if (
    types.includes("supermarket") ||
    types.includes("grocery") ||
    types.includes("convenience") ||
    r.includes("supermarket") ||
    r.includes("grocery")
  ) {
    return "generic_supermarket";
  }
  if (types.includes("market") || r.includes("night_market") || r.includes("market")) {
    return "generic_market";
  }
  if (r.startsWith("excluded_")) return r.replace(/^excluded_/, "");
  return reason.trim();
}

export type AffiliateSummaryInput = {
  place: string;
  category?: string;
  placeTypes?: string;
  tripFlight?: boolean;
  tripHotel?: boolean;
  agoda?: boolean;
  kkday?: boolean;
  klook?: boolean;
  reason?: string;
  skipped?: boolean;
};

/**
 * One log line per place.
 * Skip → [AFFILIATE_SKIP]; otherwise → [AFFILIATE_SUMMARY].
 * Detail traces only when DEBUG_AFFILIATE is on.
 */
export function logAffiliateSummary(input: AffiliateSummaryInput): void {
  const place = input.place?.trim() || "(unknown)";
  const category = input.category?.trim() || "";
  const key = placeLogKey(place, category);
  if (loggedPlaceKeys.has(key)) return;
  loggedPlaceKeys.add(key);

  // Cap memory for long sessions
  if (loggedPlaceKeys.size > 400) {
    const first = loggedPlaceKeys.values().next().value;
    if (first) loggedPlaceKeys.delete(first);
  }

  const reason = input.reason?.trim() || "";
  const skipReason = normalizeAffiliateSkipReason(reason || "skip", input.placeTypes);
  const genericSkipReasons = new Set([
    "generic_park",
    "generic_station",
    "generic_hotel",
    "generic_market",
    "generic_supermarket",
  ]);
  const isSkip =
    input.skipped === true ||
    genericSkipReasons.has(skipReason) ||
    (!input.tripFlight &&
      !input.tripHotel &&
      !input.agoda &&
      !input.kkday &&
      !input.klook &&
      (skipReason === "food_retail_lodging" ||
        skipReason === "default_type" ||
        skipReason === "not_ticketable" ||
        skipReason === "missing_name" ||
        skipReason === "general_night_market"));

  if (isSkip) {
    console.info(`[AFFILIATE_SKIP]\nPlace：${place}\nReason：${skipReason}`);
    return;
  }

  console.info(
    [
      "[AFFILIATE_SUMMARY]",
      `Place：${place}`,
      `Category：${category}`,
      "",
      `Trip Flight：${input.tripFlight ? "true" : "false"}`,
      `Trip Hotel：${input.tripHotel ? "true" : "false"}`,
      `Agoda：${input.agoda ? "true" : "false"}`,
      `KKday：${input.kkday ? "true" : "false"}`,
      `Klook：${input.klook ? "true" : "false"}`,
      "",
      `Reason：${reason || "ok"}`,
    ].join("\n"),
  );
}

export function clearAffiliateSummaryLogDedupe(): void {
  loggedPlaceKeys.clear();
}
