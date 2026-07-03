import { detectPlatform } from "@/services/platform";

export type CopyTextResult = "copied" | "manual";

export const COPY_MANUAL_HINT = "無法自動複製，請長按連結手動複製";

async function copyWithCapacitorClipboard(text: string): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return false;

    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

async function copyWithNavigatorClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy text — Capacitor Clipboard → execCommand → navigator.clipboard */
export async function copyTextToClipboard(text: string): Promise<CopyTextResult> {
  const trimmed = text.trim();
  if (!trimmed) return "manual";

  const platform = detectPlatform();
  if (platform.isCapacitor || platform.isNative) {
    if (await copyWithCapacitorClipboard(trimmed)) return "copied";
  }

  if (copyWithExecCommand(trimmed)) return "copied";

  if (await copyWithNavigatorClipboard(trimmed)) return "copied";

  return "manual";
}
