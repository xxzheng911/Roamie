type AuthBootDetail = Record<string, unknown>;

const loggedAuthBootPhases = new Set<string>();
let lastLoggedSessionUserId: string | null = null;

export function logAuthBoot(phase: string, detail?: AuthBootDetail): void {
  const key = phase;
  if (loggedAuthBootPhases.has(key)) return;
  loggedAuthBootPhases.add(key);
  console.info(`[AUTH_BOOT] ${phase}`, detail ?? {});
}

export function logAuthSessionFound(detail?: AuthBootDetail): void {
  const userId = typeof detail?.userId === "string" ? detail.userId : null;
  if (userId && lastLoggedSessionUserId === userId) return;
  if (userId) lastLoggedSessionUserId = userId;
  console.info("[AUTH_SESSION_FOUND]", detail ?? {});
}

export function logAuthSessionMissing(detail?: AuthBootDetail): void {
  console.info("[AUTH_SESSION_MISSING]", detail ?? {});
}

export function logAuthRestoreSettled(detail?: AuthBootDetail): void {
  console.info("[AUTH_RESTORE_SETTLED]", detail ?? {});
}

export function logProfileLoad(detail?: AuthBootDetail): void {
  console.info("[PROFILE_LOAD]", detail ?? {});
}

export function logProfileLoadFail(detail?: AuthBootDetail): void {
  console.info("[PROFILE_LOAD_FAIL]", detail ?? {});
}

export function logAuthRedirectLogin(reason: string, detail?: AuthBootDetail): void {
  console.info("[AUTH_REDIRECT_LOGIN]", { reason, ...(detail ?? {}) });
}
