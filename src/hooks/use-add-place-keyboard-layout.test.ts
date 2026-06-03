import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADD_PLACE_KEYBOARD_GAP_PX,
  resolveAddPlaceInputBottomPx,
} from "@/hooks/use-add-place-keyboard-layout";

vi.mock("@/lib/chat-keyboard-layout", () => ({
  readSafeAreaBottomPx: () => 34,
  readTabBarHeightPx: () => 103,
  measureVisualViewportKeyboardInset: vi.fn(() => 0),
  estimateNativeKeyboardHeight: () => 320,
  isCapacitorNativeShell: () => true,
}));

describe("resolveAddPlaceInputBottomPx", () => {
  beforeEach(async () => {
    const layout = await import("@/lib/chat-keyboard-layout");
    vi.mocked(layout.measureVisualViewportKeyboardInset).mockReturnValue(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses keyboardHeight only when vv not lifted (gap in padding)", async () => {
    const r = resolveAddPlaceInputBottomPx({
      keyboardVisible: true,
      keyboardHeightPx: 335,
      vvInsetPx: 0,
    });
    expect(r.finalBottom).toBe(335);
    expect(r.strategy).toBe("keyboard_height_with_padding_gap");
  });

  it("uses gap only when visual viewport already lifted", async () => {
    const r = resolveAddPlaceInputBottomPx({
      keyboardVisible: true,
      keyboardHeightPx: 335,
      vvInsetPx: 280,
    });
    expect(r.finalBottom).toBe(ADD_PLACE_KEYBOARD_GAP_PX);
    expect(r.strategy).toBe("visual_viewport_gap_only");
  });

  it("does not add tab bar when keyboard closed", () => {
    const r = resolveAddPlaceInputBottomPx({
      keyboardVisible: false,
      keyboardHeightPx: 0,
      vvInsetPx: 0,
    });
    expect(r.finalBottom).toBe(34);
    expect(r.keyboardHeight).toBe(0);
  });
});
