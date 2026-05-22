import { z } from "zod";
import { getOpenAIKey } from "@/lib/env.server";
import type { RoamieRequestContext } from "./context";
import { buildSystemPrompt, buildUserMessage } from "./prompts";
import { mapOpenAIError, toError } from "./errors";
import { enrichRoamieResponse } from "@/lib/enrich-roamie-places.server";
import { ROAMIE_JSON_SCHEMA, normalizeRoamieResponse, type RoamieResponse } from "./types";

const PlaceItemSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    description: z.string().optional(),
    reason: z.string().optional(),
    estimatedTime: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    googleMapsUrl: z.string().optional(),
    placeName: z.string().optional(),
    reasonSource: z.enum(["template", "ai"]).optional(),
  })
  .transform((raw) => ({
    name: raw.name,
    type: raw.type ?? "地點",
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: raw.placeName ?? raw.name,
    reasonSource: raw.reasonSource ?? "template",
  }));

const RequestSchema = z.object({
  mode: z.enum(["chat", "recommend", "itinerary"]),
  mood: z.string().max(120).optional(),
  preferences: z.record(z.unknown()).optional(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      city: z.string().optional(),
    })
    .optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
  chatInput: z.string().max(4000).optional(),
  chatPhase: z
    .enum([
      "discover",
      "recommend",
      "followup",
      "collect",
      "ready",
      "enrich",
      "handoff",
      "expand",
      "confirm",
    ])
    .optional(),
  recommendedPlaces: z.array(PlaceItemSchema).max(20).optional(),
  focusedPlace: PlaceItemSchema.optional(),
  selectedPlaces: z.array(PlaceItemSchema).max(20).optional(),
  planningHints: z
    .object({
      transportation: z.string().max(120).optional(),
      budget: z.string().max(120).optional(),
      pace: z.string().max(80).optional(),
      travelDate: z.string().max(40).optional(),
      startTime: z.string().max(20).optional(),
      endTime: z.string().max(20).optional(),
      conversationSummary: z.string().max(2000).optional(),
    })
    .optional(),
  recentRecommendationNames: z.array(z.string().max(200)).max(50).optional(),
  savedPlaceNames: z.array(z.string().max(200)).max(50).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(40)
    .optional(),
  itineraryRequest: z
    .object({
      destination: z.string().min(1).max(100),
      days: z.number().int().min(1).max(14),
      budget: z.enum(["low", "medium", "high"]),
      style: z.string().max(120).optional(),
      mood: z.string().max(120).optional(),
      startDate: z.string().max(40).optional(),
      endDate: z.string().max(40).optional(),
      origin: z.string().max(120).optional(),
      travelers: z.number().int().min(1).max(20).optional(),
      transport: z.string().max(120).optional(),
      selectedPlaces: z.array(PlaceItemSchema).max(20).optional(),
      interests: z.string().max(2000).optional(),
    })
    .optional(),
});

export function parseRoamieRequest(body: unknown): RoamieRequestContext {
  const data = RequestSchema.parse(body);
  return data as RoamieRequestContext;
}

export async function callRoamieAI(ctx: RoamieRequestContext): Promise<RoamieResponse> {
  const apiKey = getOpenAIKey();
  console.info("[Roamie AI] call", { mode: ctx.mode, hasKey: !!apiKey, keyPrefix: apiKey.slice(0, 7) });
  const system = buildSystemPrompt(ctx);
  const user = buildUserMessage(ctx);
  const maxTokens = ctx.mode === "itinerary" ? 2800 : 900;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: maxTokens,
      temperature: 0.85,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roamie_response",
          strict: true,
          schema: ROAMIE_JSON_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    throw toError(await mapOpenAIError(response));
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 回應格式錯誤，請再試一次。");

  const parsed = normalizeRoamieResponse(JSON.parse(content) as Record<string, unknown>);
  return enrichRoamieResponse(parsed, ctx);
}

/** Stream raw JSON text chunks (OpenAI SSE). */
export function streamRoamieAI(ctx: RoamieRequestContext): {
  stream: ReadableStream<Uint8Array>;
  getAssembled: () => Promise<string>;
} {
  const apiKey = getOpenAIKey();
  const system = buildSystemPrompt(ctx);
  const user = buildUserMessage(ctx);
  const maxTokens = ctx.mode === "itinerary" ? 2800 : 900;

  let assembled = "";
  let resolveAssembly!: (v: string) => void;
  const assemblyDone = new Promise<string>((res) => {
    resolveAssembly = res;
  });

  const upstreamPromise = fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: maxTokens,
      temperature: 0.85,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roamie_response",
          strict: true,
          schema: ROAMIE_JSON_SCHEMA,
        },
      },
    }),
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const upstream = await upstreamPromise;
        if (!upstream.ok || !upstream.body) {
          const detail = await mapOpenAIError(upstream);
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error: detail.message, code: detail.code, status: detail.status })}\n\n`,
            ),
          );
          controller.close();
          resolveAssembly("");
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assembled += delta;
                controller.enqueue(
                  encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`),
                );
              }
            } catch {
              /* partial line */
            }
          }
        }

        let finalPayload = assembled;
        if (assembled.trim()) {
          try {
            const parsed = normalizeRoamieResponse(JSON.parse(assembled) as Record<string, unknown>);
            const enriched = await enrichRoamieResponse(parsed, ctx);
            finalPayload = JSON.stringify(enriched);
            controller.enqueue(
              encoder.encode(`event: final\ndata: ${JSON.stringify(enriched)}\n\n`),
            );
          } catch (e) {
            console.warn("[Roamie AI] enrich after stream failed", e);
          }
        }

        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
        resolveAssembly(finalPayload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI 服務暫時無法使用";
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`),
        );
        controller.close();
        resolveAssembly("");
      }
    },
  });

  return { stream, getAssembled: () => assemblyDone };
}

export function validateAssembledJson(raw: string): RoamieResponse {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("AI 沒有回應，請再試一次。");
  return normalizeRoamieResponse(JSON.parse(trimmed) as Record<string, unknown>);
}

