import {
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import {
  getDestinationCombinations,
  hasDestinationCombinations,
  isSuggestionInDestinationScope,
} from "@/lib/ai/destination-combination-suggestions";
import { applyKoParticles, displayDestinationForCopy } from "@/lib/ai/destination-locale-aliases";
import { localizeCombinationThemeTitle } from "@/lib/ai/combination-theme-titles";
import { chatRuntimeCopy } from "@/lib/chat-runtime-copy";
import { resolvePlaceDisplayName } from "@/lib/place-display-name";
import type { Locale } from "@/lib/i18n/types";

export type DestinationStyleGuide = {
  styleOptions: string[];
  hotRoutes: string[];
  themeDescription: string;
  durationOptions?: string[];
};

const GUIDES: Record<string, DestinationStyleGuide> = {
  蒙古: {
    styleOptions: ["自然景觀草原", "戈壁沙漠", "文化歷史", "蒙古包體驗"],
    hotRoutes: [
      "烏蘭巴托",
      "特勒吉國家公園",
      "哈拉和林",
      "戈壁沙漠",
      "草原蒙古包體驗",
    ],
    themeDescription: "自然景觀、草原、沙漠和文化體驗",
    durationOptions: ["5～7 天", "8～10 天", "先幫我建議天數"],
  },
  日本: {
    styleOptions: ["經典景點", "美食咖啡", "動漫購物", "慢步調散策"],
    hotRoutes: ["東京", "京都", "大阪", "北海道", "沖繩"],
    themeDescription: "城市文化、美食、購物與自然風光",
    durationOptions: ["5 天", "7 天", "10 天"],
  },
  泰國: {
    styleOptions: ["城市探索", "美食按摩", "海島放鬆", "文化古蹟"],
    hotRoutes: ["曼谷", "清邁", "普吉島", "喀比", "蘇梅島"],
    themeDescription: "城市美食、按摩、海島與文化古蹟",
    durationOptions: ["4 天", "5 天", "7 天"],
  },
  韓國: {
    styleOptions: ["城市散策", "美食咖啡", "海景放鬆", "文化體驗"],
    hotRoutes: ["首爾", "釜山", "濟州島", "江原道", "慶州"],
    themeDescription: "城市散策、美食、海景與傳統文化",
    durationOptions: ["4 天", "5 天", "7 天"],
  },
};

const ANIME_FRIENDLY = new Set(["日本", "東京", "大阪", "京都", "橫濱", "名古屋", "福岡", "北海道", "沖繩"]);

const DEFAULT_GUIDE: DestinationStyleGuide = {
  styleOptions: ["經典景點", "美食文化", "自然風光", "慢步調散策"],
  hotRoutes: [],
  themeDescription: "文化、美食和自然風光",
  durationOptions: ["5 天", "7 天", "10 天"],
};

export function getDestinationStyleGuide(destination: string): DestinationStyleGuide {
  const label = normalizeDestinationLabel(destination);

  if (hasDestinationCombinations(label)) {
    const combos = getDestinationCombinations(label);
    return {
      styleOptions: combos.map((c) => c.title),
      hotRoutes: combos.flatMap((c) => c.places).filter((p) => isSuggestionInDestinationScope(p, label)),
      themeDescription: `${label}文化、美食與經典景點`,
      durationOptions: ["5 天", "7 天", "10 天"],
    };
  }

  if (GUIDES[label]) return GUIDES[label];

  if (ANIME_FRIENDLY.has(label)) {
    return GUIDES["日本"];
  }

  if (isKnownTouristCityLabel(label)) {
    return {
      styleOptions: ["經典景點", "美食文化", "商圈購物", "慢步調散策"],
      hotRoutes: [`${label}經典地標`, `${label}特色商圈`, `${label}在地美食`],
      themeDescription: `${label}文化、美食與經典景點`,
      durationOptions: ["5 天", "7 天", "10 天"],
    };
  }

  if (isKnownCountryLabel(label)) {
    return {
      ...DEFAULT_GUIDE,
      hotRoutes: [`${label}經典城市`, `${label}自然風光`, `${label}文化體驗`],
    };
  }

  return {
    ...DEFAULT_GUIDE,
    hotRoutes: [
      `${label}市中心`,
      `${label}經典景區`,
      `${label}周邊自然景點`,
    ],
  };
}

export function buildDestinationStyleChoiceQuestion(
  destination: string,
  opts?: { days?: number; month?: string; locale?: Locale },
): string {
  const label = normalizeDestinationLabel(destination);
  const guide = getDestinationStyleGuide(label);
  const locale = opts?.locale ?? "zh-TW";
  if (locale !== "zh-TW") return buildForeignStyleChoiceQuestion(label, guide, locale, opts);
  const daysLabel = opts?.days ? ` ${opts.days} 天` : "";
  const monthLabel = opts?.month ? `（${opts.month}）` : "";

  return [
    `好，我先幫你抓${label}${daysLabel}${monthLabel}的方向。`,
    "你想要偏向：",
    ...guide.styleOptions.map((option, index) => `${index + 1}. ${option}`),
    "",
    "也可以直接跟我說偏好，或回「都可以」讓我依建議組合安排。",
  ].join("\n");
}

type ForeignLocale = Exclude<Locale, "zh-TW">;

/** en / ja / ko style question; option values stay internal, only their labels are localized. */
function buildForeignStyleChoiceQuestion(
  label: string,
  guide: DestinationStyleGuide,
  locale: ForeignLocale,
  opts?: { days?: number; month?: string },
): string {
  const shown =
    label === "這趟"
      ? chatRuntimeCopy("tripFallback", locale)
      : displayDestinationForCopy(label, undefined, locale);
  const monthNum = Number(opts?.month?.match(/\d{1,2}/)?.[0]);
  const monthName =
    monthNum >= 1 && monthNum <= 12
      ? new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
          new Date(Date.UTC(2000, monthNum - 1, 1)),
        )
      : "";
  const n = opts?.days;
  const enParts = [n ? `${n} days` : "", monthName].filter(Boolean);
  const days =
    locale === "en"
      ? enParts.length ? ` (${enParts.join(", ")})` : ""
      : locale === "ja"
        ? n ? `の${n}日間` : ""
        : n ? ` ${n}일` : "";
  const month = locale === "en" || !monthName ? "" : locale === "ja" ? `（${monthName}）` : `(${monthName})`;
  const intro = chatRuntimeCopy("styleChoiceIntro", locale, { destination: shown, days, month });
  return [
    intro,
    chatRuntimeCopy("styleChoicePrompt", locale),
    ...guide.styleOptions.map((option, index) => {
      const text = styleOptionDisplay(option, locale);
      return `${index + 1}. ${locale === "en" ? text.charAt(0).toUpperCase() + text.slice(1) : text}`;
    }),
    "",
    chatRuntimeCopy("styleChoiceFooter", locale),
  ].join("\n");
}

