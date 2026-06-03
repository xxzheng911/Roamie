export const APPLE_SIGN_IN_TEMP_FAIL_MSG = "Apple 登入暫時失敗，請稍後再試";

export function logAppleAuthStart(fields?: Record<string, unknown>): void {
  console.info("[APPLE_AUTH_START]", { at: new Date().toISOString(), ...fields });
}

export function logAppleAuthIdTokenReceived(hasToken: boolean): void {
  console.info("[APPLE_AUTH_ID_TOKEN_RECEIVED]", { hasToken });
}

export function logAppleAuthTokenExchangeStart(fields: {
  host: string;
  attempt: number;
}): void {
  console.info("[APPLE_AUTH_TOKEN_EXCHANGE_START]", fields);
}

export function logAppleAuthTokenExchangeSuccess(fields: {
  ms: number;
  via: string;
  userId?: string;
}): void {
  console.info("[APPLE_AUTH_TOKEN_EXCHANGE_SUCCESS]", fields);
}

export function logAppleAuthTokenExchangeTimeout(fields: {
  ms: number;
  attempt: number;
  via: string;
}): void {
  console.warn("[APPLE_AUTH_TOKEN_EXCHANGE_TIMEOUT]", fields);
}

export function logAppleAuthTokenExchangeError(fields: {
  ms: number;
  attempt: number;
  via: string;
  message: string;
}): void {
  console.error("[APPLE_AUTH_TOKEN_EXCHANGE_ERROR]", fields);
}

export function logAppleAuthSessionReady(userId: string | undefined): void {
  console.info("[APPLE_AUTH_SESSION_READY]", { userId: userId ?? null });
}

export function logAppleAuthNavigateHome(target: string): void {
  console.info("[APPLE_AUTH_NAVIGATE_HOME]", { target });
}
