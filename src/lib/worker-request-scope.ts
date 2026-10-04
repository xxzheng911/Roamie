import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

type ScopeStorage = {
  run<T>(store: WorkerRequestScope, fn: () => T): T;
  getStore(): WorkerRequestScope | undefined;
};

let currentScope: WorkerRequestScope | undefined;

const fallbackStorage: ScopeStorage = {
  run(store, fn) {
    const previous = currentScope;
    currentScope = store;
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.finally(() => {
          currentScope = previous;
        }) as typeof result;
      }
      currentScope = previous;
      return result;
    } catch (error) {
      currentScope = previous;
      throw error;
    }
  },
  getStore() {
    return currentScope;
  },
};

let storage: ScopeStorage = fallbackStorage;

/** Called from the Worker entry before requests are served. */
export function registerWorkerStorage(next: ScopeStorage): void {
  storage = next;
}

export type WorkerRequestScope = {
  env?: CloudflareRuntimeEnv;
  request?: Request;
  verifiedUserId?: string;
  testUserId?: string;
  testIp?: string;
  allowLocalIp?: boolean;
  userBurstDone?: boolean;
  ipBurstDone?: boolean;
  guestBurstDone?: boolean;
  /** Server-only. Set by the public-read middleware after a trusted IP rate key is admitted. */
  publicReadAuthorized?: boolean;
  publicReadRateKey?: string;
  aiOperationKeys?: Partial<Record<string, string>>;
};

let productionOverride: boolean | null = null;

export function isProductionGuardRuntime(): boolean {
  if (productionOverride !== null) return productionOverride;
  return import.meta.env?.PROD === true;
}

/** Test-only. A production bundle cannot flip this, and request headers cannot either. */
export function setGuardProductionForTests(value: boolean | null): void {
  if (import.meta.env?.PROD === true) throw new Error("test_context_forbidden");
  productionOverride = value;
}

export function getWorkerScope(): WorkerRequestScope | undefined {
  return storage.getStore();
}

export function runWithWorkerRequest<T>(
  scope: Pick<WorkerRequestScope, "env" | "request" | "allowLocalIp">,
  fn: () => T,
): T {
  return storage.run(
    {
      env: scope.env,
      request: scope.request,
      allowLocalIp: scope.allowLocalIp === true && !isProductionGuardRuntime(),
    },
    fn,
  );
}

export function runWithGuardTestContext<T>(
  principal: { userId: string; ip: string },
  fn: () => T,
): T {
  if (isProductionGuardRuntime()) throw new Error("test_context_forbidden");
  const parent = storage.getStore();
  return storage.run(
    {
      ...parent,
      testUserId: principal.userId,
      testIp: principal.ip,
      verifiedUserId: principal.userId,
    },
    fn,
  );
}

export function bindIncomingRequest(request: Request): void {
  const store = storage.getStore();
  if (store && !store.request) store.request = request;
}

export function bindVerifiedUserId(userId: string): void {
  const store = storage.getStore();
  if (!store || !userId) return;
  store.verifiedUserId = userId;
}

/** Guest public read. Never accepts a client-supplied identity. */
export function markPublicReadAuthorized(rateKey: string): void {
  const store = storage.getStore();
  if (!store || !rateKey) return;
  store.publicReadAuthorized = true;
  store.publicReadRateKey = rateKey;
}

export function isPublicReadAuthorized(): boolean {
  return storage.getStore()?.publicReadAuthorized === true;
}

function restoreAfter<T>(fn: () => T, restore: () => void): T {
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore) as T;
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

export function runWithVerifiedPrincipal<T>(userId: string, fn: () => T): T {
  const existing = storage.getStore();
  if (!existing) return storage.run({ verifiedUserId: userId }, fn);
  const previous = existing.verifiedUserId;
  existing.verifiedUserId = userId;
  return restoreAfter(fn, () => {
    existing.verifiedUserId = previous;
  });
}

export function resolveTrustedUserId(): string | null {
  const store = storage.getStore();
  if (!store) return null;
  if (isProductionGuardRuntime()) return store.verifiedUserId ?? null;
  return store.testUserId ?? store.verifiedUserId ?? null;
}

export function resolveTrustedIp(request?: Request): string | null {
  const store = storage.getStore();
  if (!isProductionGuardRuntime() && store?.testIp) return store.testIp;
  const source = request ?? store?.request;
  const connecting = source?.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (connecting) return connecting;
  if (!isProductionGuardRuntime() && store?.allowLocalIp) return "local-dev";
  return null;
}

export function rememberAiOperation(surface: string, operationId: string): string {
  const store = storage.getStore();
  const existing = store?.aiOperationKeys?.[surface];
  if (existing) return existing;
  if (store) store.aiOperationKeys = { ...store.aiOperationKeys, [surface]: operationId };
  return operationId;
}

export function currentAiOperation(surface: string): string | undefined {
  return storage.getStore()?.aiOperationKeys?.[surface];
}
