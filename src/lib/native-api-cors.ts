import { isServerFunctionPath, NATIVE_RPC_ORIGIN } from "@/lib/native-rpc-policy";

export function isTrustedNativeApiRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return request.headers.get("origin") === NATIVE_RPC_ORIGIN &&
    (path.startsWith("/api/") || isServerFunctionPath(path));
}

export function withNativeApiCors(request: Request, response: Response): Response {
  if (!isTrustedNativeApiRequest(request)) return response;
  const rpc = isServerFunctionPath(new URL(request.url).pathname);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", NATIVE_RPC_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", rpc
    ? "Authorization, Content-Type, X-Tsr-ServerFn"
    : "Authorization, Content-Type, X-Roamie-Request-Id, X-Roamie-Stream, X-Roamie-Cancel");
  if (rpc) headers.set("Access-Control-Expose-Headers", "X-Tss-Serialized, X-Tss-Raw");
  const vary = headers.get("Vary");
  if (!vary?.split(",").some(v => ["origin", "*"].includes(v.trim().toLowerCase()))) {
    headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
