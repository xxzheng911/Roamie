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
  /** 使用者選擇的交通模式（Routes API） */
  transportMode?: import("@/lib/routes/types").RoutesTravelMode;
  transportStatus?: "ok" | "transit_unavailable" | "failed" | "pending";
  transportFallbackMode?: "walk" | "drive" | null;
  transportDurationMinutes?: number;
  transportDisplayText?: string;
  /** 對應 buildLegRouteFingerprint，用於 leg_already_covered 判斷 */
  routeCacheFingerprint?: string;
  /**
   * transit 無 API 結果時的替代方案。
   * google_maps_deeplink：日本行程，改開 Google Maps 查路線。
   */
  transitUnavailableProvider?: TransitUnavailableProvider;
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
