import { getOpenAIKey } from "@/lib/env.server";
import { mapOpenAIError } from "@/lib/ai/errors";
import type { DailyForecast } from "@/lib/weather.functions";
import { formatActivityTypesForPrompt, inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { RoamieItineraryItem } from "@/lib/ai/types";

export type OutfitAIItem = {
  date: string;
  outfitSummary: string;
  narrative: string;
  packingReminders: string[];
};

const OUTFIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dailyOutfits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", description: "YYYY-MM-DD，與輸入日期一致" },
          outfitSummary: { type: "string", description: "一行穿搭，如 短袖＋薄外套" },
          narrative: {
            type: "string",
            description: "2-3 句繁體中文，像旅伴提醒，有溫度，不要氣象播報口吻",
          },
          packingReminders: {
            type: "array",
            items: { type: "string" },
            description: "1-3 項攜帶提醒",
          },
        },
        required: ["date", "outfitSummary", "narrative", "packingReminders"],
      },
    },
  },
  required: ["dailyOutfits"],
} as const;

export type OutfitAIInput = {
  destination: string;
  fashionStyle?: string;
  mood?: string;
  days: {
    date: string;
    dayIndex: number;
    forecast: DailyForecast;
    activities: ReturnType<typeof inferActivityTypesFromDayItems>;
    scheduleSummary: string;
  }[];
};

function buildOutfitSystemPrompt(fashionStyle?: string): string {
  const styleBlock = fashionStyle?.trim()
    ? `使用者穿搭風格偏好：${fashionStyle.trim()}。請微調用詞與單品建議（如韓系簡約、日系層次、街頭休閒、文青亞麻、極簡素色），但不要變成時尚雜誌口吻。`
    : "無特定穿搭風格，以舒適、好走、符合天氣為主。";

  return `你是 Roamie，使用者的旅行穿搭夥伴。
${styleBlock}

規則：
- 只輸出一個 JSON 物件，符合 schema
- 語氣像貼心旅伴，有生活感與畫面感；禁止像氣象局播報（不要只列溫度數字）
- 必須參考【每日天氣數據】中的溫差、降雨、氣溫與【當日行程類型】
- 提及日夜溫差時要給具體建議（如晚上加外套）
- 下雨要提雨具與鞋款；登山健行要提鞋與機能；海邊要防曬；大量步行要舒適鞋
- outfitSummary 簡短（約 8–20 字），可用「＋」連接單品
- packingReminders 1-3 項，每項一句，可含 emoji 開頭如 ☔ 👟
- 每個 date 都要有一筆 dailyOutfits`;
}

function buildOutfitUserMessage(input: OutfitAIInput): string {
  const dayBlocks = input.days
    .map((d) => {
      const f = d.forecast;
      const diff =
        f.tempHighC != null && f.tempLowC != null
          ? Math.round(f.tempHighC - f.tempLowC)
          : null;
      return `【第 ${d.dayIndex} 天 ${d.date}】
天氣：${f.condition}；高溫 ${f.tempHighC ?? "?"}°C、低溫 ${f.tempLowC ?? "?"}°C${diff != null ? `；日夜溫差約 ${diff}°C` : ""}；降雨機率 ${f.precipProbability ?? "?"}%
行程類型：${formatActivityTypesForPrompt(d.activities)}
行程摘要：${d.scheduleSummary}`;
    })
    .join("\n\n");

  return `目的地：${input.destination}
${input.mood ? `旅行心情：${input.mood}` : ""}

請為以下每一天生成穿搭建議（JSON）：

${dayBlocks}`;
}

export async function callOutfitAI(input: OutfitAIInput): Promise<OutfitAIItem[]> {
  const apiKey = getOpenAIKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: 1200,
      temperature: 0.8,
      messages: [
        { role: "system", content: buildOutfitSystemPrompt(input.fashionStyle) },
        { role: "user", content: buildOutfitUserMessage(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roamie_outfit_advice",
          strict: true,
          schema: OUTFIT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw mapOpenAIError(response.status, err);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error("穿搭 AI 沒有回應");

  const parsed = JSON.parse(raw) as { dailyOutfits?: OutfitAIItem[] };
  return parsed.dailyOutfits ?? [];
}

export function buildScheduleSummary(items: RoamieItineraryItem[]): string {
  if (!items.length) return "（當日行程待安排）";
  return items
    .slice(0, 5)
    .map((i) => `${i.time} ${i.title}（${i.placeName}）`)
    .join(" → ");
}
