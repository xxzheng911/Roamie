import { isStatementTimeoutError } from "@/lib/supabase-errors";

/** 使用者可讀：後端 / DB 暫時不可用 */
export const SUPABASE_UNAVAILABLE_USER_MSG =
  "雲端服務暫時無法連線，請稍後再試。";

/**
 * PostgREST / Auth / Dashboard 常見連線與 statement timeout 訊息。
 */
export function isSupabaseConnectivityError(error: unknown): boolean {
  if (isStatementTimeoutError(error)) return true;
  const msg =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : String(error ?? "");
  const lower = msg.toLowerCase();
  return (
    /connection terminated|connection timeout|connectivity|failed to retrieve/i.test(
      msg,
    ) ||
    /要求逾時|連線.*逾時|暫時無法連線/i.test(msg) ||
    /apple_supabase_sign_in_timeout|capacitor_http_js_cap/i.test(lower) ||
    /502|503|504|520|521|522|523|524/.test(lower) ||
    /fetch is aborted|failed to fetch|network/i.test(lower)
  );
}

export function userMessageForSupabaseError(
  error: unknown,
  fallback = SUPABASE_UNAVAILABLE_USER_MSG,
): string {
  if (isSupabaseConnectivityError(error)) return fallback;
  return error instanceof Error ? error.message : fallback;
}
