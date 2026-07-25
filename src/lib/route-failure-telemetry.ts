export type RouteFailureKind =
  | "http_error"
  | "zero_results"
  | "not_found"
  | "invalid_request"
  | "request_denied"
  | "over_query_limit"
  | "unknown_google_status"
  | "empty_routes"
  | "empty_legs"
  | "invalid_duration"
  | "parse_error"
  | "network_error"
  | "aborted"
  | "unknown";

export type RouteApiFailureTelemetry = {
  endpoint: "directions_api" | "routes_api" | "unknown";
  httpStatus: number;
  httpOk: boolean;
  googleStatus: string;
  googleErrorMessage: string;
  routesCount: number;
  legsCount: number;
  parserResult: "parsed" | "parse_error" | "invalid_duration";
  failureKind: RouteFailureKind;
  exceptionName: string;
  exceptionMessage: string;
};

export function sanitizeRouteTelemetryText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1***")
    .replace(/AIza[\w-]{20,}/g, "***")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

export function maskRoutePlaceId(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().replace(/^places\//i, "");
  if (!normalized) return "";
  if (normalized.length <= 10) return `${normalized.slice(0, 3)}…${normalized.slice(-2)}`;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function classifyRouteFailure(params: {
  httpStatus: number;
  httpOk: boolean;
  googleStatus?: string | null;
  routesCount?: number;
  legsCount?: number;
  parserResult?: RouteApiFailureTelemetry["parserResult"];
  exceptionName?: string;
}): RouteFailureKind {
  const exception = (params.exceptionName ?? "").toLowerCase();
  if (/abort/.test(exception)) return "aborted";
  if (exception) return "network_error";
  if (params.parserResult === "parse_error") return "parse_error";
  if (params.parserResult === "invalid_duration") return "invalid_duration";

  const status = (params.googleStatus ?? "").toUpperCase();
  if (status === "ZERO_RESULTS") return "zero_results";
  if (status === "NOT_FOUND") return "not_found";
  if (status === "INVALID_REQUEST" || status === "INVALID_ARGUMENT") return "invalid_request";
  if (status === "REQUEST_DENIED" || status === "PERMISSION_DENIED") return "request_denied";
  if (status === "OVER_QUERY_LIMIT" || status === "RESOURCE_EXHAUSTED") {
    return "over_query_limit";
  }
  if (!params.httpOk) return "http_error";
  if (status === "OK" && (params.routesCount ?? 0) === 0) return "empty_routes";
  if (status === "OK" && (params.routesCount ?? 0) > 0 && (params.legsCount ?? 0) === 0) {
    return "empty_legs";
  }
  if (status && status !== "UNKNOWN") return "unknown_google_status";
  return "unknown";
}
