#!/usr/bin/env node
/**
 * T26 — Destination Resolution Phase 2 Step 0 第 2 輪：apply 對格式錯誤 verdict 不得拋錯。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-resolution-phase2-step0-r2.mjs --config scripts/vite.verify.config.mjs
 *
 * P1：apply 拋錯；格式錯誤 verdict 未回 ambiguous/unavailable/destination undefined；
 *     合法 classify→apply 無法確認完整地名；真 verdict 互換被接受；provider 呼叫 > 0。
 * 任何 P1 → process.exitCode = 1。
 */

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("[fetch-trap] blocked");
};
let xhrCalls = 0;
globalThis.XMLHttpRequest = class {
  open() {
    xhrCalls += 1;
    throw new Error("[xhr-trap] blocked");
  }
};
let geocodeCalls = 0;
const geocodeSpy = async () => {
  geocodeCalls += 1;
  return { location: null, error: "spy" };
};

const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const silence = () => {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.log = () => {};
};
const restore = () => Object.assign(console, orig);

const ROOT = "/Users/shuo/Roamie-clean";
silence();
const R = await import(`${ROOT}/src/lib/ai/destination-resolution.ts`);
restore();

const P1 = [];
const rows = [];
const fail = (id, msg) => P1.push(`${id}: ${msg}`);
const row = (id, ok, detail) => rows.push(`${ok ? "ok  " : "FAIL"} ${id} — ${detail}`);

const describe = (r) =>
  r == null
    ? String(r)
    : `${r.confidence}/${r.source}/dest=${r.destination ?? "-"}/type=${r.destinationType}` +
      `/raw=${r.rawLabel ?? "-"}/pv=${r.providerValidation ?? "-"}` +
      `/cand=${r.areaCandidate ? `${r.areaCandidate.parentCity}+${r.areaCandidate.area}(${r.areaCandidate.displayLabel})` : "-"}`;

const resolve = (text) => {
  silence();
  try {
    return R.resolveDestination({ text, sessionDestination: null, geocodeFn: geocodeSpy });
  } finally {
    restore();
  }
};
const classify = (cand, outcome) => {
  silence();
  try {
    return R.classifyDestinationProviderEvidence(cand, outcome);
  } finally {
    restore();
  }
};
/** 回傳 { result, error }；不在此吞掉錯誤判定。 */
const applySafe = (res, verdict) => {
  silence();
  try {
    return { result: R.applyDestinationProviderValidation(res, verdict) };
  } catch (error) {
    return { error };
  } finally {
    restore();
  }
};

function loc(fields) {
  return {
    placeId: "mock-place-id",
    country: "mock",
    city: "",
    lat: 0,
    lng: 0,
    formattedName: "",
    displayLabel: "",
    ...fields,
  };
}
const env = (location) => ({
  kind: "envelope",
  envelope: {
    location,
    error: null,
    providerResult: {
      ok: true,
      status: "OK",
      provider: "geocode_fn",
      rawResultCount: 1,
      parsedResultCount: 1,
    },
  },
});

/** 拒絕路徑檢查：不拋錯、ambiguous、unavailable、destination undefined、rawLabel 與候選保留。 */
function expectRejected(id, pending, verdict) {
  const { result, error } = applySafe(pending, verdict);
  if (error) {
    fail(id, `apply 拋錯：${error?.name}: ${error?.message}`);
    row(id, false, `throw ${error?.name}: ${error?.message}`);
    return;
  }
  const problems = [];
  if (!result || typeof result !== "object") problems.push("非物件結果");
  else {
    if (result.confidence !== "ambiguous") problems.push(`confidence=${result.confidence}`);
    if (result.providerValidation !== "unavailable")
      problems.push(`providerValidation=${result.providerValidation}`);
    if (result.destination !== undefined) problems.push(`destination=${result.destination}`);
    if (result.geographicScope !== undefined) problems.push("geographicScope 非 undefined");
    if (result.destinationType !== "unknown") problems.push(`type=${result.destinationType}`);
    if (result.activityPreference !== undefined) problems.push("activityPreference 非 undefined");
    if (result.rawLabel !== pending.rawLabel) problems.push(`rawLabel=${result.rawLabel}`);
    if (result.areaCandidate !== pending.areaCandidate) problems.push("areaCandidate 未保留");
  }
  if (problems.length) fail(id, `${problems.join(", ")} → ${describe(result)}`);
  row(id, problems.length === 0, describe(result));
}

