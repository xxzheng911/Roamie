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
  assert.equal(
    resolveApiUrl("/api/subscription/sync", {
      native: true,
      origin: "https://roamie.tw",
    }),
    "https://roamie.tw/api/subscription/sync",
  );
});

test("native missing or unsafe origin fails fast and never produces capacitor API URL", () => {
  assert.throws(
    () => resolveApiUrl("/api/roamie", { native: true, origin: "" }),
    (error) => error instanceof ApiUrlError && error.code === "native_api_origin_missing",
  );
  for (const origin of [
    "capacitor://localhost",
    "file:///tmp/app",
    "javascript:alert(1)",
    "http://example.com",
  ]) {
    assert.throws(() => validatePublicApiOrigin(origin));
  }
  assert.equal(
    resolveApiUrl("/api/roamie", {
      native: true,
      origin: "http://localhost:3000",
      allowLocalHttp: true,
    }),
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
    "native_api_origin_missing",
    "network_error",
    "http_error",
    "unexpected_content_type",
    "empty_stream",
    "stream_parse_error",
    "stream_aborted",
    "provider_error",
  ])
    assert.match(source, new RegExp(`\\"${code}\\"`));
  assert.match(source, /text\/event-stream/);
  assert.match(source, /rawBytesReceived/);
  assert.match(source, /deltaEventCount/);
  assert.match(source, /finalEventCount/);
  assert.match(source, /X-Roamie-Cancel/);
  assert.match(source, /notifyStreamCancellation/);
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
  // X-Roamie-Cancel is a notice only: 204, no refund, no fall-through to generation.
  assert.doesNotMatch(route, /rollbackServerCreditsByRequest/);
  const cancelStart = route.indexOf('request.headers.get("x-roamie-cancel") === "true"');
  assert.ok(cancelStart > 0, "cancel branch present");
  const cancelOpen = route.indexOf("{", cancelStart);
  let depth = 0;
  let cancelEnd = -1;
  for (let i = cancelOpen; i < route.length; i += 1) {
    if (route[i] === "{") depth += 1;
    else if (route[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        cancelEnd = i;
        break;
      }
    }
  }
  assert.ok(cancelEnd > cancelOpen, "cancel branch closed");
  const cancelBranch = route.slice(cancelOpen, cancelEnd + 1);
  assert.match(cancelBranch, /return new Response\(null, \{ status: 204 \}\);\s*\}$/);
  assert.doesNotMatch(cancelBranch, /rollback|credits_rollback|settleCredits|settleServerCredits/i);
  assert.doesNotMatch(cancelBranch, /status: rolledBack|503/);
  assert.doesNotMatch(cancelBranch, /callRoamieAI|streamRoamieAI|reserveServerCredits|beginAiRequest/);
  // Cancel check runs before any reservation or generation.
  assert.ok(cancelStart < route.indexOf("beginAiRequest("), "cancel before beginAiRequest");
  assert.ok(cancelStart < route.indexOf("reserveServerCredits(auth"), "cancel before reserve");
  // Matches both `callRoamieAI(ctx)` and `callRoamieAI(ctx, { signal })`; the call must
  // exist (indexOf > 0) so a missing call cannot make the ordering check pass vacuously.
  const nonStreamCall = route.indexOf("callRoamieAI(ctx");
  const streamCall = route.indexOf("streamRoamieAI(ctx");
  assert.ok(nonStreamCall > 0, "non-stream call present");
  assert.ok(streamCall > 0, "stream call present");
  assert.ok(cancelStart < nonStreamCall, "cancel before non-stream call");
  assert.ok(cancelStart < streamCall, "cancel before stream call");
  // The cancel branch returns before every generation call site.
  assert.ok(cancelEnd < nonStreamCall && cancelEnd < streamCall, "cancel branch closes before generation");
  // A rejected commit is not delivered as success on the non-stream path.
  assert.match(route, /if \(!\(await settleCredits\(true\)\)\) throw new Error/);
  assert.match(route, /parsed\.protocol === "capacitor:" && parsed\.hostname === "localhost"/);
  assert.match(
    itineraryRoute,
    /parsed\.protocol === "capacitor:" && parsed\.hostname === "localhost"/,
  );
});

test("trusted Capacitor API origin gets narrow preflight/CORS support", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../src/lib/native-rpc-policy.ts", import.meta.url), "utf8");
  const cors = readFileSync(new URL("../src/lib/native-api-cors.ts", import.meta.url), "utf8");
  assert.match(policy, /NATIVE_RPC_ORIGIN = "capacitor:\/\/localhost"/);
  assert.match(source, /request\.method === "OPTIONS"/);
  assert.match(source, /withNativeApiCors/);
  assert.match(cors, /Access-Control-Allow-Origin/);
  assert.match(cors, /Authorization, Content-Type, X-Roamie-Request-Id, X-Roamie-Stream/);
  assert.match(cors, /X-Roamie-Cancel/);
});

test("production public env contract requires native API origin", () => {
  const source = readFileSync(new URL("./public-client-env.mjs", import.meta.url), "utf8");
  assert.match(source, /REQUIRED_PUBLIC_CLIENT_ENV_KEYS[\s\S]*VITE_APP_ORIGIN/);
});
