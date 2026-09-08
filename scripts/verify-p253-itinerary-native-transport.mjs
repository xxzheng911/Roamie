import assert from "node:assert/strict";
import { generateItineraryViaNativeApi } from "../src/lib/ai/itinerary-transport.ts";

const input = {
  destination: "台北",
  days: 2,
  generationId: "p253-native-transport",
  selectedPlaces: [],
};

let requests = 0;
const successResult = { success: true, trip: { payload: { destination: "台北", days: 2 } } };
const result = await generateItineraryViaNativeApi(input, {
  token: "test-token",
  origin: "https://roamie.example",
  fetchImpl: async (url, init) => {
    requests += 1;
    assert.equal(url, "https://roamie.example/api/generate-itinerary");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.headers["X-Roamie-Request-Id"], input.generationId);
    assert.equal(JSON.parse(init.body).generationId, input.generationId);
    return new Response(JSON.stringify(successResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.deepEqual(result, successResult);
assert.equal(Object.keys(result).length, 2);
assert.equal(requests, 1, "native transport sends exactly one generation request");

const authFailure = await generateItineraryViaNativeApi(input, {
  token: undefined,
  origin: "https://roamie.example",
  fetchImpl: async () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
});
assert.deepEqual(authFailure, {
  success: false,
  errorCode: "Unauthorized",
  message: "Unauthorized",
});

const controller = new AbortController();
const aborted = generateItineraryViaNativeApi(input, {
  token: "test-token",
  origin: "https://roamie.example",
  signal: controller.signal,
  fetchImpl: async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
});
controller.abort();
await assert.rejects(aborted, (error) => error?.name === "AbortError");

await assert.rejects(
  generateItineraryViaNativeApi(input, {
    token: "test-token",
    origin: "https://roamie.example",
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  }),
  (error) => error?.name === "AbortError",
);

console.log("P25.3 native itinerary transport regression passed");
