/** Perf / diagnostic logs for user media loading. */

const loggedOnce = new Set<string>();

export function logUserMedia(
  tag: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  opts?: { onceKey?: string },
): void {
  if (opts?.onceKey) {
    const key = `${tag}:${opts.onceKey}`;
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
  }
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  console.info(`[${tag}]`, ...parts);
}

export function resetUserMediaLogOnce(): void {
  loggedOnce.clear();
}
