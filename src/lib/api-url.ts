import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

const ALLOWED_API_PATHS = new Set([
  "/api/roamie",
  "/api/generate-itinerary",
  "/api/analytics/events",
  "/api/place-photo",
  "/api/admin/dashboard",
]);

export class ApiUrlError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ApiUrlError";
    this.code = code;
  }
}

export function isApiUrlError(error: unknown): error is ApiUrlError {
  return error instanceof ApiUrlError;
}

export function validatePublicApiOrigin(raw: string, allowLocalHttp = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiUrlError("native_api_origin_invalid");
  }
  const localHttp =
    allowLocalHttp &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new ApiUrlError("native_api_origin_invalid");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiUrlError("native_api_origin_invalid");
  }
  return url;
}

export function resolveApiUrl(
  path: string,
  options?: { native?: boolean; origin?: string; allowLocalHttp?: boolean },
): string {
  const pathname = path.split("?")[0]!;
  if (!ALLOWED_API_PATHS.has(pathname)) throw new ApiUrlError("api_path_not_allowed");
  const native = options?.native ?? isCapacitorNativeShell();
  if (!native) return path;
  const rawOrigin = options?.origin ?? (import.meta.env.VITE_APP_ORIGIN as string | undefined);
  if (!rawOrigin?.trim()) throw new ApiUrlError("native_api_origin_missing");
  const origin = validatePublicApiOrigin(rawOrigin.trim(), options?.allowLocalHttp);
  return new URL(path, `${origin.origin}/`).toString();
}

export function apiEndpointDiagnostic(url: string): { endpointScheme: string; endpointHost: string } {
  const parsed = new URL(url, typeof window === "undefined" ? "https://localhost" : window.location.origin);
  return { endpointScheme: parsed.protocol.replace(":", ""), endpointHost: parsed.host };
}
