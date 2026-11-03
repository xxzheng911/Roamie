#!/usr/bin/env node
/**
 * T24 — Destination Resolution Authority Phase 1 最終獨立驗收（第 3 輪，新 tester）。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-resolution-phase1-r3.mjs --config scripts/vite.verify.config.mjs
 *
 * - 直接 import src/lib/ai/destination-resolution.ts（純函式），不經 UI。
 * - Provider 一律以 TripLocation（src/lib/location/types.ts:2）/ GeocodeFnEnvelope
 *   （src/lib/ai/destination-provider-result.ts:45）形狀的 mock 或 thrown 模擬。
 * - globalThis.fetch / XMLHttpRequest 為 trap，geocodeFn 為 spy；不用 API Key、不產生費用。
 * - P1（任務單定義）：錯誤驗證目的地、自行替換目的地城市、錯誤切割合法地名、活動污染
 *   destination、新增 provider 呼叫、pending/ambiguous 卻帶 destination、只有父城市證據判
 *   rejected。P2：契約風險／過度保守／信任邊界，非直接錯誤放行。OBS：如實記錄的觀察。
 * - 任何 P1 → process.exitCode = 1。
 */
import fs from "node:fs";
import path from "node:path";

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
const N = await import(`${ROOT}/src/lib/ai/trip-planning-context.ts`);
restore();

const compact = (s) =>
  N.normalizeDestinationLabel(String(s ?? ""))
    .replace(/[\s,，、/／\-・·]+/g, "")
    .replace(/臺/g, "台");

const P1 = [];
const P2 = [];
const OBS = [];
const fail = (id, msg) => P1.push(`${id}: ${msg}`);
const warn = (id, msg) => P2.push(`${id}: ${msg}`);
const obs = (id, msg) => OBS.push(`${id}: ${msg}`);

// ── provider mock（TripLocation 形狀）──
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
const FAILURES = {
  timeout_thrown: { kind: "thrown", error: Object.assign(new Error("The operation was aborted."), { name: "AbortError" }) },
  timeout_thrown_string: { kind: "thrown", error: "timeout" },
  zero_results: { kind: "envelope", envelope: { location: null, error: null, providerResult: pr("ZERO_RESULTS") } },
  zero_results_error: { kind: "envelope", envelope: { location: null, error: "geocode_zero_results", providerResult: pr("ZERO_RESULTS") } },
  null_envelope: { kind: "envelope", envelope: null },
  undefined_envelope: { kind: "envelope", envelope: undefined },
  null_location: { kind: "envelope", envelope: { location: null, error: null } },
  location_ok_but_pr_fail: null, // 依候選動態產生
  no_placeid: null, // 依候選動態產生
};

const describe = (r) =>
  `${r.confidence}/${r.source}/dest=${r.destination ?? "-"}/type=${r.destinationType}/raw=${r.rawLabel ?? "-"}` +
  `/act=${r.activityPreference ?? "-"}/pv=${r.providerValidation ?? "-"}` +
  `/cand=${r.areaCandidate ? `${r.areaCandidate.parentCity}+${r.areaCandidate.area}` : r.provisionalCandidate ? `prov:${r.provisionalCandidate.areaCandidate}` : "-"}`;

