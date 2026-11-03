#!/usr/bin/env node
/**
 * T23 — Destination Resolution Authority Phase 1 契約修正驗收（第 2 輪，獨立 tester）。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-resolution-phase1-r2.mjs --config scripts/vite.verify.config.mjs
 *
 * - 直接 import src/lib/ai/destination-resolution.ts（純函式）。
 * - Provider 一律以 TripLocation / GeocodeFnEnvelope 形狀的 mock 或 thrown 模擬；
 *   globalThis.fetch 為 trap；不使用 API Key、不產生 Google 費用。
 * - P1 定義（任務單）：錯誤驗證目的地、錯誤切割合法地名、活動污染 destination、
 *   新增 provider 呼叫、pending/ambiguous 卻帶 destination、只有父城市證據判 rejected。
 * - P2：契約風險但非直接錯誤放行（記錄供指派者判斷）。
 * - 任何 P1 → process.exitCode = 1。
 */
import fs from "node:fs";
import path from "node:path";

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] blocked: ${String(args[0]).slice(0, 120)}`);
};
let geocodeCalls = 0;
const geocodeSpy = async () => {
  geocodeCalls += 1;
  return { location: null, error: "spy" };
};
let xhrCalls = 0;
globalThis.XMLHttpRequest = class {
  open() {
    xhrCalls += 1;
    throw new Error("[xhr-trap] blocked");
  }
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
const NOTE = [];
const fail = (id, msg) => P1.push(`${id}: ${msg}`);
const warn = (id, msg) => P2.push(`${id}: ${msg}`);

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
const okPR = (status = "OK") => ({
  ok: status === "OK",
  status,
  provider: "geocode_fn",
  rawResultCount: status === "OK" ? 1 : 0,
  parsedResultCount: status === "OK" ? 1 : 0,
});
const env = (location, extra = {}) => ({
  kind: "envelope",
  envelope: { location, error: null, providerResult: okPR(), ...extra },
});

/**
 * kind:
 *   "admin"    尾段是真實行政區／生活圈（應可 validated）
 *   "poi"      使用者明確指定的 POI（不得標成行政區；保留 rawLabel/候選）
 *   "activity" 尾段是活動語意（不得污染 destination；無證據不切）
 * realistic：依 Google 實際可能回傳形狀撰寫的 mock（行政欄位為真實所在地）。
 */
const CASES = [
  {
    id: "09", label: "香港跑馬地", parent: "香港", tail: "跑馬地", kind: "admin",
    realisticPoi: loc({ city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "香港跑馬地馬場", displayLabel: "跑馬地馬場" }),
    correctAdmin: loc({ city: "香港", district: "跑馬地", formattedName: "香港跑馬地", displayLabel: "跑馬地" }),
  },
  {
    id: "10", label: "台南看西街教會", parent: "台南", tail: "看西街教會", kind: "poi", weakEvidence: "看",
    realisticPoi: loc({ city: "台南市", region: "台南市", district: "中西區", formattedName: "台灣台南市中西區公園路6號 看西街教會", displayLabel: "看西街教會" }),
  },
  {
    id: "11", label: "新竹潛園", parent: "新竹", tail: "潛園", kind: "poi", weakEvidence: "潛",
    realisticPoi: loc({ city: "新竹市", region: "新竹市", district: "北區", formattedName: "台灣新竹市北區 潛園爽吟閣", displayLabel: "潛園" }),
  },
  {
    id: "12", label: "千葉釣崎海岸", parent: "千葉", tail: "釣崎海岸", kind: "poi", weakEvidence: "釣",
    realisticPoi: loc({ city: "一宮町", region: "千葉縣", formattedName: "日本千葉縣長生郡一宮町 釣崎海岸", displayLabel: "釣崎海岸" }),
  },
  {
    id: "13", label: "東京玩具美術館", parent: "東京", tail: "玩具美術館", kind: "poi", weakEvidence: "玩具",
    realisticPoi: loc({ city: "新宿區", region: "東京都", sublocality: "四谷", formattedName: "日本東京都新宿區四谷 東京玩具美術館", displayLabel: "東京玩具美術館" }),
  },
  {
    id: "14", label: "京都看楓葉", parent: "京都", tail: "看楓葉", kind: "activity", evidence: "看楓葉", weakEvidence: "看",
    realisticPoi: loc({ city: "京都市", region: "京都府", district: "東山區", formattedName: "日本京都府京都市東山區 看楓葉名所", displayLabel: "京都看楓葉名所" }),
  },
  {
    id: "15", label: "北海道滑雪", parent: "北海道", tail: "滑雪", kind: "activity", evidence: "滑雪", weakEvidence: "滑",
    realisticPoi: loc({ city: "札幌市", region: "北海道", district: "南區", formattedName: "日本北海道札幌市南區 北海道滑雪中心", displayLabel: "北海道滑雪中心" }),
  },
  {
    id: "16", label: "奈良看鹿", parent: "奈良", tail: "看鹿", kind: "activity", evidence: "看鹿", weakEvidence: "鹿",
    realisticPoi: loc({ city: "奈良市", region: "奈良縣", formattedName: "日本奈良縣奈良市 奈良公園 看鹿", displayLabel: "奈良看鹿" }),
  },
  {
    id: "17", label: "台北士林夜市", parent: "台北", tail: "士林夜市", kind: "poi", weakEvidence: "夜市",
    realisticPoi: loc({ city: "台北市", district: "士林區", formattedName: "台灣台北市士林區基河路101號 士林夜市", displayLabel: "士林夜市" }),
  },
];
const PHRASES = [(x) => `${x}推薦景點`, (x) => `我想去${x}，推薦景點`];

/** 依候選建立 provider 情境。expect：契約要求的 verdict（null＝只記錄）。 */
function scenarios(c, cand) {
  const isProv = "areaCandidate" in cand && "rawLabel" in cand;
  const parent = isProv ? c.parent : cand.parentCity;
  const area = isProv ? cand.areaCandidate : cand.area;
  const s = {};
  // 1. Google 回傳名稱含活動詞／完整 label 的 POI（formattedName/displayLabel 有，行政欄位不符）
  s.poi_activity_name = {
    outcome: env(loc({ city: parent, formattedName: `${parent}${area}中心`, displayLabel: `${c.label}中心`, address: `${parent} ${area}中心` })),
    expect: "unavailable",
  };
  // 2. 同名但不同城市（行政欄位 district=尾段，但 city/region 為其他城市；formattedName 甚至含父城市字樣）
  s.same_name_other_city = {
    outcome: env(loc({ city: "澳門", region: "澳門特別行政區", district: area, formattedName: `${parent}風味 ${area}（澳門）`, displayLabel: area })),
    expect: "unavailable",
  };
  // 3. 一般 POI（依真實所在地的行政欄位）
  // 例外：#09 跑馬地是真實生活圈；Google 回傳跑馬地馬場時 sublocality=跑馬地、city=香港，
  // 行政欄位已證明範圍，依契約應 validated（不是 POI 冒充）。
  s.generic_poi = { outcome: env(c.realisticPoi), expect: c.kind === "admin" ? "validated" : "unavailable" };
  // 3b. 行政欄位以「包含」方式出現尾段（district=尾段+中心）— 不得因 substring 成立
  s.substring_district = {
    outcome: env(loc({ city: parent, district: `${area}中心`, sublocality: `大${area}`, formattedName: `${parent}${area}`, displayLabel: c.label })),
    expect: "unavailable",
  };
  // 3c. 尾段只出現在 sublocality，但父城市只在 formattedName（city/region 空）
  s.parent_only_in_name = {
    outcome: env(loc({ city: "", sublocality: area, formattedName: `${parent}${area}`, displayLabel: c.label })),
    expect: "unavailable",
  };
  // 4. 正確行政區（district=尾段、city=父城市）
  s.correct_admin = {
    outcome: env(c.correctAdmin ?? loc({ city: parent, district: area, formattedName: `${parent}${area}`, displayLabel: c.label })),
    expect: c.kind === "admin" ? "validated" : null, // POI/活動尾段在 district 欄位屬人工回應，只記錄
  };
  // 4b. 正確行政區，但 providerResult.ok=false（provider 自稱失敗）
  s.correct_admin_pr_fail = {
    outcome: env(loc({ city: parent, district: area }), { providerResult: okPR("ZERO_RESULTS") }),
    expect: "unavailable",
  };
  // 4c. 正確行政區但無 placeId
  s.correct_admin_no_placeid = {
    outcome: env(loc({ placeId: "", city: parent, district: area })),
    expect: "unavailable",
  };
  // 5. timeout（thrown）
  s.timeout_thrown = {
    outcome: { kind: "thrown", error: Object.assign(new Error("The operation was aborted."), { name: "AbortError" }) },
    expect: "unavailable",
  };
  // 6. ZERO_RESULTS
  s.zero_results = {
    outcome: { kind: "envelope", envelope: { location: null, error: null, providerResult: okPR("ZERO_RESULTS") } },
    expect: "unavailable",
  };
  s.error_envelope = {
    outcome: { kind: "envelope", envelope: { location: null, error: "geocode_zero_results" } },
    expect: "unavailable",
  };
  // 7. null
  s.null_envelope = { outcome: { kind: "envelope", envelope: null }, expect: "unavailable" };
  s.undefined_envelope = { outcome: { kind: "envelope", envelope: undefined }, expect: "unavailable" };
  s.null_location = { outcome: { kind: "envelope", envelope: { location: null, error: null } }, expect: "unavailable" };
  // 8. 父城市回退（只回父城市本身）
  s.parent_fallback = {
    outcome: env(loc({ city: parent, region: parent, formattedName: parent, displayLabel: parent })),
    expect: "unavailable",
  };
  s.parent_fallback_with_label_name = {
    outcome: env(loc({ city: parent, formattedName: `${c.label}`, displayLabel: `${c.label}` })),
    expect: "unavailable",
  };
  return s;
}

function checkResolution(id, res, c, phase, truncatedCandidate = false) {
  const pendingLike = res.confidence === "pending_provider" || res.confidence === "ambiguous";
  if (pendingLike && res.destination !== undefined) fail(id, `${res.confidence} 但 destination=${res.destination}`);
  if (pendingLike && res.geographicScope !== undefined) fail(id, `${res.confidence} 但 geographicScope 有值`);
  if (!pendingLike && !res.destination) fail(id, `${res.confidence} 但無 destination`);
  if (res.destination && res.rawLabel && res.confidence !== "confirmed" && res.confidence !== "curated") {
    fail(id, "rawLabel 成為搜尋目的地");
  }
  // 人工回應（provider 的 district 欄位直接等於 POI／活動尾段）：provider 行政欄位自己宣稱，
  // 模組依契約不得用字詞清單否決；只記錄，不判 P1（不變式已在上方檢查）。
  if (phase === "literal") {
    if (res.destination) {
      warn(id, `[人工 district=尾段] provider 行政欄位宣稱尾段為行政區 → ${res.confidence}/${res.destination}/${res.destinationType}`);
    }
    return;
  }
  // 既有擷取器已把候選截短（#17.1 台北+士林）：validated 時記錄是否被確認，交指派者裁定。
  if (truncatedCandidate && res.destination) {
    warn(id, `既有擷取器截斷候選被 provider 確認：destination=${res.destination}/${res.destinationType}（完整 ${c.label}）`);
    return;
  }
  if (res.destination) {
    const d = compact(res.destination);
    if (c.kind === "activity") {
      if (d.includes(compact(c.tail)) || (c.evidence && d.includes(compact(c.evidence)))) {
        fail(id, `活動污染 destination：${res.destination}`);
      }
      if (d !== compact(c.parent)) fail(id, `活動案 destination 非父城市：${res.destination}`);
    } else {
      // 地名：destination 只能是完整地名，或（活動分離時）父城市；不得是其他截斷片段
      if (d !== compact(c.label) && d !== compact(c.parent)) {
        fail(id, `合法地名被截斷／錯誤目的地：${res.destination}（完整：${c.label}）`);
      }
      if (d === compact(c.parent) && res.source !== "activity_evidence_split" && phase !== "init") {
        fail(id, `地名案退回父城市而丟尾段：${res.destination}/${res.source}`);
      }
    }
    if (c.kind === "poi" && res.destinationType === "district" && phase !== "literal") {
      fail(id, `使用者指定 POI 被標成行政區：${res.destination}`);
    }
  }
  if (res.activityPreference !== undefined && res.destination && compact(res.activityPreference).includes(compact(res.destination))) {
    fail(id, `activityPreference 含 destination：${res.activityPreference}`);
  }
}

const describe = (r) =>
  `${r.confidence}/${r.source}/dest=${r.destination ?? "-"}/type=${r.destinationType}/raw=${r.rawLabel ?? "-"}` +
  `/act=${r.activityPreference ?? "-"}/pv=${r.providerValidation ?? "-"}` +
  `/cand=${r.areaCandidate ? `${r.areaCandidate.parentCity}+${r.areaCandidate.area}` : r.provisionalCandidate ? `prov:${r.provisionalCandidate.areaCandidate}` : "-"}`;

const out = [];
for (const c of CASES) {
  for (const [pi, phrase] of PHRASES.entries()) {
    const text = phrase(c.label);
    const id0 = `#${c.id}.${pi + 1}「${text}」`;
    silence();
    const init = R.resolveDestination({ text, sessionDestination: null, geocodeFn: geocodeSpy });
    restore();
    out.push(`\n[${id0}] init: ${describe(init)}`);
    checkResolution(`${id0} init`, init, c, "init");
    if (init.activityPreference !== undefined) fail(`${id0} init`, `初判即切出 activityPreference`);
    if (init.destination && c.kind !== "activity" && compact(init.destination) !== compact(c.label)) {
      fail(`${id0} init`, `初判即截斷合法地名：${init.destination}`);
    }
    if (init.destination && c.kind === "activity") fail(`${id0} init`, `活動句初判即確認 destination：${init.destination}`);
    if (init.confidence === "pending_provider" || init.confidence === "ambiguous") {
      if (!init.rawLabel) warn(`${id0} init`, "pending/ambiguous 但 rawLabel 遺失");
    }
    const cand = init.areaCandidate ?? init.provisionalCandidate;
    if (init.confidence !== "pending_provider" || !cand) {
      out.push(`   （非 pending，略過 provider 情境）`);
      continue;
    }
    if (init.areaCandidate && compact(init.areaCandidate.parentCity) !== compact(c.parent)) {
      warn(`${id0} init`, `候選父城市 ${init.areaCandidate.parentCity} ≠ ${c.parent}`);
    }
    if (init.areaCandidate && compact(init.areaCandidate.displayLabel) !== compact(c.label)) {
      warn(`${id0} init`, `候選被既有擷取器截成 ${init.areaCandidate.parentCity}+${init.areaCandidate.area}（完整 ${c.label}）`);
    }
    for (const [sname, { outcome, expect }] of Object.entries(scenarios(c, cand))) {
      silence();
      const verdict = R.classifyDestinationProviderEvidence(cand, outcome);
      const r0 = R.applyDestinationProviderValidation(init, verdict);
      const rEv = c.evidence ? R.applyDestinationProviderValidation(init, verdict, c.evidence) : null;
      const rWeak = c.weakEvidence ? R.applyDestinationProviderValidation(init, verdict, c.weakEvidence) : null;
      restore();
      const id = `${id0} ${sname}`;
      if (verdict.status === "rejected") fail(id, "classify 輸出 rejected（現有 envelope 無足以否定的證據；含父城市回退）");
      const truncatedCand = Boolean(init.areaCandidate && compact(init.areaCandidate.displayLabel) !== compact(c.label));
      if (expect && verdict.status !== expect) {
        if (truncatedCand && verdict.status === "validated") {
          warn(id, `既有擷取器截斷候選 ${init.areaCandidate.displayLabel}：verdict=validated（以完整地名期望 ${expect}）`);
        } else {
          fail(id, `verdict=${verdict.status}（期望 ${expect}）`);
        }
      }
      const literal = expect === null;
      if (literal) NOTE.push(`${id} [人工：district 欄位=尾段] → ${verdict.status}/${r0.confidence}/${r0.destination ?? "-"}/${r0.destinationType}`);
      const truncated = Boolean(init.areaCandidate && compact(init.areaCandidate.displayLabel) !== compact(c.label));
      for (const [tag, r] of [["noEv", r0], ["ev", rEv], ["weakEv", rWeak]]) {
        if (!r) continue;
        checkResolution(`${id} ${tag}`, r, c, literal ? "literal" : "provider", truncated);
        if (verdict.status !== "validated") {
          if (r.confidence !== "ambiguous" || r.destination !== undefined || r.activityPreference !== undefined) {
            fail(`${id} ${tag}`, `非 validated 應 ambiguous 且無 destination/活動：${describe(r)}`);
          }
          if (r.rawLabel !== init.rawLabel) fail(`${id} ${tag}`, "rawLabel 未保留");
          if ((init.areaCandidate && !r.areaCandidate) || (init.provisionalCandidate && !r.provisionalCandidate)) {
            fail(`${id} ${tag}`, "候選未保留");
          }
        }
        if (verdict.status === "validated") {
          if (r.activityPreference !== undefined) fail(`${id} ${tag}`, "validated 卻有 activityPreference");
          if (!literal && !truncated && c.kind !== "activity" && compact(r.destination) !== compact(c.label)) {
            fail(`${id} ${tag}`, `validated destination 非完整地名：${r.destination}`);
          }
        }
      }
      if (sname === "correct_admin" && c.kind === "admin" && verdict.status === "validated") {
        if (r0.confidence !== "confirmed" || r0.source !== "provider_validated" || r0.destinationType !== "district") {
          fail(id, `正確行政區 validated 後結果錯誤：${describe(r0)}`);
        }
      }
      out.push(
        `   ${sname.padEnd(32)} ${verdict.status.padEnd(11)} → ${r0.confidence}/${r0.destination ?? "-"}` +
          (rEv ? ` | ev「${c.evidence}」:${rEv.confidence}/${rEv.destination ?? "-"}/act=${rEv.activityPreference ?? "-"}` : "") +
          (rWeak ? ` | weak「${c.weakEvidence}」:${rWeak.confidence}/${rWeak.destination ?? "-"}/act=${rWeak.activityPreference ?? "-"}` : ""),
      );
    }

    // 直接把 rejected verdict 餵給 apply（模擬未來真的有可否定證據）
    if (init.areaCandidate) {
      silence();
      const rj0 = R.applyDestinationProviderValidation(init, { status: "rejected" });
      const rjWeak = c.weakEvidence ? R.applyDestinationProviderValidation(init, { status: "rejected" }, c.weakEvidence) : null;
      const rjEv = c.evidence ? R.applyDestinationProviderValidation(init, { status: "rejected" }, c.evidence) : null;
      const rjWhole = R.applyDestinationProviderValidation(init, { status: "rejected" }, init.areaCandidate.area);
      const rjPrefixed = R.applyDestinationProviderValidation(init, { status: "rejected" }, `去${init.areaCandidate.area}`);
      restore();
      const idr = `${id0} rejected-direct`;
      if (rj0.confidence !== "ambiguous" || rj0.destination !== undefined || rj0.activityPreference !== undefined) {
        fail(`${idr} noEv`, `rejected 無證據應 ambiguous：${describe(rj0)}`);
      }
      if (rj0.providerValidation !== "rejected") warn(`${idr} noEv`, `providerValidation=${rj0.providerValidation}`);
      if (rjWeak && (rjWeak.destination !== undefined || rjWeak.activityPreference !== undefined)) {
        fail(`${idr} weakEv「${c.weakEvidence}」`, `部分字串證據切開尾段：${describe(rjWeak)}`);
      }
      if (rjPrefixed.destination !== undefined) fail(`${idr} 超集證據`, `非完全相等證據仍切開：${describe(rjPrefixed)}`);
      if (rjEv) {
        checkResolution(`${idr} ev`, rjEv, c, "provider");
        if (compact(rjEv.activityPreference ?? "") !== compact(c.evidence) && rjEv.activityPreference !== undefined) {
          fail(`${idr} ev`, `activityPreference 非完整尾段：${rjEv.activityPreference}`);
        }
      }
      if (c.kind !== "activity" && rjWhole.destination !== undefined) {
        warn(
          `${idr} 整段尾段當證據`,
          `呼叫端若同時給 rejected 與「${init.areaCandidate.area}」整段證據，地名尾段會被當活動分離：${describe(rjWhole)}（classify 不會輸出 rejected，屬上游信任邊界）`,
        );
      }
      out.push(
        `   rejected-direct                  noEv:${rj0.confidence}/${rj0.destination ?? "-"}` +
          (rjWeak ? ` | weak「${c.weakEvidence}」:${rjWeak.confidence}/${rjWeak.destination ?? "-"}` : "") +
          (rjEv ? ` | ev「${c.evidence}」:${rjEv.confidence}/${rjEv.destination ?? "-"}/act=${rjEv.activityPreference ?? "-"}` : "") +
          ` | whole「${init.areaCandidate.area}」:${rjWhole.confidence}/${rjWhole.destination ?? "-"}/act=${rjWhole.activityPreference ?? "-"}`,
      );
    }
  }
}

