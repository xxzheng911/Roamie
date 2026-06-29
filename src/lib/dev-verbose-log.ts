/** Verbose chat/places tracing — development builds only. */
export function isDevVerboseLog(): boolean {
  return import.meta.env.DEV;
}

export function devVerboseInfo(...args: unknown[]): void {
  if (import.meta.env.DEV) console.info(...args);
}

export function devVerboseWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn(...args);
}
