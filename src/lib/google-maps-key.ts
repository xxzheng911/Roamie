/** Maps browser/server keys are typically AIza…; reject OAuth client secrets (e.g. GOCSPX-). */
export function isValidGoogleMapsApiKey(key: string): boolean {
  return key.startsWith("AIza");
}
