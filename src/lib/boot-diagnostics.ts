/** 啟動診斷 log（DEV 或 localStorage roamie:boot-diagnostics=1） */
export function isBootDiagnosticsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("roamie:boot-diagnostics") === "1";
  } catch {
    return false;
  }
}

export function bootDiagnosticLog(message: string): void {
  if (!isBootDiagnosticsEnabled()) return;
  console.error(message);
}

declare global {
  interface Window {
    __ROAMIE_BOOT__?: {
      phase?: string;
      t0?: number;
      import?: string;
      error?: string;
      lastHref?: string;
      lastPathname?: string;
      blankAtMs?: number;
    };
  }
}

export function markBootPhase(phase: string, detail?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.__ROAMIE_BOOT__ = window.__ROAMIE_BOOT__ ?? { t0: Date.now() };
    window.__ROAMIE_BOOT__!.phase = phase;
    if (detail) window.__ROAMIE_BOOT__!.error = detail;
    const path =
      typeof location !== "undefined" ? location.pathname : undefined;
    bootDiagnosticLog(
      "ROAMIE_PHASE " +
        phase +
        (detail ? " " + detail : "") +
        (path ? " path=" + path : ""),
    );
  } catch {
    // ignore
  }
}
