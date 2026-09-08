import { apiEndpointDiagnostic, resolveApiUrl } from "@/lib/api-url";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { GenerateItineraryResult } from "@/lib/trip/itinerary-guards";

type NativeItineraryTransportOptions = {
  token: string | undefined;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
};

export async function generateItineraryViaNativeApi(
  input: ItineraryInput,
  options: NativeItineraryTransportOptions,
): Promise<GenerateItineraryResult> {
  const generationId = input.generationId?.trim() || crypto.randomUUID();
  const endpoint = resolveApiUrl("/api/generate-itinerary", {
    native: true,
    origin: options.origin,
  });
  const endpointShape = apiEndpointDiagnostic(endpoint);
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort("itinerary_transport_timeout"),
    options.timeoutMs ?? 60_000,
  );
  const abort = () => timeoutController.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  console.info("[ITINERARY_TRANSPORT_REQUEST]", {
    generationId,
    transport: "capacitor_https",
    endpointHost: endpointShape.endpointHost,
    endpointPath: "/api/generate-itinerary",
    requestStarted: true,
  });
  console.info("[ITINERARY_DAYS_AUTHORITY]", {
    generationId,
    stage: "native_request",
    explicitDays: input.days,
    derivedDays: null,
    effectiveDays: input.days,
    startDatePresent: Boolean(input.startDate?.trim()),
    endDatePresent: Boolean(input.endDate?.trim()),
    source: Number.isInteger(input.days) && input.days > 0 ? "explicit_days" : "none",
  });

  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        "X-Roamie-Request-Id": generationId,
      },
      body: JSON.stringify({ ...input, generationId }),
      signal: timeoutController.signal,
      });
    } catch (error) {
      console.info("[ITINERARY_TRANSPORT_RESPONSE]", {
        generationId,
        httpStatus: 0,
        contentType: "",
        responseByteLength: 0,
        elapsedMs: Date.now() - startedAt,
        transport: "capacitor_https",
        settlement: timeoutController.signal.aborted ? "aborted_or_timeout" : "network_error",
      });
      throw error;
    }
    const text = await response.text();
    console.info("[ITINERARY_TRANSPORT_RESPONSE]", {
      generationId,
      httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "",
      responseByteLength: new TextEncoder().encode(text).byteLength,
      elapsedMs: Date.now() - startedAt,
      transport: "capacitor_https",
    });
    if (!response.ok) {
      let serverCode = "http_error";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error?.trim()) serverCode = parsed.error.trim();
      } catch {
        // Keep the structured transport error without logging response content.
      }
      return {
        success: false,
        errorCode: serverCode,
        message: serverCode,
      };
    }
    if (!/application\/json/i.test(response.headers.get("content-type") ?? "")) {
      return {
        success: false,
        errorCode: "unexpected_content_type",
        message: "unexpected_content_type",
      };
    }
    return JSON.parse(text) as GenerateItineraryResult;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abort);
  }
}
