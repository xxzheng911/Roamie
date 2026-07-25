export type PlaceDetailRequestPath = "server" | "capacitor_client" | "cache" | "unknown";

export type PlaceDetailFailureKind =
  | "http_error"
  | "bad_request"
  | "permission_denied"
  | "not_found"
  | "resource_exhausted"
  | "unavailable"
  | "rate_limited"
  | "parse_error"
  | "network_error"
  | "cors_error"
  | "timeout"
  | "aborted"
  | "invalid_payload"
  | "empty_response"
  | "unknown";

export type PlaceDetailResponseShape = {
  responsePlaceIdPresent: boolean;
  responseDisplayNamePresent: boolean;
  responseLocationPresent: boolean;
  responsePhotosArray: boolean;
  responseTypesArray: boolean;
};

export type PlaceDetailBoundaryTelemetry = {
  cacheHit: boolean;
  cachePlacePresent: boolean;
  cacheEnvelopeValid: boolean;
  serverAttempted: boolean;
  serverPlacePresent: boolean;
  serverErrorPresent: boolean;
  serverErrorCode: string;
  clientFallbackAttempted: boolean;
  clientPlacePresent: boolean;
  clientErrorPresent: boolean;
  clientErrorCode: string;
  firstNullErrorBoundary: string;
};

type GoogleErrorEnvelope = {
  error?: { code?: number; status?: string; message?: string };
};

function safeText(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1***")
    .replace(/AIza[\w-]{20,}/g, "***")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
}

