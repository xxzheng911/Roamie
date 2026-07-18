import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  parseMonthNumber,
  resolveTravelMonthLabel,
  stripUnrelatedSeasonInfo,
} from "@/lib/ai/season-response-guardrail";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { midMonthIsoDate } from "@/lib/ai/resolve-suggested-trip-dates";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

type ClimateBits = {
  climate: string;
  windowHint: string;
  weatherFacts: string;
  suggestedWindow: string;
};

/**
 * Destination + month seasonal highlights (flower season / festivals).
 * Prefer explicit city knowledge, then entity events, then climate-only fallback.
 * Never invent festivals when no reliable event exists.
 */
function seasonalHighlightsForMonth(
  label: string,
  monthNum: number | undefined,
): { highlights: string[]; travelWindowHint: string } | null {
  if (!monthNum) return null;

  // Explicit destination+month knowledge (priority over generic climate)
  const explicit: Array<{ match: RegExp; months: number[]; highlights: string[]; window: string }> = [
    {
      match: /東京|东京/,
      months: [11],
      highlights: ["楓葉季", "銀杏金黃"],
      window: "如果想看楓葉與銀杏，可以優先安排在 11 月中旬前後。",
    },
    {
      match: /東京|东京/,
      months: [10],
      highlights: ["初秋楓葉", "銀杏開始轉色"],
      window: "如果想趕上看初秋轉色，可以優先考慮 10 月中下旬。",
    },
    {
      match: /京都/,
      months: [11],
      highlights: ["楓葉季高峰", "紅葉名所與夜間點燈"],
      window: "如果想看楓葉，京都建議優先安排在 11 月中旬到下旬。",
    },
    {
      match: /京都/,
      months: [10],
      highlights: ["秋色漸濃", "初楓"],
      window: "如果想看初楓，可以優先考慮 10 月下旬起的山區與寺院。",
    },
    {
      match: /大阪/,
      months: [4],
      highlights: ["櫻花季", "春季祭典與公園花見"],
      window: "如果想看櫻花，大阪 4 月上中旬常是比較準的節奏。",
    },
    {
      match: /大阪/,
      months: [11],
      highlights: ["楓葉季"],
      window: "如果想看秋色，可以優先考慮 11 月中旬前後。",
    },
    {
      match: /北海道|札幌/,
      months: [2],
      highlights: ["札幌雪祭", "雪景與溫泉"],
      window: "如果想碰雪祭與雪景，建議先鎖定 2 月節日週邊再排動線。",
    },
    {
      match: /北海道|札幌/,
      months: [1, 12],
      highlights: ["雪景", "溫泉"],
      window: "如果想看雪與泡溫泉，可以優先安排在這段冬季，並預留交通緩衝。",
    },
    {
      match: /首爾|首尔/,
      months: [10],
      highlights: ["楓葉季"],
      window: "如果想賞楓，首爾 10 月中下旬氣氛通常最濃。",
    },
    {
      match: /首爾|首尔/,
      months: [11],
      highlights: ["晚秋楓葉"],
      window: "如果想趕上秋色尾聲，建議優先考慮 11 月中旬前。",
    },
    {
      match: /首爾|首尔/,
      months: [4],
      highlights: ["櫻花季"],
      window: "如果想看櫻花，4 月上中旬常有春季氣氛。",
    },
    {
      match: /台東|臺東/,
      months: [8, 9],
      highlights: ["金針花季"],
      window: "如果想看金針花，可以優先考慮這段花季高峰再排縱谷行程。",
    },
  ];

  for (const row of explicit) {
    if (row.match.test(label) && row.months.includes(monthNum)) {
      return { highlights: row.highlights, travelWindowHint: row.window };
    }
  }

  // Entity-backed events (Japan / Korea maple, sakura, etc.)
  try {
    const entity = resolveDestinationEntity(label);
    const events = (entity.seasonality.events ?? []).filter((e) =>
      (e.months ?? []).includes(monthNum),
    );
    if (events.length) {
      return {
        highlights: events.map((e) => e.label),
        travelWindowHint: `如果想碰上${events.map((e) => e.label).join("、")}，可優先考慮 ${monthNum} 月中旬前後。`,
      };
    }
  } catch {
    // ignore entity miss
  }

  return null;
}

