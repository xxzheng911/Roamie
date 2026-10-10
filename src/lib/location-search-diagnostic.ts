/** Never serialize the error itself: messages may contain response bodies or credentials. */
export function locationSearchDiagnostic(error: unknown, stage: "autocomplete" | "details", endpoint: unknown) {
  const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" ? v as Record<string, unknown> : {};
  const e = record(error);
  const response = record(e.response);
  const status = [e.status, e.statusCode, response.status].find(v => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599) ?? null;
  const rawName = typeof e.name === "string" ? e.name : "";
  const rawMessage = typeof e.message === "string" ? e.message : "";
  const names = ["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError", "NetworkError"];
  const name = names.includes(rawName) ? rawName : "UnknownError";
  // Only fixed, known-safe messages/codes leave this helper. Unknown text is never logged.
  const messages = ["Failed to fetch", "Load failed", "Network request failed", "The operation was aborted."];
  const codes = ["UNAUTHORIZED", "FORBIDDEN", "TIMEOUT", "NETWORK_ERROR", "invalid_google_request", "unauthorized", "forbidden", "google_unavailable", "guard_unavailable"];
  const serverErrorCode = codes.includes(String(e.code)) ? String(e.code) : null;
  const category = status === 401 || status === 403 || ["UNAUTHORIZED", "FORBIDDEN", "unauthorized", "forbidden"].includes(serverErrorCode ?? "") ? "auth"
    : name === "TimeoutError" || serverErrorCode === "TIMEOUT" ? "timeout"
    : typeof status === "number" && status >= 300 ? "http_non_2xx"
    : ["Failed to fetch", "Load failed", "Network request failed"].includes(rawMessage) || name === "NetworkError" ? "fetch_network"
    : name === "SyntaxError" && /JSON/i.test(rawMessage) ? "json_parse"
    : name === "AbortError" ? "abort"
    : serverErrorCode ? "server_function" : "unknown";
  let endpointPathname: string | null = null;
  try {
    if (typeof endpoint === "string") {
      const path = new URL(endpoint, "https://diagnostic.invalid").pathname;
      // Server-function generated IDs only; never arbitrary paths containing personal data.
      if (/^\/_serverFn\/[a-zA-Z0-9_-]+$/.test(path)) endpointPathname = path;
    }
  } catch { /* unavailable metadata stays unknown */ }
  return { stage, category, errorName: name, errorMessage: messages.includes(rawMessage) ? rawMessage : "[redacted]", httpStatus: status, serverErrorCode, endpointPathname };
}
