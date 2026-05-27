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