const resolve = (text, sessionDestination = null) => {
  silence();
  try {
    // geocodeFn 不是 resolveDestination 的參數；仍傳入 spy 以證明模組不會呼叫任何注入的 provider
    return R.resolveDestination({ text, sessionDestination, geocodeFn: geocodeSpy });
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
const apply = (res, verdict, ev) => {
  silence();
  try {
    return R.applyDestinationProviderValidation(res, verdict, ev);
  } finally {
    restore();
  }
};

/** 每個結果都必須成立的不變式。 */
function invariants(id, r) {
  const pendingLike = r.confidence === "pending_provider" || r.confidence === "ambiguous";
  if (pendingLike && r.destination !== undefined) fail(id, `${r.confidence} 但 destination=${r.destination}`);
  if (pendingLike && r.geographicScope !== undefined) fail(id, `${r.confidence} 但 geographicScope 有值`);
  if (!pendingLike && !r.destination) fail(id, `${r.confidence} 但無 destination`);
  if (r.confidence === "confirmed" && r.provisionalCandidate && !r.areaCandidate) {
    fail(id, `無可信父城市的 provisional 候選被確認：${describe(r)}`);
  }
}

const log = [];
const out = (s) => log.push(s);

/**
 * 跑一個輸入：init → 每個 provider 情境 classify → apply（無證據 / 活動證據 / 弱證據）。
 * spec.scenarios: { name: { outcome, expect: "validated"|"unavailable"|null, note? } }
 * spec.expectDest: validated 時 destination 必須等於的完整地名（compact 比較）
 */
function runCase(id, text, spec) {
  const init = resolve(text, spec.session ?? null);
  out(`\n[${id}]「${text}」init: ${describe(init)}`);
  invariants(`${id} init`, init);
  if (init.activityPreference !== undefined) fail(`${id} init`, `初判即切出 activityPreference=${init.activityPreference}`);
  if (spec.kind === "activity" && init.destination !== undefined && init.source !== "session") {
    fail(`${id} init`, `活動句初判即確認 destination=${init.destination}`);
  }
  if (spec.kind !== "activity" && init.destination !== undefined && compact(init.destination) !== compact(spec.full)) {
    fail(`${id} init`, `初判 destination 非完整地名：${init.destination}（完整 ${spec.full}）`);
  }
  if (spec.expectInitSource && init.source !== spec.expectInitSource) {
    obs(`${id} init`, `source=${init.source}（預期 ${spec.expectInitSource}）`);
  }
  if ((init.confidence === "pending_provider" || init.confidence === "ambiguous") && !init.rawLabel) {
    warn(`${id} init`, "pending/ambiguous 但 rawLabel 遺失");
  }
  if (init.rawLabel && spec.full && compact(init.rawLabel) !== compact(spec.full) && spec.kind !== "activity") {
    obs(`${id} init`, `rawLabel=${init.rawLabel} 與完整地名 ${spec.full} 不同`);
  }
  const cand = init.areaCandidate ?? init.provisionalCandidate;
  if (init.confidence !== "pending_provider" || !cand) {
    out("   （非 pending_provider，無 provider 情境）");
    return { init, results: {} };
  }
  const isProv = Boolean(init.provisionalCandidate && !init.areaCandidate);
  const scen = { ...spec.scenarios(init) };
  for (const [k, v] of Object.entries(FAILURES)) if (v) scen[k] = { outcome: v, expect: "unavailable" };
  const results = {};
  for (const [sname, { outcome, expect, note }] of Object.entries(scen)) {
    const sid = `${id} ${sname}`;
    const verdict = classify(cand, outcome);
    const r0 = apply(init, verdict);
    const rEv = spec.evidence ? apply(init, verdict, spec.evidence) : null;
    const rWeak = spec.weakEvidence ? apply(init, verdict, spec.weakEvidence) : null;
    const rWhole = init.areaCandidate ? apply(init, verdict, init.areaCandidate.area) : null;
    results[sname] = { verdict, r0 };

    if (verdict.status === "rejected") fail(sid, "classify 輸出 rejected（現有證據不足以否定；只有父城市證據不得 rejected）");
    if (isProv && verdict.status !== "unavailable") fail(sid, `無可信父城市候選 verdict=${verdict.status}`);
    if (expect && verdict.status !== expect) {
      if (verdict.status === "validated") fail(sid, `錯誤驗證：verdict=validated（期望 ${expect}）${note ? `｜${note}` : ""}`);
      else fail(sid, `合法行政區未通過：verdict=${verdict.status}（期望 ${expect}）${note ? `｜${note}` : ""}`);
    }
    if (expect === null) obs(sid, `[記錄] verdict=${verdict.status} → ${r0.confidence}/${r0.destination ?? "-"}${note ? `｜${note}` : ""}`);

    for (const [tag, r] of [["noEv", r0], ["ev", rEv], ["weakEv", rWeak], ["wholeTailEv", rWhole]]) {
      if (!r) continue;
      const rid = `${sid} ${tag}`;
      invariants(rid, r);
      if (r.activityPreference !== undefined) fail(rid, `非 rejected 卻切出活動 ${r.activityPreference}`);
      if (verdict.status === "validated") {
        if (r.confidence !== "confirmed" || r.source !== "provider_validated" || r.providerValidation !== "validated") {
          fail(rid, `validated 套用結果錯誤：${describe(r)}`);
        }
        if (compact(r.destination) !== compact(init.areaCandidate.displayLabel)) {
          fail(rid, `validated destination 非候選完整標籤：${r.destination}（候選 ${init.areaCandidate.displayLabel}）`);
        }
        if (!compact(r.destination).startsWith(compact(init.areaCandidate.parentCity))) {
          fail(rid, `validated destination 父城市被替換：${r.destination}`);
        }
        if (spec.kind === "activity" && expect !== null) fail(rid, `活動尾段被驗證成目的地：${r.destination}`);
      } else {
        if (r.confidence !== "ambiguous" || r.providerValidation !== "unavailable") {
          fail(rid, `非 validated 應 ambiguous/unavailable：${describe(r)}`);
        }
        if (r.rawLabel !== init.rawLabel) fail(rid, `rawLabel 未保留：${r.rawLabel} ≠ ${init.rawLabel}`);
        if ((init.areaCandidate && r.areaCandidate !== init.areaCandidate) || (init.provisionalCandidate && r.provisionalCandidate !== init.provisionalCandidate)) {
          fail(rid, "候選未保留");
        }
      }
    }
    out(
      `   ${sname.padEnd(34)} ${verdict.status.padEnd(11)} → ${r0.confidence}/pv=${r0.providerValidation}/dest=${r0.destination ?? "-"}/raw=${r0.rawLabel ?? "-"}` +
        (rEv ? ` | ev「${spec.evidence}」:${rEv.destination ?? "-"}/act=${rEv.activityPreference ?? "-"}` : "") +
        (rWeak ? ` | weak「${spec.weakEvidence}」:${rWeak.destination ?? "-"}/act=${rWeak.activityPreference ?? "-"}` : ""),
    );
  }
  return { init, results };
}

/** 依候選產生通用 provider 情境（other city / POI / substring / parent-only）。 */
function commonScenarios(init, { parent, otherCity = "澳門", otherRegion = "澳門特別行政區" }) {
  const isProv = Boolean(init.provisionalCandidate && !init.areaCandidate);
  const area = isProv ? init.provisionalCandidate.areaCandidate : init.areaCandidate.area;
  const label = isProv ? init.provisionalCandidate.rawLabel : init.areaCandidate.displayLabel;
  const p = isProv ? parent : init.areaCandidate.parentCity;
  return {
    other_city_same_name_district: {
      outcome: env(loc({ city: otherCity, region: otherRegion, district: area, formattedName: `${otherCity}${area}`, displayLabel: area })),
      expect: "unavailable",
      note: "同名地點在其他城市",
    },
    other_city_same_name_sublocality: {
      outcome: env(loc({ city: otherCity, sublocality: area, formattedName: `${otherCity} ${area}`, displayLabel: area })),
      expect: "unavailable",
    },
    other_city_full_label_district: {
      outcome: env(loc({ city: otherCity, district: label, formattedName: `${otherCity}${label}`, displayLabel: label })),
      expect: "unavailable",
      note: "T23 形狀：district=完整標籤、city=其他城市",
    },
    other_city_name_mentions_parent: {
      outcome: env(loc({ city: otherCity, district: area, formattedName: `${p ?? ""}${area}（${otherCity}）`, displayLabel: `${p ?? ""}${area}`, address: `${p ?? ""} ${area}` })),
      expect: "unavailable",
      note: "formattedName/address 含父城市字樣但行政欄位是其他城市",
    },
    poi_name_only: {
      outcome: env(loc({ city: p ?? otherCity, formattedName: `${label}`, displayLabel: label, address: `${p ?? ""} ${label}` })),
      expect: "unavailable",
      note: "普通 POI：名稱只在 formattedName/displayLabel/address",
    },
    substring_district: {
      outcome: env(loc({ city: p ?? otherCity, district: `${area}中心`, sublocality: `大${area}`, formattedName: label, displayLabel: label })),
      expect: "unavailable",
      note: "行政欄位只以子字串包含尾段",
    },
    parent_only_fallback: {
      outcome: env(loc({ city: p ?? otherCity, region: p ?? otherRegion, formattedName: p ?? otherCity, displayLabel: p ?? otherCity })),
      expect: "unavailable",
      note: "Google 回退到父城市本身（只有父城市證據）",
    },
    area_without_parent_fields: {
      outcome: env(loc({ city: "", region: "", district: area, formattedName: label, displayLabel: label })),
      expect: "unavailable",
      note: "尾段相符但無父城市欄位",
    },
    location_ok_but_pr_fail: {
      outcome: env(loc({ city: p ?? otherCity, district: area }), { providerResult: pr("ZERO_RESULTS") }),
      expect: "unavailable",
    },
    location_ok_but_error: {
      outcome: env(loc({ city: p ?? otherCity, district: area }), { error: "geocode_timeout" }),
      expect: "unavailable",
    },
    no_placeid: {
      outcome: env(loc({ placeId: "", city: p ?? otherCity, district: area })),
      expect: "unavailable",
    },
  };
}

// ══════════ A. 千葉釣崎海岸（T23 P1 重現點）══════════
const CHIBA_REAL = loc({ city: "一宮町", region: "千葉県", formattedName: "日本、〒299-4301 千葉県長生郡一宮町 釣ヶ崎海岸", displayLabel: "釣ヶ崎海岸" });
for (const [i, text] of ["千葉釣崎海岸推薦景點", "我想去千葉釣崎海岸，推薦景點", "千葉釣崎海岸"].entries()) {
  runCase(`A.${i + 1}`, text, {
    full: "千葉釣崎海岸",
    kind: "poi",
    weakEvidence: "釣",
    scenarios: (init) => ({
      ...commonScenarios(init, { parent: "千葉" }),
      t23_district_full_city_macau: {
        outcome: env(loc({ city: "澳門", district: "千葉釣崎海岸", formattedName: "澳門千葉釣崎海岸", displayLabel: "千葉釣崎海岸" })),
        expect: "unavailable",
        note: "T23 P1 原始重現：district=千葉釣崎海岸、city=澳門",
      },
      t23_district_tail_city_macau: {
        outcome: env(loc({ city: "澳門", region: "澳門", district: "釣崎海岸", formattedName: "澳門釣崎海岸", displayLabel: "釣崎海岸" })),
        expect: "unavailable",
      },
      t23_city_full_region_macau: {
        outcome: env(loc({ city: "千葉釣崎海岸", region: "澳門" })),
        expect: "unavailable",
      },
      realistic_ichinomiya: { outcome: env(CHIBA_REAL), expect: "unavailable", note: "寫實：一宮町/千葉県，無 district" },
      realistic_chiba_city_fallback: {
        outcome: env(loc({ city: "千葉市", region: "千葉県", formattedName: "日本千葉県千葉市", displayLabel: "千葉市" })),
        expect: "unavailable",
        note: "寫實：Google 回退千葉市",
      },
      realistic_district_chiba: {
        outcome: env(loc({ city: "千葉市", region: "千葉県", district: "釣崎海岸", formattedName: "千葉市 釣崎海岸", displayLabel: "釣崎海岸" })),
        expect: "unavailable",
        note: "無可信父城市：即使 provider 稱 district=釣崎海岸/city=千葉市 也不得確認",
      },
    }),
  });
}

// ══════════ B. 不同城市同名地點 ══════════
// B1 known-parent：香港跑馬地 → provider 回其他城市
runCase("B1.1", "香港跑馬地推薦景點", {
  full: "香港跑馬地",
  kind: "admin",
  scenarios: (init) => ({
    ...commonScenarios(init, { parent: "香港" }),
    other_city_region_other: {
      outcome: env(loc({ city: "台北市", region: "台灣", district: "跑馬地", formattedName: "台北跑馬地" })),
      expect: "unavailable",
    },
    other_city_but_region_parent: {
      outcome: env(loc({ city: "深圳市", region: "香港", district: "跑馬地" })),
      expect: null,
      note: "人工矛盾：city=深圳、region=香港（上級範圍=父城市）",
    },
  }),
});
runCase("B1.2", "台中東區推薦景點", {
  full: "台中東區",
  kind: "admin",
  scenarios: (init) => ({
    ...commonScenarios(init, { parent: "台中" }),
    same_name_tainan_east: {
      outcome: env(loc({ city: "台南市", region: "台南市", district: "東區", formattedName: "台灣台南市東區" })),
      expect: "unavailable",
      note: "同名區在台南",
    },
    correct_taichung_east: {
      outcome: env(loc({ city: "台中市", region: "台中市", district: "東區", formattedName: "台灣台中市東區" })),
      expect: "validated",
    },
  }),
});
// B2 沒有父城市：釣崎海岸 / 埔里鎮 → provider 回其他城市
for (const [i, [text, area]] of [["釣崎海岸推薦景點", "釣崎海岸"], ["埔里鎮推薦景點", "埔里鎮"]].entries()) {
  runCase(`B2.${i + 1}`, text, {
    full: area,
    kind: "admin",
    scenarios: (init) => ({
      ...commonScenarios(init, { parent: undefined }),
      other_city_township_in_city: {
        outcome: env(loc({ city: area, region: "澳門" })),
        expect: "unavailable",
      },
    }),
  });
}

// ══════════ C. 有可信父城市的合法行政區（應 validated 並保留完整地名）══════════
const ADMIN = [
  { id: "C.1", text: "香港跑馬地推薦景點", full: "香港跑馬地", ok: loc({ city: "香港", region: "香港", district: "灣仔區", sublocality: "跑馬地", formattedName: "香港跑馬地", displayLabel: "跑馬地" }), note: "寫實：sublocality=跑馬地、district=灣仔區" },
  { id: "C.2", text: "我想去香港跑馬地，推薦景點", full: "香港跑馬地", ok: loc({ city: "香港", district: "跑馬地", formattedName: "香港跑馬地", displayLabel: "跑馬地" }) },
  { id: "C.3", text: "台中西屯推薦景點", full: "台中西屯", ok: loc({ city: "台中市", region: "台中市", district: "西屯區", formattedName: "台灣台中市西屯區" }) },
  { id: "C.4", text: "台中東區推薦景點", full: "台中東區", ok: loc({ city: "台中市", region: "台中市", district: "東區", formattedName: "台灣台中市東區" }) },
  { id: "C.5", text: "屏東恆春推薦景點", full: "屏東恆春", ok: loc({ city: "屏東縣", region: "屏東縣", district: "恆春鎮", formattedName: "台灣屏東縣恆春鎮" }) },
  { id: "C.6", text: "宜蘭羅東推薦景點", full: "宜蘭羅東", ok: loc({ city: "宜蘭縣", region: "宜蘭縣", district: "羅東鎮", formattedName: "台灣宜蘭縣羅東鎮" }) },
  { id: "C.7", text: "南投埔里鎮推薦景點", full: "南投埔里鎮", ok: loc({ city: "南投縣", region: "南投縣", district: "埔里鎮", formattedName: "台灣南投縣埔里鎮" }) },
];
for (const c of ADMIN) {
  const { init, results } = runCase(c.id, c.text, {
    full: c.full,
    kind: "admin",
    scenarios: (init) => ({
      ...commonScenarios(init, { parent: undefined }),
      correct_admin: { outcome: env(c.ok), expect: "validated", note: c.note },
    }),
  });
  if (!init.areaCandidate && init.confidence !== "curated" && init.confidence !== "confirmed") {
    obs(c.id, `合法行政區未走 known-parent 路徑：${describe(init)}`);
  }
  const r = results.correct_admin?.r0;
  if (r && r.destination && compact(r.destination) !== compact(c.full)) {
    fail(`${c.id} correct_admin`, `合法地名未完整保留：${r.destination}（完整 ${c.full}）`);
  }
}

// ══════════ D. 沒有可信父城市的合法地點（釣崎海岸 / 埔里鎮）══════════
for (const [i, [text, area, region]] of [
  ["釣崎海岸推薦景點", "釣崎海岸", "千葉県"],
  ["我想去釣崎海岸，推薦景點", "釣崎海岸", "千葉県"],
  ["埔里鎮推薦景點", "埔里鎮", "南投縣"],
  ["我想去埔里鎮，推薦景點", "埔里鎮", "南投縣"],
  ["埔里推薦景點", "埔里", "南投縣"],
].entries()) {
  runCase(`D.${i + 1}`, text, {
    full: area,
    kind: "admin",
    scenarios: (init) => ({
      correct_admin_district: {
        outcome: env(loc({ city: region, region, district: area, formattedName: `${region}${area}` })),
        expect: "unavailable",
        note: "合法但無可信父城市 → Phase 1 不確認",
      },
      correct_admin_city: { outcome: env(loc({ city: area, region })), expect: "unavailable" },
      realistic_poi: {
        outcome: env(area.startsWith("釣") ? CHIBA_REAL : loc({ city: "埔里鎮", region: "南投縣", formattedName: "台灣南投縣埔里鎮" })),
        expect: "unavailable",
      },
    }),
  });
}

// ══════════ E. 普通 POI / 指定案例 ══════════
const NAMED = [
  {
    id: "E.HK", text: "香港跑馬地推薦景點", full: "香港跑馬地", kind: "admin",
    sc: { realistic_racecourse_poi: { outcome: env(loc({ city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "香港跑馬地馬場", displayLabel: "跑馬地馬場" })), expect: "validated", note: "馬場 POI 但 sublocality=跑馬地/city=香港 為行政證據" } },
  },
  {
    id: "E.TN", text: "台南看西街教會推薦景點", full: "台南看西街教會", kind: "poi", weakEvidence: "看",
    sc: { realistic: { outcome: env(loc({ city: "台南市", region: "台南市", district: "中西區", formattedName: "台灣台南市中西區公園路6號 看西街教會", displayLabel: "看西街教會" })), expect: "unavailable", note: "普通 POI" } },
  },
  {
    id: "E.TN2", text: "我想去台南看西街教會，推薦景點", full: "台南看西街教會", kind: "poi", weakEvidence: "看",
    sc: { realistic: { outcome: env(loc({ city: "台南市", region: "台南市", district: "中西區", formattedName: "看西街教會", displayLabel: "看西街教會" })), expect: "unavailable" } },
  },
  {
    id: "E.TK", text: "東京玩具美術館推薦景點", full: "東京玩具美術館", kind: "poi", weakEvidence: "玩具",
    sc: { realistic: { outcome: env(loc({ city: "新宿区", region: "東京都", sublocality: "四谷", district: "四谷", formattedName: "日本東京都新宿区四谷4丁目20 東京おもちゃ美術館", displayLabel: "東京おもちゃ美術館" })), expect: "unavailable", note: "普通 POI" } },
  },
  {
    id: "E.KY", text: "京都看楓葉推薦景點", full: "京都看楓葉", kind: "activity", evidence: "看楓葉", weakEvidence: "看",
    sc: { realistic: { outcome: env(loc({ city: "京都市", region: "京都府", district: "東山区", formattedName: "日本京都府京都市東山区 看楓葉名所", displayLabel: "京都看楓葉名所" })), expect: "unavailable" } },
  },
  {
    id: "E.KY2", text: "我想去京都看楓葉，推薦景點", full: "京都看楓葉", kind: "activity", evidence: "看楓葉", weakEvidence: "看",
    sc: { realistic: { outcome: env(loc({ city: "京都市", region: "京都府", formattedName: "日本京都府京都市", displayLabel: "京都市" })), expect: "unavailable" } },
  },
  {
    id: "E.HKD", text: "北海道滑雪推薦景點", full: "北海道滑雪", kind: "activity", evidence: "滑雪", weakEvidence: "滑",
    sc: { realistic: { outcome: env(loc({ city: "札幌市", region: "北海道", district: "南区", formattedName: "日本北海道札幌市南区 札幌國際滑雪場", displayLabel: "札幌國際滑雪場" })), expect: "unavailable" } },
  },
  {
    id: "E.HKD2", text: "我想去北海道滑雪，推薦景點", full: "北海道滑雪", kind: "activity", evidence: "滑雪", weakEvidence: "滑",
    sc: { realistic: { outcome: env(loc({ city: "北海道", region: "北海道", formattedName: "日本北海道" })), expect: "unavailable" } },
  },
  {
    id: "E.NR", text: "奈良看鹿推薦景點", full: "奈良看鹿", kind: "activity", evidence: "看鹿", weakEvidence: "鹿",
    sc: { realistic: { outcome: env(loc({ city: "奈良市", region: "奈良県", formattedName: "日本奈良県奈良市 奈良公園", displayLabel: "奈良公園" })), expect: "unavailable" } },
  },
  {
    id: "E.NR2", text: "我想去奈良看鹿，推薦景點", full: "奈良看鹿", kind: "activity", evidence: "看鹿", weakEvidence: "鹿",
    sc: { realistic: { outcome: env(loc({ city: "奈良市", region: "奈良県" })), expect: "unavailable" } },
  },
];
for (const c of NAMED) {
  const { init } = runCase(c.id, c.text, {
    full: c.full,
    kind: c.kind,
    evidence: c.evidence,
    weakEvidence: c.weakEvidence,
    scenarios: (init) => ({
      ...commonScenarios(init, { parent: undefined }),
      ...c.sc,
      // 人工：provider 行政欄位直接宣稱尾段為 district、city=父城市（模組不得用字詞清單否決，只記錄）
      literal_tail_as_district: init.areaCandidate
        ? { outcome: env(loc({ city: init.areaCandidate.parentCity, district: init.areaCandidate.area })), expect: null, note: "人工：district=尾段" }
        : { outcome: env(loc({ city: "澳門", district: init.provisionalCandidate?.areaCandidate ?? "" })), expect: "unavailable" },
    }),
  });

  // 直接 rejected：活動只有在 rejected + 父城市確認 + 證據等於整個尾段時才分離
  if (init.areaCandidate) {
    const tail = init.areaCandidate.area;
    const rj0 = apply(init, { status: "rejected" });
    const rjWeak = c.weakEvidence ? apply(init, { status: "rejected" }, c.weakEvidence) : null;
    const rjEv = c.evidence ? apply(init, { status: "rejected" }, c.evidence) : null;
    const rjSuper = apply(init, { status: "rejected" }, `去${tail}`);
    const rjWhole = apply(init, { status: "rejected" }, tail);
    const rid = `${c.id} rejected-direct`;
    for (const [tag, r] of [["noEv", rj0], ["weak", rjWeak], ["ev", rjEv], ["super", rjSuper], ["whole", rjWhole]]) {
      if (r) invariants(`${rid} ${tag}`, r);
    }
    if (rj0.confidence !== "ambiguous" || rj0.destination !== undefined || rj0.providerValidation !== "rejected") {
      fail(`${rid} noEv`, `rejected 無活動證據應 ambiguous/rejected：${describe(rj0)}`);
    }
    if (rjWeak && (rjWeak.destination !== undefined || rjWeak.activityPreference !== undefined)) {
      fail(`${rid} weak「${c.weakEvidence}」`, `單字/部分字串證據切開地名：${describe(rjWeak)}`);
    }
    if (rjSuper.destination !== undefined) fail(`${rid} super`, `非完全相等證據仍切開：${describe(rjSuper)}`);
    if (rjEv && rjEv.destination !== undefined) {
      if (compact(rjEv.destination) !== compact(init.areaCandidate.parentCity)) fail(`${rid} ev`, `活動分離後 destination 非父城市：${rjEv.destination}`);
      if (compact(rjEv.destination).includes(compact(c.evidence))) fail(`${rid} ev`, `活動污染 destination：${rjEv.destination}`);
      if (compact(rjEv.activityPreference) !== compact(tail)) fail(`${rid} ev`, `activityPreference 非完整尾段：${rjEv.activityPreference}`);
    }
    if (c.kind !== "activity" && rjWhole.destination !== undefined) {
      warn(`${rid} whole`, `呼叫端若傳 rejected＋整段地名尾段當活動證據，地名尾段會被分離為活動：${describe(rjWhole)}（classify 從不輸出 rejected；屬上游信任邊界）`);
    }
    out(
      `   rejected-direct                    noEv:${rj0.confidence}/pv=${rj0.providerValidation}` +
        (rjWeak ? ` | weak「${c.weakEvidence}」:${rjWeak.destination ?? "-"}/act=${rjWeak.activityPreference ?? "-"}` : "") +
        (rjEv ? ` | ev「${c.evidence}」:${rjEv.confidence}/${rjEv.destination ?? "-"}/act=${rjEv.activityPreference ?? "-"}` : "") +
        ` | super:${rjSuper.destination ?? "-"} | whole「${tail}」:${rjWhole.destination ?? "-"}/act=${rjWhole.activityPreference ?? "-"}`,
    );
  }
}

// ══════════ F. 直接把 validated verdict 餵給沒有父城市候選的 apply ══════════
{
  const texts = ["千葉釣崎海岸推薦景點", "釣崎海岸推薦景點", "埔里鎮推薦景點"];
  const scopes = (init) => {
    const a = init.provisionalCandidate?.areaCandidate ?? "x";
    return {
      macau_full: { displayLabel: `澳門${a}`, parentCity: "澳門", area: a, searchScope: "area" },
      chiba: { displayLabel: `千葉${a}`, parentCity: "千葉", area: a, searchScope: "area" },
      self: { displayLabel: a, parentCity: a, area: a, searchScope: "area" },
      empty_parent: { displayLabel: a, parentCity: "", area: a, searchScope: "area" },
    };
  };
  for (const text of texts) {
    const init = resolve(text);
    out(`\n[F]「${text}」init: ${describe(init)}`);
    if (!init.provisionalCandidate) {
      obs(`F「${text}」`, `非 provisional：${describe(init)}`);
      continue;
    }
    for (const [n, scope] of Object.entries(scopes(init))) {
      const r = apply(init, { status: "validated", scope });
      invariants(`F「${text}」${n}`, r);
      if (r.confidence !== "ambiguous" || r.destination !== undefined || r.providerValidation !== "unavailable") {
        fail(`F「${text}」${n}`, `直接 validated 套用到 provisional 被確認：${describe(r)}`);
      }
      if (r.rawLabel !== init.rawLabel || r.provisionalCandidate !== init.provisionalCandidate) fail(`F「${text}」${n}`, "rawLabel/候選未保留");
      out(`   validated(${scope.displayLabel || "-"}/${scope.parentCity || "-"}) → ${describe(r)}`);
    }
    // 偽造：provisional resolution 上硬塞 areaCandidate=undefined 之外的路徑已涵蓋；另驗 pending 但無任何候選
    const bare = { ...init, provisionalCandidate: undefined };
    const rb = apply(bare, { status: "validated", scope: scopes(init).macau_full });
    if (rb.destination !== undefined) fail(`F「${text}」bare`, `無候選 pending + validated 被確認：${describe(rb)}`);
  }
}

// ══════════ G. 補充父城市後（未知城市不得被永久判無效）══════════
{
  const texts = [
    "千葉縣釣崎海岸推薦景點",
    "日本千葉縣釣崎海岸推薦景點",
    "千葉縣一宮町釣崎海岸推薦景點",
    "千葉 釣崎海岸推薦景點",
    "釣崎海岸在千葉縣，推薦景點",
    "千葉県一宮町推薦景點",
    "南投埔里鎮推薦景點",
    "南投縣埔里鎮推薦景點",
    "日本釣崎海岸推薦景點",
  ];
  for (const text of texts) {
    const init = resolve(text);
    invariants(`G「${text}」init`, init);
    let line = `\n[G]「${text}」init: ${describe(init)}`;
    if (init.areaCandidate) {
      const p = init.areaCandidate.parentCity;
      const a = init.areaCandidate.area;
      const correct = env(loc({ city: `${p}`, region: `${p}`, district: a, formattedName: `${p}${a}` }));
      const v = classify(init.areaCandidate, correct);
      const r = apply(init, v);
      invariants(`G「${text}」apply`, r);
      line += `\n   known-parent 路徑：district=${a}/city=${p} → ${v.status} → ${describe(r)}`;
      const vOther = classify(init.areaCandidate, env(loc({ city: "澳門", district: a })));
      if (vOther.status !== "unavailable") fail(`G「${text}」other_city`, `verdict=${vOther.status}`);
      obs(`G「${text}」`, `走 known-parent（${p}+${a}），正確行政欄位 → ${v.status}/${r.destination ?? "-"}`);
    } else {
      obs(`G「${text}」`, `未走 known-parent 路徑（既有表格不認得父城市）：${init.confidence}/${init.source}/raw=${init.rawLabel ?? "-"}`);
      if (init.provisionalCandidate) {
        const v = classify(init.provisionalCandidate, env(loc({ city: "一宮町", region: "千葉県", district: init.provisionalCandidate.areaCandidate })));
        const r = apply(init, v);
        invariants(`G「${text}」apply`, r);
        if (v.status !== "unavailable") fail(`G「${text}」`, `provisional verdict=${v.status}`);
        line += `\n   provisional：→ ${v.status} → ${describe(r)}`;
      }
    }
    out(line);
  }
}

// ══════════ H. session 與非 pending ══════════
{
  const S = { destination: "澳門" };
  const cases = [
    ["推薦景點", "session"],
    ["千葉釣崎海岸推薦景點", "no-session"],
    ["釣崎海岸推薦景點", "no-session"],
    ["香港跑馬地推薦景點", "no-session"],
    ["北海道滑雪推薦景點", "no-session"],
  ];
  for (const [text, expectKind] of cases) {
    const r = resolve(text, S);
    invariants(`H「${text}」`, r);
    if (expectKind === "session" && !(r.source === "session" && r.destination === "澳門")) fail(`H「${text}」`, describe(r));
    if (expectKind === "no-session" && (r.source === "session" || r.destination === "澳門")) fail(`H「${text}」`, `本句有目的地片段卻退回 session：${describe(r)}`);
    out(`\n[H session=澳門]「${text}」→ ${describe(r)}`);
  }
  const init = resolve("大阪推薦景點");
  if (apply(init, { status: "rejected" }, "大阪") !== init) fail("H nonpending", "非 pending 應原樣回傳");
  if (apply(init, { status: "validated", scope: { displayLabel: "澳門", parentCity: "澳門", area: "x", searchScope: "area" } }) !== init) fail("H nonpending", "非 pending 應原樣回傳（validated）");
  // validated 但父城市不符
  const hk = resolve("香港跑馬地推薦景點");
  const bad = apply(hk, { status: "validated", scope: { displayLabel: "澳門跑馬地", parentCity: "澳門", area: "跑馬地", searchScope: "area" } });
  if (bad.destination !== undefined) fail("H parent-mismatch", describe(bad));
  // 信任邊界：父城市相符但 scope.area/displayLabel 被呼叫端改寫
  const forged = apply(hk, { status: "validated", scope: { displayLabel: "香港銅鑼灣", parentCity: "香港", area: "銅鑼灣", searchScope: "area" } });
  if (forged.destination && compact(forged.destination) !== compact("香港跑馬地")) {
    warn("H forged-scope", `apply 直接採用 verdict.scope.displayLabel，未比對候選尾段：香港跑馬地 → ${forged.destination}（classify 自身只會用候選標籤組 scope；屬呼叫端信任邊界）`);
  }
  out(`\n[H] parent-mismatch → ${describe(bad)}\n[H] forged-scope(香港銅鑼灣) → ${describe(forged)}`);
}

// ══════════ J. 既有擷取器截斷（記錄；destination-travel-profile 本輪只改 export）══════════
{
  for (const text of ["台北士林夜市推薦景點", "我想去台北士林夜市，推薦景點"]) {
    const init = resolve(text);
    invariants(`J「${text}」init`, init);
    let line = `\n[J]「${text}」init: ${describe(init)}`;
    if (init.areaCandidate) {
      const real = env(loc({ city: "台北市", region: "台北市", district: "士林區", formattedName: "台灣台北市士林區基河路101號 士林夜市", displayLabel: "士林夜市" }));
      const v = classify(init.areaCandidate, real);
      const r = apply(init, v);
      invariants(`J「${text}」apply`, r);
      line += `\n   realistic 士林夜市 POI → ${v.status} → ${describe(r)}`;
      if (v.status === "validated" && compact(r.destination) !== compact("台北士林夜市")) {
        warn(`J「${text}」`, `既有擷取器把「夜市」視為類別 token，候選為 ${init.areaCandidate.displayLabel}；寫實 POI 回傳後 destination=${r.destination}（行政區，非完整 POI 名）`);
      }
    }
    out(line);
  }
}

// ══════════ I. 靜態：無 geocode/fetch/AI；無循環 import ══════════
{
  const file = `${ROOT}/src/lib/ai/destination-resolution.ts`;
  const src = fs.readFileSync(file, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const re of [/\bfetch\s*\(/, /geocode\w*\s*\(/i, /\bawait\b/, /\basync\b/, /openai|anthropic|gemini|createServerFn|invokeAi|generateText|streamText/i, /XMLHttpRequest/, /import\s*\(/]) {
    if (re.test(code)) fail("STATIC", `destination-resolution.ts 含可疑呼叫 ${re}`);
  }
  const resolveImport = (spec, from) => {
    let base;
    if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      const f = base + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  const importsOf = (f) => {
    const s = fs.readFileSync(f, "utf8");
    const specs = [...s.matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    return specs.map((sp) => resolveImport(sp, f)).filter(Boolean);
  };
  const seen = new Set();
  const stack = [file];
  let cycleToSelf = false;
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf(f)) {
      if (dep === file) cycleToSelf = true;
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  if (cycleToSelf) fail("CYCLE", "destination-resolution.ts 在自身 import 閉包中被引用（循環）");
  out(`\n[I 靜態] import 閉包檔案數=${seen.size}，回到自身=${cycleToSelf}`);
}

if (fetchCalls !== 0) fail("COST", `fetch 被呼叫 ${fetchCalls} 次`);
if (geocodeCalls !== 0) fail("COST", `geocodeFn spy 被呼叫 ${geocodeCalls} 次`);
if (xhrCalls !== 0) fail("COST", `XMLHttpRequest 被呼叫 ${xhrCalls} 次`);

console.log("=== T24 Phase 1 r3：案例 × provider 情境（verdict → apply 結果）===");
for (const line of log) console.log(line);
console.log(`\n=== OBS = ${OBS.length} ===`);
for (const o of OBS) console.log(" - " + o);
console.log(`\nfetchCalls=${fetchCalls} geocodeCalls=${geocodeCalls} xhrCalls=${xhrCalls}`);
console.log(`\n=== P2 = ${P2.length} ===`);
for (const p of P2) console.log(" ! " + p);
console.log(`\n=== P1 = ${P1.length} ===`);
for (const p of P1) console.log(" x " + p);
if (P1.length) process.exitCode = 1;