// ── 補充：validated verdict 但父城市不符 → ambiguous ──
{
  silence();
  const init = R.resolveDestination({ text: "香港跑馬地推薦景點" });
  const bad = R.applyDestinationProviderValidation(init, {
    status: "validated",
    scope: { displayLabel: "澳門跑馬地", parentCity: "澳門", area: "跑馬地", searchScope: "area" },
  });
  restore();
  if (init.confidence === "pending_provider" && (bad.confidence !== "ambiguous" || bad.destination !== undefined)) {
    fail("PARENT-MISMATCH", `validated 但父城市不符應 ambiguous：${describe(bad)}`);
  }
  out.push(`\n[補充] validated(澳門跑馬地) 套用到「香港跑馬地」→ ${describe(bad)}`);
}

// ── 補充：provisional（無已知父城市）──
{
  const texts = ["我想去釣崎海岸，推薦景點", "釣崎海岸推薦景點", "埔里鎮推薦景點"];
  for (const text of texts) {
    silence();
    const init = R.resolveDestination({ text });
    restore();
    out.push(`\n[補充 provisional]「${text}」init: ${describe(init)}`);
    if ((init.confidence === "pending_provider" || init.confidence === "ambiguous") && init.destination !== undefined) {
      fail(`PROV「${text}」`, "pending/ambiguous 帶 destination");
    }
    const cand = init.provisionalCandidate;
    if (!cand) continue;
    const a = cand.areaCandidate;
    const tests = {
      // 正確：district=片段, city=父, region=縣
      admin_exact: { o: env(loc({ city: "南投縣", region: "南投縣", district: a })), expect: null },
      township_in_city: { o: env(loc({ city: a, region: "南投縣" })), expect: null },
      poi_name_only: { o: env(loc({ city: "一宮町", region: "千葉縣", formattedName: `${a}`, displayLabel: a })), expect: "unavailable" },
      substring_city: { o: env(loc({ city: `${a}中心`, region: "千葉縣" })), expect: "unavailable" },
      same_field_only: { o: env(loc({ city: a, region: "", district: "" })), expect: "unavailable" },
      parent_only: { o: env(loc({ city: "千葉", region: "千葉縣" })), expect: "unavailable" },
      thrown: { o: { kind: "thrown", error: new Error("timeout") }, expect: "unavailable" },
      zero: { o: { kind: "envelope", envelope: { location: null, error: null, providerResult: okPR("ZERO_RESULTS") } }, expect: "unavailable" },
      null: { o: { kind: "envelope", envelope: null }, expect: "unavailable" },
    };
    for (const [n, { o, expect }] of Object.entries(tests)) {
      silence();
      const v = R.classifyDestinationProviderEvidence(cand, o);
      const r = R.applyDestinationProviderValidation(init, v);
      restore();
      if (v.status === "rejected") fail(`PROV「${text}」${n}`, "provisional 被判 rejected");
      if (expect && v.status !== expect) fail(`PROV「${text}」${n}`, `verdict=${v.status}（期望 ${expect}）`);
      if (v.status === "validated" && !compact(r.destination).includes(compact(a).replace(/[鎮镇]$/, ""))) {
        fail(`PROV「${text}」${n}`, `validated destination 未含完整片段：${r.destination}`);
      }
      if (v.status !== "validated" && r.destination !== undefined) fail(`PROV「${text}」${n}`, "非 validated 帶 destination");
      out.push(`   ${n.padEnd(20)} ${v.status.padEnd(11)} → ${r.confidence}/${r.destination ?? "-"}/${r.destinationType}`);
    }
  }
}