const TAIWAN_CITY_RE =
  /台東|臺東|花蓮|台南|臺南|高雄|屏東|台中|臺中|台北|臺北|宜蘭|桃園|新竹|新北|基隆|苗栗|嘉義|雲林|彰化|南投|澎湖/;

/**
 * Historical / typical climate notes by month — NOT a live forecast for future months.
 * Always include at least one concrete cue (heat / rain / typhoon / humidity / diurnal range).
 */
function typicalClimateForMonth(
  label: string,
  monthNum: number | undefined,
  monthLabel: string,
): ClimateBits {
  if (!monthNum) {
    return {
      climate: `${label}在${monthLabel}時段的天氣會依年份略有不同，建議先用常見季節特性抓個大致感覺。`,
      windowHint: `若還沒有固定日期，可以先從${monthLabel}挑一段較順的連續日子，實際天氣再接近出發日確認。`,
      weatherFacts: "season_typical_variable",
      suggestedWindow: monthLabel,
    };
  }

  if (TAIWAN_CITY_RE.test(label) && monthNum >= 6 && monthNum <= 9) {
    const typhoonNote =
      monthNum === 8 || monthNum === 9 ? "偶爾也需留意颱風動向；" : "";
    const climate =
      monthNum === 9
        ? `${label} 9 月通常還是偏熱，白天可能有午後雷陣雨，戶外行程建議安排在早上或傍晚，也可以準備雨具。`
        : `${label} ${monthNum} 月通常偏熱濕悶，午後常有短暫雷陣雨；${typhoonNote}戶外行程建議排在早上或傍晚，並準備雨具。`;
    const suggestedWindow =
      monthNum === 9 ? "9 月中下旬" : `${monthNum} 月中下旬`;
    const windowHint =
      monthNum === 9
        ? "若想避開較悶熱的時段，可以優先考慮 9 月中下旬，但實際天氣仍要接近出發日再確認。"
        : `若想安排舒服一點的戶外行程，可以優先考慮 ${monthNum} 月中下旬，並先備好雨天備案。`;
    return {
      climate,
      windowHint,
      weatherFacts:
        monthNum === 9
          ? "hot,afternoon_thunderstorms"
          : `hot,afternoon_thunderstorms${monthNum >= 8 ? ",typhoon_risk" : ""}`,
      suggestedWindow,
    };
  }

  if (/北海道|札幌|富良野/.test(label) && (monthNum === 7 || monthNum === 8)) {
    return {
      climate: `${label} ${monthNum} 月通常屬於盛夏旅遊季，日間體感舒適，晚間也可能偏涼。`,
      windowHint: `若還沒定日期，可以先從 ${monthNum} 月中旬附近挑一段連續日子安排。`,
      weatherFacts: "mild_summer,cool_evenings",
      suggestedWindow: `${monthNum} 月中旬`,
    };
  }

  if (/北海道|札幌/.test(label) && (monthNum === 12 || monthNum <= 2)) {
    return {
      climate: `${label} ${monthNum} 月通常偏冷，可能有積雪；適合看雪景與溫泉，但交通建議預留緩衝。`,
      windowHint: `若還沒定日期，建議先鎖定 ${monthNum} 月中下旬挑一段較穩定的區間。`,
      weatherFacts: "cold,snow_possible",
      suggestedWindow: `${monthNum} 月中下旬`,
    };
  }

  if (/東京|大阪|京都|名古屋/.test(label) && (monthNum === 3 || monthNum === 4)) {
    return {
      climate: `${label} ${monthNum} 月白天通常回暖，早晚仍偏涼，日夜溫差較明顯；春季人潮也可能偏多。`,
      windowHint: `若還沒定日期，可以優先考慮 ${monthNum} 月中旬前後、避開週末尖峰。`,
      weatherFacts: "mild_days,cool_mornings,diurnal_range",
      suggestedWindow: `${monthNum} 月中旬`,
    };
  }

  if (/東京|大阪|京都|名古屋/.test(label) && (monthNum === 10 || monthNum === 11)) {
    return {
      climate: `${label} ${monthNum} 月通常較涼爽，降雨相對少，步行與戶外景點會比較舒服。`,
      windowHint: `若還沒定日期，可先從 ${monthNum} 月中旬挑一段、避開連假尖峰。`,
      weatherFacts: "cool,lower_rain",
      suggestedWindow: `${monthNum} 月中旬`,
    };
  }

  if (/釜山|首爾|濟州/.test(label) && (monthNum === 4 || monthNum === 5 || monthNum === 9 || monthNum === 10)) {
    return {
      climate: `${label} ${monthNum} 月體感通常較舒適，白天適合戶外，早晚可能稍涼。`,
      windowHint: `若還沒定日期，可以優先考慮 ${monthNum} 月中下旬。`,
      weatherFacts: "comfortable,cool_edges",
      suggestedWindow: `${monthNum} 月中下旬`,
    };
  }

  if (monthNum >= 6 && monthNum <= 8) {
    return {
      climate: `${label} ${monthNum} 月通常偏熱，也可能有午後短暫雨；戶外行程建議穿插室內或樹蔭停留。`,
      windowHint: `若想安排舒服一點的行程，可以優先考慮 ${monthNum} 月中下旬出發。`,
      weatherFacts: "hot,afternoon_rain",
      suggestedWindow: `${monthNum} 月中下旬`,
    };
  }

  if (monthNum === 12 || monthNum <= 2) {
    if (/釜山/.test(label)) {
      return {
        climate: `${label} ${monthNum} 月通常偏冷，海邊風勢也會比較明顯，建議準備保暖、防風的衣物。`,
        windowHint: `若還沒定日期，可以先從 ${monthNum} 月中旬挑一段較順的區間。`,
        weatherFacts: "cold,coastal_wind",
        suggestedWindow: `${monthNum} 月中旬`,
      };
    }
    if (/濟州/.test(label)) {
      return {
        climate: `${label} ${monthNum} 月通常偏冷，風勢也可能較明顯，建議準備保暖層。`,
        windowHint: `若還沒定日期，可以先從 ${monthNum} 月中旬挑一段較順的區間。`,
        weatherFacts: "cold,windy",
        suggestedWindow: `${monthNum} 月中旬`,
      };
    }
    return {
      climate: `${label} ${monthNum} 月通常偏冷，早晚溫差可能較大，建議準備保暖層。`,
      windowHint: `若還沒定日期，可以先從 ${monthNum} 月中旬挑一段較順的區間。`,
      weatherFacts: "cold,diurnal_range",
      suggestedWindow: `${monthNum} 月中旬`,
    };
  }

  // Spring / late autumn fallback — concrete but not invented festivals
  if (monthNum >= 3 && monthNum <= 5) {
    return {
      climate: `${label} ${monthNum} 月白天通常回暖，早晚仍可能偏涼，偶有短暫降雨。`,
      windowHint: `若還沒定日期，可以優先考慮 ${monthNum} 月中旬前後。`,
      weatherFacts: "mild,occasional_rain,cool_edges",
      suggestedWindow: `${monthNum} 月中旬`,
    };
  }

  return {
    climate: `${label} ${monthNum} 月通常體感較舒適，偶有短暫降雨，白天適合安排戶外活動。`,
    windowHint: `若還沒定日期，可以優先考慮 ${monthNum} 月中旬；實際天氣仍建議接近出發日再確認。`,
    weatherFacts: "mild,occasional_rain",
    suggestedWindow: `${monthNum} 月中旬`,
  };
}

