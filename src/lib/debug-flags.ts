/** 開發診斷 log（layout audit 等），需明確設定 VITE_DEBUG_DIAGNOSTICS=1 */
export function isDebugDiagnosticsEnabled(): boolean {
  return import.meta.env.VITE_DEBUG_DIAGNOSTICS === "1";
}
