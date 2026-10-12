import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Fixture key only: never resolve a real key; every request hits the mock below.
process.env.OPENAI_API_KEY = "sk-test-fixture-not-real";
const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(String(reason?.message ?? reason)));
let providerCalls = 0;
const failures = {
  401: { error: { message: "Incorrect API key provided.", code: "invalid_api_key", type: "invalid_request_error" } },
  429: { error: { message: "You exceeded your current quota.", code: "insufficient_quota", type: "insufficient_quota" } },
  500: { error: { message: "upstream failure", type: "server_error" } },
};
let status = 401;
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
  providerCalls++;
  return new Response(JSON.stringify(failures[status]), { status, headers: { "content-type": "application/json" } });
};
const quiet = console.error; console.error = () => {}; console.info = () => {}; console.log = () => {}; console.warn = () => {};
const { callOutfitAI } = await import("../src/lib/outfit/outfit-ai.server.ts");
const out = (...a) => process.stdout.write(a.join(" ") + "\n");

const input = { destination: "京都", locale: "ja", days: [{ date: "2026-12-10", dayIndex: 1, forecast: { date: "2026-12-10", tempMin: 3, tempMax: 11, precipitationProbability: 20, weatherCode: 1 }, activities: [], scheduleSummary: "清水寺" }] };
for (const code of [401, 429, 500]) {
  status = code;
  let thrown;
  try { await callOutfitAI(input); } catch (error) { thrown = error; }
  await new Promise((resolve) => setTimeout(resolve, 20)); // let any detached rejection surface
  out(`status=${code}`, `thrownIsError=${thrown instanceof Error}`, `thrownIsPromise=${thrown instanceof Promise}`, `roamie=${JSON.stringify(thrown?.roamie ?? null)}`, `name=${thrown?.name}`, `msg=${String(thrown?.message).slice(0,100)}`, `unhandled=${JSON.stringify(unhandled)}`);
  assert.ok(thrown instanceof Error, `${code}: rejects with an Error, not a Promise`);
  assert.equal(thrown.roamie?.status, code, `${code}: classified status`);
  if (failures[code].error.code) assert.equal(thrown.roamie?.code, failures[code].error.code, `${code}: provider code kept`);
  assert.ok(!thrown.message.includes("sk-test-fixture"), "no secret in message");
}
assert.deepEqual(unhandled, [], "no unhandled rejection");
assert.equal(providerCalls, 3, "exactly one mocked provider attempt per call");

// Both outfit call sites share the same Response-based mapping contract.
for (const file of ["src/lib/outfit/outfit-ai.server.ts", "src/lib/outfit/generate-trip-outfit.server.ts"]) {
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("throw toError(await mapOpenAIError(response));"), `${file} maps the Response`);
  assert.ok(!/mapOpenAIError\(response\.status/.test(source), `${file} no status-number call`);
}
console.error = quiet;
out("PASS outfit OpenAI failures reject with classified Errors, no unhandled rejection");
