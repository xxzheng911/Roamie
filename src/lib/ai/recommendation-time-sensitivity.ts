export type RecommendationTimeMode =
  | "GENERAL_CHAT"
  | "LIVE_NEARBY"
  | "TIME_SENSITIVE"
  | "ITINERARY";

export type RecommendationTimePolicy = {
  mode: RecommendationTimeMode;
  timeSensitive: boolean;
  requireOpenNow: boolean;
  useOpenNowForRanking: boolean;
};

const EXPLICIT_NOW_RE =
  /(?:現在|目前)(?:有|能|可以|還有|正在|營業|開門|去|吃)|現在就|此刻|open\s*now/i;
const MEAL_TIME_RE = /早餐|早午餐|午餐|晚餐|今晚吃|宵夜|消夜/i;
const SPECIFIED_TIME_RE =
  /(?:今天|今晚|明天|週[一二三四五六日天]|星期[一二三四五六日天])?(?:早上|上午|中午|下午|傍晚|晚上|凌晨)?\s*\d{1,2}(?::\d{2})?\s*(?:點|時|am|pm)/i;

export function isExplicitTimeSensitiveRecommendation(userText: string): boolean {
  const normalized = userText.trim();
  return (
    EXPLICIT_NOW_RE.test(normalized) ||
    MEAL_TIME_RE.test(normalized) ||
    SPECIFIED_TIME_RE.test(normalized)
  );
}

export function resolveRecommendationTimePolicy(
  userText: string,
  baseMode: "GENERAL_CHAT" | "LIVE_NEARBY" = "GENERAL_CHAT",
): RecommendationTimePolicy {
  if (isExplicitTimeSensitiveRecommendation(userText)) {
    return {
      mode: "TIME_SENSITIVE",
      timeSensitive: true,
      requireOpenNow: true,
      useOpenNowForRanking: true,
    };
  }

  if (baseMode === "LIVE_NEARBY") {
    return {
      mode: "LIVE_NEARBY",
      timeSensitive: false,
      requireOpenNow: false,
      useOpenNowForRanking: true,
    };
  }

  return {
    mode: "GENERAL_CHAT",
    timeSensitive: false,
    requireOpenNow: false,
    useOpenNowForRanking: false,
  };
}

export const GENERAL_CHAT_TIME_POLICY: RecommendationTimePolicy = {
  mode: "GENERAL_CHAT",
  timeSensitive: false,
  requireOpenNow: false,
  useOpenNowForRanking: false,
};
