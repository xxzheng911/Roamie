import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type PlanningFollowUpIntent = "must_visit_places" | "daily_rhythm";

const MUST_VISIT_RE =
  /(必去點|必去景點|必去|推薦景點|哪些景點|列景點|列出景點|景點有哪些|景點推薦|幫我列|先列)/;

const DAILY_RHYTHM_RE =
  /(總天數節奏|天數節奏|排節奏|先定節奏|前後段節奏|行程節奏|每天怎麼排|怎麼排天)/;

type CityMustVisitGuide = {
  places: string[];
  rhythmTip: string;
  styleQuestion: string;
};

const CITY_MUST_VISIT: Record<string, CityMustVisitGuide> = {
  曼谷: {
    places: [
      "大皇宮＋玉佛寺",
      "鄭王廟",
      "臥佛寺",
      "恰圖恰市集",
      "ICONSIAM",
      "喬德夜市",
      "水上市場或美功鐵道市場",
    ],
    rhythmTip:
      "如果想排得順，我會建議第一天先走市區寺廟，第二天安排市集和夜市，後面再看要不要加近郊。",
    styleQuestion: "你比較想偏文化景點、購物美食，還是夜市？",
  },
  清邁: {
    places: [
      "清邁古城寺廟",
      "帕辛寺",
      "雙龍寺",
      "週六／週日夜市",
      "尼曼路咖啡街區",
      "大象自然公園或近郊一日遊",
    ],
    rhythmTip: "清邁節奏可以前幾天古城散步，中間排市集，最後留一天近郊。",
    styleQuestion: "你比較想偏古城寺廟、咖啡慢步調，還是近郊自然？",
  },
  芭達雅: {
    places: [
      "真理寺",
      "芭達雅海灘散步",
      "四方水上市場",
      "蒂芬妮人妖秀或文化秀",
      "珊瑚島或格蘭島跳島",
      "中天海灘日落",
    ],
    rhythmTip: "通常會把海灘放鬆和跳島分開排，市場和夜景可以放在中間幾天。",
    styleQuestion: "你比較想偏海灘放鬆、跳島，還是夜市夜景？",
  },
  普吉島: {
    places: [
      "芭東海灘",
      "普吉老城",
      "查龍寺",
      "神仙半島",
      "皮皮島或皇帝島跳島",
      "週末夜市",
    ],
    rhythmTip: "建議前段排跳島，後段留海灘放空和老城散步，節奏會比較舒服。",
    styleQuestion: "你比較想偏跳島、海灘放空，還是老城美食？",
  },
  首爾: {
    places: [
      "景福宮＋北村韓屋村",
      "弘大／梨大商圈",
      "明洞購物街",
      "南山首爾塔",
      "廣藏市場",
      "漢江公園散步",
    ],
    rhythmTip: "可以前幾天排經典地標，中間穿插商圈和咖啡廳，最後留半天漢江散步。",
    styleQuestion: "你比較想偏文化古蹟、購物美食，還是夜景？",
  },
  東京: {
    places: [
      "淺草寺＋晴空塔",
      "明治神宮＋原宿表參道",
      "teamLab 或上野博物館",
      "築地／豐洲市場",
      "澀谷＋新宿",
      "近郊箱根或鎌倉一日遊",
    ],
    rhythmTip: "建議市區經典景點和商圈交錯排，最後留一天近郊會比較平衡。",
    styleQuestion: "你比較想偏文化寺社、購物美食，還是近郊一日遊？",
  },
};

export function parseMustVisitPlacesIntent(text: string): boolean {
  return MUST_VISIT_RE.test(text.trim());
}

export function parseDailyRhythmIntent(text: string): boolean {
  return DAILY_RHYTHM_RE.test(text.trim());
}

export function parsePlanningFollowUpIntent(text: string): PlanningFollowUpIntent | null {
  const t = text.trim();
  if (!t) return null;
  if (parseMustVisitPlacesIntent(t)) return "must_visit_places";
  if (parseDailyRhythmIntent(t)) return "daily_rhythm";
  return null;
}

function resolveCityGuide(destination: string): CityMustVisitGuide | null {
  const label = normalizeDestinationLabel(destination);
  if (CITY_MUST_VISIT[label]) return CITY_MUST_VISIT[label];

  if (label.includes("曼谷")) return CITY_MUST_VISIT["曼谷"];

  return null;
}

export function buildMustVisitPlacesReply(ctx: CanonicalTravelContext): string | null {
  const destination = ctx.destination?.trim();
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const guide = resolveCityGuide(label);
  const days = ctx.days;
  const dayLabel = days ? `${days} 天` : "";

  if (!guide) {
    const list = [
      `${label}${dayLabel ? ` ${dayLabel}` : ""}的話，我會先抓這些方向：`,
      "1. 經典地標",
      "2. 在地市集或商圈",
      "3. 夜景或特色街區",
      "4. 近郊半日或一日遊",
      "你可以跟我說比較想偏文化、美食還是自然，我再幫你細排。",
    ];
    return list.join("\n");
  }

  const header = days
    ? `${label} ${days} 天的話，我會先抓這些必去點：`
    : `${label}的話，我會先抓這些必去點：`;

  const numbered = guide.places.map((place, index) => `${index + 1}. ${place}`).join("\n");

  return [header, "", numbered, "", guide.rhythmTip, "", guide.styleQuestion].join("\n");
}

export function buildDailyRhythmReply(ctx: CanonicalTravelContext): string | null {
  const destination = ctx.destination?.trim();
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const days = ctx.days ?? 5;

  if (label === "曼谷" || label.includes("曼谷")) {
    return [
      `好，${label} ${days} 天我會這樣抓節奏：`,
      "第 1 天：大皇宮、玉佛寺、鄭王廟（市區寺廟）",
      "第 2 天：臥佛寺、ICONSIAM、河畔夜市",
      "第 3 天：恰圖恰市集、按摩、喬德夜市",
      "第 4 天：水上市場或美功鐵道市場半日遊",
      days >= 5 ? "第 5 天：自由安排購物、咖啡廳或近郊" : undefined,
      "",
      "這版節奏偏經典＋市集混搭，不會太趕。",
      "你想把哪一天改成購物或按摩多一點嗎？",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }

  return [
    `好，${label} ${days} 天我會建議前段排經典地標，中間穿插美食或市集，最後留 1 天彈性或近郊。`,
    "你想把節奏排得鬆一點，還是多留一天給購物或夜景？",
  ].join("\n");
}