export function maskPlaceDetailId(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const normalized = raw.replace(/^places\//i, "").replace(/^place_id:/i, "");
  if (!normalized) return "";
  if (normalized.length <= 10) return `${normalized.slice(0, 3)}…${normalized.slice(-2)}`;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function placeDetailIdKind(value: string | null | undefined):
  | "raw_google_place_id"
  | "places_resource_name"
  | "place_id_prefixed"
  | "synthetic"
  | "invalid"
  | "missing" {
  const raw = (value ?? "").trim();
  if (!raw) return "missing";
  if (/^places\/ChIJ[\w-]+$/i.test(raw)) return "places_resource_name";
  if (/^place_id:ChIJ[\w-]+$/i.test(raw)) return "place_id_prefixed";
  if (/^ChIJ[\w-]+$/i.test(raw)) return "raw_google_place_id";
  if (/^(latlng:|saved-|trip-|session:|memory:|synthetic:|name:|dayplan:|core:)/i.test(raw)) {
    return "synthetic";
  }
  return "invalid";
}

export function normalizedPlaceDetailIdForTelemetry(value: string): string {
  return value.trim().replace(/^places\//i, "").replace(/^place_id:/i, "");
}

export function placeDetailFieldMaskHash(fieldMask: string): string {
  let hash = 2166136261;
  for (let index = 0; index < fieldMask.length; index += 1) {
    hash ^= fieldMask.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function parseGooglePlaceDetailError(bodyText: string): {
  code: number | null;
  status: string;
  message: string;
} {
  try {
    const parsed = JSON.parse(bodyText) as GoogleErrorEnvelope;
    return {
      code: typeof parsed.error?.code === "number" ? parsed.error.code : null,
      status: safeText(parsed.error?.status),
      message: safeText(parsed.error?.message),
    };
  } catch {
    return { code: null, status: "", message: "" };
  }
}

export function classifyPlaceDetailFailure(input: {
  httpStatus: number;
  googleErrorStatus?: string;
  parserResult?: "parsed" | "failed" | "invalid_payload" | "empty_response";
  exceptionName?: string;
  exceptionMessage?: string;
}): PlaceDetailFailureKind {
  const exceptionName = (input.exceptionName ?? "").toLowerCase();
  const exceptionMessage = (input.exceptionMessage ?? "").toLowerCase();
  if (/abort/.test(exceptionName)) return "aborted";
  if (/timeout/.test(exceptionName) || /timed?\s*out/.test(exceptionMessage)) return "timeout";
  if (input.parserResult === "failed") return "parse_error";
  if (input.parserResult === "empty_response") return "empty_response";
  if (input.parserResult === "invalid_payload") return "invalid_payload";
  if (exceptionName === "typeerror" && /cors|failed to fetch|load failed/.test(exceptionMessage)) {
    return "cors_error";
  }
  if (exceptionName) return "network_error";

  const status = (input.googleErrorStatus ?? "").toUpperCase();
  if (input.httpStatus === 400 || status === "INVALID_ARGUMENT") return "bad_request";
  if (input.httpStatus === 401 || input.httpStatus === 403 || status === "PERMISSION_DENIED") {
    return "permission_denied";
  }
  if (input.httpStatus === 404 || status === "NOT_FOUND") return "not_found";
  if (input.httpStatus === 429) return "rate_limited";
  if (status === "RESOURCE_EXHAUSTED") return "resource_exhausted";
  if (input.httpStatus === 503 || status === "UNAVAILABLE") return "unavailable";
  if (input.httpStatus >= 400) return "http_error";
  return "unknown";
}

export function inspectPlaceDetailResponseShape(value: unknown): PlaceDetailResponseShape {
  if (typeof value !== "object" || value === null) {
    return {
      responsePlaceIdPresent: false,
      responseDisplayNamePresent: false,
      responseLocationPresent: false,
      responsePhotosArray: false,
      responseTypesArray: false,
    };
  }
  const record = value as Record<string, unknown>;
  const displayName = record.displayName;
  const location = record.location;
  return {
    responsePlaceIdPresent: typeof record.id === "string" && record.id.length > 0,
    responseDisplayNamePresent:
      typeof displayName === "object" &&
      displayName !== null &&
      typeof (displayName as Record<string, unknown>).text === "string",
    responseLocationPresent:
      typeof location === "object" &&
      location !== null &&
      typeof (location as Record<string, unknown>).latitude === "number" &&
      typeof (location as Record<string, unknown>).longitude === "number",
    responsePhotosArray: Array.isArray(record.photos),
    responseTypesArray: Array.isArray(record.types),
  };
}

export function logPlaceDetailRequestFailure(input: {
  placeId: string;
  requestPath: PlaceDetailRequestPath;
  languageCode: string;
  fieldMask: string;
  cacheStatus: "hit" | "miss" | "invalid" | "expired";
  serverAttempted: boolean;
  clientFallbackAttempted: boolean;
  httpStatus: number;
  httpOk: boolean;
  googleErrorCode: number | null;
  googleErrorStatus: string;
  googleErrorMessage: string;
  parserResult: "parsed" | "failed" | "invalid_payload" | "empty_response";
  failureKind: PlaceDetailFailureKind;
  exceptionName?: string;
  exceptionMessage?: string;
  shape: PlaceDetailResponseShape;
}): void {
  const masked = maskPlaceDetailId(input.placeId);
  const normalizedMasked = maskPlaceDetailId(normalizedPlaceDetailIdForTelemetry(input.placeId));
  console.warn(
    [
      "[PLACE_DETAIL_REQUEST_DETAIL]",
      `placeIdMasked=${masked}`,
      `idKind=${placeDetailIdKind(input.placeId)}`,
      `normalizedPlaceIdMasked=${normalizedMasked}`,
      `requestPath=${input.requestPath}`,
      "endpointKind=places_api_new_details",
      "method=GET",
      `languageCode=${input.languageCode}`,
      "regionCode=unset",
      `fieldMaskHash=${placeDetailFieldMaskHash(input.fieldMask)}`,
      `fieldMaskCount=${input.fieldMask.split(",").filter(Boolean).length}`,
      `cacheStatus=${input.cacheStatus}`,
      "triggerSource=place_detail_refresh",
      `serverAttempted=${input.serverAttempted}`,
      `clientFallbackAttempted=${input.clientFallbackAttempted}`,
    ].join(" "),
  );
  console.warn(
    [
      "[PLACE_DETAIL_API_RAW_STATUS]",
      `placeIdMasked=${masked}`,
      `requestPath=${input.requestPath}`,
      `httpStatus=${input.httpStatus}`,
      `httpOk=${input.httpOk}`,
      `googleErrorCode=${input.googleErrorCode ?? "none"}`,
      `googleErrorStatus=${safeText(input.googleErrorStatus) || "none"}`,
      `googleErrorMessage=${safeText(input.googleErrorMessage) || "none"}`,
      `parserResult=${input.parserResult}`,
      `failureKind=${input.failureKind}`,
      `exceptionName=${safeText(input.exceptionName) || "none"}`,
      `exceptionMessage=${safeText(input.exceptionMessage) || "none"}`,
      `responsePlaceIdPresent=${input.shape.responsePlaceIdPresent}`,
      `responseDisplayNamePresent=${input.shape.responseDisplayNamePresent}`,
      `responseLocationPresent=${input.shape.responseLocationPresent}`,
      `responsePhotosArray=${input.shape.responsePhotosArray}`,
      `responseTypesArray=${input.shape.responseTypesArray}`,
    ].join(" "),
  );
}

export function logPlaceDetailResultBoundary(input: {
  placeId: string;
  telemetry: PlaceDetailBoundaryTelemetry;
  finalError: string | null | undefined;
  snapshotPresent: boolean;
  baseDetailPresent: boolean;
}): void {
  const finalErrorCode = safeText(input.finalError);
  console.warn(
    [
      "[PLACE_DETAIL_RESULT_BOUNDARY]",
      `placeIdMasked=${maskPlaceDetailId(input.placeId)}`,
      `cacheHit=${input.telemetry.cacheHit}`,
      `cachePlacePresent=${input.telemetry.cachePlacePresent}`,
      `cacheEnvelopeValid=${input.telemetry.cacheEnvelopeValid}`,
      "cacheKeyKind=place_id_language_scope",
      `serverAttempted=${input.telemetry.serverAttempted}`,
      `serverPlacePresent=${input.telemetry.serverPlacePresent}`,
      `serverErrorPresent=${input.telemetry.serverErrorPresent}`,
      `serverErrorCode=${input.telemetry.serverErrorCode || "none"}`,
      `clientFallbackAttempted=${input.telemetry.clientFallbackAttempted}`,
      `clientPlacePresent=${input.telemetry.clientPlacePresent}`,
      `clientErrorPresent=${input.telemetry.clientErrorPresent}`,
      `clientErrorCode=${input.telemetry.clientErrorCode || "none"}`,
      "finalPlacePresent=false",
      `finalErrorPresent=${Boolean(finalErrorCode)}`,
      `finalErrorCode=${finalErrorCode || "none"}`,
      `uiFallbackReason=${finalErrorCode || "unknown"}`,
      `snapshotPresent=${input.snapshotPresent}`,
      `baseDetailPresent=${input.baseDetailPresent}`,
      `firstNullErrorBoundary=${input.telemetry.firstNullErrorBoundary || "none"}`,
    ].join(" "),
  );
}
