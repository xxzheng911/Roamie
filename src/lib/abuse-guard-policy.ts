import { secondsUntilUtcMidnight, utcDay, windowStart, guardNow } from "@/lib/abuse-guard-clock";
import type { GuardBucket } from "@/lib/abuse-guard-logic";

export const GOOGLE_USER_DAILY_WEIGHT = 4_000;
export const GOOGLE_IP_DAILY_WEIGHT = 12_000;
export const GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT = 100_000;

export const GOOGLE_FAMILY_LIMITS = {
  places_text: { daily: 200, weight: 8 },
  places_nearby: { daily: 150, weight: 8 },
  places_details: { daily: 120, weight: 5 },
  places_autocomplete: { daily: 300, weight: 1 },
  geocoding: { daily: 80, weight: 2 },
  directions: { daily: 80, weight: 4 },
  routes: { daily: 150, weight: 4 },
  place_photos: { daily: 800, weight: 1 },
} as const;

export type GoogleBillingFamily = keyof typeof GOOGLE_FAMILY_LIMITS;

export const AI_FAIR_USE = {
  chat: { minute: 8, hour: 60, day: 400 },
  recommendations: { minute: 6, hour: 40, day: 80 },
  itinerary: { perTenMinutes: 2, hour: 8, day: 15 },
  /** Abuse ceiling for outfit copy. Not a credit balance and not shown to the client. */
  outfit: { minute: 6, hour: 40, day: 80 },
  /** Abuse ceiling for transit copy. Not a credit balance and not shown to the client. */
  transit: { minute: 6, hour: 40, day: 80 },
} as const;

export type AiSurface = keyof typeof AI_FAIR_USE;

const GLOBAL_EXCLUDED: ReadonlySet<GoogleBillingFamily> = new Set([
  "places_autocomplete",
  "place_photos",
]);

export function countsTowardGlobalBudget(family: GoogleBillingFamily): boolean {
  return !GLOBAL_EXCLUDED.has(family);
}

export function readGlobalDailyUnits(env: Readonly<Record<string, unknown>> | undefined): number {
  const raw = env?.GOOGLE_GLOBAL_DAILY_UNITS ?? process.env.GOOGLE_GLOBAL_DAILY_UNITS;
  if (typeof raw !== "string" && typeof raw !== "number") return GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 0) return GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT;
  return value;
}

export function billingFamilyFromUrl(url: string): GoogleBillingFamily {
  const path = new URL(url).pathname;
  if (path.endsWith(":searchText")) return "places_text";
  if (path.endsWith(":searchNearby")) return "places_nearby";
  if (path.endsWith(":autocomplete")) return "places_autocomplete";
  if (path.includes("/geocode/json")) return "geocoding";
  if (path.includes("/directions/json")) return "directions";
  if (path.includes(":computeRoutes")) return "routes";
  if (/^\/v1\/places\/[^/]+$/.test(path)) return "places_details";
  throw new Error("unsupported_google_operation");
}

export function aiSurfaceForMode(mode: string): AiSurface {
  if (mode === "itinerary") return "itinerary";
  if (mode === "chat") return "chat";
  return "recommendations";
}

function dailyBuckets(
  prefix: string,
  family: GoogleBillingFamily,
  weightLimit: number,
  now: number,
): GuardBucket[] {
  const day = utcDay(now);
  const retryAt = now + secondsUntilUtcMidnight(now) * 1000;
  const spec = GOOGLE_FAMILY_LIMITS[family];
  return [
    { key: `${prefix}:family:${family}:${day}`, limit: spec.daily, delta: 1, reason: "family", retryAt },
    { key: `${prefix}:weight:${day}`, limit: weightLimit, delta: spec.weight, reason: `${prefix}_weight`, retryAt },
  ];
}

export function googleUserBuckets(family: GoogleBillingFamily, now = guardNow()): GuardBucket[] {
  return dailyBuckets("user", family, GOOGLE_USER_DAILY_WEIGHT, now);
}

export function googleIpBuckets(family: GoogleBillingFamily, now = guardNow()): GuardBucket[] {
  const day = utcDay(now);
  const retryAt = now + secondsUntilUtcMidnight(now) * 1000;
  return [
    {
      key: `ip:weight:${day}`,
      limit: GOOGLE_IP_DAILY_WEIGHT,
      delta: GOOGLE_FAMILY_LIMITS[family].weight,
      reason: "ip_weight",
      retryAt,
    },
  ];
}

export function googleGlobalBuckets(
  family: GoogleBillingFamily,
  globalLimit: number,
  now = guardNow(),
): GuardBucket[] {
  const day = utcDay(now);
  const retryAt = now + secondsUntilUtcMidnight(now) * 1000;
  return [
    {
      key: `global:weight:${day}`,
      limit: globalLimit,
      delta: GOOGLE_FAMILY_LIMITS[family].weight,
      reason: "global_weight",
      retryAt,
    },
  ];
}

export function aiBuckets(surface: AiSurface, now = guardNow()): GuardBucket[] {
  const day = utcDay(now);
  const dayRetry = now + secondsUntilUtcMidnight(now) * 1000;
  if (surface === "itinerary") {
    const ten = windowStart(now, 600_000);
    const hour = windowStart(now, 3_600_000);
    const limits = AI_FAIR_USE.itinerary;
    return [
      { key: `ai:itinerary:10m:${ten}`, limit: limits.perTenMinutes, delta: 1, reason: "ai_window", retryAt: ten + 600_000 },
      { key: `ai:itinerary:hour:${hour}`, limit: limits.hour, delta: 1, reason: "ai_window", retryAt: hour + 3_600_000 },
      { key: `ai:itinerary:day:${day}`, limit: limits.day, delta: 1, reason: "ai_window", retryAt: dayRetry },
    ];
  }
  const limits = AI_FAIR_USE[surface];
  const minute = windowStart(now, 60_000);
  const hour = windowStart(now, 3_600_000);
  return [
    { key: `ai:${surface}:min:${minute}`, limit: limits.minute, delta: 1, reason: "ai_window", retryAt: minute + 60_000 },
    { key: `ai:${surface}:hour:${hour}`, limit: limits.hour, delta: 1, reason: "ai_window", retryAt: hour + 3_600_000 },
    { key: `ai:${surface}:day:${day}`, limit: limits.day, delta: 1, reason: "ai_window", retryAt: dayRetry },
  ];
}

export function serverFunctionBuckets(now = guardNow()): GuardBucket[] {
  const start = windowStart(now, 60_000);
  return [
    { key: `sf:min:${start}`, limit: 60, delta: 1, reason: "server_function", retryAt: start + 60_000 },
  ];
}
