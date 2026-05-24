import type { Locale } from "@/lib/i18n/types";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import type { DailyPrepAdvice } from "@/lib/recommendation/types";

type PrepCopy = {
  headline: string;
  bullets: string[];
};

const COPY: Record<Locale, Record<string, PrepCopy>> = {
  "zh-TW": {
    hot_rain: {
      headline: "今天偏悶熱，可能會下雨",
      bullets: [
        "穿透氣、吸汗的上衣，好走的鞋",
        "包包裡放一把小傘或輕便雨衣",
        "戶外行程縮短，午後改室內",
      ],
    },
    hot: {
      headline: "今天偏熱，記得補水",
      bullets: ["輕薄透氣衣物", "好走的鞋、帽子或陽傘", "傍晚再安排戶外散步"],
    },
    rain: {
      headline: "今天可能下雨",
      bullets: ["防水外套或折疊傘", "防滑好走的鞋", "以室內動線為主"],
    },
    cold: {
      headline: "今天偏涼，洋蔥式穿搭較安心",
      bullets: ["薄外套或針織", "長褲、好走的鞋", "傍晚降溫時加一件"],
    },
    night: {
      headline: "夜晚出門，記得保暖",
      bullets: ["薄外套", "好走的鞋", "留意末班大眾運輸時間"],
    },
    fair: {
      headline: "天氣舒適，適合慢慢走",
      bullets: ["輕便衣物、好走的鞋", "小背包帶水", "依行程留一點彈性"],
    },
  },
  en: {
    hot_rain: {
      headline: "Warm and possibly rainy today",
      bullets: [
        "Breathable top and comfortable shoes",
        "Pack a compact umbrella",
        "Keep outdoor time short; go indoors later",
      ],
    },
    hot: {
      headline: "It's warm — stay hydrated",
      bullets: ["Light layers", "Comfortable shoes, hat or sun shade", "Save long walks for evening"],
    },
    rain: {
      headline: "Rain is likely",
      bullets: ["Light rain jacket or foldable umbrella", "Non-slip shoes", "Favor indoor stops"],
    },
    cold: {
      headline: "Cool today — layer up",
      bullets: ["Light jacket or knit", "Long pants, walkable shoes", "Add a layer after sunset"],
    },
    night: {
      headline: "Heading out at night",
      bullets: ["Light jacket", "Comfortable shoes", "Check last transit times"],
    },
    fair: {
      headline: "Comfortable weather for wandering",
      bullets: ["Easy layers and walkable shoes", "Bring water", "Leave room in your plan"],
    },
  },
  ja: {
    hot_rain: {
      headline: "蒸し暑く、雨の可能性あり",
      bullets: ["通気性の良い服と歩きやすい靴", "折りたたみ傘を持参", "午後は室内中心に"],
    },
    hot: {
      headline: "暑い日 — 水分補給を",
      bullets: ["軽い服装", "歩きやすい靴、帽子", "夕方以降に散策を"],
    },
    rain: {
      headline: "雨の可能性",
      bullets: ["レインジャケットか傘", "滑りにくい靴", "室内スポット中心に"],
    },
    cold: {
      headline: "肌寒い — 重ね着で",
      bullets: ["薄手のアウター", "歩きやすい靴", "夜は一枚追加"],
    },
    night: {
      headline: "夜のお出かけ",
      bullets: ["薄手の上着", "歩きやすい靴", "終電を確認"],
    },
    fair: {
      headline: "過ごしやすい天気",
      bullets: ["軽装と歩きやすい靴", "水を持参", "余裕を残して"],
    },
  },
  ko: {
    hot_rain: {
      headline: "덥고 비 가능성 있음",
      bullets: ["통기성 좋은 옷과 편한 신발", "접이식 우산", "오후엔 실내 위주로"],
    },
    hot: {
      headline: "더운 날 — 수분 보충",
      bullets: ["가벼운 옷", "편한 신발, 모자", "저녁 산책 추천"],
    },
    rain: {
      headline: "비 올 수 있어요",
      bullets: ["우비 또는 우산", "미끄럼 방지 신발", "실내 코스 위주"],
    },
    cold: {
      headline: "쌀쌀해요 — 겹쳐 입기",
      bullets: ["가벼운 겉옷", "편한 신발", "저녁엔 한 겹 더"],
    },
    night: {
      headline: "밤 외출",
      bullets: ["얇은 겉옷", "편한 신발", "막차 시간 확인"],
    },
    fair: {
      headline: "산책하기 좋은 날씨",
      bullets: ["가벼운 옷과 편한 신발", "물 챙기기", "여유 있게"],
    },
  },
};

function pickKey(weather: WeatherSummary): keyof (typeof COPY)["zh-TW"] {
  const scene = classifyWeatherScene({
    tempC: weather.tempC,
    precipProbability: weather.precipProbability,
    condition: weather.condition,
    isDaytime: weather.isDaytime,
  });
  const precip = weather.precipProbability ?? 0;
  if (scene === "rainy" || precip >= 40) return scene === "hot" ? "hot_rain" : "rain";
  if (scene === "hot") return "hot";
  if (scene === "cold") return "cold";
  if (scene === "night") return "night";
  return "fair";
}

/** 今日穿搭／旅遊準備（規則式 fallback，不依 AI） */
export function buildDailyPrepAdvice(
  weather: WeatherSummary | null,
  locale: Locale,
  city?: string,
): DailyPrepAdvice | null {
  if (!weather) return null;
  const loc = locale in COPY ? locale : "en";
  const key = pickKey(weather);
  const block = COPY[loc][key] ?? COPY[loc].fair;
  const cityPrefix = city || weather.city;
  return {
    headline: cityPrefix ? `${cityPrefix} · ${block.headline}` : block.headline,
    bullets: block.bullets,
    source: "rules",
  };
}
