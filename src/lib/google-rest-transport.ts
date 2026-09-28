/** Non-credential marker retained only for existing parsing helper signatures. */
export function getGoogleRestTransportToken(): string {
  return "roamie-server-proxy";
}

export async function googleRestFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  url.searchParams.delete("key");
  const fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask");
  const payload = {
    url: url.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    ...(fieldMask ? { fieldMask } : {}),
    ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
  };
  if (import.meta.env.SSR) {
    const { fetchGoogleRestProvider } = await import("@/lib/google-rest-provider.server");
    return fetchGoogleRestProvider(payload);
  }
  const [{ getClientAuthSession }, { resolveApiUrl }] = await Promise.all([
    import("@/lib/auth-session"),
    import("@/lib/api-url"),
  ]);
  const session = await getClientAuthSession();
  if (!session?.access_token) return Response.json({ error: "unauthorized" }, { status: 401 });
  return fetch(resolveApiUrl("/api/google"), {
    method: "POST",
    signal: init?.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
}
