const loggedOnce = new Set<string>();

export function logMapsOnce(key: string, message: string, detail?: Record<string, unknown>): void {
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  if (detail) {
    console.info("[Roamie Maps]", message, detail);
    return;
  }
  console.info("[Roamie Maps]", message);
}