/** Display-only labels for zh style options (internal option values never change). */
const STYLE_OPTION_DISPLAY: Record<string, Record<ForeignLocale, string>> = {
  經典景點: { en: "classic sights", ja: "定番スポット", ko: "대표 명소" },
  美食咖啡: { en: "food & café", ja: "グルメ＆カフェ", ko: "맛집·카페" },
  動漫購物: { en: "manga, anime & shopping", ja: "アニメ＆ショッピング", ko: "애니메이션·쇼핑" },
  慢步調散策: { en: "slow-paced stroll", ja: "のんびり散策", ko: "느긋한 산책" },
  美食文化: { en: "food & culture", ja: "グルメと文化", ko: "미식·문화" },
  自然風光: { en: "nature & scenery", ja: "自然風景", ko: "자연 풍경" },
  商圈購物: { en: "shopping district", ja: "商店街ショッピング", ko: "상권 쇼핑" },
  城市探索: { en: "city exploration", ja: "街の探索", ko: "도시 탐방" },
  美食按摩: { en: "food & massage", ja: "グルメ＆マッサージ", ko: "맛집·마사지" },
  海島放鬆: { en: "relaxing island", ja: "島でのんびり", ko: "섬 휴양" },
  文化古蹟: { en: "culture & heritage", ja: "文化・史跡", ko: "문화·유적" },
  城市散策: { en: "city walk", ja: "街歩き", ko: "도시 산책" },
  海景放鬆: { en: "seaside relaxation", ja: "海辺でのんびり", ko: "바다 전망 휴식" },
  文化體驗: { en: "cultural experience", ja: "文化体験", ko: "문화 체험" },
  自然景觀草原: { en: "grassland scenery", ja: "草原の自然景観", ko: "초원 자연경관" },
  戈壁沙漠: { en: "Gobi Desert", ja: "ゴビ砂漠", ko: "고비 사막" },
  文化歷史: { en: "culture & history", ja: "文化・歴史", ko: "문화·역사" },
  蒙古包體驗: { en: "ger stay", ja: "ゲル体験", ko: "게르 체험" },
  海灘放鬆: { en: "beach relaxation", ja: "ビーチでのんびり", ko: "해변 휴식" },
  混合: { en: "mixed", ja: "バランス型", ko: "다양한 테마" },
  都可以: { en: "mixed", ja: "バランス型", ko: "다양한 테마" },
};

