#!/usr/bin/env node
// verify-itinerary-settlement-retry-review3.mjs — 任務單 #8（第 3 次獨立複審）：行程 server function 結算
//
// 從 src/lib/itinerary.functions.ts 取出「真實」 finish() 結算閉包原文（不改寫邏輯），以 TypeScript 轉譯後
// 在 node:vm 沙箱執行；只提供 stub：context、itinerary diagnostics、動態 import 的 endpoint-guard.server
// （serverCreditsClient／serverCreditsRpc，契約與真實版本相同）。沙箱內沒有 fetch／require，不可能連網。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=60 scripts/verify-itinerary-settlement-retry-review3.mjs
//
// 覆蓋（以 RPC 次數證明）：
//   I1 成功 → commit 1（service role、p_user_id＝已驗證使用者），回傳結果
//   I2 commit 第 1 次 rpc_error、第 2 次成功 → commit 2，回傳結果
//   I3 commit 兩次 rpc_error → commit 2，丟錯（不交付；由 middleware 釋放預扣）
//   I4 commit 回 ok:false → 不重試、丟錯（不交付）
//   I5 失敗結果 → rollback 1；rollback rpc_error 不重試、丟錯
//   I6 Plus bypass → 0 RPC
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const file = "src/lib/itinerary.functions.ts";
const src = readFileSync(file, "utf8");
const start = src.indexOf("    const finish = async (result: GenerateItineraryResult)");
const end = src.indexOf("    let timingLastAt = Date.now();", start);
assert.ok(start > 0 && end > start, "finish() closure not found");
const finishSrc = src.slice(start, end);
assert.equal(finishSrc.split('await import(\n            "@/lib/ai/endpoint-guard.server"\n          )').length, 2, "dynamic import shape changed");
const wrapped =
  "async function makeFinish(context, data, __imp, setGenerationPhase, generationSettlement, generationSettlementResponse, creditSettlementException, emitGenerationDiagnostic) {\n" +
  "  const generationId = '';\n" +
  finishSrc.replace('await import(\n            "@/lib/ai/endpoint-guard.server"\n          )', "await __imp()") +
  "  return finish;\n}\nexports.makeFinish = makeFinish;\n";
const js = ts.transpileModule("type GenerateItineraryResult = any;\n" + wrapped, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(js, { exports, console: { info() {}, warn() {}, error() {} }, Object, Boolean, Error });

const SERVICE = { tag: "service_role" };
async function run({ success = true, plusBypass = false, results = [] } = {}) {
  const calls = [];
  const queue = [...results];
  const settled = [];
  const imp = async () => ({
    serverCreditsClient: () => SERVICE,
    async serverCreditsRpc(fn, args, client) {
      if (!client) return { data: null, error: { message: "credits_client_missing" } };
      calls.push({ fn, args, client });
      return queue.length ? queue.shift() : { data: { ok: true }, error: null };
    },
  });
  const context = {
    userId: "verified-user",
    supabase: { rpc: async () => { throw new Error("user JWT client must not settle credits"); } },
    itineraryCreditReservation: { ledgerId: "L-1", idempotencyKey: null, plusBypass },
  };
  const finish = await exports.makeFinish(
    context,
    {},
    imp,
    () => {},
    (op, state) => settled.push(op + ":" + state),
    () => {},
    (e) => Object.assign(new Error("credit_settlement_failed"), { cause: e }),
    () => {},
  );
  const result = success ? { success: true, trip: { payload: {} } } : { success: false, errorCode: "x", failureReason: "y" };
  let error;
  let value;
  try {
    value = await finish(result);
  } catch (e) {
    error = e;
  }
  for (const c of calls) {
    assert.equal(c.client, SERVICE, "service role client");
    assert.equal(c.args.p_user_id, "verified-user", "bound to the verified user");
    assert.equal(c.args.p_ledger_id, "L-1");
  }
  return { calls: calls.map((c) => c.fn), error, value, settled };
}

const rpcErr = { data: null, error: { message: "timeout", code: "57014" } };
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failed += 1;
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n     "));
  }
}

await check("I1 成功 → commit 1、回傳結果", async () => {
  const r = await run();
  assert.deepEqual(r.calls, ["credits_commit"]);
  assert.equal(r.error, undefined);
  assert.equal(r.value?.success, true);
});
await check("I2 commit rpc_error 一次後成功 → commit 2、回傳結果", async () => {
  const r = await run({ results: [rpcErr] });
  assert.deepEqual(r.calls, ["credits_commit", "credits_commit"]);
  assert.equal(r.error, undefined);
  assert.equal(r.value?.success, true);
});
await check("I3 commit 兩次 rpc_error → commit 2、丟錯（不交付）", async () => {
  const r = await run({ results: [rpcErr, rpcErr] });
  assert.deepEqual(r.calls, ["credits_commit", "credits_commit"]);
  assert.ok(r.error, "must throw so the middleware releases the reservation");
  assert.equal(r.value, undefined);
  assert.ok(r.settled.includes("commit:failed"));
});
await check("I4 commit ok:false → 不重試、丟錯（不交付）", async () => {
  const r = await run({ results: [{ data: { ok: false, reason: "not_found" }, error: null }] });
  assert.deepEqual(r.calls, ["credits_commit"]);
  assert.ok(r.error);
  assert.equal(r.value, undefined);
});
await check("I5 失敗結果 → rollback 1；rollback rpc_error 不重試、丟錯", async () => {
  let r = await run({ success: false });
  assert.deepEqual(r.calls, ["credits_rollback"]);
  assert.equal(r.error, undefined);
  r = await run({ success: false, results: [rpcErr] });
  assert.deepEqual(r.calls, ["credits_rollback"]);
  assert.ok(r.error);
});
await check("I6 Plus bypass → 0 RPC", async () => {
  const r = await run({ plusBypass: true });
  assert.deepEqual(r.calls, []);
  assert.equal(r.value?.success, true);
});

console.log(`\n${6 - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
