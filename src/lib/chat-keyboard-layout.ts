import { detectPlatform } from "@/services/platform";

export function isCapacitorNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function logChatKeyboardShow(height: number): void {
  console.info("[Chat Keyboard Show]", { height });
}

export function logChatKeyboardHide(): void {
  console.info("[Chat Keyboard Hide]");
}

export function logKeyboardHeight(height: number): void {
  console.info("[Keyboard Height]", height);
}

export function logInputBarOffsetUpdated(offsetPx: number, open: boolean): void {
  console.info("[Input Bar Offset Updated]", { offsetPx, open, native: isCapacitorNativeShell() });
}

export function logChatInputLayoutRendered(detail: Record<string, unknown>): void {
  console.info("[Chat Input Layout Rendered]", detail);
}

export function resolveChatPageBottomInset(
  open: boolean,
  keyboardHeightPx: number,
): number {
  if (!open || keyboardHeightPx <= 0) return 0;
  const platform = detectPlatform();
  // Tab bar overlays chat; when keyboard open it is hidden — lift by full keyboard height.
  if (platform.isCapacitor) {
    return Math.max(0, Math.round(keyboardHeightPx));
  }
  return Math.max(0, Math.round(keyboardHeightPx));
}
