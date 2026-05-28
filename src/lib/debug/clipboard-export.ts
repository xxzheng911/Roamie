import { toast } from "sonner";
import { detectPlatform } from "@/services/platform";

function isNativeCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    detectPlatform().isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

/** WKWebView / Capacitor：clipboard API 常失敗，依序嘗試 writeText → execCommand → Share */
export async function copyTextForMobile(text: string): Promise<boolean> {
  if (!text.trim()) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("[clipboard-export] navigator.clipboard failed", e);
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;opacity:0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    if (ok) return true;
  } catch (e) {
    console.warn("[clipboard-export] execCommand failed", e);
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: text.slice(0, 120_000) });
      return true;
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "AbortError") return false;
      console.warn("[clipboard-export] share text failed", e);
    }
  }

  return false;
}

export type JsonExportResult = "download" | "share" | "clipboard" | "failed";

/** 桌面用下載；iOS / Capacitor 用 Share 或複製 JSON 到剪貼簿 */
export async function exportJsonForMobile(
  filename: string,
  jsonText: string,
): Promise<JsonExportResult> {
  const native = isNativeCapacitorShell();

  if (!native) {
    try {
      const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return "download";
    } catch (e) {
      console.warn("[clipboard-export] anchor download failed", e);
    }
  }

  if (typeof navigator.share === "function") {
    try {
      const file = new File([jsonText], filename, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return "share";
      }
    } catch (e) {
      console.warn("[clipboard-export] file share failed", e);
    }
  }

  const copied = await copyTextForMobile(jsonText);
  return copied ? "clipboard" : "failed";
}

export function toastCopyResult(ok: boolean): void {
  if (ok) toast.success("已複製診斷快照");
  else toast.error("複製失敗，請長按診斷文字手動複製");
}

export function toastJsonExportResult(result: JsonExportResult): void {
  if (result === "download") toast.success("diagnostics.json 已下載");
  else if (result === "share") toast.success("請在分享面板儲存到「檔案」或 AirDrop");
  else if (result === "clipboard")
    toast.success("已複製 diagnostics.json 內容（可貼到備忘錄後儲存）");
  else toast.error("匯出失敗，請改用「複製診斷快照」");
}
