/** 智慧交通建議 — 點到點推薦方式 */

export type TransitMode =
  | "walk"
  | "subway"
  | "bus"
  | "transit"
  | "taxi"
  | "uber"
  | "hsr"
  | "train"
  | "drive"
  | "scooter";

export type TransitComplexity = "low" | "medium" | "high";

/** 未來可擴充 ekispert | navitime | jorudan */
export type TransitUnavailableProvider = "google_maps_deeplink" | null;

/** Single source of truth for one itinerary leg's transport + duration. */
export type LegTransportRouteStatus =
  | "ok"
  | "failed"
  | "pending"
  | "transit_unavailable"
  | "mode_unavailable";

export type LegTransportDurationSource =
  | "directions"
  | "estimate"
  | "none";

export type TransitLegAdvice = {
  /** `${fromPlace}→${toPlace}` */
  legKey: string;
  fromName: string;
  toName: string;
  recommendedMode: TransitMode;
  /** 顯示用，如「建議搭 Uber」 */
  headline: string;
  durationMinutes: number;
  distanceMeters: number;
  reason: string;
  complexity: TransitComplexity;
  /** Google 估算（分鐘） */
  estimates: Partial<Record<"walk" | "drive" | "transit", number>>;
  alternatives?: Array<{
    mode: TransitMode;
    label: string;
    durationMinutes: number;
  }>;
  source: "rules" | "ai";
  /**
   * User / day preference mode that initiated the Directions request.
   * Do not show this in UI when it differs from resolvedMode.
   */
  requestedMode?: import("@/lib/routes/types").RoutesTravelMode;
  /**
   * Mode that actually produced durationMinutes (Source of Truth for UI).
   * Same as transportMode when present.
   */
  resolvedMode?: import("@/lib/routes/types").RoutesTravelMode;
  /** Why resolvedMode differs from requestedMode (or why the leg failed). */
  fallbackReason?: string | null;
  /** Where durationMinutes came from. */
  durationSource?: LegTransportDurationSource;
  /** Overall leg route status — UI + arrival must respect this. */
  routeStatus?: LegTransportRouteStatus;
  /** 使用者選擇的交通模式（Routes API）— prefer resolvedMode when set */
  transportMode?: import("@/lib/routes/types").RoutesTravelMode;
  transportStatus?: "ok" | "transit_unavailable" | "failed" | "pending";
  transportFallbackMode?: "walk" | "drive" | "transit" | null;
  transportDurationMinutes?: number;
  transportDisplayText?: string;
  /** 對應 buildLegRouteFingerprint，用於 leg_already_covered 判斷 */
  routeCacheFingerprint?: string;
  /**
   * transit 無 API 結果時的替代方案。
   * google_maps_deeplink：日本行程，改開 Google Maps 查路線。
   */
  transitUnavailableProvider?: TransitUnavailableProvider;
  /**
   * auto = AI / initial sync (allowModeFallback=true)
   * manual = user explicitly picked a transport mode (allowModeFallback=false)
   */
  modeSelectionSource?: "auto" | "manual";
};

export type TransitPreferences = {
  destination?: string;
  transportation?: string;
  pace?: string;
  companionship?: string;
  setting?: string;
  vibe?: string;
  /** 長輩、親子、情侶等 */
  travelStyle?: string;
};

export type TransitWeatherHint = {
  condition?: string;
  precipProbability?: number | null;
  tempC?: number | null;
  feelsLikeC?: number | null;
  isRainy?: boolean;
  isHot?: boolean;
  isNight?: boolean;
  uvi?: number | null;
};

export type TransitLegInput = {
  placeName: string;
  title: string;
  lat: number | null;
  lng: number | null;
  date?: string;
};

export function buildLegKey(from: string, to: string): string {
  return `${from}→${to}`;
}

const DAY_LEG_SEP = "§";

/** 含日期範圍的路段 key，避免多天行程共用同一段 from→to 的 duration */
export function buildDayLegKey(dateKey: string, from: string, to: string): string {
  return `${dateKey}${DAY_LEG_SEP}${buildLegKey(from, to)}`;
}

export function parseDayLegKey(
  key: string,
): { dateKey: string; from: string; to: string } | null {
  const sep = key.indexOf(DAY_LEG_SEP);
  if (sep < 0) return null;
  const legPart = key.slice(sep + DAY_LEG_SEP.length);
  const arrow = legPart.indexOf("→");
  if (arrow < 0) return null;
  return {
    dateKey: key.slice(0, sep),
    from: legPart.slice(0, arrow),
    to: legPart.slice(arrow + 1),
  };
}

export function resolveTransitLeg(
  transitLegs: Record<string, TransitLegAdvice> | undefined,
  dateKey: string,
  from: string,
  to: string,
): TransitLegAdvice | undefined {
  if (!transitLegs) return undefined;
  const scoped = buildDayLegKey(dateKey, from, to);
  if (transitLegs[scoped]) return transitLegs[scoped];
  return transitLegs[buildLegKey(from, to)];
}
