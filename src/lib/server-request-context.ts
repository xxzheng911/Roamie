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

declare module "@tanstack/react-router" {
  interface Register {
    server: {
      requestContext: RoamieServerRequestContext;
    };
  }
}
