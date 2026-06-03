import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemove, mockAddListener } = vi.hoisted(() => ({
  mockRemove: vi.fn(),
  mockAddListener: vi.fn(async () => ({ remove: vi.fn(() => mockRemove()) })),
}));

vi.mock("@/lib/chat-keyboard-layout", () => ({
  isCapacitorNativeShell: () => true,
  parseKeyboardEventHeight: () => 320,
  estimateNativeKeyboardHeight: () => 300,
}));

vi.mock("@/lib/capacitor-bridge-ready", () => ({
  runWhenCapacitorBridgeReady: async (_label: string, fn: () => void | Promise<void>) => {
    await fn();
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: mockAddListener,
  },
}));

describe("chat-keyboard-listeners", () => {
  beforeEach(() => {
    vi.resetModules();
    mockAddListener.mockClear();
    mockRemove.mockClear();
  });

  afterEach(async () => {
    const { resetChatKeyboardListenersForTests } = await import(
      "@/lib/chat-keyboard-listeners"
    );
    resetChatKeyboardListenersForTests();
  });

  it("attaches once and removes when last subscriber leaves", async () => {
    const {
      subscribeChatKeyboardLayout,
      flushChatKeyboardListenerAttachForTests,
    } = await import("@/lib/chat-keyboard-listeners");
    const logs: unknown[][] = [];
    const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    const unsub1 = subscribeChatKeyboardLayout(() => {});
    await flushChatKeyboardListenerAttachForTests();
    const unsub2 = subscribeChatKeyboardLayout(() => {});
    await flushChatKeyboardListenerAttachForTests();

    expect(mockAddListener).toHaveBeenCalledTimes(2);

    const attached = logs.filter((row) => row[0] === "[KEYBOARD_LISTENER_ATTACHED]");
    const already = logs.filter((row) => row[0] === "[KEYBOARD_LISTENER_ALREADY_ACTIVE]");
    expect(attached.length).toBe(1);
    expect(already.length).toBe(1);

    unsub1();
    expect(logs.filter((row) => row[0] === "[KEYBOARD_LISTENER_REMOVED]").length).toBe(0);

    unsub2();
    expect(logs.filter((row) => row[0] === "[KEYBOARD_LISTENER_REMOVED]").length).toBe(1);
    expect(mockRemove).toHaveBeenCalledTimes(2);

    info.mockRestore();
  });

  it("re-subscribe after full teardown attaches again", async () => {
    const {
      subscribeChatKeyboardLayout,
      flushChatKeyboardListenerAttachForTests,
    } = await import("@/lib/chat-keyboard-listeners");
    const logs: unknown[][] = [];
    const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    const unsub = subscribeChatKeyboardLayout(() => {});
    await flushChatKeyboardListenerAttachForTests();
    unsub();
    await flushChatKeyboardListenerAttachForTests();

    subscribeChatKeyboardLayout(() => {});
    await flushChatKeyboardListenerAttachForTests();

    expect(logs.filter((row) => row[0] === "[KEYBOARD_LISTENER_ATTACHED]").length).toBe(2);
    expect(mockAddListener).toHaveBeenCalledTimes(4);

    info.mockRestore();
  });
});