export type ScenicMonthPlanningResult = {
  reply: string;
  /** AI-suggested mid-month start (YYYY-MM-DD) when month is known. */
  suggestedStartDate?: string;
};

/**
 * Reply structure: weather → optional flower/festival → travel tip → ask date/days.
 */
export function buildScenicMonthPlanningReply(params: {
  destination: string;
  context: CanonicalTravelContext;
  userText: string;
  weather?: WeatherSummary | null;
}): string {
  return buildScenicMonthPlanningResult(params).reply;
}

export function buildScenicMonthPlanningResult(params: {
  destination: string;
  context: CanonicalTravelContext;
  userText: string;
  weather?: WeatherSummary | null;
}): ScenicMonthPlanningResult {
  const label = normalizeDestinationLabel(params.destination);
  const monthLabel = resolveTravelMonthLabel(params.context, params.userText);
  const monthNum = parseMonthNumber(params.context.travelMonth);
  const bits = typicalClimateForMonth(label, monthNum, monthLabel);
  const seasonal = seasonalHighlightsForMonth(label, monthNum);
  const hasExactDate =
    Boolean(params.context.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(params.context.startDate!.trim()) &&
    Boolean(params.context.endDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(params.context.endDate!.trim());

  logAiPipeline(
    "[SEASONAL_REPLY_STAGE]",
    `destination=${label}`,
    `month=${monthNum ?? "unknown"}`,
    `hasExactDate=${hasExactDate}`,
  );

  const lines: string[] = [bits.climate, ""];
  let seasonalEvent = "none";

  if (seasonal?.highlights.length) {
    seasonalEvent = seasonal.highlights.join("、");
    lines.push(`這個月份也常碰上：${seasonalEvent}。`);
    lines.push("");
    lines.push(seasonal.travelWindowHint);
  } else {
    lines.push(bits.windowHint);
  }

  lines.push("");
  lines.push("你目前有預計的旅行日期或天數嗎？");

  logAiPipeline(
    "[SEASONAL_REPLY_CONTENT]",
    `weatherFacts=${bits.weatherFacts}`,
    `seasonalEvent=${seasonalEvent}`,
    `suggestedWindow=${bits.suggestedWindow}`,
  );

  const body = lines.join("\n");
  const suggestedStartDate = monthNum ? midMonthIsoDate(monthNum) : undefined;

  return {
    reply: stripUnrelatedSeasonInfo(body, monthNum, false),
    suggestedStartDate,
  };
}

/** Full YYYY-MM-DD only — refuse incomplete month strings like 2026-09 */
export function isCompleteTripCalendarDate(value?: string | null): boolean {
  if (!value?.trim()) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * Country + month: seasonal note then ask which city/region — never ask days
 * or run Places at country level.
 *
 * @deprecated Prefer buildCountryCitySelectionReply in destination-advice.ts —
 * kept for callers that still assemble city question lines separately.
 */
export function buildCountryMonthCityAskResult(params: {
  country: string;
  context: CanonicalTravelContext;
  userText: string;
  cityQuestionLines: string[];
}): ScenicMonthPlanningResult {
  const label = normalizeDestinationLabel(params.country);
  const monthLabel = resolveTravelMonthLabel(params.context, params.userText);
  const monthNum = parseMonthNumber(params.context.travelMonth);
  const bits = typicalClimateForMonth(label, monthNum, monthLabel);
  const seasonal = seasonalHighlightsForMonth(label, monthNum);

  logAiPipeline(
    "[SEASONAL_REPLY_STAGE]",
    `destination=${label}`,
    `type=country`,
    `month=${monthNum ?? "unknown"}`,
    "ask=city",
  );
  logAiPipeline(
    "[COUNTRY_REPLY_GENERIC_MONTH_TEMPLATE_BLOCKED]",
    `country=${label}`,
    "reason=legacy_builder_no_date_window",
  );

  const lines: string[] = [];
  // Soft country climate — avoid claiming the entire country shares one microclimate.
  // Never suggest a precise mid-month window at country level.
  if (monthNum) {
    lines.push(
      `${label} ${monthNum} 月通常體感較舒適，不同城市的氣候與季節景色可能會有差異。`,
    );
  } else {
    lines.push(bits.climate);
  }
  lines.push("");

  if (seasonal?.highlights.length) {
    lines.push(
      `這個月份部分地區也可能碰上：${seasonal.highlights.join("、")}。實際時間會依城市略有不同。`,
    );
    lines.push("");
  }

  for (const line of params.cityQuestionLines) {
    if (line.trim()) lines.push(line);
  }

  const body = lines.join("\n");
  return {
    reply: stripUnrelatedSeasonInfo(body, monthNum, false),
    // Do not suggest a country-level mid-month start date.
    suggestedStartDate: undefined,
  };
}
