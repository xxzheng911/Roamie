import { isLocalhostChatApiOrigin } from "@/lib/chat-api-ready";
import { detectPlatform } from "@/services/platform";

function readBundledApiOriginMeta(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const content = document
    .querySelector('meta[name="roamie-api-origin"]')
    ?.getAttribute("content")
    ?.trim();
  return content || undefined;
}

/** Absolute URL for API routes when running in bundled Capacitor (no local SSR). */
export function resolveAppApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;

  const configured = import.meta.env.VITE_APP_ORIGIN as string | undefined;
  const metaOrigin = readBundledApiOriginMeta();
  const origin = (configured ?? metaOrigin)?.replace(/\/$/, "");
  const platform = detectPlatform();

  if (platform.isCapacitor && origin) {
    return `${origin}${normalized}`;
  }

  if (platform.isCapacitor && window.location.protocol === "capacitor:" && !origin) {
    console.warn(
      "[API] VITE_APP_ORIGIN is not set — bundled iOS cannot reach /api. Set VITE_APP_ORIGIN at build time or use CAPACITOR_DEV_SERVER_URL for live reload.",
    );
  }

  return normalized;
}

function readConfiguredAppOrigin(): string | undefined {
  const configured = import.meta.env.VITE_APP_ORIGIN as string | undefined;
  const meta = readBundledApiOriginMeta();
  return (configured ?? meta)?.replace(/\/$/, "");
}

/** 實機上 localhost / 127.0.0.1 指向裝置本身，無法打到開發機或正式 API */
export function isLocalhostAppApiUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return false;
    const h = hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

/** Capacitor 打包後能否透過 VITE_APP_ORIGIN 使用 /api 代理（含 place-photo） */
export function canReachBundledAppApiOrigin(): boolean {
  if (typeof window === "undefined") return true;
  if (!detectPlatform().isCapacitor) return true;
  const origin = readConfiguredAppOrigin();
  if (!origin) return false;
  return !isLocalhostChatApiOrigin(origin);
}
