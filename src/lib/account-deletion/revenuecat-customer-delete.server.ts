import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const REVENUECAT_V2_BASE_URL = "https://api.revenuecat.com/v2";
const REQUEST_TIMEOUT_MS = 8_000;

type RevenueCatCustomer = {
  id: string;
  project_id: string;
};

type RevenueCatList<T> = {
  items: T[];
  next_page?: string | null;
};

type Fetcher = typeof fetch;

function readServerEnv(env: CloudflareRuntimeEnv, name: string): string | undefined {
  const runtime = env[name];
  if (typeof runtime === "string" && runtime.trim()) return runtime.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function revenueCatHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

function failureFor(stage: "lookup" | "aliases" | "delete", status: number): Error {
  if (status === 401 || status === 403)
    return new Error(`account_revenuecat_${stage}_unauthorized`);
  if (status >= 500 || status === 408 || status === 423 || status === 429)
    return new Error(`account_revenuecat_${stage}_retryable`);
  return new Error(`account_revenuecat_${stage}_failed`);
}

function isCustomer(value: unknown): value is RevenueCatCustomer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RevenueCatCustomer>;
  return typeof candidate.id === "string" && typeof candidate.project_id === "string";
}

function parseList(value: unknown): RevenueCatList<unknown> {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items))
    throw new Error("account_revenuecat_response_invalid");
  return value as RevenueCatList<unknown>;
}

async function customerHasAppUserId(params: {
  apiKey: string;
  projectId: string;
  customerId: string;
  appUserId: string;
  fetcher: Fetcher;
}): Promise<boolean> {
  // RevenueCat may use an opaque canonical customer ID, so verify the requested
  // Supabase UUID against the customer's App User ID aliases before deletion.
  if (params.customerId === params.appUserId) return true;

  let nextUrl: string | null = `${REVENUECAT_V2_BASE_URL}/projects/${encodeURIComponent(
    params.projectId,
  )}/customers/${encodeURIComponent(params.customerId)}/aliases?limit=100`;
  for (let page = 0; nextUrl && page < 10; page += 1) {
    const response = await params.fetcher(nextUrl, {
      headers: revenueCatHeaders(params.apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw failureFor("aliases", response.status);
    const payload = parseList(await response.json());
    if (
      payload.items.some(
        (item) =>
          Boolean(item) &&
          typeof item === "object" &&
          (item as { id?: unknown }).id === params.appUserId,
      )
    )
      return true;
    nextUrl = payload.next_page
      ? new URL(payload.next_page, REVENUECAT_V2_BASE_URL).toString()
      : null;
  }
  return false;
}

export async function deleteRevenueCatCustomerV2(
  env: CloudflareRuntimeEnv,
  authenticatedUserId: string,
  options?: {
    fetcher?: Fetcher;
    diagnostic?: (event: {
      stage: "lookup" | "lookup_complete" | "delete" | "delete_complete";
      status?: number;
    }) => void;
  },
): Promise<void> {
  const apiKey = readServerEnv(env, "REVENUECAT_V2_SECRET_API_KEY");
  const projectId = readServerEnv(env, "REVENUECAT_PROJECT_ID");
  if (!apiKey || !projectId) throw new Error("account_revenuecat_configuration_missing");

  const fetcher = options?.fetcher ?? globalThis.fetch.bind(globalThis);
  const searchUrl = new URL(
    `${REVENUECAT_V2_BASE_URL}/projects/${encodeURIComponent(projectId)}/customers`,
  );
  searchUrl.searchParams.set("search", authenticatedUserId);
  searchUrl.searchParams.set("limit", "100");
  options?.diagnostic?.({ stage: "lookup" });
  const searchResponse = await fetcher(searchUrl, {
    headers: revenueCatHeaders(apiKey),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  options?.diagnostic?.({ stage: "lookup_complete", status: searchResponse.status });
  if (searchResponse.status === 404) return;
  if (!searchResponse.ok) throw failureFor("lookup", searchResponse.status);

  const searchPayload = parseList(await searchResponse.json());
  const candidates = searchPayload.items.filter(isCustomer);
  if (candidates.length === 0) return;
  if (candidates.some((candidate) => candidate.project_id !== projectId))
    throw new Error("account_revenuecat_project_mismatch");

  const verified: RevenueCatCustomer[] = [];
  for (const candidate of candidates) {
    if (
      await customerHasAppUserId({
        apiKey,
        projectId,
        customerId: candidate.id,
        appUserId: authenticatedUserId,
        fetcher,
      })
    )
      verified.push(candidate);
  }
  if (verified.length !== 1) throw new Error("account_revenuecat_customer_mismatch");

  options?.diagnostic?.({ stage: "delete" });
  const deleteResponse = await fetcher(
    `${REVENUECAT_V2_BASE_URL}/projects/${encodeURIComponent(
      projectId,
    )}/customers/${encodeURIComponent(verified[0].id)}`,
    {
      method: "DELETE",
      headers: revenueCatHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  options?.diagnostic?.({ stage: "delete_complete", status: deleteResponse.status });
  // A prior attempt can have queued/deleted the customer even if its response was lost.
  if (deleteResponse.status === 404) return;
  if (!deleteResponse.ok) throw failureFor("delete", deleteResponse.status);
}
