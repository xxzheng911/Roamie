/**
 * T10 tester helper: run the same verify scripts in the workspace and in a HEAD copy, then compare
 * PASS/FAIL sets, exit codes and provider/stub call-count lines.
 *
 * Cost safety: every provider key is overridden with a fake placeholder in the child env
 * (process.env wins over .env for Vite), so any accidental real request is rejected by the provider
 * without billing. Output lines that look like real-network evidence are counted and reported.
 *
 * Usage:
 *   npx vite-node scripts/verify-t10-regression-compare.mjs --config scripts/vite.verify.config.mjs \
 *     [-- <headRoot>] (env T10_SCRIPTS="a.mjs,b.mjs" optional, T10_TIMEOUT_MS, T10_CONCURRENCY)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const WORK = "/Users/shuo/Roamie-clean";
const HEAD =
  process.env.T10_HEAD_ROOT ||
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/head";
const TIMEOUT_MS = Number(process.env.T10_TIMEOUT_MS || 240000);
const CONCURRENCY = Number(process.env.T10_CONCURRENCY || 5);

const DEFAULT_SCRIPTS = [
  "verify-regenerate-selected-combination-authority.mjs",
  "verify-offered-identity-concurrency.mjs",
  "verify-jeju-combination-fallback.mjs",
  "verify-chat-regenerate-handler-runtime.mjs",
  "verify-recommendation-reason-v2.mjs",
  "verify-recommendation-reason-authority.mjs",
  "verify-ai-itinerary-state-machine.mjs",
  "verify-chat-bottom-follow.mjs",
  "verify-chat-cafe-category.mjs",
  "verify-chat-context-intent.mjs",
  "verify-chat-create-authority.mjs",
  "verify-chat-destination-places.mjs",
  "verify-chat-display-preserve.mjs",
  "verify-chat-geocode-nonblocking-smoke.mjs",
  "verify-chat-no-combination-place-cards.mjs",
  "verify-chat-pending-duration-runtime.mjs",
  "verify-chat-persistence-compatibility.mjs",
  "verify-chat-place-intent.mjs",
  "verify-chat-place-search-context.mjs",
  "verify-chat-recommendation-refresh.mjs",
  "verify-chat-runtime-localization.mjs",
  "verify-chat-session-lifecycle.mjs",
  "verify-chat-shortcut-render-stability.mjs",
  "verify-chat-state-machine.mjs",
  "verify-combination-category-contract.mjs",
  "verify-combination-deliverability.mjs",
  "verify-combination-discovery-trace.mjs",
  "verify-combination-localization.mjs",
  "verify-combination-nearby-extension-reply.mjs",
  "verify-combination-post-validation-topup.mjs",
  "verify-combination-preferred-top-up.mjs",
  "verify-combination-resolved-metadata-reuse.mjs",
  "verify-combination-selection-diagnostics.mjs",
  "verify-combination-selection-ranges.mjs",
  "verify-country-city-combination-flow.mjs",
  "verify-direct-itinerary-generation.mjs",
  "verify-duration-combination-session-handoff.mjs",
  "verify-duration-to-combination-routing.mjs",
  "verify-full-itinerary-draft.mjs",
  "verify-generate-itinerary-result-normalization.mjs",
  "verify-global-combination-coverage-contract.mjs",
  "verify-global-combination-scope.mjs",
  "verify-hsinchu-combination-discovery-mock.mjs",
  "verify-hsinchu-combination-no-placeholders.mjs",
  "verify-initial-combination-offer-authority.mjs",
  "verify-itinerary-core.mjs",
  "verify-itinerary-credit-request-scope.mjs",
  "verify-itinerary-credits-settle-contract.mjs",
  "verify-itinerary-delivery-pipeline.mjs",
  "verify-itinerary-entity-extraction.mjs",
  "verify-itinerary-failure-telemetry.mjs",
  "verify-itinerary-generation-diagnostics.mjs",
  "verify-itinerary-guards.mjs",
  "verify-itinerary-handler-daily-balance.mjs",
  "verify-itinerary-handler-plus-personalization.mjs",
  "verify-itinerary-insufficient-credits.mjs",
  "verify-itinerary-integration.mjs",
  "verify-itinerary-integrity-failure-telemetry.mjs",
  "verify-itinerary-localization-runtime.mjs",
  "verify-itinerary-long-trip-duration-contract.mjs",
  "verify-itinerary-next-step.mjs",
  "verify-itinerary-persistence-day-index.mjs",
  "verify-itinerary-pipeline-acceptance.mjs",
  "verify-itinerary-place-sources.mjs",
  "verify-itinerary-rate-limit-recovery.mjs",
  "verify-itinerary-regression.mjs",
  "verify-itinerary-repair-no-progress.mjs",
  "verify-itinerary-selected-places-capacity.mjs",
  "verify-itinerary-ui-locale.mjs",
  "verify-itinerary-validator-p4-2.mjs",
  "verify-korean-itinerary-cover-contract.mjs",
  "verify-multi-combination-integrity.mjs",
  "verify-p19-chat-stream-native.mjs",
  "verify-p252-itinerary-invocation.mjs",
  "verify-p253-itinerary-native-transport.mjs",
  "verify-p32-itinerary-scope-coverage.mjs",
  "verify-p33-required-coverage-replan.mjs",
  "verify-p40-replan-deliverable-admission.mjs",
  "verify-p42-combination-composition.mjs",
  "verify-p524-itinerary-affiliate-render.mjs",
  "verify-paris-combination-all-select.mjs",
  "verify-place-detail-chat.mjs",
  "verify-planning-chat-shell.mjs",
  "verify-planning-selection-itinerary-handoff.mjs",
  "verify-regenerate-planner-session.mjs",
  "verify-replan-ios15-compat.mjs",
  "verify-replan-recipient-diversity.mjs",
  "verify-selected-combination-coverage.mjs",
  "verify-selected-combination-meals.mjs",
  "verify-single-combination-capacity.mjs",
  "verify-stored-itinerary-normalization.mjs",
  "verify-tainan-combination-allowlist.mjs",
  "verify-taipei-combination-multi-select.mjs",
  "verify-yilan-combination-mapping.mjs",
];

const SCRIPTS = process.env.T10_SCRIPTS
  ? process.env.T10_SCRIPTS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SCRIPTS;

const FAKE = "T10_FAKE_NOT_A_REAL_KEY";
const KEY_VARS = [
  "OPENAI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "GOOGLE_PLACES_SERVER_API_KEY",
  "VITE_GOOGLE_MAPS_IOS_API_KEY",
  "VITE_GOOGLE_MAPS_WEB_API_KEY",
  "VISUAL_CROSSING_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "EXPO_PUBLIC_OPENWEATHER_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_REVENUECAT_APPLE_KEY",
];
const childEnv = { ...process.env };
for (const k of KEY_VARS) childEnv[k] = FAKE;

const REAL_NET = /REQUEST_DENIED|API key not valid|invalid_api_key|Incorrect API key|ENOTFOUND|ECONNREFUSED|getaddrinfo/i;
const CALLS = /(calls?|count|requests?)\s*[=:]\s*\d+/i;

function runOne(root, script) {
  return new Promise((resolve) => {
    const file = path.join(root, "scripts", script);
    if (!existsSync(file)) return resolve({ missing: true });
    const started = Date.now();
    const child = spawn(
      "npx",
      ["vite-node", `scripts/${script}`, "--config", "scripts/vite.verify.config.mjs"],
      { cwd: root, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = out.split(/\r?\n/);
      const pass = lines.filter((l) => /^\s*(PASS|✓|✅|ok\b)/.test(l)).map((l) => l.trim());
      const fail = lines
        .filter((l) => /^\s*(FAIL|✗|❌|not ok\b)|AssertionError|^\s*Error:/.test(l))
        .map((l) => l.trim().slice(0, 240));
      const calls = lines
        .filter((l) => /^\s*(PASS|FAIL|INFO|OBSERVE|✓|✗|\[.*(CALL|PROVIDER).*\])/i.test(l) && CALLS.test(l))
        .map((l) => l.trim().slice(0, 240));
      const realNet = lines.filter((l) => REAL_NET.test(l)).length;
      resolve({
        code,
        timedOut,
        ms: Date.now() - started,
        pass,
        fail,
        calls,
        realNet,
        tail: lines.filter(Boolean).slice(-4).map((l) => l.slice(0, 200)),
      });
    });
  });
}

const jobs = [];
for (const s of SCRIPTS) for (const [label, root] of [["work", WORK], ["head", HEAD]]) jobs.push({ s, label, root });
const results = new Map();
let idx = 0;
async function worker() {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    const r = await runOne(j.root, j.s);
    results.set(`${j.s}|${j.label}`, r);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const status = (r) =>
  r.missing ? "MISSING" : r.timedOut ? "TIMEOUT" : r.code === 0 ? "EXIT0" : `EXIT${r.code}`;
const diff = (a, b) => {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
};

let regressions = 0;
let realNetTotal = 0;
for (const s of SCRIPTS) {
  const w = results.get(`${s}|work`);
  const h = results.get(`${s}|head`);
  realNetTotal += (w.realNet || 0) + (h.realNet || 0);
  const same =
    status(w) === status(h) &&
    !w.missing &&
    !h.missing &&
    diff(w.fail, h.fail).length === 0 &&
    diff(h.fail, w.fail).length === 0 &&
    diff(w.pass, h.pass).length === 0 &&
    diff(h.pass, w.pass).length === 0 &&
    diff(w.calls, h.calls).length === 0 &&
    diff(h.calls, w.calls).length === 0;
  console.log(
    `${same ? "SAME" : "DIFF"} ${s} work=${status(w)} pass=${w.pass?.length ?? "-"} fail=${w.fail?.length ?? "-"} ${w.ms ?? 0}ms | head=${status(h)} pass=${h.pass?.length ?? "-"} fail=${h.fail?.length ?? "-"} ${h.ms ?? 0}ms realNet=${w.realNet ?? 0}/${h.realNet ?? 0}`,
  );
  if (w.calls?.length) for (const c of w.calls) console.log(`    calls(work): ${c}`);
  if (same) continue;
  const workWorse =
    (status(w) !== "EXIT0" && status(h) === "EXIT0") || diff(w.fail, h.fail || []).length > 0;
  if (workWorse) regressions++;
  for (const x of diff(w.fail || [], h.fail || [])) console.log(`    +FAIL(work only): ${x}`);
  for (const x of diff(h.fail || [], w.fail || [])) console.log(`    -FAIL(head only): ${x}`);
  for (const x of diff(w.pass || [], h.pass || []).slice(0, 8)) console.log(`    +PASS(work only): ${x}`);
  for (const x of diff(h.pass || [], w.pass || []).slice(0, 8)) console.log(`    -PASS(head only): ${x}`);
  for (const x of diff(w.calls || [], h.calls || [])) console.log(`    calls work-only: ${x}`);
  for (const x of diff(h.calls || [], w.calls || [])) console.log(`    calls head-only: ${x}`);
  if (status(w) !== "EXIT0") console.log(`    work tail: ${JSON.stringify(w.tail)}`);
  if (status(h) !== "EXIT0") console.log(`    head tail: ${JSON.stringify(h.tail)}`);
}
console.log(`T10 SUMMARY scripts=${SCRIPTS.length} workWorse=${regressions} realNetEvidenceLines=${realNetTotal}`);
