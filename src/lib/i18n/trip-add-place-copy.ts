import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";

const COPY = {
  "zh-TW": {
    opening: "當然可以！幫你找了幾個適合加入的地點 👇",
    continuation: "再幫你找了幾個選擇 👇",
    empty: "目前沒有找到適合加入的地點。",
    missingContext: "目前缺少地點資訊，暫時無法推薦附近的地點。",
  },
  en: {
    opening: "Of course! Here are a few places to consider adding to your day 👇",
    continuation: "Here are a few more options 👇",
    empty: "I couldn’t find a suitable place to add right now.",
    missingContext: "Location information is missing, so I can’t suggest nearby places yet.",
  },
  ja: {
    opening: "もちろん！予定に加えるのにおすすめの場所を見つけました 👇",
    continuation: "ほかにも候補をいくつか見つけました 👇",
    empty: "今のところ、追加に適した場所が見つかりませんでした。",
    missingContext: "場所の情報が不足しているため、まだ周辺の場所をおすすめできません。",
  },
  ko: {
    opening: "물론이죠! 일정에 추가할 만한 곳을 몇 군데 찾았어요 👇",
    continuation: "몇 군데 더 찾아봤어요 👇",
    empty: "지금은 일정에 추가하기 적합한 장소를 찾지 못했어요.",
    missingContext: "위치 정보가 부족해서 아직 주변 장소를 추천하기 어려워요.",
  },
} satisfies Record<Locale, Record<"opening" | "continuation" | "empty" | "missingContext", string>>;

export function getTripAddPlaceCopy(locale: Locale = effectiveAppLocale()) {
  return COPY[locale];
}
