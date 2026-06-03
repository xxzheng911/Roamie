import { isStatementTimeoutError } from "@/lib/supabase-errors";

/** 使用者可讀：後端 / DB 暫時不可用 */
export const SUPABASE_UNAVAILABLE_USER_MSG =
  "雲端服務暫時無法連線，請稍後再試。";

/** build 內 Supabase 主機名無效或 DNS 無法解析（非 DB timeout） */
export const SUPABASE_HOST_UNREACHABLE_MSG =
  "無法連上 Supabase 伺服器（主機名稱無效）。請確認 .env 的 VITE_SUPABASE_URL 為 Dashboard → Project Settings → API 的 Project URL（https://專案代號.supabase.co），再執行 npm run cap:sync:ios 重新安裝 App。";

function readErrorMessage(error: unknown): { message: string; name?: string; status?: number } {
  if (error instanceof Error) {
    const o = error as { status?: number };
    return {
      message: error.message,
      name: error.name,
      status: typeof o.status === "number" ? o.status : undefined,
    };
  }
  if (typeof error === "string") return { message: error };
  return { message: String(error ?? "") };
}

/** iOS NSURLErrorCannotFindHost / AuthRetryableFetchError status 0 */
export function isSupabaseHostnameUnreachableError(error: unknown): boolean {
  const { message, name, status } = readErrorMessage(error);
  const lower = message.toLowerCase();
  if (
    /無法找到指定主機|找不到主機|hostname|host name|could not find.*host|unknown host|enotfound|err_name_not_resolved|dns/i.test(
      message,
    )
  ) {
    return true;
  }
  if (status === 0 && /AuthRetryableFetchError|FetchError/i.test(name ?? "")) {
    return /host|主機|network|fetch|伺服器/i.test(lower);
  }
  return false;
}

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
