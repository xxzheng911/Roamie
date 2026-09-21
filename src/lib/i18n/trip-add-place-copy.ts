import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";

const COPY = {
  "zh-TW": {
    opening: "當然可以！幫你找了幾個適合加入的地點 👇",
    continuation: "再幫你找了幾個選擇 👇",
    empty: "目前沒有找到適合加入的地點。",
    missingContext: "目前缺少地點資訊，暫時無法推薦附近的地點。",
    renderFailed: "我找到地點了，但卡片載入失敗，請重新整理。",
    emptyHint:
      "我可以依照目前行程幫你找順路地點。告訴我想找景點、咖啡廳或餐廳，也可以說「還有嗎」。",
    placesFound: "我幫你找了 {count} 個順路地點，可以看看哪個最適合加入行程。",
  },
  en: {
    opening: "Of course! Here are a few places to consider adding to your day 👇",
    continuation: "Here are a few more options 👇",
    empty: "I couldn’t find a suitable place to add right now.",
    missingContext: "Location information is missing, so I can’t suggest nearby places yet.",
    renderFailed: "I found the places, but the cards didn’t load. Please refresh.",
    emptyHint:
      "I can look for places that fit this itinerary. Tell me if you want sights, cafés, or restaurants, or ask for more.",
    placesFound: "I found {count} places that fit this itinerary. See which one you’d like to add.",
  },
  ja: {
    opening: "もちろん！予定に加えるのにおすすめの場所を見つけました 👇",
    continuation: "ほかにも候補をいくつか見つけました 👇",
    empty: "今のところ、追加に適した場所が見つかりませんでした。",
    missingContext: "場所の情報が不足しているため、まだ周辺の場所をおすすめできません。",
    renderFailed:
      "場所は見つかりましたが、カードを表示できませんでした。更新してもう一度お試しください。",
    emptyHint:
      "今の旅程に合う場所を探せます。観光スポット、カフェ、レストランの希望を教えるか、「ほかには？」と聞いてください。",
    placesFound: "旅程に合いそうな場所を {count} 件見つけました。追加したい場所を選んでください。",
  },
  ko: {
    opening: "물론이죠! 일정에 추가할 만한 곳을 몇 군데 찾았어요 👇",
    continuation: "몇 군데 더 찾아봤어요 👇",
    empty: "지금은 일정에 추가하기 적합한 장소를 찾지 못했어요.",
    missingContext: "위치 정보가 부족해서 아직 주변 장소를 추천하기 어려워요.",
    renderFailed: "장소는 찾았지만 카드를 불러오지 못했어요. 새로고침해 주세요.",
    emptyHint:
      "지금 일정에 맞는 장소를 찾아볼 수 있어요. 명소, 카페, 맛집 중 원하는 것을 말하거나 더 보여 달라고 해 주세요.",
    placesFound: "일정에 맞는 장소 {count}곳을 찾았어요. 어디를 추가할지 골라 보세요.",
  },
} satisfies Record<
  Locale,
  Record<
    | "opening"
    | "continuation"
    | "empty"
    | "missingContext"
    | "renderFailed"
    | "emptyHint"
    | "placesFound",
    string
  >
>;

export function getTripAddPlaceCopy(locale: Locale = effectiveAppLocale()) {
  return COPY[locale];
}

export function tripAddPlacePlacesFound(
  count: number,
  locale: Locale = effectiveAppLocale(),
): string {
  return COPY[locale].placesFound.replaceAll("{count}", String(count));
}
