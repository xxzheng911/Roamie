import { useEffect, useState, type RefObject } from "react";
import {
  isChatKeyboardDebugEnabled,
  measureChatKeyboardDebugMetrics,
  type ChatKeyboardDebugMetrics,
} from "@/lib/chat-keyboard-visual-debug";

type ChatKeyboardDebugOverlayProps = {
  active: boolean;
  composerShellRef: RefObject<HTMLElement | null>;
  nativeKeyboardHeightPx: number;
};

function resolveInputRowEl(composerShellRef: RefObject<HTMLElement | null>): HTMLElement | null {
  const el = composerShellRef.current?.querySelector(".chat-input-row");
  return el instanceof HTMLElement ? el : null;
}

export function ChatKeyboardDebugOverlay({
  active,
  composerShellRef,
  nativeKeyboardHeightPx,
}: ChatKeyboardDebugOverlayProps) {
  const [metrics, setMetrics] = useState<ChatKeyboardDebugMetrics | null>(null);

  useEffect(() => {
    if (!isChatKeyboardDebugEnabled() || !active) {
      setMetrics(null);
      return;
    }

    let frame = 0;
    const sync = () => {
      setMetrics(
        measureChatKeyboardDebugMetrics({
          inputRowEl: resolveInputRowEl(composerShellRef),
          nativeKeyboardHeightPx,
        }),
      );
    };

    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };

    sync();
    frame = requestAnimationFrame(tick);

    const vv = window.visualViewport;
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);

    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    };
  }, [active, composerShellRef, nativeKeyboardHeightPx]);

  if (!isChatKeyboardDebugEnabled() || !active || !metrics) return null;

  const keyboardGapOk =
    metrics.inputRowToKeyboardGapPx >= 8 && metrics.inputRowToKeyboardGapPx <= 12;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      aria-hidden
      data-chat-keyboard-debug-overlay
    >
      {/* 紅線：visualViewport 底緣 (offsetTop + height) */}
      <div
        className="absolute left-0 right-0 border-t-2 border-red-500"
        style={{ top: metrics.visualViewportBottomY }}
      />
      {/* 藍線：input row bottom */}
      <div
        className="absolute left-0 right-0 border-t-2 border-blue-500"
        style={{ top: metrics.inputRowBottomY }}
      />

      <div className="absolute left-2 top-[max(0.5rem,var(--safe-area-top))] max-w-[min(100%,22rem)] rounded-lg border border-border/80 bg-background/90 px-2.5 py-2 font-mono text-[10px] leading-snug text-foreground shadow-md backdrop-blur">
        <p className="font-semibold text-red-600">— red: visualViewport bottom</p>
        <p className="font-semibold text-blue-600">— blue: inputRowRect.bottom</p>
        <p>vv.height: {metrics.visualViewportHeightPx}px</p>
        <p>vv.bottom Y: {metrics.visualViewportBottomY}</p>
        <p>input bottom Y: {metrics.inputRowBottomY}</p>
        <p>keyboardTopY: {metrics.keyboardTopY}</p>
        <p className={keyboardGapOk ? "text-green-700" : "text-amber-700"}>
          input→keyboardTop: {metrics.inputRowToKeyboardGapPx}px
          {keyboardGapOk ? " ✓" : " (expect 8~12)"}
        </p>
        <p>input→vv.bottom: {metrics.inputRowToVisualViewportGapPx}px</p>
        <p className="mt-1 text-muted-foreground">
          測 EN / emoji / 注音：DOM gap 穩定、注音視覺空隙大 → iOS visual area
        </p>
      </div>
    </div>
  );
}
