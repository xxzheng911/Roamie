/** 當日行程活動類型（影響穿搭建議） */
export type TripActivityType =
  | "shopping"
  | "food"
  | "outdoor"
  | "photo"
  | "hiking"
  | "beach"
  | "city"
  | "culture"
  | "mixed";

export const TRIP_ACTIVITY_LABELS: Record<TripActivityType, string> = {
  shopping: "逛街",
  food: "美食",
  outdoor: "戶外",
  photo: "拍照",
  hiking: "登山健行",
  beach: "海邊",
  city: "城市漫遊",
  culture: "文化展覽",
  mixed: "綜合",
};

/** 單日天氣快照（來自 OpenWeather，非 AI 捏造） */
export type DayWeatherSnapshot = {
  condition: string;
  tempHighC: number | null;
  tempLowC: number | null;
  precipProbability: number | null;
  /** 日夜溫差（最高 − 最低） */
  diurnalRangeC: number | null;
  iconType?: string;
  cloudCoverPercent?: number | null;
  uvi?: number | null;
};

/** 每日穿搭建議 — 存入 RoamiePayloadV2.outfitAdvice */
export type DailyOutfitAdvice = {
  date: string;
  dayIndex: number;
  weather: DayWeatherSnapshot;
  activityTypes: TripActivityType[];
  /** 一行穿搭重點，如「短袖＋薄外套」 */
  outfitSummary: string;
  /** 旅伴語氣段落，有溫度與情境 */
  narrative: string;
  /** 攜帶提醒，如「建議攜帶折疊傘」 */
  packingReminders: string[];
  /** 穿搭風格語氣參考（文青、韓系等） */
  styleTone?: string;
};

export type OutfitAdvicePayload = {
  destination: string;
  generatedAt: string;
  fashionStyle?: string;
  days: DailyOutfitAdvice[];
};

/** 整趟行程穿搭建議 — 存入 RoamiePayloadV2 */
export type TripWeatherSource = "openweather" | "unavailable";

export type TripOutfitSuggestionFields = {
  /** 2–4 句穿搭建議正文 */
  outfitSuggestion?: string;
  outfitSuggestionUpdatedAt?: string;
  /** 天氣 / 溫度摘要 */
  weatherSummary?: string;
  weatherSource?: TripWeatherSource;
  /** 目的地／日期／天數變更時用於判斷是否重新生成 */
  outfitSuggestionInputKey?: string;
  /** 穿搭重點標籤（防曬、防水…） */
  outfitTags?: string[];
  /** 畫面上顯示的即時溫度 */
  weatherTempC?: number | null;
  weatherFeelsLikeC?: number | null;
  weatherCondition?: string;
  weatherIconType?: string;
  weatherIsDaytime?: boolean;
  weatherPrecipPercent?: number | null;
  /** 是否為 Plus 細緻版建議 */
  outfitTier?: "free" | "plus";
};
