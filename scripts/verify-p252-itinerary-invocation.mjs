import assert from "node:assert/strict";
import {
  classifyGenerateItineraryInvocationResult,
  invokeGenerateItinerary,
  isEmptyGenerateItineraryInvocationResult,
} from "../src/lib/ai/itinerary-generation-invocation.ts";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const logs = [];
const originalInfo = console.info;
const originalLog = console.log;
const capture = (...args) =>
  logs.push(args.map((value) => (typeof value === "object" ? JSON.stringify(value) : String(value))).join(" "));
console.info = capture;
console.log = capture;

try {
  let calls = 0;
  const direct = await invokeGenerateItinerary({
    generationId: "p252-direct",
    transport: "test_direct",
    invoke: async () => {
      calls += 1;
      return { success: true, trip: { payload: {} } };
    },
  });
  assert.equal(direct.success, true);
  assert.equal(calls, 1, "invocation boundary never creates an extra API request");

  const native = await invokeGenerateItinerary({
    generationId: "p252-native",
    transport: "native_wrapper",
    invoke: async () => ({ result: { success: true, trip: { payload: {} } } }),
  });
  assert.deepEqual(Object.keys(native), ["result"]);

  const empty = await invokeGenerateItinerary({
    generationId: "p252-undefined",
    transport: "test_direct",
    invoke: async () => undefined,
  });
  assert.equal(empty, undefined);
  assert.equal(isEmptyGenerateItineraryInvocationResult(empty), true);
  assert.equal(isEmptyGenerateItineraryInvocationResult(null), true);
  assert.equal(isEmptyGenerateItineraryInvocationResult({}), true);
  assert.equal(classifyGenerateItineraryInvocationResult(empty), "invocation_empty_result");

  await assert.rejects(
    invokeGenerateItinerary({
      generationId: "p252-rejected",
      transport: "test_direct",
      invoke: async () => {
        throw new Error("server rejected");
      },
    }),
    /server rejected/,
  );

  const controller = new AbortController();
  const aborted = invokeGenerateItinerary({
    generationId: "p252-aborted",
    transport: "test_direct",
    signal: controller.signal,
    invoke: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(aborted, (error) => error?.name === "AbortError");

  await assert.rejects(
    invokeGenerateItinerary({
      generationId: "p252-timeout",
      transport: "test_direct",
      timeoutMs: 5,
      invoke: () => new Promise(() => {}),
    }),
    /itinerary_invocation_timeout/,
  );

  const places = ["A", "B", "C", "D"].map((name, index) => ({
    name: `台北景點${name}`,
    placeName: `台北景點${name}`,
    googlePlaceId: `taipei-${index}`,
    address: `台北市測試路${index + 1}號`,
    lat: 25.03 + index * 0.001,
    lng: 121.56 + index * 0.001,
  }));
  const emptyResult = await createItineraryFromSession({
    session: { ...createEmptySession(), selectedPlaces: places },
    generateInput: {
      destination: "台北",
      days: 2,
      placeAuthority: "selected_only",
      selectedPlaces: places,
      generationId: "p252-full-flow-empty",
    },
    generationTransport: "tanstack_useServerFn",
    generateItineraryFn: async () => undefined,
  });
  assert.equal(emptyResult.ok, false);
  assert.ok(
    !logs.some(
      (line) =>
        line.includes("p252-full-flow-empty") &&
        line.includes("ITINERARY_PAYLOAD_VALIDATION"),
    ),
    "empty invocation stops before payload normalization and validation",
  );

  for (const [id, settlement] of [
    ["p252-direct", "resolved"],
    ["p252-native", "resolved"],
    ["p252-undefined", "resolved"],
    ["p252-rejected", "rejected"],
    ["p252-aborted", "aborted"],
    ["p252-timeout", "timeout"],
  ]) {
    assert.ok(
      logs.some(
        (line) => line.includes("ITINERARY_INVOCATION_SETTLEMENT") && line.includes(id) && line.includes(`\"settled\":\"${settlement}\"`),
      ),
      `${id} emits ${settlement} settlement`,
    );
  }
  assert.ok(
    logs.some(
      (line) => line.includes("ITINERARY_INVOCATION_RESULT") && line.includes("p252-undefined") && line.includes('"valueType":"undefined"') && line.includes('"promiseResolved":true'),
    ),
    "resolved undefined is distinguishable from a thrown invocation",
  );
} finally {
  console.info = originalInfo;
  console.log = originalLog;
}

console.log("P25.2 itinerary invocation boundary regression passed");