// ── 補充：活動證據不得用單字首切開（「看」）—— 對所有含「看」的地名再測一次 ──
{
  for (const text of ["台南看西街教會", "我想去台南看西街教會，推薦景點", "台南看西街教會附近推薦景點"]) {
    silence();
    const init = R.resolveDestination({ text });
    const v = init.areaCandidate
      ? R.classifyDestinationProviderEvidence(init.areaCandidate, env(loc({ city: "台南市", formattedName: "台南市" })))
      : null;
    const r1 = v ? R.applyDestinationProviderValidation(init, v, "看") : init;
    const r2 = init.areaCandidate ? R.applyDestinationProviderValidation(init, { status: "rejected" }, "看") : init;
    restore();
    out.push(`\n[補充 看]「${text}」init=${describe(init)} | 父城市回退+看=${describe(r1)} | rejected+看=${describe(r2)}`);
    for (const [tag, r] of [["init", init], ["fallback+看", r1], ["rejected+看", r2]]) {
      if (r.activityPreference !== undefined) fail(`看「${text}」${tag}`, `「看」切出活動 ${r.activityPreference}`);
      if (r.destination !== undefined && compact(r.destination) !== compact("台南看西街教會")) {
        fail(`看「${text}」${tag}`, `destination 錯誤：${r.destination}`);
      }
    }
  }
}

