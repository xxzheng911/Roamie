import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";

const CITY_DAY_OUTLINES: Record<string, string[]> = {
  雪梨: [
    "Day1 市區地標",
    "Day2 達令港＋岩石區",
    "Day3 邦代海灘",
    "Day4 藍山",
    "Day5 塔龍加動物園",
    "Day6 採買與市區散步",
  ],
  墨爾本: [
    "Day1 市區咖啡與塗鴉巷",
    "Day2 聯邦廣場＋雅拉河",
    "Day3 聖基爾達海灘",
    "Day4 大洋路一日遊",
    "Day5 維多利亞市場",
    "Day6 自由活動與採買",
  ],
};

function buildGenericDayOutline(destination: string, days: number): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= days; i += 1) {
    if (i === 1) lines.push(`Day${i} 市區地標`);
    else if (i === days) lines.push(`Day${i} 採買與市區散步`);
    else if (i === 2) lines.push(`Day${i} 美食與市區散策`);
    else lines.push(`Day${i} ${destination}近郊或特色區域`);
  }
  return lines;
}

function dayOutlineForCity(destination: string, days: number): string[] {
  const label = normalizeDestinationLabel(destination);
  const template = CITY_DAY_OUTLINES[label];
  if (template) {
    if (days <= template.length) return template.slice(0, days);
    return [
      ...template,
      ...buildGenericDayOutline(label, days - template.length).map((line, index) =>
        line.replace(/^Day\d+/, `Day${template.length + index + 1}`),
      ),
    ];
  }
  return buildGenericDayOutline(label, days);
}

export function pendingQuestionForCityPreference(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_preference",
    options: ["經典景點", "美食咖啡", "海灘放鬆", "都可以"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForAskDays(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_days",
    options: [],
    baseDestination,
    destinationCountry,
  });
}

export function buildCityDaysConfirmedReply(
  destination: string,
  days: number,
  destinationCountry?: string,
): { reply: string; pendingQuestion: PendingQuestion } {
  const label = normalizeDestinationLabel(destination);
  const outline = dayOutlineForCity(label, days);

  const reply = [
    "好，我先記下：",
    "",
    `目的地：${label}`,
    `天數：${days}天`,
    "",
    `${label} ${days} 天其實很舒服。`,
    "",
    "我通常會安排：",
    "",
    ...outline,
    "",
    "你比較偏：",
    "A. 經典景點",
    "B. 美食咖啡",
    "C. 海灘放鬆",
    "D. 都可以",
  ].join("\n");

  return {
    reply,
    pendingQuestion: pendingQuestionForCityPreference(label, destinationCountry),
  };
}