/** Style option / combination title shown in the active locale. zh-TW returns the value unchanged. */
export function styleOptionDisplay(value: string, locale: Locale): string {
  if (locale === "zh-TW") return value;
  return STYLE_OPTION_DISPLAY[value.trim()]?.[locale] ?? localizeCombinationThemeTitle(value, locale);
}

const THEME_DESCRIPTION_DISPLAY: Record<string, Record<ForeignLocale, string>> = {
  "自然景觀、草原、沙漠和文化體驗": {
    en: "natural scenery, grasslands, deserts, and cultural experiences",
    ja: "自然景観、草原、砂漠、文化体験",
    ko: "자연경관, 초원, 사막, 문화 체험",
  },
  "城市文化、美食、購物與自然風光": {
    en: "city culture, food, shopping, and nature",
    ja: "都市文化、グルメ、ショッピング、自然風景",
    ko: "도시 문화, 미식, 쇼핑, 자연 풍경",
  },
  "城市美食、按摩、海島與文化古蹟": {
    en: "city food, massages, islands, and historic sites",
    ja: "街のグルメ、マッサージ、島、史跡",
    ko: "도시 미식, 마사지, 섬, 역사 유적",
  },
  "城市散策、美食、海景與傳統文化": {
    en: "city walks, food, sea views, and traditional culture",
    ja: "街歩き、グルメ、海の景色、伝統文化",
    ko: "도시 산책, 미식, 바다 풍경, 전통문화",
  },
  "文化、美食和自然風光": {
    en: "culture, food, and nature",
    ja: "文化、グルメ、自然風景",
    ko: "문화, 미식, 자연 풍경",
  },
  "文化、美食與經典景點": {
    en: "culture, food, and classic sights",
    ja: "文化、グルメ、定番スポット",
    ko: "문화, 미식, 대표 명소",
  },
};

/** Generated `${label}…` route labels → localized templates ({d} = shown destination). */
const GENERATED_ROUTE_DISPLAY: Record<string, Record<ForeignLocale, string>> = {
  經典地標: { en: "Landmarks of {d}", ja: "{d}の定番ランドマーク", ko: "{d} 대표 랜드마크" },
  特色商圈: { en: "Shopping districts of {d}", ja: "{d}の個性的な商店街", ko: "{d} 특색 상권" },
  在地美食: { en: "Local food in {d}", ja: "{d}のローカルグルメ", ko: "{d} 현지 맛집" },
  經典城市: { en: "Classic cities of {d}", ja: "{d}の定番都市", ko: "{d} 대표 도시" },
  自然風光: { en: "Nature in {d}", ja: "{d}の自然風景", ko: "{d} 자연 풍경" },
  文化體驗: { en: "Cultural experiences in {d}", ja: "{d}の文化体験", ko: "{d} 문화 체험" },
  市中心: { en: "Central {d}", ja: "{d}の中心部", ko: "{d} 시내 중심" },
  經典景區: { en: "Classic sights of {d}", ja: "{d}の定番観光エリア", ko: "{d} 대표 관광지" },
  周邊自然景點: { en: "Nature around {d}", ja: "{d}周辺の自然スポット", ko: "{d} 근교 자연 명소" },
};