// ── 前置：pending resolution ──
const HV = resolve("香港跑馬地");
const CWB = resolve("香港銅鑼灣");
for (const [id, r, area] of [
  ["pre.HV", HV, "跑馬地"],
  ["pre.CWB", CWB, "銅鑼灣"],
]) {
  const ok =
    r.confidence === "pending_provider" &&
    r.source === "known_parent_tail" &&
    r.destination === undefined &&
    r.areaCandidate?.parentCity === "香港" &&
    r.areaCandidate?.area === area;
  if (!ok) fail(id, `前置 resolution 非預期：${describe(r)}`);
  row(id, ok, describe(r));
}

// ── 1. 格式錯誤的 validated verdict（香港跑馬地） ──
const malformedValidated = [
  ["1.validated.noScope", { status: "validated" }],
  ["1.validated.scopeNull", { status: "validated", scope: null }],
  ["1.validated.scopeEmpty", { status: "validated", scope: {} }],
  ["1.validated.scopeString", { status: "validated", scope: "x" }],
];
for (const [id, v] of malformedValidated) expectRejected(id, HV, v);

// ── 2. 非 verdict 形狀 ──
const malformedOther = [
  ["2.null", null],
  ["2.undefined", undefined],
  ["2.number", 42],
  ["2.numberZero", 0],
  ["2.string", "validated"],
  ["2.emptyString", ""],
  ["2.emptyObject", {}],
  ["2.statusUnknown", { status: "unknown" }],
];
for (const [id, v] of malformedOther) expectRejected(id, HV, v);

// ── 3. 合法 classify → apply ──
const validLoc = (cand) => env(loc({ sublocality: cand.area, city: cand.parentCity }));
const vHV = classify(HV.areaCandidate, validLoc(HV.areaCandidate));
const vCWB = classify(CWB.areaCandidate, validLoc(CWB.areaCandidate));
for (const [id, v] of [
  ["3.classify.HV", vHV],
  ["3.classify.CWB", vCWB],
]) {
  const ok = v?.status === "validated";
  if (!ok) fail(id, `classify 未回 validated：${JSON.stringify(v)}`);
  row(id, ok, `status=${v?.status}/scope=${v?.scope?.displayLabel ?? "-"}`);
}
for (const [id, pending, v, expected] of [
  ["3.apply.HV", HV, vHV, "香港跑馬地"],
  ["3.apply.CWB", CWB, vCWB, "香港銅鑼灣"],
]) {
  const { result, error } = applySafe(pending, v);
  if (error) {
    fail(id, `apply 拋錯：${error?.message}`);
    row(id, false, `throw ${error?.message}`);
    continue;
  }
  const ok =
    result.confidence === "confirmed" &&
    result.source === "provider_validated" &&
    result.providerValidation === "validated" &&
    result.destination === expected &&
    result.destinationType === "district" &&
    result.geographicScope?.displayLabel === expected;
  if (!ok) fail(id, `合法驗證未確認成「${expected}」：${describe(result)}`);
  row(id, ok, describe(result));
}

// ── 4. 真 verdict 互換 ──
expectRejected("4.swap.HV←CWBverdict", HV, vCWB);
expectRejected("4.swap.CWB←HVverdict", CWB, vHV);

// ── 5. provider 呼叫次數 ──
const callsOk = fetchCalls === 0 && xhrCalls === 0 && geocodeCalls === 0;
if (!callsOk) fail("5.providerCalls", `fetch=${fetchCalls} xhr=${xhrCalls} geocode=${geocodeCalls}`);
row("5.providerCalls", callsOk, `fetch=${fetchCalls} xhr=${xhrCalls} geocode=${geocodeCalls}`);

console.log(rows.join("\n"));
console.log(`\n── P1 (${P1.length}) ──`);
for (const p of P1) console.log(` ! ${p}`);
console.log(`\nSUMMARY P1=${P1.length} cases=${rows.length}`);
if (P1.length) process.exitCode = 1;
