import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { isValidTabelogSearchUrl } from "@/lib/tabelog-reference";

/** 以 SafariViewController / 系統瀏覽器開啟 Tabelog（不用 app 內 WebView） */
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

  try {
    if (isCapacitorNativeShell()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({
        url: normalized,
        presentationStyle: "popover",
        toolbarColor: "#ffffff",
      });
      console.info("[TABELOG_OPEN_SUCCESS]", normalized);
      return true;
    }

    if (typeof window !== "undefined") {
      const opened = window.open(normalized, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error("window.open blocked");
      }
      console.info("[TABELOG_OPEN_SUCCESS]", normalized);
      return true;
    }

    throw new Error("no_window");
  } catch (error) {
    console.info("[TABELOG_OPEN_FAILED]", { url: normalized, error });
    if (typeof window !== "undefined") {
      window.open(normalized, "_blank");
      console.info("[TABELOG_OPEN_SUCCESS]", normalized, "via=window.open_fallback");
      return true;
    }
    return false;
  }
}
