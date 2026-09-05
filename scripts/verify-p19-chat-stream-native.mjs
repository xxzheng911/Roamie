import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ApiUrlError, resolveApiUrl, validatePublicApiOrigin } from "../src/lib/api-url.ts";

test("web API remains same-origin relative", () => {
  assert.equal(resolveApiUrl("/api/roamie", { native: false }), "/api/roamie");
});

test("native API uses validated HTTPS production origin", () => {
  assert.equal(
    resolveApiUrl("/api/roamie", { native: true, origin: "https://roamie.example" }),
    "https://roamie.example/api/roamie",
  );
});

test("native missing or unsafe origin fails fast and never produces capacitor API URL", () => {
  assert.throws(
    () => resolveApiUrl("/api/roamie", { native: true, origin: "" }),
    (error) => error instanceof ApiUrlError && error.code === "native_api_origin_missing",
  );
  for (const origin of ["capacitor://localhost", "file:///tmp/app", "javascript:alert(1)", "http://example.com"]) {
    assert.throws(() => validatePublicApiOrigin(origin));
  }
  assert.equal(
    resolveApiUrl("/api/roamie", { native: true, origin: "http://localhost:3000", allowLocalHttp: true }),
    "http://localhost:3000/api/roamie",
  );
});

test("only repository-owned API paths can be resolved", () => {
  assert.throws(() => resolveApiUrl("https://evil.example/api/roamie", { native: false }));
  assert.throws(() => resolveApiUrl("/not-api", { native: false }));
});

test("client distinguishes HTTP, content type, empty stream, parse and abort failures", () => {
  const source = readFileSync(new URL("../src/lib/ai/stream-client.ts", import.meta.url), "utf8");
  for (const code of [
    "native_api_origin_missing", "network_error", "http_error", "unexpected_content_type",
    "empty_stream", "stream_parse_error", "stream_aborted", "provider_error",
  ]) assert.match(source, new RegExp(`\\"${code}\\"`));
  assert.match(source, /text\/event-stream/);
  assert.match(source, /rawBytesReceived/);
  assert.match(source, /deltaEventCount/);
  assert.match(source, /finalEventCount/);
});

test("server propagates abort, has deadlines, structured empty-stream error and credit lifecycle", () => {
  const service = readFileSync(new URL("../src/lib/ai/service.server.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/routes/api/roamie.ts", import.meta.url), "utf8");
  const itineraryRoute = readFileSync(
    new URL("../src/routes/api/generate-itinerary.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS = 25_000/);
  assert.match(service, /CHAT_STREAM_OVERALL_TIMEOUT_MS = 55_000/);
  assert.match(service, /signal: upstreamAbort\.signal/);
  assert.match(service, /provider_empty_stream/);
  assert.match(service, /\[CHAT_API_OPENAI\]/);
  assert.match(service, /\[CHAT_API_RESPONSE\]/);
  assert.match(service, /await complete\([\s\S]*controller\.close\(\)/);
  assert.match(service, /async cancel\(reason\)[\s\S]*cancelActiveStream/);
  assert.match(route, /\[CHAT_API_REQUEST\]/);
  assert.match(route, /\[CHAT_CREDIT_LIFECYCLE\]/);
  assert.match(route, /settleCredits\(false, "client_abort"\)/);
  assert.match(route, /onComplete:\s*async/);
  assert.match(route, /parsed\.protocol === "capacitor:" && parsed\.hostname === "localhost"/);
  assert.match(
    itineraryRoute,
    /parsed\.protocol === "capacitor:" && parsed\.hostname === "localhost"/,
  );
});

test("trusted Capacitor API origin gets narrow preflight/CORS support", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(source, /NATIVE_APP_ORIGIN = "capacitor:\/\/localhost"/);
  assert.match(source, /request\.method === "OPTIONS"/);
  assert.match(source, /Access-Control-Allow-Origin/);
  assert.match(source, /Authorization, Content-Type, X-Roamie-Request-Id, X-Roamie-Stream/);
});

test("production public env contract requires native API origin", () => {
  const source = readFileSync(new URL("./public-client-env.mjs", import.meta.url), "utf8");
  assert.match(source, /REQUIRED_PUBLIC_CLIENT_ENV_KEYS[\s\S]*VITE_APP_ORIGIN/);
});
