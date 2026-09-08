/** Runtime QA overrides are allowed only in explicitly non-production builds. */
export function canUseRuntimeDebugOverrides(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ROAMIE_DEVELOPER === "1";
}
