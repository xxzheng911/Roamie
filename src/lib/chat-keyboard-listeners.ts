import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import {
  estimateNativeKeyboardHeight,
  isCapacitorNativeShell,
  parseKeyboardEventHeight,
} from "@/lib/chat-keyboard-layout";

export type ChatKeyboardLayoutEvent = {
  height: number;
  open: boolean;
};

export type ChatKeyboardLayoutSubscriber = (event: ChatKeyboardLayoutEvent) => void;

const subscribers = new Set<ChatKeyboardLayoutSubscriber>();

let capacitorActive = false;
let capacitorRemovers: Array<() => void> = [];
let capacitorAttachGeneration = 0;
let capacitorAttachInFlight: Promise<void> | null = null;

let viewportActive = false;
let viewportTeardown: (() => void) | null = null;

function notifySubscribers(height: number, open: boolean): void {
  const event = { height, open };
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

function teardownCapacitorListeners(reason: string): void {
  capacitorAttachGeneration += 1;
  const hadListeners = capacitorActive || capacitorRemovers.length > 0;
  for (const remove of capacitorRemovers) remove();
  capacitorRemovers = [];
  capacitorActive = false;
  capacitorAttachInFlight = null;
  if (hadListeners) {
    console.info("[KEYBOARD_LISTENER_REMOVED]", { platform: "capacitor", reason });
  }
}

function teardownViewportListeners(reason: string): void {
  if (!viewportActive) return;
  viewportTeardown?.();
  viewportTeardown = null;
  viewportActive = false;
  console.info("[KEYBOARD_LISTENER_REMOVED]", { platform: "visualViewport", reason });
}

async function attachCapacitorListeners(): Promise<void> {
  if (capacitorActive) {
    console.info("[KEYBOARD_LISTENER_ALREADY_ACTIVE]", {
      platform: "capacitor",
      subscribers: subscribers.size,
    });
    return;
  }

  if (capacitorAttachInFlight) {
    await capacitorAttachInFlight;
    if (capacitorActive) {
      console.info("[KEYBOARD_LISTENER_ALREADY_ACTIVE]", {
        platform: "capacitor",
        subscribers: subscribers.size,
        phase: "after_in_flight",
      });
    }
    return;
  }

  const generation = ++capacitorAttachGeneration;

  capacitorAttachInFlight = runWhenCapacitorBridgeReady("chat.keyboardListeners", async () => {
    if (generation !== capacitorAttachGeneration || subscribers.size === 0) return;

    const { Keyboard } = await import("@capacitor/keyboard");
    if (generation !== capacitorAttachGeneration || subscribers.size === 0) return;

    const onShow = (info: unknown) => {
      const reported = parseKeyboardEventHeight(info);
      const height = reported > 50 ? reported : estimateNativeKeyboardHeight();
      notifySubscribers(height, true);
    };

    const onHide = () => {
      notifySubscribers(0, false);
    };

    const willShow = await Keyboard.addListener("keyboardWillShow", onShow);
    const willHide = await Keyboard.addListener("keyboardWillHide", onHide);

    if (generation !== capacitorAttachGeneration || subscribers.size === 0) {
      void willShow.remove();
      void willHide.remove();
      return;
    }

    capacitorRemovers = [
      () => void willShow.remove(),
      () => void willHide.remove(),
    ];
    capacitorActive = true;
    console.info("[KEYBOARD_LISTENER_ATTACHED]", {
      platform: "capacitor",
      subscribers: subscribers.size,
    });
  }).finally(() => {
    capacitorAttachInFlight = null;
  });

  await capacitorAttachInFlight;
}

function attachViewportListeners(): void {
  if (typeof window === "undefined") return;

  if (viewportActive) {
    console.info("[KEYBOARD_LISTENER_ALREADY_ACTIVE]", {
      platform: "visualViewport",
      subscribers: subscribers.size,
    });
    return;
  }

  const vv = window.visualViewport;
  let viewportSyncFrame = 0;
  let lastVisible = false;

  const syncFromViewport = () => {
    if (!vv) return;
    if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
    viewportSyncFrame = requestAnimationFrame(() => {
      viewportSyncFrame = 0;
      const shrink = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)),
      );
      const capped = Math.min(shrink, Math.round(window.innerHeight * 0.55));
      if (capped > 50) {
        lastVisible = true;
        notifySubscribers(capped, true);
        return;
      }
      if (lastVisible) {
        lastVisible = false;
        notifySubscribers(0, false);
      }
    });
  };

  vv?.addEventListener("resize", syncFromViewport);
  vv?.addEventListener("scroll", syncFromViewport);

  viewportTeardown = () => {
    if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
    vv?.removeEventListener("resize", syncFromViewport);
    vv?.removeEventListener("scroll", syncFromViewport);
  };
  viewportActive = true;
  console.info("[KEYBOARD_LISTENER_ATTACHED]", {
    platform: "visualViewport",
    subscribers: subscribers.size,
  });
}

function ensureListeners(): void {
  if (subscribers.size === 0) return;
  if (isCapacitorNativeShell()) {
    void attachCapacitorListeners();
  } else {
    attachViewportListeners();
  }
}

function releaseListenersIfIdle(): void {
  if (subscribers.size > 0) return;
  teardownCapacitorListeners("no_subscribers");
  teardownViewportListeners("no_subscribers");
}

/**
 * 聊聊頁鍵盤事件：全域單例 listener，避免重複 Keyboard.addListener。
 * @returns unsubscribe
 */
export function subscribeChatKeyboardLayout(
  subscriber: ChatKeyboardLayoutSubscriber,
): () => void {
  subscribers.add(subscriber);
  ensureListeners();

  return () => {
    subscribers.delete(subscriber);
    releaseListenersIfIdle();
  };
}

/** @internal vitest only */
export async function flushChatKeyboardListenerAttachForTests(): Promise<void> {
  if (capacitorAttachInFlight) await capacitorAttachInFlight;
}

/** @internal vitest only */
export function resetChatKeyboardListenersForTests(): void {
  subscribers.clear();
  teardownCapacitorListeners("test_reset");
  teardownViewportListeners("test_reset");
}
