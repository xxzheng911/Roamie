/** 最早 client 診斷（須為 main / router 第一個 import） */
import { bootDiagnosticLog, isBootDiagnosticsEnabled } from "@/lib/boot-diagnostics";
import { mountImmediateBootShell } from "@/lib/immediate-boot-shell";

bootDiagnosticLog("MAIN_TSX_LOADED");
console.log("[APP_BOOT] boot-trace loaded");
mountImmediateBootShell();

function bootMark(phase: string, extra?: Record<string, unknown>) {
  try {
    const b = window.__ROAMIE_BOOT__ ?? { t0: Date.now() };
    b.phase = phase;
    b.lastHref = typeof location !== "undefined" ? location.href : b.lastHref;
    b.lastPathname =
      typeof location !== "undefined" ? location.pathname : b.lastPathname;
    window.__ROAMIE_BOOT__ = b;
    if (extra) {
      Object.assign(b as Record<string, unknown>, extra);
    }
  } catch {
    // ignore
  }
}

bootMark("boot-trace");

// Watch for the exact moment WKWebView resets to about:blank (diagnostics only).
if (typeof window !== "undefined" && isBootDiagnosticsEnabled()) {
  let seenBlank = false;
  const start = performance.now();
  const id = window.setInterval(() => {
    if (seenBlank) return;
    const href = String(location.href || "");
    if (!href.includes("about:blank")) return;
    seenBlank = true;
    const ms = Math.round(performance.now() - start);
    bootMark("about-blank", { blankAtMs: ms });
    bootDiagnosticLog(
      "ROAMIE_ABOUT_BLANK ms=" +
        ms +
        " phase=" +
        (window.__ROAMIE_BOOT__?.phase || "?") +
        " pathname=" +
        (window.__ROAMIE_BOOT__?.lastPathname || "?"),
    );
    window.clearInterval(id);
  }, 200);
}
