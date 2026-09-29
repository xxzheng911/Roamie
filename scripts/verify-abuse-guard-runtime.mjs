import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const entry = `
import { AbuseGuard } from "./src/lib/abuse-guard-do.ts";
import { utcDay } from "./src/lib/abuse-guard-clock.ts";
import { authorizeGoogleBilling } from "./src/lib/abuse-guard.server.ts";
import { installWorkerRequestStorage } from "./src/lib/worker-request-als.server.ts";
import {
  resolveTrustedIp,
  resolveTrustedUserId,
  runWithGuardTestContext,
  runWithWorkerRequest,
  setGuardProductionForTests,
} from "./src/lib/worker-request-scope.ts";

export { AbuseGuard };

function bucket(key, limit, delta) {
  return [{ key, limit, delta, reason: "family", retryAt: Date.now() + 60_000 }];
}

async function charge(env, name, operationId, buckets) {
  const stub = env.ABUSE_GUARD.get(env.ABUSE_GUARD.idFromName(name));
  const response = await stub.fetch(new Request("https://abuse-guard.internal/", {
    method: "POST",
    body: JSON.stringify({ action: "charge", operationId, buckets }),
  }));
  return response.json();
}

export default {
  async fetch(request, env) {
    installWorkerRequestStorage();
    const job = await request.json();
    if (job.kind === "als") {
      const ip = await runWithWorkerRequest({ env, request, allowLocalIp: false }, async () => {
        await Promise.resolve();
        return resolveTrustedIp();
      });
      return Response.json({ ip, utc: utcDay(Date.parse("2026-09-29T23:30:00-10:00")) });
    }
    if (job.kind === "production-override") {
      setGuardProductionForTests(true);
      let thrown = "";
      try {
        runWithGuardTestContext({ userId: "spoof", ip: "198.51.100.2" }, () => "allowed");
      } catch (error) {
        thrown = error instanceof Error ? error.message : "unknown";
      }
      let userId = "unset";
      let ip = "unset";
      try {
        const spoofRequest = new Request("https://roamie.tw/", {
          headers: { "x-user-id": "spoof", "x-forwarded-for": "198.51.100.2" },
        });
        userId = await runWithWorkerRequest({ env, request: spoofRequest, allowLocalIp: true }, () =>
          resolveTrustedUserId(),
        );
        ip = await runWithWorkerRequest({ env, request: spoofRequest, allowLocalIp: true }, () =>
          resolveTrustedIp(),
        );
      } finally {
        setGuardProductionForTests(null);
      }
      return Response.json({ thrown, userId, ip });
    }
    if (job.kind === "missing-do") {
      const response = await runWithWorkerRequest({ env: {}, request, allowLocalIp: false }, () =>
        authorizeGoogleBilling({
          family: "places_text",
          operationId: "missing-do",
          chargeUser: true,
          chargeIp: true,
          userId: "runtime-user",
          ip: "203.0.113.70",
        }),
      );
      return Response.json({ status: response?.status ?? 200, body: response ? await response.json() : null });
    }
    if (job.kind === "do-exception") {
      const broken = {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => { throw new Error("storage down"); } }),
      };
      const response = await runWithWorkerRequest({ env: { ABUSE_GUARD: broken }, request, allowLocalIp: false }, () =>
        authorizeGoogleBilling({
          family: "places_text",
          operationId: "explode",
          chargeUser: true,
          chargeIp: true,
          userId: "runtime-user",
          ip: "203.0.113.70",
        }),
      );
      return Response.json({ status: response?.status ?? 200 });
    }
    if (job.kind === "sql-command") {
      const stub = env.ABUSE_GUARD.get(env.ABUSE_GUARD.idFromName("user:sql"));
      let failed = false;
      try {
        await stub.fetch(new Request("https://abuse-guard.internal/", {
          method: "POST",
          body: JSON.stringify({ action: "not-a-command", operationId: "bad" }),
        }));
      } catch {
        failed = true;
      }
      const after = await charge(env, "user:sql", "after-bad", bucket("family:sql", 1, 1));
      return Response.json({ failed, after });
    }
    if (job.kind === "concurrency") {
      const results = await Promise.all(job.ids.map((id) => charge(env, job.name, id, job.buckets)));
      return Response.json({
        allowed: results.filter((result) => result.ok && !result.replay).length,
        denied: results.filter((result) => !result.ok).length,
        replay: results.filter((result) => result.replay).length,
      });
    }
    if (job.kind === "duplicate") {
      const buckets = bucket("family:dup", 1, 1);
      const first = await charge(env, "user:dup", "same-op", buckets);
      const second = await charge(env, "user:dup", "same-op", buckets);
      const third = await charge(env, "user:dup", "other-op", buckets);
      const empty = await charge(env, "user:dup", "", buckets);
      return Response.json({ first, second, third, empty });
    }
    if (job.kind === "deny-not-stored") {
      const denied = await charge(env, "user:deny", "over", bucket("family:deny", 0, 1));
      const later = await charge(env, "user:deny", "over", bucket("family:deny", 1, 1));
      return Response.json({ denied, later });
    }
    if (job.kind === "ratelimit") {
      const binding = env.GOOGLE_API_RATE_LIMITER;
      if (!binding || typeof binding.limit !== "function") return Response.json({ available: false });
      const results = [];
      for (let index = 0; index < 4; index += 1) {
        results.push((await binding.limit({ key: "google:user:runtime" })).success);
      }
      return Response.json({ available: true, results });
    }
    return Response.json({ error: "unknown" }, { status: 400 });
  },
};
`;

