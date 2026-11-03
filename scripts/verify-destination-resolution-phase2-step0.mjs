#!/usr/bin/env node
/**
 * T25 — Destination Resolution Phase 2 Step 0：Apply Identity Guard 獨立驗證（新 tester）。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-resolution-phase2-step0.mjs --config scripts/vite.verify.config.mjs
 *
 * - 直接 import src/lib/ai/destination-resolution.ts（純函式）。
 * - Provider 以 TripLocation / GeocodeFnEnvelope 形狀 mock；fetch / XHR 為 trap，geocodeFn 為 spy。
 * - P1：不該確認卻被確認（跨區 / 跨父城市 / 偽造 / 複製 / 竄改 verdict）、確認的目的地與
 *   使用者輸入的身分不一致、拒絕路徑不符合 ambiguous+unavailable+destination undefined+rawLabel
 *   與候選保留、合法 classify→apply 無法確認、apply 拋例外、provider 呼叫 > 0。
 * - P2：契約風險 / 信任邊界觀察。OBS：如實記錄。
 * - 任何 P1 → process.exitCode = 1。
 */

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] blocked: ${String(args[0]).slice(0, 120)}`);
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
const P2 = [];
const OBS = [];
const fail = (id, msg) => P1.push(`${id}: ${msg}`);
const warn = (id, msg) => P2.push(`${id}: ${msg}`);
const obs = (id, msg) => OBS.push(`${id}: ${msg}`);
const rows = [];
const row = (id, result, detail) => rows.push(`${result.padEnd(4)} ${id} — ${detail}`);

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
const pr = (status = "OK") => ({
  ok: status === "OK",
  status,
  provider: "geocode_fn",
  rawResultCount: status === "OK" ? 1 : 0,
  parsedResultCount: status === "OK" ? 1 : 0,
});
const env = (location, extra = {}) => ({
  kind: "envelope",
  envelope: { location, error: null, providerResult: pr(), ...extra },
});

const describe = (r) =>
  `${r.confidence}/${r.source}/dest=${r.destination ?? "-"}/type=${r.destinationType}/raw=${r.rawLabel ?? "-"}` +
  `/act=${r.activityPreference ?? "-"}/pv=${r.providerValidation ?? "-"}` +
  `/cand=${r.areaCandidate ? `${r.areaCandidate.parentCity}+${r.areaCandidate.area}(${r.areaCandidate.displayLabel})` : r.provisionalCandidate ? `prov:${r.provisionalCandidate.areaCandidate}` : "-"}`;

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
/** apply 包裝：拋例外視為 P1（呼叫端會直接崩潰，而不是走 ambiguous）。 */
const apply = (id, res, verdict, ev) => {
  silence();
  try {
    return R.applyDestinationProviderValidation(res, verdict, ev);
  } catch (error) {
    restore();
    fail(id, `apply 拋出例外（應回 ambiguous/unavailable）：${error?.name}: ${error?.message}`);
    return null;
  } finally {
    restore();
  }
};

const compactLabel = (s) => String(s ?? "").replace(/[\s,，、/／\-・·]+/g, "").replace(/臺/g, "台");

/** 拒絕路徑的完整契約。 */
function expectRejectedToUnavailable(id, before, after) {
  if (!after) return false;
  const problems = [];
  if (after.confidence !== "ambiguous") problems.push(`confidence=${after.confidence}`);
  if (after.providerValidation !== "unavailable") problems.push(`pv=${after.providerValidation}`);
  if (after.destination !== undefined) problems.push(`destination=${after.destination}`);
  if (after.geographicScope !== undefined) problems.push("geographicScope 有值");
  if (after.activityPreference !== undefined) problems.push(`act=${after.activityPreference}`);
  if (after.rawLabel !== before.rawLabel) problems.push(`rawLabel 變動 ${before.rawLabel}→${after.rawLabel}`);
  if (after.areaCandidate !== before.areaCandidate) problems.push("areaCandidate 未保留");
  if (after.provisionalCandidate !== before.provisionalCandidate) problems.push("provisionalCandidate 未保留");
  if (problems.length) {
    fail(id, `應拒絕但結果不符：${problems.join("; ")} → ${describe(after)}`);
    row(id, "FAIL", describe(after));
    return false;
  }
  row(id, "ok", describe(after));
  return true;
}

function expectConfirmed(id, before, after, expectedLabel) {
  if (!after) return false;
  const problems = [];
  if (after.confidence !== "confirmed") problems.push(`confidence=${after.confidence}`);
  if (after.providerValidation !== "validated") problems.push(`pv=${after.providerValidation}`);
  if (compactLabel(after.destination) !== compactLabel(expectedLabel)) problems.push(`destination=${after.destination}（應為 ${expectedLabel}）`);
  if (after.source !== "provider_validated") problems.push(`source=${after.source}`);
  if (after.destinationType !== "district") problems.push(`type=${after.destinationType}`);
  const gs = after.geographicScope;
  if (!gs || gs.searchScope !== "area" || compactLabel(gs.displayLabel) !== compactLabel(expectedLabel)) {
    problems.push(`geographicScope=${JSON.stringify(gs)}`);
  }
  if (after.rawLabel !== before.rawLabel) problems.push("rawLabel 變動");
  if (problems.length) {
    fail(id, `合法 classify→apply 應確認為 ${expectedLabel}：${problems.join("; ")} → ${describe(after)}`);
    row(id, "FAIL", describe(after));
    return false;
  }
  row(id, "ok", describe(after));
  return true;
}

// ───────────────────────── 0. 取得 pending 候選 ─────────────────────────
function pendingFor(id, texts) {
  for (const text of texts) {
    const r = resolve(text);
    obs(`${id}.resolve`, `「${text}」→ ${describe(r)}`);
    if (r.confidence === "pending_provider" && r.areaCandidate) return { text, r };
  }
  fail(id, `找不到能產生 known-parent pending 的輸入：${texts.join(" / ")}`);
  return null;
}

const HK_HV = pendingFor("HV", ["香港跑馬地", "香港 跑馬地", "香港跑馬地美食"]);
const HK_CWB = pendingFor("CWB", ["香港銅鑼灣", "香港 銅鑼灣", "香港銅鑼灣美食"]);
const TC_E = pendingFor("TCE", ["台中東區", "台中 東區", "台中東區美食"]);
const TN_E = pendingFor("TNE", ["台南東區", "台南 東區", "台南東區美食"]);

// 正確行政欄位 mock
const locFor = (cand, extra = {}) =>
  loc({
    sublocality: cand.area,
    city: cand.parentCity,
    formattedName: `${cand.parentCity}${cand.area}`,
    displayLabel: `${cand.parentCity}${cand.area}`,
    ...extra,
  });

const verdicts = {};

// ───────────────────────── 1. 合法 classify→apply ─────────────────────────
for (const [key, entry, label] of [
  ["HV", HK_HV, "香港跑馬地"],
  ["CWB", HK_CWB, "香港銅鑼灣"],
  ["TCE", TC_E, "台中東區"],
  ["TNE", TN_E, "台南東區"],
]) {
  if (!entry) continue;
  const cand = entry.r.areaCandidate;
  // sublocality 版本
  const vSub = classify(cand, env(locFor(cand)));
  // district 版本
  const vDist = classify(cand, env(locFor(cand, { sublocality: undefined, district: cand.area })));
  verdicts[key] = vSub;
  for (const [tag, v] of [["sublocality", vSub], ["district", vDist]]) {
    if (v.status !== "validated") {
      fail(`1.${key}.${tag}`, `classify 未產生 validated（${v.status}）；候選 ${cand.parentCity}+${cand.area}`);
      row(`1.${key}.${tag}`, "FAIL", `classify=${v.status}`);
      continue;
    }
    expectConfirmed(`1.${key}.${tag}`, entry.r, apply(`1.${key}.${tag}`, entry.r, v), label);
  }
}

// ───────────────────────── 2. 跨區 / 跨父城市互換 ─────────────────────────
const swaps = [
  ["2.CWB→HV", "CWB", HK_HV],
  ["2.HV→CWB", "HV", HK_CWB],
  ["2.TCE→TNE", "TCE", TN_E],
  ["2.TNE→TCE", "TNE", TC_E],
  ["2.CWB→TCE", "CWB", TC_E],
  ["2.TCE→HV", "TCE", HK_HV],
];
for (const [id, vKey, target] of swaps) {
  const v = verdicts[vKey];
  if (!v || !target) {
    fail(id, "前置條件不足（verdict 或目標 resolution 缺）");
    continue;
  }
  expectRejectedToUnavailable(id, target.r, apply(id, target.r, v));
}

// ───────────────────────── 3. 偽造 / 複製 / 竄改 ─────────────────────────
if (HK_HV && verdicts.HV && verdicts.CWB) {
  const target = HK_HV.r;
  const genuineHV = verdicts.HV;
  const genuineCWB = verdicts.CWB;
  const hvCand = target.areaCandidate;
  const forged = {
    "3.literal.HV": { status: "validated", scope: { displayLabel: "香港跑馬地", parentCity: hvCand.parentCity, area: hvCand.area, searchScope: "area" } },
    "3.literal.CWB": { status: "validated", scope: { displayLabel: "香港銅鑼灣", parentCity: "香港", area: "銅鑼灣", searchScope: "area" } },
    "3.literal.frozen.HV": Object.freeze({ status: "validated", scope: Object.freeze({ ...genuineHV.scope }) }),
    "3.spread.HV": { ...genuineHV },
    "3.spread.frozen.HV": Object.freeze({ ...genuineHV }),
    "3.structuredClone.HV": structuredClone(genuineHV),
    "3.json.HV": JSON.parse(JSON.stringify(genuineHV)),
    "3.spread.CWB": { ...genuineCWB },
    "3.structuredClone.CWB": structuredClone(genuineCWB),
    "3.json.CWB": JSON.parse(JSON.stringify(genuineCWB)),
    "3.object.create.HV": Object.create(genuineHV),
    "3.literal.noScope": { status: "validated" },
    "3.literal.nullScope": { status: "validated", scope: null },
    "3.literal.emptyScope": { status: "validated", scope: {} },
  };
  for (const [id, v] of Object.entries(forged)) {
    expectRejectedToUnavailable(id, target, apply(id, target, v));
  }

  // Proxy 包住真 verdict（identity 不同）
  const proxied = new Proxy(genuineHV, {});
  expectRejectedToUnavailable("3.proxy.HV", target, apply("3.proxy.HV", target, proxied));

  // 修改 verdict.scope（真 verdict 已 freeze：嘗試賦值）
  {
    const fresh = classify(HK_CWB.r.areaCandidate, env(locFor(HK_CWB.r.areaCandidate)));
    let threw = false;
    try {
      "use strict";
      fresh.scope = { ...genuineHV.scope };
    } catch {
      threw = true;
    }
    let threw2 = false;
    try {
      fresh.scope.displayLabel = "香港跑馬地";
      fresh.scope.area = hvCand.area;
    } catch {
      threw2 = true;
    }
    let defineThrew = false;
    try {
      Object.defineProperty(fresh, "scope", { value: genuineHV.scope });
    } catch {
      defineThrew = true;
    }
    obs("3.mutate", `frozen=${Object.isFrozen(fresh)}/${Object.isFrozen(fresh.scope)} 賦值拋錯=${threw} scope 欄位賦值拋錯=${threw2} defineProperty 拋錯=${defineThrew} 現 scope=${fresh.scope.displayLabel}`);
    if (fresh.scope.displayLabel !== "香港銅鑼灣" && compactLabel(fresh.scope.displayLabel) !== compactLabel(HK_CWB.r.areaCandidate.displayLabel)) {
      fail("3.mutate", `真 verdict 的 scope 被改動成 ${fresh.scope.displayLabel}`);
    }
    // 竄改嘗試後套到跑馬地 → 不得確認
    expectRejectedToUnavailable("3.mutate→HV", target, apply("3.mutate→HV", target, fresh));
    // 竄改嘗試後套回銅鑼灣 → 記錄（未被成功竄改，應仍可確認）
    const back = apply("3.mutate→CWB", HK_CWB.r, fresh);
    if (back) obs("3.mutate→CWB", describe(back));
  }

  // 改寫 resolution 的 areaCandidate 以配合偽造 verdict（resolution 是一般物件，可被呼叫端改）
  {
    const tampered = { ...target, areaCandidate: { ...genuineCWB.scope, validationStatus: "pending_provider" }, rawLabel: target.rawLabel };
    const out = apply("3.tamperResolution", tampered, genuineCWB);
    if (out) {
      obs("3.tamperResolution", `把跑馬地 resolution 的 areaCandidate 換成銅鑼灣後套用銅鑼灣真 verdict → ${describe(out)}`);
      if (out.confidence === "confirmed") {
        warn("3.tamperResolution", `resolution 本身不受保護：呼叫端改寫 areaCandidate（rawLabel 仍為「${target.rawLabel}」）即可確認成 ${out.destination}；guard 只綁 verdict↔candidate，不綁 rawLabel。屬呼叫端自行竄改，非外部 verdict 偽造`);
      }
    }
  }
}

// ───────────────────────── 4. 同一句話再 resolve 一次 ─────────────────────────
for (const [key, entry, label] of [
  ["HV", HK_HV, "香港跑馬地"],
  ["CWB", HK_CWB, "香港銅鑼灣"],
]) {
  if (!entry || !verdicts[key]) continue;
  const again = resolve(entry.text);
  const sameObj = again === entry.r || again.areaCandidate === entry.r.areaCandidate;
  const out = apply(`4.reResolve.${key}`, again, verdicts[key]);
  if (out) {
    obs(`4.reResolve.${key}`, `新 resolution（同物件=${sameObj}）套用前一次 classify 的 verdict → ${describe(out)}`);
    row(`4.reResolve.${key}`, "rec", describe(out));
    if (out.confidence === "confirmed" && compactLabel(out.destination) !== compactLabel(label)) {
      fail(`4.reResolve.${key}`, `確認成錯誤目的地 ${out.destination}`);
    }
  }
  // 重複套用同一 verdict 兩次
  const twice = apply(`4.twice.${key}`, entry.r, verdicts[key]);
  if (twice) obs(`4.twice.${key}`, describe(twice));
}

// ───────────────────────── 5. 地理身分（使用者要求 1–4）─────────────────────────
if (HK_HV) {
  const cand = HK_HV.r.areaCandidate;
  const cases = [
    ["5.HV.otherArea", loc({ sublocality: "銅鑼灣", city: cand.parentCity })],
    ["5.HV.otherParent", loc({ sublocality: cand.area, city: "台北" })],
    ["5.HV.poiOnly", loc({ city: cand.parentCity, formattedName: `${cand.area}馬場`, displayLabel: cand.area })],
    ["5.HV.poiNameAsDisplay", loc({ city: cand.parentCity, formattedName: `${cand.parentCity}${cand.area}`, displayLabel: `${cand.parentCity}${cand.area}` })],
    ["5.HV.substring", loc({ sublocality: `${cand.area}馬場`, city: cand.parentCity })],
    ["5.HV.parentOnly", loc({ city: cand.parentCity })],
    ["5.HV.areaInCityOnly", loc({ city: cand.area, region: cand.parentCity })],
    ["5.HV.noPlaceId", loc({ placeId: "", sublocality: cand.area, city: cand.parentCity })],
  ];
  for (const [id, l] of cases) {
    const v = classify(cand, env(l));
    if (v.status === "validated") {
      if (id === "5.HV.areaInCityOnly") {
        // city=跑馬地, region=香港 — 行政欄位都不在 district/sublocality → 不應 validated
        fail(id, `area 只在 city 欄位卻 validated`);
      } else {
        fail(id, `classify 不應 validated：${JSON.stringify(l)}`);
      }
    }
    expectRejectedToUnavailable(id, HK_HV.r, apply(id, HK_HV.r, v));
  }
}

// ───────────────────────── 6. unavailable / rejected 行為 ─────────────────────────
if (HK_HV) {
  const r = HK_HV.r;
  expectRejectedToUnavailable("6.unavailable", r, apply("6.unavailable", r, { status: "unavailable" }));
  const thrown = classify(r.areaCandidate, { kind: "thrown", error: new Error("timeout") });
  if (thrown.status !== "unavailable") fail("6.thrown", `thrown → ${thrown.status}`);
  expectRejectedToUnavailable("6.thrown", r, apply("6.thrown", r, thrown));

  const rej = apply("6.rejected.noEvidence", r, { status: "rejected" });
  if (rej) {
    const ok = rej.confidence === "ambiguous" && rej.providerValidation === "rejected" && rej.destination === undefined && rej.rawLabel === r.rawLabel && rej.areaCandidate === r.areaCandidate;
    row("6.rejected.noEvidence", ok ? "ok" : "FAIL", describe(rej));
    if (!ok) fail("6.rejected.noEvidence", describe(rej));
  }
  const rejPartial = apply("6.rejected.partial", r, { status: "rejected" }, r.areaCandidate.area.slice(0, 1));
  if (rejPartial) {
    const ok = rejPartial.confidence === "ambiguous" && rejPartial.destination === undefined;
    row("6.rejected.partialEvidence", ok ? "ok" : "FAIL", describe(rejPartial));
    if (!ok) fail("6.rejected.partialEvidence", `部分尾段證據卻切割：${describe(rejPartial)}`);
  }
  const rejWhole = apply("6.rejected.whole", r, { status: "rejected" }, r.areaCandidate.area);
  if (rejWhole) {
    row("6.rejected.wholeEvidence", "rec", describe(rejWhole));
    if (rejWhole.confidence === "confirmed") {
      warn("6.rejected.wholeEvidence", `已知 P2（任務單）：手寫 rejected + 整段尾段證據可把「${r.rawLabel}」切成 ${rejWhole.destination}+act=${rejWhole.activityPreference}；rejected 不受 identity guard 保護（classify 目前從不產生 rejected）`);
    }
  }
  // rejected 不應產生 validated 欄位
  const classifyNeverRejected = [
    env(loc({ city: r.areaCandidate.parentCity })),
    env(loc({ sublocality: "銅鑼灣", city: r.areaCandidate.parentCity })),
    { kind: "envelope", envelope: { location: null, error: null, providerResult: pr("ZERO_RESULTS") } },
  ].map((o) => classify(r.areaCandidate, o).status);
  if (classifyNeverRejected.some((s) => s !== "unavailable")) fail("6.classifyStatuses", classifyNeverRejected.join(","));
  else row("6.classifyStatuses", "ok", classifyNeverRejected.join(","));
}

// ───────────────────────── 7. provisional 路徑 ─────────────────────────
{
  const prov = ["跑馬地", "某某小鎮", "清水斷崖附近"].map((t) => [t, resolve(t)]).find(([, r]) => r.confidence === "pending_provider" && r.provisionalCandidate);
  if (prov) {
    const [t, r] = prov;
    if (verdicts.HV) expectRejectedToUnavailable(`7.provisional(${t})+HV`, r, apply("7.prov", r, verdicts.HV));
    const pv = classify(r.provisionalCandidate, env(loc({ sublocality: "跑馬地", city: "香港" })));
    if (pv.status !== "unavailable") fail("7.provisional.classify", `provisional → ${pv.status}`);
  } else {
    obs("7.provisional", "未找到 provisional 輸入，略過");
  }
}

// ───────────────────────── 8. 非 pending 原樣回傳 ─────────────────────────
{
  const confirmed = resolve("台北");
  if (verdicts.HV) {
    const out = apply("8.nonPending", confirmed, verdicts.HV);
    if (out !== confirmed) fail("8.nonPending", `非 pending 被修改：${describe(out)}`);
    else row("8.nonPending", "ok", describe(out));
  }
}

// ───────────────────────── 9. provider 呼叫次數 ─────────────────────────
if (fetchCalls || xhrCalls || geocodeCalls) {
  fail("9.providerCalls", `fetch=${fetchCalls} xhr=${xhrCalls} geocode=${geocodeCalls}`);
}
row("9.providerCalls", fetchCalls + xhrCalls + geocodeCalls === 0 ? "ok" : "FAIL", `fetch=${fetchCalls} xhr=${xhrCalls} geocode=${geocodeCalls}`);

console.log("── 案例 ──");
for (const r of rows) console.log(r);
console.log("\n── OBS ──");
for (const o of OBS) console.log(o);
console.log(`\n── P2 (${P2.length}) ──`);
for (const p of P2) console.log(p);
console.log(`\n── P1 (${P1.length}) ──`);
for (const p of P1) console.log(p);
console.log(`\nSUMMARY P1=${P1.length} P2=${P2.length} OBS=${OBS.length}`);
if (P1.length) process.exitCode = 1;
