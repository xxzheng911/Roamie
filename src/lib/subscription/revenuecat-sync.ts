import { supabase } from "@/lib/supabase";
import { isApiUrlError, resolveApiUrl } from "@/lib/api-url";

type SubscriptionSyncFailureDiagnostic = {
  event: "server_sync_failed";
  errorCode: "subscription_sync_failed" | string;
};

export type SubscriptionServerSyncResult = {
  ok: boolean;
  active: boolean | null;
  expiresAt: string | null;
  lifecyclePersisted?: boolean;
  errorCode?: string;
};

export function isCanonicalRestoreConfirmed(
  customerInfoActive: boolean,
  syncResult: SubscriptionServerSyncResult,
): boolean {
  return customerInfoActive && syncResult.ok && syncResult.active === true;
}

export async function syncRevenueCatEntitlementWithServer(): Promise<SubscriptionServerSyncResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    console.info("[REVENUECAT_CANONICAL_SYNC]", {
      requestAttempted: false,
      httpOk: false,
      responseActive: false,
      lifecyclePersisted: false,
      canonicalRevisionPublished: false,
      errorCode: "subscription_session_missing",
    });
    return { ok: false, active: null, expiresAt: null, errorCode: "subscription_session_missing" };
  }
  let response: Response;
  try {
    response = await fetch(resolveApiUrl("/api/subscription/sync"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    console.info("[REVENUECAT_CANONICAL_SYNC]", {
      requestAttempted: true,
      httpOk: false,
      responseActive: false,
      lifecyclePersisted: false,
      canonicalRevisionPublished: false,
      errorCode: "subscription_sync_network_failed",
    });
    return {
      ok: false,
      active: null,
      expiresAt: null,
      errorCode: "subscription_sync_network_failed",
    };
  }
  const payload = (await response.json().catch(() => null)) as {
    active?: unknown;
    expiresAt?: unknown;
    lifecyclePersisted?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    console.info("[REVENUECAT_CANONICAL_SYNC]", {
      requestAttempted: true,
      httpOk: false,
      responseActive: false,
      lifecyclePersisted: false,
      canonicalRevisionPublished: false,
      errorCode: typeof payload?.error === "string" ? payload.error : "subscription_sync_failed",
    });
    return {
      ok: false,
      active: null,
      expiresAt: null,
      errorCode: typeof payload?.error === "string" ? payload.error : "subscription_sync_failed",
    };
  }
  const result = {
    ok: true,
    active: payload?.active === true,
    expiresAt: typeof payload?.expiresAt === "string" ? payload.expiresAt : null,
    lifecyclePersisted: payload?.lifecyclePersisted === true,
  };
  console.info("[REVENUECAT_CANONICAL_SYNC]", {
    requestAttempted: true,
    httpOk: true,
    responseActive: result.active,
    lifecyclePersisted: result.lifecyclePersisted,
    canonicalRevisionPublished: false,
  });
  return result;
}

export async function syncRevenueCatEntitlementAfterRestore(options?: {
  sync?: () => Promise<SubscriptionServerSyncResult>;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<SubscriptionServerSyncResult> {
  const sync = options?.sync ?? syncRevenueCatEntitlementWithServer;
  const wait =
    options?.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const delays = [0, 500, 1_500] as const;
  let result: SubscriptionServerSyncResult = { ok: false, active: null, expiresAt: null };
  for (const delay of delays) {
    if (delay) await wait(delay);
    result = await sync();
    if (result.active === true) return result;
    if (
      !result.ok &&
      /configuration_missing|session_missing|unauthorized/i.test(result.errorCode ?? "")
    ) {
      return result;
    }
  }
  return result;
}

/** CustomerInfo listeners must not leak a background sync rejection globally. */
export function syncRevenueCatEntitlementInBackground(options?: {
  sync?: () => Promise<SubscriptionServerSyncResult>;
  report?: (diagnostic: SubscriptionSyncFailureDiagnostic) => void;
}): void {
  const sync = options?.sync ?? syncRevenueCatEntitlementWithServer;
  void sync().catch((cause) => {
    const diagnostic: SubscriptionSyncFailureDiagnostic = {
      event: "server_sync_failed",
      errorCode: isApiUrlError(cause) ? cause.code : "subscription_sync_failed",
    };
    if (options?.report) options.report(diagnostic);
    else console.warn("[REVENUECAT_STATE]", diagnostic);
  });
}
