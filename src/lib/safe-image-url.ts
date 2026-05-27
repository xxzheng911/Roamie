import { detectPlatform } from "@/services/platform";

/** iOS WKWebView 對部分 WebP 批次解碼會噴 makeImagePlus err=-50，需避開 */
export function isWebpImageUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u) return false;
  return /\.webp(\?|#|$)/.test(u) || u.includes("format=webp") || u.includes("type=webp");
}

/**
 * 在 Capacitor / iOS 上若為 WebP，回傳 null 讓呼叫端走 JPEG fallback（Unsplash / 內建圖）。
 */
export function preferNonWebpImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  const { isCapacitor, isIOS } = detectPlatform();
  if ((isCapacitor || isIOS) && isWebpImageUrl(trimmed)) {
    console.info("[IMAGE] skip webp on native", trimmed.slice(0, 80));
    return null;
  }
  return trimmed;
}
