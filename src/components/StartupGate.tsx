import { type ReactNode, useEffect, useRef, useState } from "react";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { requestIosSnapshotRefresh } from "@/lib/ios-snapshot-bridge";

export function markSessionBootstrapped(): void {
  // Kept for compatibility; cold-start gate removed.
}

export function clearSessionBootstrapForDev(): void {
  // Kept for compatibility; cold-start gate removed.
}

const SLOW_START_MS = 5_000;

type Props = { children: ReactNode };

function hasMeaningfulUi(root: HTMLElement): boolean {
  return (
    root.querySelector("main,nav,[role=main],button,a[href],input,textarea,form") != null
  );
}

/**
 * 子路由尚未渲染時，5 秒後顯示 loading（避免白屏）。
 */
export function StartupGate({ children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasUi, setHasUi] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const check = () => {
      if (hasMeaningfulUi(root)) setHasUi(true);
    };
    check();

    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hasUi) {
      setSlow(false);
      markBootPhase("startup-gate:has-ui");
      requestIosSnapshotRefresh("startup-gate-has-ui", { force: true });
    }
  }, [hasUi]);

  return (
    <>
      {slow && !hasUi ? (
        <div className="fixed inset-0 z-[2147483645]">
          <RoamieRoutePending />
        </div>
      ) : null}
      <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </>
  );
}
