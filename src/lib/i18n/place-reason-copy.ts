import type { Locale } from "@/lib/i18n/types";

export type PlaceReasonCopy = {
  safeFallback: string;
  savedNearbyLead: string;
  tripSuffix: string;
  closedNow: string;
  closingSoon: (note: string) => string;
  openNow: string;
  distanceM: (m: number) => string;
  distanceKm: (km: string) => string;
  ratingHigh: (rating: number, count: number) => string;
  rainIndoor: string;
  rainOutdoor: string;
  hotIndoor: string;
  hotOutdoor: string;
  coldIndoor: string;
  coldOutdoor: string;
};

const COPY: Record<Locale, PlaceReasonCopy> = {
  "zh-TW": {
    safeFallback: "這個地點距離你不遠，評價不錯，可以順路安排進今天行程。",
    savedNearbyLead: "你收藏的角落就在附近，",
    tripSuffix: "，可以順路安排進今天行程。",
    closedNow: "目前未營業，出發前建議先確認時間",
    closingSoon: (n) => n,
    openNow: "營業中，現在出發剛好",
    distanceM: (m) => `步行約 ${m} 公尺`,
    distanceKm: (km) => `約 ${km} 公里`,
    ratingHigh: (r, c) => `評價 ${r}（${c} 則）`,
    rainIndoor: "今天有雨，室內剛好",
    rainOutdoor: "今天有雨，出門記得帶傘",
    hotIndoor: "今天偏熱，室內比較舒服",
    hotOutdoor: "今天偏熱，注意補水",
    coldIndoor: "今天偏涼，室內待久一點會比較舒服",
    coldOutdoor: "今天偏涼，記得保暖",
  },
  en: {
    safeFallback: "It's close by and well rated—a nice easy add to today.",
    savedNearbyLead: "A place you saved is nearby—",
    tripSuffix: ", easy to slot into today.",
    closedNow: "Looks closed now—double-check hours before you go",
    closingSoon: (n) => n,
    openNow: "Open now—good time to head over",
    distanceM: (m) => `about ${m} m away`,
    distanceKm: (km) => `about ${km} km away`,
    ratingHigh: (r, c) => `${r}★ (${c} reviews)`,
    rainIndoor: "Rain today—indoor works well",
    rainOutdoor: "Rain today—bring an umbrella",
    hotIndoor: "It's hot—indoor spots feel better",
    hotOutdoor: "It's hot—stay hydrated",
    coldIndoor: "Chilly today—indoor is cozier",
    coldOutdoor: "Chilly today—layer up",
  },
  ja: {
    safeFallback: "近くて評価も良さそう。今日の流れに入れやすい場所です。",
    savedNearbyLead: "保存した場所が近くにあります。",
    tripSuffix: "。今日の行程に入れやすいです。",
    closedNow: "今は営業していないかも。行く前に時間を確認してね",
    closingSoon: (n) => n,
    openNow: "営業中。今行くのにちょうどよさそう",
    distanceM: (m) => `約${m}m`,
    distanceKm: (km) => `約${km}km`,
    ratingHigh: (r, c) => `評価${r}（${c}件）`,
    rainIndoor: "雨模様。屋内がちょうどいい",
    rainOutdoor: "雨模様。傘があると安心",
    hotIndoor: "暑め。屋内が落ち着く",
    hotOutdoor: "暑め。水分補給を",
    coldIndoor: "ひんやり。屋内が温かい",
    coldOutdoor: "ひんやり。防寒を",
  },
  ko: {
    safeFallback: "가깝고 평도 괜찮아요. 오늘 일정에 넣기 좋아요.",
    savedNearbyLead: "저장한 곳이 근처에 있어요. ",
    tripSuffix: ", 오늘 동선에 넣기 좋아요.",
    closedNow: "지금은 영업하지 않을 수 있어요. 시간을 확인하세요",
    closingSoon: (n) => n,
    openNow: "영업 중—지금 가기 좋아요",
    distanceM: (m) => `약 ${m}m`,
    distanceKm: (km) => `약 ${km}km`,
    ratingHigh: (r, c) => `평점 ${r} (${c}개)`,
    rainIndoor: "비 올 수 있어요—실내가 좋아요",
    rainOutdoor: "비 올 수 있어요—우산 챙기세요",
    hotIndoor: "더워요—실내가 편해요",
    hotOutdoor: "더워요—수분 보충하세요",
    coldIndoor: "쌀쌀해요—실내가 따뜻해요",
    coldOutdoor: "쌀쌀해요—따뜻하게 입으세요",
  },
};

export function getPlaceReasonCopy(locale?: Locale): PlaceReasonCopy {
  return COPY[locale ?? "zh-TW"] ?? COPY["zh-TW"];
}

const EN_IDENTITY: Record<string, string> = {
  cafe: "A café nearby—good for a quiet pause.",
  restaurant: "A meal spot that fits a relaxed stop.",
  tourist_attraction: "A sight worth weaving into today.",
  park: "Green space for a slow walk.",
  bookstore: "A bookstore to browse without rushing.",
  shopping_mall: "Indoor browsing when you want options.",
  bar: "Evening drinks with a local feel.",
  night_market: "Lively stalls—best later in the day.",
  district: "A district made for wandering.",
};

export function reasonIdentityIntro(
  locale: Locale | undefined,
  identity: string,
  seed: string,
  zhOptions: string[],
): string {
  if ((locale ?? "zh-TW") === "zh-TW") {
    return zhOptions[seed.length % zhOptions.length] ?? zhOptions[0] ?? "";
  }
  return EN_IDENTITY[identity] ?? EN_IDENTITY.cafe;
}
