import { getOpenAIKey } from "@/lib/env.server";
import type { TransitLegAdvice, TransitPreferences } from "@/lib/transit/types";

/**
 * 以 AI 潤飾每段交通建議理由（保留 mode / 時間，只改 reason 與 headline）
 */
export async function enrichTransitLegsWithAI(
  legs: TransitLegAdvice[],
  ctx: {
    destination?: string;
    preferences?: TransitPreferences;
    summary?: string;
  },
): Promise<TransitLegAdvice[]> {
  if (legs.length === 0) return legs;

  const apiKey = getOpenAIKey();
  const payload = {
    destination: ctx.destination ?? "",
    preferences: ctx.preferences ?? {},
    legs: legs.map((l) => ({
      legKey: l.legKey,
      from: l.fromName,
      to: l.toName,
      mode: l.recommendedMode,
      minutes: l.durationMinutes,
      distanceM: l.distanceMeters,
      complexity: l.complexity,
      draftReason: l.reason,
    })),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.6,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "transit_legs",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              legs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    legKey: { type: "string" },
                    headline: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["legKey", "headline", "reason"],
                },
              },
            },
            required: ["legs"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "你是 Roamie 旅伴，專門給台灣使用者點對點交通建議。輸出繁體中文。語氣像朋友提醒，不要像客服公報。綜合國家城市特性（日韓地鐵複雜、京都公車易塞車、曼谷尖峰壅塞）。不要只重複 Google 路線，要給體驗判斷。每段 reason 1-2 句，headline 含交通方式與約略分鐘。",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!res.ok) {
    console.warn("[Roamie Transit AI] failed", res.status);
    return legs;
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) return legs;

  try {
    const parsed = JSON.parse(text) as {
      legs: Array<{ legKey: string; headline: string; reason: string }>;
    };
    const map = new Map(parsed.legs.map((x) => [x.legKey, x]));
    return legs.map((l) => {
      const ai = map.get(l.legKey);
      if (!ai) return l;
      return { ...l, headline: ai.headline, reason: ai.reason, source: "ai" as const };
    });
  } catch {
    return legs;
  }
}
