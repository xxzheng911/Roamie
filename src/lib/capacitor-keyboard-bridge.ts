import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import { isCapacitorNativeShell } from "@/lib/chat-keyboard-layout";
import { logPerfKeyboardListener } from "@/lib/app-perf";

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
let nativeListenersInstalled = false;
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

/** App 啟動時預先安裝 Capacitor Keyboard listener（避免切到聊聊頁才洗版 addListener） */
export function bootstrapCapacitorKeyboardBridge(): void {
  ensureNativeListeners();
}

function ensureNativeListeners(): void {
  if (!isCapacitorNativeShell()) return;
  if (nativeListenersInstalled || installStarted) return;
  installStarted = true;

  void runWhenCapacitorBridgeReady("capacitor-keyboard-bridge", async () => {
    if (nativeListenersInstalled) {
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

    nativeListenersInstalled = true;
    installStarted = false;
    logPerfKeyboardListener("add", { count: 4, subscribers: subscribers.size });

    void Promise.all([showWill, showDid, hideWill, hideDid]).catch((error) => {
      console.warn("[capacitor-keyboard-bridge] listener install failed", error);
    });
  });
}

/** 全 app 共用一組 Capacitor Keyboard listener；tab 切換只 subscribe / unsubscribe handler */
export function subscribeCapacitorKeyboard(handlers: CapacitorKeyboardHandlers): () => void {
  const id = nextSubscriberId++;
  subscribers.set(id, { id, handlers });
  ensureNativeListeners();

  return () => {
    subscribers.delete(id);
    logPerfKeyboardListener("remove", { count: subscribers.size });
  };
}
