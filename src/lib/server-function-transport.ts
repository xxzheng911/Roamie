import { validatePublicApiOrigin } from "@/lib/api-url";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { isServerFunctionPath, NATIVE_RPC_ORIGIN } from "@/lib/native-rpc-policy";

/** Only local native RPCs may use the build-configured production authority. */
export function resolveServerFunctionUrl(url: string, context: {
  native: boolean; pageUrl: string; appOrigin?: string;
}): string {
  if (!context.native) return url;
  const page = new URL(context.pageUrl);
  // URL.origin may be "null" for custom schemes; compare the explicit authority.
  if (`${page.protocol}//${page.host}` !== NATIVE_RPC_ORIGIN) return url;
  const request = new URL(url, page);
  if (!isServerFunctionPath(request.pathname)) return url;
  if (`${request.protocol}//${request.host}` !== NATIVE_RPC_ORIGIN || request.username || request.password) {
    throw new Error("native_rpc_origin_not_allowed");
  }
  if (!context.appOrigin?.trim()) throw new Error("native_rpc_origin_missing");
  const origin = validatePublicApiOrigin(context.appOrigin.trim());
  if (origin.pathname !== "/") throw new Error("native_rpc_origin_invalid");
  return `${origin.origin}${request.pathname}${request.search}`;
}

export const serverFunctionFetch: typeof fetch = (input, init) => {
  if (typeof window === "undefined" || !isCapacitorNativeShell()) return fetch(input, init);
  const original = input instanceof Request ? input.url : String(input);
  const resolved = resolveServerFunctionUrl(original, {
    native: true, pageUrl: window.location.href, appOrigin: import.meta.env.VITE_APP_ORIGIN,
  });
  if (resolved === original) return fetch(input, init);
  // Request constructor preserves method/headers/body/signal; init overrides remain intact.
  const request = input instanceof Request ? new Request(resolved, input) : resolved;
  return fetch(request, { ...init, credentials: "omit" });
};
