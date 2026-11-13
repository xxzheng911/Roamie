export type CloudflareRuntimeEnv = Readonly<Record<string, unknown>>;

export type CloudflareExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

export type RoamieServerRequestContext = {
  cloudflareEnv: CloudflareRuntimeEnv;
  executionCtx: CloudflareExecutionContext;
};

export function createRoamieServerRequestContext(
  cloudflareEnv: CloudflareRuntimeEnv,
  executionCtx: CloudflareExecutionContext,
): RoamieServerRequestContext {
  return { cloudflareEnv, executionCtx };
}

/**
 * Keeps a promise alive past the response / client disconnect (Workers
 * ctx.waitUntil). No-op when no execution context is available (tests, dev).
 */
export function waitUntilFromContext(context: unknown, promise: Promise<unknown>): void {
  const executionCtx = (context as Partial<RoamieServerRequestContext> | null | undefined)
    ?.executionCtx;
  if (typeof executionCtx?.waitUntil !== "function") return;
  try {
    executionCtx.waitUntil(promise.catch(() => undefined));
  } catch {
    // waitUntil unavailable after the request ended: the promise still runs.
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    server: {
      requestContext: RoamieServerRequestContext;
    };
  }
}
