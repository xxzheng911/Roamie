import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import { isCapacitorNativeShell } from "@/lib/chat-keyboard-layout";

export type CapacitorKeyboardHandlers = {
  onShow: (keyboardHeight: number) => void;
  onHide: () => void;
};

type Subscriber = {
  id: number;
  handlers: CapacitorKeyboardHandlers;
};

let nextSubscriberId = 1;
const subscribers = new Map<number, Subscriber>();
let removeNativeListeners: (() => void) | undefined;
let installStarted = false;

function dispatchShow(height: number): void {
  for (const sub of subscribers.values()) {
    sub.handlers.onShow(height);
  }
}

function dispatchHide(): void {
  for (const sub of subscribers.values()) {
    sub.handlers.onHide();
  }
}

function teardownNativeListeners(): void {
  removeNativeListeners?.();
  removeNativeListeners = undefined;
  installStarted = false;
}

function ensureNativeListeners(): void {
  if (!isCapacitorNativeShell()) return;
  if (installStarted) return;
  installStarted = true;

  void runWhenCapacitorBridgeReady("capacitor-keyboard-bridge", async () => {
    if (subscribers.size === 0) {
      installStarted = false;
      return;
    }

    const { Keyboard } = await import("@capacitor/keyboard");
    const onShow = (info: { keyboardHeight?: number }) => {
      dispatchShow(info.keyboardHeight ?? 0);
    };
    const onHide = () => dispatchHide();

    const showWill = Keyboard.addListener("keyboardWillShow", onShow);
    const showDid = Keyboard.addListener("keyboardDidShow", onShow);
    const hideWill = Keyboard.addListener("keyboardWillHide", onHide);
    const hideDid = Keyboard.addListener("keyboardDidHide", onHide);

    removeNativeListeners = () => {
      void showWill.then((s) => s.remove());
      void showDid.then((s) => s.remove());
      void hideWill.then((s) => s.remove());
      void hideDid.then((s) => s.remove());
    };
  });
}

/** 全 app 共用一組 Capacitor Keyboard listener；tab 切換只 subscribe / unsubscribe */
export function subscribeCapacitorKeyboard(handlers: CapacitorKeyboardHandlers): () => void {
  const id = nextSubscriberId++;
  subscribers.set(id, { id, handlers });
  ensureNativeListeners();

  return () => {
    subscribers.delete(id);
    if (subscribers.size === 0) {
      teardownNativeListeners();
    }
  };
}