/** Localized route label, or null when only the zh source name is available. */
function routeDisplay(route: string, label: string, shownLabel: string, locale: ForeignLocale): string | null {
  if (route.startsWith(label)) {
    const generated = GENERATED_ROUTE_DISPLAY[route.slice(label.length)]?.[locale];
    if (generated) return generated.replace("{d}", shownLabel);
  }
  const city = displayDestinationForCopy(route, undefined, locale);
  // Known destination: ja may share the kanji (東京) or only differ by shinjitai, so confirm
  // via the English / Korean display name instead of the ja form.
  const knownCity =
    (locale !== "ja" && city !== route) ||
    displayDestinationForCopy(route, undefined, "en") !== route ||
    displayDestinationForCopy(route, undefined, "ko") !== route;
  const shown = knownCity
    ? city
    : resolvePlaceDisplayName(route, locale).localizedDisplayName.trim() || route;
  if (!/\p{Script=Han}/u.test(shown)) return shown;
  // en / ko never show Han; ja keeps kanji only for known destinations.
  return locale === "ja" && knownCity ? shown : null;
}

function buildForeignDefaultRoutesReply(
  label: string,
  guide: DestinationStyleGuide,
  locale: ForeignLocale,
): string {
  const shownLabel =
    label === "這趟"
      ? chatRuntimeCopy("tripFallback", locale)
      : displayDestinationForCopy(label, undefined, locale);
  const routes = guide.hotRoutes
    .filter((route) => isSuggestionInDestinationScope(route, label))
    .map((route) => routeDisplay(route, label, shownLabel, locale))
    .filter((route): route is string => Boolean(route));
  const themeKey = guide.themeDescription.startsWith(label)
    ? guide.themeDescription.slice(label.length)
    : guide.themeDescription;
  const theme =
    THEME_DESCRIPTION_DISPLAY[themeKey]?.[locale] ??
    THEME_DESCRIPTION_DISPLAY["文化、美食和自然風光"]![locale];
  let themeLine = applyKoParticles(
    chatRuntimeCopy("defaultRoutesTheme", locale, { destination: shownLabel, theme }),
    [shownLabel],
    locale,
  );
  if (!routes.length) themeLine = themeLine.replace(/[:：]$/, locale === "ja" ? "。" : ".");
  return [
    chatRuntimeCopy("defaultRoutesIntro", locale, { destination: shownLabel }),
    themeLine,
    ...(routes.length ? ["", routes.map((route, index) => `${index + 1}. ${route}`).join("\n")] : []),
    "",
    chatRuntimeCopy("defaultRoutesDaysAsk", locale),
  ].join("\n");
}

export function buildDefaultRoutesReply(
  destination: string,
  country?: string,
  locale: Locale = "zh-TW",
): { reply: string; durationOptions: string[] } {
  const label = normalizeDestinationLabel(destination);
  const guide = getDestinationStyleGuide(label);

  if (locale !== "zh-TW") {
    return {
      reply: buildForeignDefaultRoutesReply(label, guide, locale),
      durationOptions: guide.durationOptions ?? DEFAULT_GUIDE.durationOptions!,
    };
  }

  const routeList = guide.hotRoutes
    .filter((route) => isSuggestionInDestinationScope(route, label))
    .map((route, index) => `${index + 1}. ${route}`)
    .join("\n");

  return {
    reply: [
      `如果都可以，我會先用${label}經典熱門路線幫你抓方向。`,
      `${label}比較適合走${guide.themeDescription}：`,
      "",
      routeList,
      "",
      "你這趟大概想排幾天？我可以幫你抓 5～7 天或 8～10 天的節奏。",
    ].join("\n"),
    durationOptions: guide.durationOptions ?? DEFAULT_GUIDE.durationOptions!,
  };
}
