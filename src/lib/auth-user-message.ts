import { logAuthError } from "@/lib/auth-debug";

const DEFAULT_SIGN_IN_MESSAGE = "登入未完成，請稍後再試一次。";

const SYSTEM_ERROR_RE =
  /AuthenticationServices|AuthorizationError|錯誤\s*1001|error\s*1001|com\.apple\./i;

/** 從 Apple / OAuth 錯誤物件擷取除錯用 code（僅 log，不顯示給使用者） */
export function extractAuthErrorDebugInfo(error: unknown): Record<string, string> {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const code = (error as { code?: string })?.code;
  const domain = (error as { domain?: string })?.domain;
  const appleCode = msg.match(/錯誤\s*(\d+)|error\s*(\d+)/i);
  return {
    message: msg,
    code: code ?? appleCode?.[1] ?? appleCode?.[2] ?? "",
    domain: domain ?? (SYSTEM_ERROR_RE.test(msg) ? "com.apple.AuthenticationServices" : ""),
  };
}

/** 將系統錯誤轉成使用者可讀訊息；完整錯誤只寫入 Xcode / console log */
export function sanitizeAuthErrorForUser(
  error: unknown,
  fallback = DEFAULT_SIGN_IN_MESSAGE,
): string {
  const debug = extractAuthErrorDebugInfo(error);
  if (debug.message || debug.code) {
    console.info("[AUTH_SIGN_IN_ERROR]", debug);
    logAuthError("sign_in.user_facing", error);
  }

  const raw = debug.message.trim();
  if (!raw) return fallback;

  if (SYSTEM_ERROR_RE.test(raw) || /無法完成作業/.test(raw)) {
    return fallback;
  }

  if (/apple_supabase_sign_in_timeout/i.test(raw)) {
    return "連線登入服務逾時，請確認網路後再試一次。";
  }

  if (/nonces?\s*mismatch/i.test(raw)) {
    return "登入驗證失敗，請稍後再試一次。";
  }

  const stripped = raw
    .replace(/\(com\.apple\.[^)]+\)/gi, "")
    .replace(/\(com\.google\.[^)]+\)/gi, "")
    .trim();

  if (!stripped || SYSTEM_ERROR_RE.test(stripped)) return fallback;
  if (/Apple 登入失敗：/i.test(stripped)) return fallback;
  if (/Supabase/i.test(stripped)) return fallback;

  return stripped.length > 120 ? fallback : stripped;
}

export { DEFAULT_SIGN_IN_MESSAGE };
