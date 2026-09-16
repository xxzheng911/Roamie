import { isValidTabelogSearchUrl } from "@/lib/tabelog-reference";
import { openExternalUrl } from "@/lib/open-external-url";

/** 以系統瀏覽器開啟 Tabelog（不用 app 內 WebView / Capacitor Browser tmpWindow） */
export async function openTabelogExternal(
  url: string | null | undefined,
): Promise<boolean> {
  const normalized = typeof url === "string" ? url.trim() : "";
  if (!normalized || !isValidTabelogSearchUrl(normalized)) {
    console.info("[TABELOG_OPEN_FAILED]", {
      reason: "invalid_url",
      raw: url ?? null,
    });
    return false;
  }

  console.info("[TABELOG_OPEN_URL]", normalized);

  const opened = await openExternalUrl(normalized);
  if (opened) {
    console.info("[TABELOG_OPEN_SUCCESS]", normalized);
    return true;
  }
  console.info("[TABELOG_OPEN_FAILED]", { url: normalized, reason: "open_failed" });
  return false;
}
