import {
  isSupabaseHostnameUnreachableError,
  SUPABASE_HOST_UNREACHABLE_MSG,
} from "@/lib/supabase-connectivity";
import { diagnoseSupabaseUrlForNativeBuild } from "@/lib/supabase-project-url";

/** 從 Supabase Auth / fetch 錯誤抽出可記錄的 code / status（不含 token） */

export type AppleAuthErrorDetail = {
  message: string;
  code?: string;
  status?: number;
  name?: string;
};

export function describeAuthError(error: unknown): AppleAuthErrorDetail {
  if (error == null) {
    return { message: "(null)" };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error instanceof Error) {
    const o = error as { code?: string | number; status?: number };
    return {
      message: error.message || "(no message)",
      name: error.name,
      code:
        typeof o.code === "string"
          ? o.code
          : typeof o.code === "number"
            ? String(o.code)
            : undefined,
      status: typeof o.status === "number" ? o.status : undefined,
    };
  }
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    const message =
      typeof o.message === "string"
        ? o.message
        : typeof o.error_description === "string"
          ? o.error_description
          : typeof o.error === "string"
            ? o.error
            : "(unknown object)";
    return {
      message,
      code: typeof o.code === "string" ? o.code : undefined,
      status: typeof o.status === "number" ? o.status : undefined,
      name: typeof o.name === "string" ? o.name : undefined,
    };
  }
  return { message: String(error) };
}

export function mapAppleExchangeErrorToUserMessage(
  detail: AppleAuthErrorDetail,
  error?: unknown,
): string {
  const msg = detail.message;
  const lower = msg.toLowerCase();
  const urlIssue = diagnoseSupabaseUrlForNativeBuild();

  if (urlIssue === "placeholder_host" || urlIssue === "missing_url" || urlIssue?.startsWith("dev_host:")) {
    return SUPABASE_HOST_UNREACHABLE_MSG;
  }
  if (error && isSupabaseHostnameUnreachableError(error)) {
    return SUPABASE_HOST_UNREACHABLE_MSG;
  }
  if (/無法找到指定主機|could not find.*host|unknown host/i.test(msg)) {
    return SUPABASE_HOST_UNREACHABLE_MSG;
  }

  if (/nonces?\s*mismatch/i.test(msg)) {
    return (
      "Apple 登入失敗：nonce 驗證不一致。請確認 Supabase Dashboard → Authentication → Apple 已啟用，" +
      "且 Client IDs 含 App bundle ID（com.shuode.roamie）。"
    );
  }
  if (/unacceptable audience|invalid audience|client id|bundle/i.test(lower)) {
    return (
      "Apple 登入失敗：Bundle ID 未列入 Supabase Apple Client IDs。請在 Dashboard 加入 com.shuode.roamie。"
    );
  }
  if (/supabase_not_configured/i.test(msg)) {
    return "雲端登入未設定，請更新 App 後再試。";
  }
  if (/apple_supabase_sign_in_timeout|apple_token_exchange 逾時/i.test(msg)) {
    return "Apple 登入連線逾時，請稍後再試。";
  }
  if (/invalid.?grant|bad.?id.?token|jwt|token.*expired|id_token/i.test(lower)) {
    return "Apple 身分驗證失敗，請再試一次。";
  }
  if (detail.status === 400 || detail.status === 401 || detail.status === 422) {
    return msg.length <= 120 ? msg : "Apple 登入驗證失敗，請再試一次。";
  }
  return msg.length > 0 && msg.length <= 80 ? msg : "Apple 登入暫時失敗，請稍後再試";
}
