/** Server-only env helpers (never import from client components). */

import { isPlaceholderSecret, resolveServerEnv } from "@/lib/load-env.server";

export function resolveGoogleMapsKey(): string | undefined {
  const resolved =
    resolveServerEnv("GOOGLE_MAPS_API_KEY") ?? resolveServerEnv("VITE_GOOGLE_MAPS_API_KEY");
  return resolved?.value;
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
