import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

let keyboardFrozenForShell = false;
let keyboardModePromise: Promise<void> | null = null;

function normalizeRoutePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

async function applyShellKeyboardFrozen(frozen: boolean): Promise<void> {
  if (!isCapacitorNativeShell()) return;
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({
      mode: frozen ? KeyboardResize.None : KeyboardResize.Native,
    });
    await Keyboard.setScroll({ isDisabled: frozen });
  } catch (e) {
    console.warn("[ROUTE_KEYBOARD] native layout failed", e instanceof Error ? e.message : e);
  }
}

/** /map 與 /chat 共用 KeyboardResize.None；僅在進出這兩頁時呼叫 native API */
export function syncRouteKeyboardMode(pathname: string): void {
  const path = normalizeRoutePath(pathname);
  const shouldFreeze = path === "/map" || path === "/chat";
  if (shouldFreeze === keyboardFrozenForShell) return;

  keyboardFrozenForShell = shouldFreeze;
  keyboardModePromise = (keyboardModePromise ?? Promise.resolve())
    .then(() => applyShellKeyboardFrozen(shouldFreeze))
    .catch(() => applyShellKeyboardFrozen(shouldFreeze));
}

export function resetRouteKeyboardMode(): void {
  keyboardFrozenForShell = false;
  keyboardModePromise = null;
}
