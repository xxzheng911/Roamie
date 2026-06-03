import { Browser } from "@capacitor/browser";

export function logAffiliateBrowserOpenStart(url: string, platform?: string): void {
  console.info("[AFFILIATE_BROWSER_OPEN_START]", { url, platform });
}

export function logAffiliateBrowserOpenSuccess(url: string, platform?: string): void {
  console.info("[AFFILIATE_BROWSER_OPEN_SUCCESS]", { url, platform });
}

export function logAffiliateBrowserOpenFailed(
  url: string,
  reason: string,
  platform?: string,
): void {
  console.info("[AFFILIATE_BROWSER_OPEN_FAILED]", { url, reason, platform });
}

/**
 * Klook / KKday 等導購連結：一律用 Capacitor Browser（iOS SFSafariViewController）。
 * 不使用 window.open / target=_blank / router。
 */
export async function openAffiliateBrowser(url: string, platform?: string): Promise<void> {
  const trimmed = url?.trim();
  if (!trimmed) {
    logAffiliateBrowserOpenFailed(url, "empty_url", platform);
    return;
  }

  logAffiliateBrowserOpenStart(trimmed, platform);

  try {
    await Browser.open({ url: trimmed });
    logAffiliateBrowserOpenSuccess(trimmed, platform);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "browser_open_failed";
    logAffiliateBrowserOpenFailed(trimmed, reason, platform);
    throw e;
  }
}
