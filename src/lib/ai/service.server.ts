import { z } from "zod";
import { getOpenAIKey } from "@/lib/env.server";
import type { RoamieRequestContext } from "./context";
import { buildSystemPrompt, buildUserMessage } from "./prompts";
import { mapOpenAIError, toError } from "./errors";
import { enrichRoamieResponse } from "@/lib/enrich-roamie-places.server";
import { mergeAiWithVerifiedCandidates } from "@/lib/recommendation/merge-verified.server";
import { preparePlacesFirstContext } from "@/lib/recommendation/pipeline.server";
import { buildRuleBasedRecommendSummary } from "@/lib/recommendation/fallback-summary";
import { ROAMIE_JSON_SCHEMA, normalizeRoamieResponse, type RoamieResponse } from "./types";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { mergeBoundsForStage, stageAllowsPlacesFirst } from "@/lib/ai/conversation-stage";

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
    reasonSource: z.enum(["template", "ai", "evidence", "fallback"]).optional(),
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
      fromMoodCard: z.boolean().optional(),
      fromMoodFlow: z.boolean().optional(),
      selectedMood: z.string().max(120).optional(),
      selectedCategory: z.string().max(120).optional(),
      initialChatContext: z.string().max(4000).optional(),
      lateNightMode: z.boolean().optional(),
      avoidTypes: z.array(z.string().max(80)).max(12).optional(),
      preferredArea: z.string().max(80).optional(),
      rejectedPlaceNames: z.array(z.string().max(120)).max(20).optional(),
      lastUserIntent: z.string().max(400).optional(),
    })
    .optional(),
  recentRecommendationNames: z.array(z.string().max(200)).max(50).optional(),
  savedPlaceNames: z.array(z.string().max(200)).max(50).optional(),
  fromMoodCard: z.boolean().optional(),
  fromMoodFlow: z.boolean().optional(),
  selectedMood: z.string().max(120).optional(),
  selectedCategory: z.string().max(120).optional(),
  initialChatContext: z.string().max(4000).optional(),
  lateNightMode: z.boolean().optional(),
  avoidTypes: z.array(z.string().max(80)).max(12).optional(),
  preferredArea: z.string().max(80).optional(),
  rejectedPlaceNames: z.array(z.string().max(120)).max(20).optional(),
  lastUserIntent: z.string().max(400).optional(),
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
      selectedCombinationIds: z.array(z.number().int().positive()).max(10).optional(),
      interests: z.string().max(2000).optional(),
    })
    .optional(),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  planTier: z.enum(["free", "plus"]).optional(),
  conversationStage: z
    .enum(["empathize", "infer", "clarify", "converge", "recommend", "itinerary"])
    .optional(),
});

export function parseRoamieRequest(body: unknown): RoamieRequestContext {
  const data = RequestSchema.parse(body);
  return data as RoamieRequestContext;
}

function shouldUsePlacesFirst(ctx: RoamieRequestContext): boolean {
  if (ctx.mode === "recommend") return true;
  if (ctx.mode !== "chat") return false;
  if (ctx.conversationStage) {
    return stageAllowsPlacesFirst(ctx.conversationStage);
  }
  const phase = ctx.chatPhase;
  if (!phase) return false;
  if (phase === "discover" || phase === "confirm" || phase === "ready") return false;
  return true;
}

function mergeOptionsForContext(ctx: RoamieRequestContext) {
  const profile = {
    profileTier: ctx.planTier ?? "free",
    profileOnboarded: ctx.planTier === "plus" && ctx.preferences?.onboarded === true,
  } as const;
  if (ctx.conversationStage) {
    return { ...mergeBoundsForStage(ctx.conversationStage), ...profile };
  }
  if (ctx.mode === "chat") {
    return { minCount: 2, maxCount: 4, ...profile };
  }
  return { minCount: 3, maxCount: 5, ...profile };
}

async function withPlacesFirstPrep(ctx: RoamieRequestContext) {
  if (!shouldUsePlacesFirst(ctx)) {
    return {
      ctx,
      candidates: [] as Awaited<ReturnType<typeof preparePlacesFirstContext>>["candidates"],
    };
  }
  return preparePlacesFirstContext(ctx);
}