// ── 補充：session 與非 pending ──
{
  silence();
  const S = { destination: "京都" };
  const s1 = R.resolveDestination({ text: "推薦景點", sessionDestination: S });
  const s3 = R.resolveDestination({ text: "我想去香港跑馬地，推薦景點", sessionDestination: S });
  const s4 = R.resolveDestination({ text: "北海道滑雪推薦景點", sessionDestination: S });
  const init = R.resolveDestination({ text: "大阪推薦景點" });
  const after = R.applyDestinationProviderValidation(init, { status: "rejected" }, "大阪");
  restore();
  if (!(s1.source === "session" && s1.destination === "京都")) fail("SESSION-1", describe(s1));
  if (s3.destination === "京都" || s3.source === "session") fail("SESSION-3", `本句 pending 退回 session：${describe(s3)}`);
  if (s4.destination === "京都" || s4.source === "session") fail("SESSION-4", `本句 pending 退回 session：${describe(s4)}`);
  if (after !== init) fail("NONPENDING", "非 pending resolution 應原樣回傳");
  out.push(`\n[補充 session] s1=${describe(s1)}\n  s3=${describe(s3)}\n  s4=${describe(s4)}`);
}

// ── 靜態檢查：模組內無 geocode/fetch/AI 呼叫；無循環 import ──
{
  const file = `${ROOT}/src/lib/ai/destination-resolution.ts`;
  const src = fs.readFileSync(file, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const re of [/\bfetch\s*\(/, /geocode\w*\s*\(/i, /\bawait\b/, /\basync\b/, /openai|anthropic|gemini|createServerFn|invokeAi/i, /XMLHttpRequest/]) {
    if (re.test(code)) fail("STATIC", `destination-resolution.ts 含可疑呼叫 ${re}`);
  }
  // 從 destination-resolution.ts 出發的 @/ import 圖，檢查是否有路徑回到自身
  const resolveImport = (spec) => {
    if (!spec.startsWith("@/")) return null;
    const base = path.join(ROOT, "src", spec.slice(2));
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext)) return base + ext;
    return null;
  };
  const importsOf = (f) => {
    const s = fs.readFileSync(f, "utf8");
    const specs = [...s.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
    return specs.map(resolveImport).filter(Boolean);
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
  if (cycleToSelf) fail("CYCLE", "destination-resolution.ts 在自身的 import 閉包中被引用（循環）");
  out.push(`\n[靜態] import 閉包檔案數=${seen.size}，回到自身=${cycleToSelf}`);
}

if (fetchCalls !== 0) fail("COST", `fetch 被呼叫 ${fetchCalls} 次`);
if (geocodeCalls !== 0) fail("COST", `geocodeFn 被呼叫 ${geocodeCalls} 次`);
if (xhrCalls !== 0) fail("COST", `XMLHttpRequest 被呼叫 ${xhrCalls} 次`);

console.log("=== 案例 × provider 情境（verdict → 無證據結果 | ev 完整活動證據 | weak 單字/部分證據）===");
for (const line of out) console.log(line);
console.log("\n=== NOTE ===");
for (const n of NOTE) console.log(" - " + n);
console.log(`\nfetchCalls=${fetchCalls} geocodeCalls=${geocodeCalls} xhrCalls=${xhrCalls}`);
console.log(`\n=== P2 = ${P2.length} ===`);
for (const p of P2) console.log(" ! " + p);
console.log(`\n=== P1 = ${P1.length} ===`);
for (const p of P1) console.log(" x " + p);
if (P1.length) process.exitCode = 1;
