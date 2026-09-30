import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { unsplashProxyDisabledResponse } from "@/lib/kill-switch.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { resolveUnsplashAccessKey } from "@/lib/unsplash-key.server";

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";
const MAX_BODY_BYTES = 2_048;
const UPSTREAM_TIMEOUT_MS = 8_000;

const SearchPhotosBody = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    per_page: z.literal(5),
    orientation: z.literal("landscape"),
    content_filter: z.literal("high"),
  })
  .strict();

type SearchPhotosBody = z.infer<typeof SearchPhotosBody>;

export type UnsplashProxyDeps = {
  authenticate: (request: Request, env: CloudflareRuntimeEnv) => Promise<string | null>;
  fetchImpl: typeof fetch;
  resolveAccessKey: (env: CloudflareRuntimeEnv) => string | null;
};

export async function authenticateUnsplashRequest(
  request: Request,
  env: CloudflareRuntimeEnv,
): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length > 8_192) return null;
  const url = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || typeof key !== "string") throw new Error("auth_unavailable");
  const client = createClient(url.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, ""), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.getUser(auth.slice(7));
  return result.error ? null : (result.data.user?.id ?? null);
}

function json(body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new RangeError("request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function projectResults(payload: unknown): {
  results: Array<{ urls: { regular?: string; small?: string }; user: { name?: string } }>;
} {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return { results: [] };
  return {
    results: results.slice(0, 5).map((item) => {
      const urls = (item as { urls?: { regular?: unknown; small?: unknown } } | null)?.urls;
      const name = (item as { user?: { name?: unknown } } | null)?.user?.name;
      return {
        urls: {
          ...(typeof urls?.regular === "string" ? { regular: urls.regular } : {}),
          ...(typeof urls?.small === "string" ? { small: urls.small } : {}),
        },
        user: typeof name === "string" ? { name } : {},
      };
    }),
  };
}

function buildSearchUrl(body: SearchPhotosBody): URL {
  const upstreamUrl = new URL(UNSPLASH_SEARCH_URL);
  upstreamUrl.searchParams.set("query", body.query);
  upstreamUrl.searchParams.set("per_page", "5");
  upstreamUrl.searchParams.set("orientation", "landscape");
  upstreamUrl.searchParams.set("content_filter", "high");
  if (
    upstreamUrl.origin !== "https://api.unsplash.com" ||
    upstreamUrl.pathname !== "/search/photos"
  ) {
    throw new Error("unsplash_target_invalid");
  }
  return upstreamUrl;
}

const defaultDeps: UnsplashProxyDeps = {
  authenticate: authenticateUnsplashRequest,
  fetchImpl: (input, init) => fetch(input, init),
  resolveAccessKey: resolveUnsplashAccessKey,
};

export async function handleUnsplashProxy(
  request: Request,
  env: CloudflareRuntimeEnv,
  deps: UnsplashProxyDeps = defaultDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== "capacitor://localhost" && origin !== new URL(request.url).origin) {
    return json({ error: "origin_forbidden" }, 403);
  }
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "invalid_content_type" }, 415);
  }
  try {
    const userId = await deps.authenticate(request, env);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const disabled = unsplashProxyDisabledResponse(env);
    if (disabled) return disabled;
    let body: SearchPhotosBody;
    try {
      body = SearchPhotosBody.parse(await readJson(request));
    } catch (failure) {
      return json({ error: "invalid_request" }, failure instanceof RangeError ? 413 : 400);
    }
    const accessKey = deps.resolveAccessKey(env);
    if (!accessKey) return json({ error: "unsplash_unavailable" }, 503);
    const upstreamUrl = buildSearchUrl(body);
    let upstream: Response;
    try {
      // Workers have no pre-dispatch redirect rejection mode. manual returns 3xx here.
      upstream = await deps.fetchImpl(upstreamUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          Authorization: `Client-ID ${accessKey}`,
        },
      });
    } catch {
      return json({ error: "unsplash_unavailable" }, 502);
    }
    // Never follow Location or resend Authorization. 3xx and other non-2xx share one failure.
    if ((upstream.status >= 300 && upstream.status <= 399) || !upstream.ok) {
      await upstream.body?.cancel();
      return json({ error: "unsplash_unavailable" }, 502);
    }
    try {
      return json(projectResults(await upstream.json()), 200);
    } catch {
      return json({ error: "unsplash_unavailable" }, 502);
    }
  } catch {
    return json({ error: "unsplash_unavailable" }, 503);
  }
}