export async function callRoamieAI(ctx: RoamieRequestContext): Promise<RoamieResponse> {
  const prep = await withPlacesFirstPrep(ctx);
  ctx = prep.ctx;
  const apiKey = getOpenAIKey();
  logAiPipeline("[Roamie AI] call", {
    mode: ctx.mode,
    hasKey: !!apiKey,
    keyPrefix: apiKey.slice(0, 7),
  });
  const system = buildSystemPrompt(ctx);
  const user = buildUserMessage(ctx);
  const lateNightRecommend =
    ctx.mode === "recommend" &&
    ctx.lateNightMode &&
    /深夜散步|夜晚探索|深夜|想放空/.test(ctx.mood ?? ctx.selectedMood ?? "");
  const maxTokens = ctx.mode === "itinerary" ? 2800 : lateNightRecommend ? 1400 : 900;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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

  let parsed = normalizeRoamieResponse(JSON.parse(content) as Record<string, unknown>);

  if (prep.candidates.length) {
    parsed = mergeAiWithVerifiedCandidates(parsed, prep.candidates, mergeOptionsForContext(ctx));
  } else if (shouldUsePlacesFirst(ctx)) {
    parsed = {
      ...parsed,
      recommendations: [],
      summary:
        parsed.summary?.trim() || buildRuleBasedRecommendSummary(ctx, prep.candidates.length === 0),
    };
  }

  return enrichRoamieResponse(parsed, ctx);
}

/** Stream raw JSON text chunks (OpenAI SSE). */
export const CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS = 25_000;
export const CHAT_STREAM_OVERALL_TIMEOUT_MS = 55_000;

