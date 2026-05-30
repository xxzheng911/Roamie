/** 依月份與目的地推斷季節、當地亮點與穿搭建議 */

export type TravelSeasonInfo = {
  month: number;
  seasonLabel: string;
  seasonHighlights: string[];
  climateNote?: string;
  outfitSuggestion?: string;
};

const MONTH_SEASON: Record<number, { label: string; defaultHighlights: string[] }> = {
  1: { label: "冬季", defaultHighlights: ["寒流", "年節"] },
  2: { label: "冬季", defaultHighlights: ["元宵", "早春"] },
  3: { label: "春季", defaultHighlights: ["櫻花季", "賞櫻"] },
  4: { label: "春季", defaultHighlights: ["晚櫻", "春遊"] },
  5: { label: "春季", defaultHighlights: ["新綠", "黃金週"] },
  6: { label: "夏季", defaultHighlights: ["梅雨季", "初夏"] },
  7: { label: "夏季", defaultHighlights: ["夏季祭典", "海邊"] },
  8: { label: "夏季", defaultHighlights: ["酷暑", "煙火"] },
  9: { label: "秋季", defaultHighlights: ["初秋", "中秋"] },
  10: { label: "秋季", defaultHighlights: ["楓葉季", "賞楓"] },
  11: { label: "秋季", defaultHighlights: ["楓葉季", "晚秋"] },
  12: { label: "冬季", defaultHighlights: ["聖誕", "雪季"] },
};

function clampMonth(m: number): number {
  if (m < 1) return ((m % 12) + 12) % 12 || 12;
  if (m > 12) return ((m - 1) % 12) + 1;
  return m;
}

export function parseMonthNumber(input?: {
  travelMonth?: string;
  startDate?: string;
  travelDate?: string;
  userText?: string;
  referenceDate?: Date;
}): number | undefined {
  const ref = input?.referenceDate ?? new Date();
  const text = input?.userText?.trim() ?? "";

  const monthMatch = input?.travelMonth?.match(/(\d{1,2})\s*月/);
  if (monthMatch) return clampMonth(Number.parseInt(monthMatch[1], 10));

  for (const iso of [input?.startDate, input?.travelDate]) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.getMonth() + 1;
  }

  const explicit = text.match(/(\d{1,2})\s*月/);
  if (explicit) return clampMonth(Number.parseInt(explicit[1], 10));

  if (/下個月|下个月/.test(text)) {
    const d = new Date(ref);
    d.setMonth(d.getMonth() + 1);
    return d.getMonth() + 1;
  }
  if (/這個月|这个月/.test(text)) return ref.getMonth() + 1;

  return undefined;
}

function destinationOverrides(
  destination: string | undefined,
  month: number,
): { highlights: string[]; climateNote?: string; outfit?: string } {
  const dest = destination?.trim() ?? "";
  const highlights: string[] = [];
  let climateNote: string | undefined;
  let outfit: string | undefined;

  const isJapan =
    /京都|大阪|東京|橫濱|名古屋|福岡|北海道|沖繩|奈良|神戶|廣島|金澤|札幌/.test(dest);
  const isKorea = /首爾|釜山|濟州|大邱|仁川/.test(dest);
  const isTaiwan = /台北|臺北|新北|台中|臺中|高雄|花蓮|台東|臺東|墾丁/.test(dest);

  if (month === 3 && isJapan) highlights.push("櫻花季");
  if ((month === 10 || month === 11) && (isJapan || isKorea)) highlights.push("楓葉季");
  if (month === 7 && /東京|大阪|京都/.test(dest)) highlights.push("夏季祭典");
  if ((month === 12 || month === 1 || month === 2) && /北海道|札幌/.test(dest)) {
    highlights.push("雪季", "滑雪");
    climateNote = "北海道冬季寒冷多雪";
    outfit = "羽絨外套、防風大衣、圍巾、手套、雪靴";
  }

  if (month === 11 && /釜山/.test(dest)) {
    climateNote = "11月釜山約 8–18°C，早晚偏涼、海風大，降雨不多";
    outfit = outfit ?? "薄長袖、防風外套、圍巾、好走的鞋";
    highlights.push("秋末海景", "市場美食");
  }

  if (month === 12 && /大阪|京都|東京|首爾|釜山/.test(dest)) {
    climateNote = climateNote ?? "12月偏冷乾燥，早晚溫差大";
    outfit = outfit ?? "羽絨外套或大衣、圍巾、保暖內層";
  }

  if ((month === 7 || month === 8) && (isJapan || isKorea || isTaiwan)) {
    climateNote = climateNote ?? "盛夏高溫潮濕";
    outfit = outfit ?? "透氣短袖、防曬、帽子、室內冷氣薄外套";
  }

  if (/(楓葉|賞楓|紅葉)/.test(dest) || month === 10 || month === 11) {
    if (isJapan || isKorea) highlights.push("楓葉季");
  }
  if (/(櫻花|賞櫻)/.test(dest) || month === 3 || month === 4) {
    if (isJapan) highlights.push("櫻花季");
  }

  return { highlights: [...new Set(highlights)], climateNote, outfit };
}

export function inferTravelSeason(input: {
  destination?: string;
  month?: number;
  userText?: string;
}): TravelSeasonInfo | undefined {
  const month = input.month;
  if (month == null || month < 1 || month > 12) return undefined;

  const base = MONTH_SEASON[month];
  const overrides = destinationOverrides(input.destination, month);
  const seasonHighlights = [
    ...new Set([...base.defaultHighlights, ...overrides.highlights]),
  ];

  if (/(楓葉|賞楓|紅葉)/.test(input.userText ?? "")) {
    seasonHighlights.unshift("楓葉季");
  }
  if (/(櫻花|賞櫻)/.test(input.userText ?? "")) {
    seasonHighlights.unshift("櫻花季");
  }

  return {
    month,
    seasonLabel: base.label,
    seasonHighlights: [...new Set(seasonHighlights)],
    climateNote: overrides.climateNote,
    outfitSuggestion: overrides.outfit,
  };
}

export function formatTravelSeasonForAi(info: TravelSeasonInfo | undefined): string {
  if (!info) return "";
  const lines = [
    `月份：${info.month}月`,
    `季節：${info.seasonLabel}`,
    `季節亮點：${info.seasonHighlights.join("、")}`,
  ];
  if (info.climateNote) lines.push(`氣候：${info.climateNote}`);
  if (info.outfitSuggestion) lines.push(`穿搭建議：${info.outfitSuggestion}`);
  return lines.join("\n");
}
