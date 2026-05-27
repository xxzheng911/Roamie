/** Server-only env helpers (never import from client components). */

import { isPlaceholderSecret, resolveServerEnv } from "@/lib/load-env.server";
import { readGoogleMapsKeyFromServerEnv } from "@/lib/google-maps-key-resolve.server";
import { requireOpenWeatherApiKey } from "@/lib/openweather-key-resolve.server";

export function resolveGoogleMapsKey(): string | undefined {
  return readGoogleMapsKeyFromServerEnv() ?? undefined;
}

export function getOpenAIKey(): string {
  const resolved = resolveServerEnv("OPENAI_API_KEY");

  if (!resolved) {
    console.error(
      "[Roamie AI] OPENAI_API_KEY not found. Sources checked: process.env, .env, .dev.vars. " +
        "Run: npm run sync:env then restart npm run dev",
    );
    throw new Error(
      "OPENAI_API_KEY 尚未載入。請確認 .env 已設定，執行 npm run sync:env 後重啟 dev server。",
    );
  }

  const apiKey = resolved.value;
  if (isPlaceholderSecret(apiKey)) {
    console.error(
      "[Roamie AI] OPENAI_API_KEY is a placeholder from",
      resolved.source,
      "prefix:",
      apiKey.slice(0, 10) + "…",
    );
    throw new Error(
      "OPENAI_API_KEY 仍是佔位符。請更新 .env 後執行 npm run sync:env 並重啟 npm run dev。",
    );
  }
  if (!apiKey.startsWith("sk-")) {
    console.error("[Roamie AI] OPENAI_API_KEY invalid format from", resolved.source);
    throw new Error("OPENAI_API_KEY 格式不正確，應以 sk- 開頭");
  }

  console.info("[Roamie AI] OPENAI_API_KEY loaded from", resolved.source, "prefix:", apiKey.slice(0, 12) + "…");
  return apiKey;
}

/** @deprecated 使用 requireOpenWeatherApiKey；保留別名供既有 import */
export function getOpenWeatherApiKey(): string {
  return requireOpenWeatherApiKey();
}