export function streamRoamieAI(
  initialCtx: RoamieRequestContext,
  options?: {
    signal?: AbortSignal;
    requestId?: string;
    onComplete?: (result: {
      assembled: string;
      success: boolean;
      failureReason: string;
    }) => Promise<void> | void;
  },
): {
  stream: ReadableStream<Uint8Array>;
  getAssembled: () => Promise<string>;
} {
  let assembled = "";
  let resolveAssembly!: (v: string) => void;
  const assemblyDone = new Promise<string>((res) => {
    resolveAssembly = res;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const requestId = options?.requestId ?? crypto.randomUUID();
      const startedAt = Date.now();
      let completionCalled = false;
      const complete = async (
        result: { assembled: string; success: boolean; failureReason: string },
      ) => {
        if (completionCalled) return;
        completionCalled = true;
        try {
          await options?.onComplete?.(result);
        } catch (error) {
          console.error(
            "[CHAT_STREAM_COMPLETION] failed",
            error instanceof Error ? error.message : "unknown_error",
          );
        }
      };
      const upstreamAbort = new AbortController();
      let firstByteReceived = false;
      let providerStatus = 0;
      let timeoutReason = "";
      const abortFromClient = () => upstreamAbort.abort(options?.signal?.reason);
      options?.signal?.addEventListener("abort", abortFromClient, { once: true });
      const overallTimer = setTimeout(() => {
        timeoutReason = "overall_timeout";
        upstreamAbort.abort(new Error(timeoutReason));
      }, CHAT_STREAM_OVERALL_TIMEOUT_MS);
      const firstByteTimer = setTimeout(() => {
        if (!firstByteReceived) {
          timeoutReason = "first_byte_timeout";
          upstreamAbort.abort(new Error(timeoutReason));
        }
      }, CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS);
      let bytesWritten = 0;
      const enqueue = (text: string) => {
        const encoded = encoder.encode(text);
        bytesWritten += encoded.byteLength;
        controller.enqueue(encoded);
      };
      try {
        const prep = await withPlacesFirstPrep(initialCtx);
        let ctx = prep.ctx;
        const apiKey = getOpenAIKey();
        const system = buildSystemPrompt(ctx);
        const user = buildUserMessage(ctx);
        const lateNightRecommend =
          ctx.mode === "recommend" &&
          ctx.lateNightMode &&
          /深夜散步|夜晚探索|深夜|想放空/.test(ctx.mood ?? ctx.selectedMood ?? "");
        const maxTokens = ctx.mode === "itinerary" ? 2800 : lateNightRecommend ? 1400 : 900;

        console.info("[CHAT_API_OPENAI]", { requestId, started: true, firstByteReceived: false, completed: false, aborted: false, durationMs: 0, providerStatus: 0 });
        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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
          signal: upstreamAbort.signal,
        });
        providerStatus = upstream.status;

        if (!upstream.ok || !upstream.body) {
          const detail = await mapOpenAIError(upstream);
          enqueue(`event: error\ndata: ${JSON.stringify({ error: detail.message, code: detail.code, status: detail.status })}\n\n`);
          await complete({
            assembled: "",
            success: false,
            failureReason: detail.code ?? "provider_error",
          });
          controller.close();
          resolveAssembly("");
          console.info("[CHAT_API_OPENAI]", { requestId, started: true, firstByteReceived, completed: true, aborted: false, durationMs: Date.now() - startedAt, providerStatus });
          console.info("[CHAT_API_RESPONSE]", { requestId, status: 200, contentType: "text/event-stream", bytesWritten, streamClosedNormally: true, failureReason: detail.code ?? "provider_error" });
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstByteReceived) {
            firstByteReceived = true;
            clearTimeout(firstByteTimer);
            console.info("[CHAT_API_OPENAI]", { requestId, started: true, firstByteReceived: true, completed: false, aborted: false, durationMs: Date.now() - startedAt, providerStatus });
          }
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
                enqueue(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
              }
            } catch {
              /* partial line */
            }
          }
        }

        let finalPayload = assembled;
        if (assembled.trim()) {
          try {
            let parsed = normalizeRoamieResponse(JSON.parse(assembled) as Record<string, unknown>);
            if (prep.candidates.length) {
              parsed = mergeAiWithVerifiedCandidates(
                parsed,
                prep.candidates,
                mergeOptionsForContext(ctx),
              );
            } else if (shouldUsePlacesFirst(ctx)) {
              parsed = {
                ...parsed,
                recommendations: [],
                summary:
                  parsed.summary?.trim() ||
                  buildRuleBasedRecommendSummary(ctx, prep.candidates.length === 0),
              };
            }
            const enriched = await enrichRoamieResponse(parsed, ctx);
            finalPayload = JSON.stringify(enriched);
            enqueue(`event: final\ndata: ${JSON.stringify(enriched)}\n\n`);
          } catch (e) {
            console.warn("[Roamie AI] enrich after stream failed", e);
          }
        }

        if (!assembled.trim()) {
          enqueue(`event: error\ndata: ${JSON.stringify({ error: "AI 服務未回傳內容。", code: "provider_empty_stream" })}\n\n`);
        } else {
          enqueue(`event: done\ndata: {}\n\n`);
        }
        await complete({
          assembled: finalPayload,
          success: Boolean(assembled.trim()),
          failureReason: assembled.trim() ? "" : "empty_response",
        });
        controller.close();
        resolveAssembly(finalPayload);
        console.info("[CHAT_API_OPENAI]", { requestId, started: true, firstByteReceived, completed: true, aborted: false, durationMs: Date.now() - startedAt, providerStatus });
        console.info("[CHAT_API_RESPONSE]", { requestId, status: 200, contentType: "text/event-stream", bytesWritten, streamClosedNormally: true, failureReason: assembled.trim() ? "" : "provider_empty_stream" });
      } catch (e) {
        const aborted = upstreamAbort.signal.aborted;
        const code = timeoutReason || (options?.signal?.aborted ? "client_abort" : "provider_error");
        const msg = aborted ? "AI 回應逾時，請再試一次。" : e instanceof Error ? e.message : "AI 服務暫時無法使用";
        await complete({ assembled: "", success: false, failureReason: code });
        try {
          enqueue(`event: error\ndata: ${JSON.stringify({ error: msg, code })}\n\n`);
          controller.close();
        } catch {
          // Client may already have disconnected; credit settlement still observes empty assembly.
        }
        resolveAssembly("");
        console.info("[CHAT_API_OPENAI]", { requestId, started: true, firstByteReceived, completed: false, aborted, durationMs: Date.now() - startedAt, providerStatus });
        console.info("[CHAT_API_RESPONSE]", { requestId, status: 200, contentType: "text/event-stream", bytesWritten, streamClosedNormally: !options?.signal?.aborted, failureReason: code });
      } finally {
        clearTimeout(firstByteTimer);
        clearTimeout(overallTimer);
        options?.signal?.removeEventListener("abort", abortFromClient);
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
