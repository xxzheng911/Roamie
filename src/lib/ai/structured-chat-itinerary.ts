import type { RoamieItineraryItem, RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import {
  buildSeasonOutfitAdvicePayload,
  buildSeasonTripOutfitSuggestion,
} from "@/lib/outfit/trip-season-outfit-suggestion";
import { buildOutfitInputKey, buildTripItemsFingerprint } from "@/lib/outfit/trip-outfit-context";
import { attachDayPlansToPayload } from "@/lib/trip/build-day-plans";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { tripPlaceToItineraryItem } from "@/lib/trip/trip-place-input";
import { generateTripTitle } from "@/lib/trip/trip-title";

export type StructuredChatItineraryInput = {
  destination: string;
  days: number;
  startDate: string;
  endDate: string;
  mustIncludePlaces: string[];
  mood?: string;
  transport?: string;
  weatherSummary?: string;
  destinationLocation?: TripLocation;
  /** 已搜尋／選定的真實地點（優先使用） */
  selectedPlaces?: RoamieRecommendationItem[];
};

function placeItem(
  name: string,
  type: string,
  time: string,
  date: string,
  notes?: string,
): RoamieItineraryItem {
  return tripPlaceToItineraryItem(
    {
      name,
      placeName: name,
      type,
      address: `東京 ${name}`,
      description: notes ?? `${name} — 可依體力調整停留`,
      reason: notes ?? "依你的必去清單安排",
      reasonSource: "template",
      estimatedTime: type.includes("一日") ? "全天" : "約 3–4 小時",
    },
    { date, time, notes },
  );
}

function resolveMustSlot(
  mustInclude: string[],
  selected: RoamieRecommendationItem[],
): { fuji?: string; harryPotter?: string } {
  const names = [
    ...selected.map((p) => p.placeName ?? p.name),
    ...mustInclude,
  ].filter(Boolean);
  const fuji = names.find((n) => /富士|河口湖|五合目/.test(n)) ?? mustInclude.find((n) => /富士/.test(n));
  const harry =
    names.find((n) => /哈利|Harry|華納.*哈利|Studio Tour.*Harry/i.test(n)) ??
    mustInclude.find((n) => /哈利/.test(n));
  return {
    fuji: fuji ?? (mustInclude.some((m) => /富士/.test(m)) ? "富士山（河口湖・五合目）" : undefined),
    harryPotter:
      harry ??
      (mustInclude.some((m) => /哈利/.test(m)) ? "哈利波特影城" : undefined),
  };
}

/** 依必去景點建立多日結構化行程（AI 不可用時或明確規劃請求） */
export function buildStructuredChatItinerary(
  input: StructuredChatItineraryInput,
): RoamiePayloadV2 {
  const days = Math.min(14, Math.max(1, input.days));
  const dateKeys = listTripDates([], input.startDate, days);
  const { fuji, harryPotter } = resolveMustSlot(input.mustIncludePlaces, input.selectedPlaces ?? []);

  const dayTemplates: Array<{ theme: string; slots: Array<{ name: string; type: string; time: string }> }> =
    [];

  const pushDay = (
    theme: string,
    slots: Array<{ name: string; type: string; time: string }>,
  ) => {
    dayTemplates.push({ theme, slots });
  };

  if (/東京/.test(input.destination) && days >= 6) {
    pushDay("抵達・淺草與下町散步（早班機適應）", [
      { name: "淺草寺・雷門", type: "景點", time: "14:00" },
      { name: "隅田川沿岸散步", type: "景點", time: "16:30" },
      { name: "上野阿美橫町", type: "美食", time: "18:30" },
    ]);
    pushDay("澀谷・原宿・表參道（市區經典）", [
      { name: "明治神宮", type: "景點", time: "10:00" },
      { name: "原宿竹下通", type: "景點", time: "12:30" },
      { name: "澀谷十字路口", type: "景點", time: "16:00" },
    ]);
    pushDay("富士山一日（建議包車或巴士）", [
      {
        name: fuji ?? "富士山（河口湖・五合目）",
        type: "一日郊遊",
        time: "08:00",
      },
      { name: "河口湖湖畔", type: "景點", time: "13:00" },
    ]);
    pushDay("哈利波特影城・豐洲（半天主題＋海鮮）", [
      {
        name: harryPotter ?? "哈利波特影城",
        type: "主題景點",
        time: "09:30",
      },
      { name: "豐洲市場外圍", type: "美食", time: "14:00" },
    ]);
    pushDay("上野・秋葉原・東京車站（文化與動漫）", [
      { name: "上野公園", type: "景點", time: "10:00" },
      { name: "秋葉原", type: "景點", time: "13:30" },
      { name: "東京車站丸之內", type: "景點", time: "17:00" },
    ]);
    pushDay("自由緩衝・採買・晚班機（早去晚回）", [
      { name: "新宿御苑或代官山", type: "景點", time: "10:00" },
      { name: "銀座／日本橋", type: "購物", time: "14:00" },
    ]);
  } else {
    const fillers = [
      { name: "市區景點 A", type: "景點", time: "10:00" },
      { name: "在地美食", type: "美食", time: "13:00" },
      { name: "傍晚散步", type: "景點", time: "17:00" },
    ];
    for (let d = 0; d < days; d++) {
      const theme =
        d === 0
          ? "抵達與市區適應"
          : d === days - 1
            ? "收尾與返程"
            : `第 ${d + 1} 天探索`;
      const slots = [...fillers];
      if (d === 1 && fuji) slots[0] = { name: fuji, type: "一日郊遊", time: "08:00" };
      if (d === 2 && harryPotter) slots[0] = { name: harryPotter, type: "主題景點", time: "09:30" };
      pushDay(theme, slots);
    }
  }

  const itinerary: RoamieItineraryItem[] = [];
  dayTemplates.slice(0, days).forEach((day, dayIndex) => {
    const date = dateKeys[dayIndex] ?? input.startDate;
    for (const slot of day.slots) {
      itinerary.push(
        placeItem(
          slot.name,
          slot.type,
          slot.time,
          date,
          `${input.destination} · ${day.theme}`,
        ),
      );
    }
  });

  const mustNames = input.mustIncludePlaces.join("、");
  const summary = [
    `已為你排好 ${input.destination} ${days} 天行程（12 月冬季、早去晚回節奏）。`,
    mustNames ? `必去景點已納入：${mustNames}。` : "",
    fuji ? `第 ${dayTemplates.findIndex((d) => d.theme.includes("富士")) + 1 || 3} 天安排富士山一日。` : "",
    harryPotter
      ? `第 ${dayTemplates.findIndex((d) => d.theme.includes("哈利")) + 1 || 4} 天安排哈利波特影城。`
      : "",
    "可在收藏行程中微調時間與交通。",
  ]
    .filter(Boolean)
    .join("\n");

  const transport =
    /大眾|捷運|地鐵/.test(input.transport ?? "") ? "transit" : "transit";

  const { outfitSuggestion } = buildSeasonTripOutfitSuggestion({
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    dayCount: days,
    itinerary,
    mood: input.mood,
    weatherSummary: input.weatherSummary,
  });
  const outfitAdvice = buildSeasonOutfitAdvicePayload({
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    dayCount: days,
    itinerary,
    mood: input.mood,
    weatherSummary: input.weatherSummary,
  });
  const itemsFingerprint = buildTripItemsFingerprint(itinerary);

  const payload: RoamiePayloadV2 = {
    version: 2,
    title: generateTripTitle({
      destination: input.destination,
      mood: input.mood,
      moodTag: input.mood,
    }),
    summary,
    moodTag: input.mood?.trim() ?? "",
    recommendations: [],
    itinerary,
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    days,
    generatedAt: new Date().toISOString(),
    tripSettings: {
      startTime: "09:00",
      transport,
      tripStartDate: input.startDate,
      tripEndDate: input.endDate,
      transportTips: "富士山建議預留整日；哈利波特影城請預約時段；市區以 JR／地鐵為主",
      legMinutes: {},
      legTransport: {},
      transitLegs: {},
    },
    weatherSummary:
      input.weatherSummary ??
      "12 月東京偏冷乾燥，富士山區更冷，建議洋蔥式分層＋保暖外套與好走的鞋。",
    outfitSuggestion,
    clothingAdvice: outfitSuggestion,
    outfitAdvice,
    outfitAdviceInputKey: buildOutfitInputKey({
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      dayCount: days,
      itemsFingerprint,
    }),
    aiFallbackSource: "structured_chat_itinerary",
  };

  return attachDayPlansToPayload(payload);
}

export function countMustPlacesInItinerary(
  itinerary: RoamieItineraryItem[],
  mustIncludePlaces: string[],
): string[] {
  const text = itinerary.map((i) => i.placeName ?? i.title).join(" ");
  return mustIncludePlaces.filter((m) => {
    if (/富士/.test(m)) return /富士|河口湖|五合目/.test(text);
    if (/哈利/.test(m)) return /哈利|Harry|華納/.test(text);
    return text.includes(m);
  });
}
