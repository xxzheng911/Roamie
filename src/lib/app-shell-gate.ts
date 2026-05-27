/** 避免每次進入 _app 子路由都重跑完整 auth / startup 解析（會造成行程詳情閃屏） */
let shellGatePassedAt = 0;
let shellGateUserId: string | null = null;

const SHELL_GATE_CACHE_MS = 60_000;

export function peekAppShellGateCache(userId: string | null): boolean {
  if (!shellGatePassedAt || !userId) return false;
  if (shellGateUserId !== userId) return false;
  return Date.now() - shellGatePassedAt < SHELL_GATE_CACHE_MS;
}

export function markAppShellGatePassed(userId: string): void {
  shellGatePassedAt = Date.now();
  shellGateUserId = userId;
}

export function invalidateAppShellGateCache(): void {
  shellGatePassedAt = 0;
  shellGateUserId = null;
}
