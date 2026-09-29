#!/usr/bin/env node
/** Standalone request-scope regression. All RPCs are mocks; no telemetry dependency or network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { getRequest as getRuntimeRequest } from "@tanstack/react-start/server";

const file = "src/integrations/supabase/security-middleware.ts";
const fixed = readFileSync(file, "utf8");
const fixedScope = "    const request = getRequest();\n    if (isAbuseGuardEnforcementOn()) {";
const brokenScope = "    if (isAbuseGuardEnforcementOn()) {\n      const request = getRequest();";
assert.equal(fixed.split(fixedScope).length, 2, "exactly one scope fix in requireItineraryCredits");
const broken = fixed.replace(fixedScope, brokenScope);
assert.equal(broken.replace(brokenScope, fixedScope), fixed, "only move the request declaration");

const printer = ts.createPrinter({ removeComments: true });
const parse = (source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
function nodes(source, predicate) {
  const sf = parse(source),
    found = [];
  function visit(node) {
    if (predicate(node)) found.push(printer.printNode(ts.EmitHint.Unspecified, node, sf));
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
const rpc = (n) =>
  ts.isCallExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  n.expression.name.text === "rpc";
assert.deepEqual(nodes(fixed, rpc), nodes(broken, rpc), "all RPC names and arguments unchanged");
assert.deepEqual(
  nodes(fixed, ts.isIfStatement).filter((s) => !s.startsWith("if (isAbuseGuardEnforcementOn")),
  nodes(broken, ts.isIfStatement).filter((s) => !s.startsWith("if (isAbuseGuardEnforcementOn")),
  "Plus, insufficient, replay and other branch conditions unchanged",
);
for (const name of ["requestId", "idempotencyKey", "hasPlusAccess", "reservation"]) {
  const predicate = (n) => ts.isVariableDeclaration(n) && n.name.getText() === name;
  assert.deepEqual(
    nodes(fixed, predicate),
    nodes(broken, predicate),
    name + " construction unchanged",
  );
}
assert.deepEqual(
  nodes(
    fixed,
    (n) => ts.isPropertyAccessExpression(n) && n.expression.getText() === "CREDITS_COSTS",
  ),
  nodes(
    broken,
    (n) => ts.isPropertyAccessExpression(n) && n.expression.getText() === "CREDITS_COSTS",
  ),
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
// Read the real constants/parser/error class without importing any application runtime.
function localExports(path) {
  const exports = {};
  vm.runInNewContext(transpile(readFileSync(path, "utf8")), { exports });
  return exports;
}
const constants = localExports("src/lib/credits/constants.ts");
const entitlement = localExports("src/lib/plan-tier/entitlement.ts");
const errors = localExports("src/lib/credits/errors.ts");
let contextError;
try {
  getRuntimeRequest();
} catch (error) {
  contextError = error;
}
assert(contextError instanceof Error, "actual runtime must reject a missing request context");

async function execute(
  source,
  {
    enforcement = false,
    plus = false,
    deny = 0,
    missing = false,
    replay = false,
    insufficient = false,
    handlerFailure = false,
    entitlementFailure = false,
  } = {},
) {
  const calls = [];
  let reached = 0,
    guardCalls = 0,
    error;
  const request = new Request("https://fixture.invalid/itinerary", { method: "POST" });
  const exports = {};
  const stubs = {
    "@tanstack/react-start": {
      createMiddleware: () => ({
        middleware() {
          return this;
        },
        server(fn) {
          return fn;
        },
      }),
    },
    "@tanstack/react-start/server": { getRequest: () => (missing ? getRuntimeRequest() : request) },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/plan-tier/entitlement": entitlement,
    "@/lib/credits/constants": constants,
    "@/lib/credits/errors": errors,
    "@/lib/abuse-guard-enforcement.server": { isAbuseGuardEnforcementOn: () => enforcement },
    "@/lib/abuse-guard.server": {
      authorizeAiUse: async () => {
        guardCalls++;
        return deny ? new Response(null, { status: deny }) : null;
      },
    },
    // Observation is deliberately irrelevant to every scope assertion.
    "@/lib/abuse-guard-telemetry.server": {
      aiObservation: () => ({}),
      observeCredit() {},
      observeCreditReserveAttempt() {},
    },
  };
  vm.runInNewContext(transpile(source), {
    exports,
    crypto: { randomUUID },
    require(name) {
      assert(Object.hasOwn(stubs, name), "unexpected dependency");
      return stubs[name];
    },
  });
  const context = {
    userId: "fixture",
    supabase: {
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "resolve_user_plus_entitlement")
          return { data: { has_plus: plus }, error: entitlementFailure ? {} : null };
        if (name === "credits_reserve")
          return {
            data: { ok: !insufficient, idempotent: replay, ledger_id: "fixture" },
            error: null,
          };
        assert.equal(name, "credits_rollback");
        return { data: { ok: true }, error: null };
      },
    },
  };
  try {
    await exports.requireItineraryCredits({
      context,
      next: async () => {
        reached++;
        if (handlerFailure) throw new Error("fixture handler failure");
        return "ok";
      },
    });
  } catch (caught) {
    error = caught;
  }
  const reserves = calls.filter((c) => c.name === "credits_reserve");
  for (const { args } of reserves) {
    assert.equal(args.p_feature_type, "ITINERARY_GENERATION");
    assert.equal(args.p_amount, constants.CREDITS_COSTS.ITINERARY_GENERATION);
    assert.equal(
      args.p_idempotency_key,
      `server:fixture:ITINERARY_GENERATION:${args.p_request_id}`,
    );
    assert.equal(args.p_metadata.authority, "server_function");
  }
  return { calls, reserves: reserves.length, reached, guardCalls, error };
}

// Also exercise the scope fix alone: remove observation statements in memory, never on disk.
const scopeOnly = fixed
  .replace(/^import .*abuse-guard-telemetry\.server.*\n/m, "")
  .replace(/^    const observation = aiObservation\("itinerary"\);\n/m, "")
  .replace(/^\s*observeCredit(?:ReserveAttempt)?\([^\n]*\);\n/gm, "");

for (const [label, source] of [
  ["scope-only", scopeOnly],
  ["full integration", fixed],
]) {
  for (const enforcement of [false, true]) {
    for (const plus of [false, true]) {
      const result = await execute(source, { enforcement, plus });
      assert.equal(result.error, undefined);
      assert.equal(result.reserves, plus ? 0 : 1);
      assert.equal(result.reached, 1);
      assert.equal(result.guardCalls, enforcement ? 1 : 0);
      console.log(
        `PASS ${label}: ${enforcement ? "Enforcement" : "Bootstrap"} ${plus ? "Plus skips" : "Free reserves exactly once"}, handler reached`,
      );
      const absent = await execute(source, { enforcement, plus, missing: true });
      assert.equal(absent.error?.name, contextError.name);
      assert.equal(absent.error?.message, contextError.message);
      assert.equal(absent.reserves, 0);
      assert.equal(absent.reached, 0);
      assert.equal(absent.calls.length, 0);
    }
  }
  for (const deny of [429, 503])
    for (const plus of [false, true]) {
      const result = await execute(source, { enforcement: true, plus, deny });
      assert.equal(result.error?.message, deny === 429 ? "rate_limited" : "ai_unavailable");
      assert.equal(result.reserves, 0);
      assert.equal(result.reached, 0);
      assert.equal(result.calls.length, 0);
    }
  const repeated = await execute(source, { enforcement: true, replay: true });
  assert.match(repeated.error?.message, /Conflict/);
  assert.equal(repeated.reserves, 1);
  assert.equal(repeated.reached, 0);
  const short = await execute(source, { insufficient: true });
  assert.equal(short.error?.code, "INSUFFICIENT_CREDITS");
  assert.equal(short.reserves, 1);
  assert.equal(short.reached, 0);
  const failed = await execute(source, { handlerFailure: true });
  assert.equal(failed.error?.message, "fixture handler failure");
  assert.equal(failed.reserves, 1);
  assert.equal(failed.calls.filter((c) => c.name === "credits_rollback").length, 1);
  const unresolved = await execute(source, { plus: true, entitlementFailure: true });
  assert.equal(unresolved.reserves, 1, "resolver error must not grant Plus");
  console.log(
    `PASS ${label}: guard reject, missing runtime context, idempotency, insufficient and rollback contracts`,
  );
}
for (const enforcement of [false, true]) {
  const free = await execute(broken, { enforcement });
  assert.equal(free.error?.name, "ReferenceError");
  assert.equal(free.reserves, 0);
  assert.equal(free.reached, 0);
  const plus = await execute(broken, { enforcement, plus: true });
  assert.equal(plus.error, undefined);
  assert.equal(plus.reserves, 0);
  assert.equal(plus.reached, 1);
}
console.log(
  "PASS HEAD-equivalent broken form: Free ReferenceError before reserve; Plus still skips",
);
console.log(
  "PASS AST parity: cost reference, RPCs, Plus/insufficient/replay conditions, idempotency unchanged",
);
console.log("Itinerary credit request-scope regression: PASS (mock RPC only, no network)");
