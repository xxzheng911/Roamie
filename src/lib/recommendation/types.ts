import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import type { FestivalContext } from "@/lib/recommendation/festival-context";

/** 推薦分類 id（穩定、與 UI 語言無關） */
export type RecommendationCategoryId =
  | "coffee"
  | "food"
  | "sight"
  | "district"
  | "park"
  | "indoor"
  | "rainy"
  | "night"
  | "photo"
  | "walking";

export type RecommendationContext = {
  locale: Locale;
  location: { lat: number; lng: number; city?: string; displayLabel?: string };
  weather: WeatherSummary | null;
  time: string;
  mood?: string;
  preferences?: TravelPreferences;
  savedPlaceNames?: string[];
  recentRecommendationNames?: string[];
  rejectedPlaceNames?: string[];
  selectedPlaceNames?: string[];
  festival?: FestivalContext | null;
  /** 來自 trip intent：少走路、怕熱等 */
  constraints?: string[];
};

export type VerifiedPlaceCandidate = RoamieRecommendationItem & {
  /** Google Places resource id */
  googlePlaceId: string;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  primaryType: string | null;
  categoryId: RecommendationCategoryId;
  sourcePlace: PlaceResult;
};

export type DailyPrepAdvice = {
  headline: string;
  bullets: string[];
  source: "rules" | "ai";
};

export type PlaceIntroPayload = {
  intro: string;
  recommendReason: string;
  suitableFor: string;
  weatherFit: string;
  goNowAdvice: string;
  dataSparse: boolean;
  source: "ai" | "template";
};
