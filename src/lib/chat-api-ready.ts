import {
  canReachBundledAppApiOrigin,
  isLocalhostAppApiUrl,
  resolveAppApiUrl,
} from "@/lib/api-base-url";
import { detectPlatform } from "@/services/platform";

function readConfiguredApiOrigin(): string | undefined {
  const fromVite = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();
  if (fromVite) return fromVite.replace(/\/$/, "");
  if (typeof document === "undefined") return undefined;
  const meta = document
    .querySelector('meta[name="roamie-api-origin"]')
    ?.getAttribute("content")
    ?.trim();
  return meta?.replace(/\/$/, "") || undefined;
}

function isLocalhostHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function getChatApiOrigin(): string | undefined {
  return readConfiguredApiOrigin();
}

/** 實機／模擬器上 localhost 指向裝置本身，無法連到開發機或正式 API */
export function isLocalhostChatApiOrigin(origin?: string): boolean {
  const o = origin ?? readConfiguredApiOrigin();
  if (!o) return false;
  try {
    return isLocalhostHostname(new URL(o).hostname);
  } catch {
    return false;
  }
}

/**
 * 原生 App 無法使用 AI API：
 * - 未設定 origin（相對路徑 /api）
 * - 或 origin 為 localhost（TestFlight 常見誤設）
 * - 或解析後的 /api/roamie URL 為 localhost
 */
export function isChatApiUnreachableOnNative(): boolean {
  if (typeof window === "undefined") return false;
  if (!detectPlatform().isCapacitor) return false;

  if (!canReachBundledAppApiOrigin()) return true;

  const resolved = resolveAppApiUrl("/api/roamie");
  if (resolved.startsWith("/")) return true;
  if (isLocalhostAppApiUrl(resolved)) return true;

  const origin = readConfiguredApiOrigin();
  if (origin && isLocalhostChatApiOrigin(origin)) return true;

  return false;
}

/** @deprecated 使用 isChatApiUnreachableOnNative */
export function isCapacitorBundledChatApiMisconfigured(): boolean {
  return isChatApiUnreachableOnNative();
}

export function chatApiMisconfigUserMessage(): string {
  if (isLocalhostChatApiOrigin()) {
    return "AI 無法連到 localhost。TestFlight 請在 build 前將 VITE_APP_ORIGIN 設為正式網域；開發請改為電腦區域網 IP（例如 http://192.168.0.10:8080）並 npm run dev。";
  }
  return "AI 連線尚未設定。請在 .env 設定 VITE_APP_ORIGIN 後重新 build。";
}

export function chatApiResolvedUrl(): string {
  return resolveAppApiUrl("/api/roamie");
}