const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  external: ["node:async_hooks", "cloudflare:workers"],
});

let outbound = 0;
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2025-09-24",
    compatibilityFlags: ["nodejs_compat"],
    script: result.outputFiles[0].text,
    durableObjects: { ABUSE_GUARD: { className: "AbuseGuard", useSQLite: true } },
    ratelimits: {
      GOOGLE_API_RATE_LIMITER: { namespace_id: "1001", simple: { limit: 2, period: 60 } },
    },
    outboundService: () => {
      outbound += 1;
      return new Response("outbound", { status: 500 });
    },
  }),
);

async function call(kind, extra = {}, headers = {}) {
  const response = await worker.dispatchFetch("https://roamie.test/guard", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.80", ...headers },
    body: JSON.stringify({ kind, ...extra }),
  });
  assert.equal(response.ok, true, `${kind} ${response.status}`);
  return response.json();
}

const als = await call("als");
assert.equal(als.ip, "203.0.113.80");
assert.equal(als.utc, "2026-09-30");

const production = await call("production-override");
assert.equal(production.thrown, "test_context_forbidden");
assert.equal(production.userId, null);
assert.equal(production.ip, null);

const missing = await call("missing-do");
assert.equal(missing.status, 503);
assert.deepEqual(missing.body, { error: "google_unavailable" });

const exploded = await call("do-exception");
assert.equal(exploded.status, 503);

const sql = await call("sql-command");
assert.equal(sql.failed, true);
assert.equal(sql.after.ok, true);
assert.equal(sql.after.replay, false);

const family = await call("concurrency", {
  name: "user:family",
  ids: Array.from({ length: 20 }, (_, index) => `family-${index}`),
  buckets: [{ key: "user:family:places_text:2026-09-30", limit: 10, delta: 1, reason: "family", retryAt: Date.now() + 60_000 }],
});
assert.equal(family.allowed, 10);
assert.equal(family.denied, 10);

const weight = await call("concurrency", {
  name: "user:weight",
  ids: Array.from({ length: 20 }, (_, index) => `weight-${index}`),
  buckets: [{ key: "user:weight:2026-09-30", limit: 20, delta: 8, reason: "user_weight", retryAt: Date.now() + 60_000 }],
});
assert.equal(weight.allowed, 2);
assert.equal(weight.denied, 18);

const globalBudget = await call("concurrency", {
  name: "global:google",
  ids: Array.from({ length: 20 }, (_, index) => `global-${index}`),
  buckets: [{ key: "global:weight:2026-09-30", limit: 16, delta: 8, reason: "global_weight", retryAt: Date.now() + 60_000 }],
});
assert.equal(globalBudget.allowed, 2);
assert.equal(globalBudget.denied, 18);

const duplicate = await call("duplicate");
assert.equal(duplicate.first.ok, true);
assert.equal(duplicate.first.replay, false);
assert.equal(duplicate.second.ok, true);
assert.equal(duplicate.second.replay, true);
assert.equal(duplicate.third.ok, false);
assert.equal(duplicate.empty.ok, false);

const denied = await call("deny-not-stored");
assert.equal(denied.denied.ok, false);
assert.equal(denied.later.ok, true);
assert.equal(denied.later.replay, false);

const rate = await call("ratelimit");
assert.equal(outbound, 0);
await worker.dispose();

if (!rate.available) {
  console.log("RATE_LIMIT_BINDING: unavailable in this local runtime");
} else {
  assert.deepEqual(rate.results, [true, true, false, false]);
  console.log("RATE_LIMIT_BINDING: local limit 2/60 verified");
}
console.log("PASS abuse guard workerd runtime: sqlite DO, ALS, concurrency, fail closed");
