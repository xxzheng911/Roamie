/** Centralized auth restore / cleanup deadlines (ms). */
export const AUTH_RESTORE_TIMEOUT = {
  webMs: 4_000,
  nativeMs: 12_000,
  webShellGateMs: 5_000,
  nativeClearMs: 3_000,
} as const;

export function authRestoreTimeoutMs(isNative: boolean): number {
  return isNative ? AUTH_RESTORE_TIMEOUT.nativeMs : AUTH_RESTORE_TIMEOUT.webMs;
}

export function authShellGateTimeoutMs(isNative: boolean): number {
  return isNative ? AUTH_RESTORE_TIMEOUT.nativeMs : AUTH_RESTORE_TIMEOUT.webShellGateMs;
}

export type AppShellRestoreDecision =
  | { kind: "welcome" }
  | { kind: "allow-app" }
  | { kind: "login"; reason: string };

/**
 * Cold-start / app-shell destination after session restore has settled.
 * Persisted hint is not an input — hint may only trigger a restore attempt.
 */
export function decideAppShellAfterAuthRestore(input: {
  onboardingCompleted: boolean;
  hasSessionUser: boolean;
}): AppShellRestoreDecision {
  if (!input.onboardingCompleted) return { kind: "welcome" };
  if (input.hasSessionUser) return { kind: "allow-app" };
  return { kind: "login", reason: "restore-unauthenticated" };
}
