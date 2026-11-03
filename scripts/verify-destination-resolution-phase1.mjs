#!/usr/bin/env node
/**
 * T22 — Destination Resolution Authority Phase 1 獨立驗收（tester）。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-resolution-phase1.mjs --config scripts/vite.verify.config.mjs
 *
 * - 直接 import src/lib/ai/destination-resolution.ts（純函式）。
 * - Provider 一律以 mock envelope / 拋錯模擬；globalThis.fetch 為 trap；不使用 API Key。
 * - 每案 × 2 句型 × 5 provider 情境 × (無活動證據 / 有活動證據) 套用契約檢查。
 * - 任何違反契約 → P1，process.exitCode = 1。
 */
let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] blocked: ${String(args[0]).slice(0, 120)}`);
};
let geocodeCalls = 0;
// 若任何函式誤收/誤呼叫 geocodeFn，計數會上升。
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

const compact = (s) => N.normalizeDestinationLabel(String(s ?? "")).replace(/[\s,，、/／\-・·]+/g, "");

const P1 = [];
const NOTE = [];
const fail = (id, msg) => P1.push(`${id}: ${msg}`);

/**
 * 案例：label＝完整合法地名（含活動句型的「地名＋活動」整串），
 * parent＝合理父城市，tail＝父城市後尾段，
 * kind＝"activity"（尾段為活動語意）或 "place"（尾段為地名一部分），
 * evidence＝模擬既有 parser 提供的獨立活動證據（僅 activity 案例）。
 */
const CASES = [
  { id: "A", label: "京都看楓葉", parent: "京都", tail: "看楓葉", kind: "activity", evidence: "楓葉" },
  { id: "B", label: "北海道滑雪", parent: "北海道", tail: "滑雪", kind: "activity", evidence: "滑雪" },
  { id: "C", label: "沖繩潛水", parent: "沖繩", tail: "潛水", kind: "activity", evidence: "潛水" },
  { id: "D", label: "奈良看鹿", parent: "奈良", tail: "看鹿", kind: "activity", evidence: "鹿" },
  { id: "E", label: "金澤看兼六園", parent: "金澤", tail: "看兼六園", kind: "activity", evidence: "兼六園" },
  { id: "F", label: "花蓮泛舟", parent: "花蓮", tail: "泛舟", kind: "activity", evidence: "泛舟" },
  { id: "G", label: "香港跑馬地", parent: "香港", tail: "跑馬地", kind: "place" },
  { id: "H", label: "台南看西街教會", parent: "台南", tail: "看西街教會", kind: "place" },
  { id: "I", label: "新竹潛園", parent: "新竹", tail: "潛園", kind: "place" },
  { id: "J", label: "千葉釣崎海岸", parent: "千葉", tail: "釣崎海岸", kind: "place" },
  { id: "K", label: "東京玩具美術館", parent: "東京", tail: "玩具美術館", kind: "place" },
  { id: "L", label: "台北士林夜市", parent: "台北", tail: "士林夜市", kind: "place" },
];
const PHRASES = [(x) => `${x}推薦景點`, (x) => `我想去${x}，推薦景點`];

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

/** 依候選建立五種 provider 情境（皆為 mock）。 */
function scenarios(candidate) {
  const isProv = candidate && "areaCandidate" in candidate && "rawLabel" in candidate;
  const parent = isProv ? "" : candidate.parentCity;
  const area = isProv ? candidate.areaCandidate : candidate.area;
  const full = isProv ? candidate.rawLabel : candidate.displayLabel;
  const okResult = (status = "OK") => ({
    ok: status === "OK",
    status,
    provider: "geocode_fn",
    rawResultCount: status === "OK" ? 1 : 0,
    parsedResultCount: status === "OK" ? 1 : 0,
  });
  const out = {
    // 契約字面：provider 直接以 district=尾段 確認候選（對 activity 尾段而言為人工、不實際的回應）。
    // provisional：採實際形狀（尾段地名在 district，上層縣在 region）。
    validated: {
      kind: "envelope",
      envelope: {
        location: isProv
          ? loc({ city: "一宮町", region: "千葉縣", district: "釣崎海岸", formattedName: "日本千葉縣長生郡一宮町釣崎海岸", displayLabel: "釣崎海岸" })
          : loc({ city: parent, district: area, formattedName: `${parent}${area}`, displayLabel: full }),
        error: null,
        providerResult: okResult(),
      },
    },
    // Google 找不到尾段而退回父城市（只帶父城市證據）。
    rejected: {
      kind: "envelope",
      envelope: {
        location: loc({ city: parent || "mockOtherCity", formattedName: parent || "mockOtherCity", displayLabel: parent || "mockOtherCity" }),
        error: null,
        providerResult: okResult(),
      },
    },
    unavailable: { kind: "envelope", envelope: { location: null, error: "network_error" } },
    timeout: {
      kind: "thrown",
      error: Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
    },
    zero_results: {
      kind: "envelope",
      envelope: { location: null, error: null, providerResult: okResult("ZERO_RESULTS") },
    },
  };
  if (!isProv) {
    // 實際可能：Google 以「父城市＋活動詞」查到名稱含活動詞的 POI（例：xx滑雪場、xx潛水中心）。
    out.validated_poi = {
      kind: "envelope",
      envelope: {
        location: loc({ city: parent, formattedName: `日本${parent} ${area}中心`, displayLabel: `${area}中心` }),
        error: null,
        providerResult: okResult(),
      },
    };
  }
  return out;
}

function checkInvariants(id, res, c) {
  const pending = res.confidence === "pending_provider" || res.confidence === "ambiguous";
  if (pending && res.destination !== undefined) {
    fail(id, `${res.confidence} 但 destination=${res.destination}`);
  }
  if (!pending && !res.destination) fail(id, `${res.confidence} 但無 destination`);
  if (res.destination && c.kind === "activity") {
    // destination 不得含活動尾段（含證據字）。
    if (compact(res.destination).includes(compact(c.tail)) || compact(res.destination).includes(compact(c.evidence))) {
      fail(id, `destination 含活動尾段：${res.destination}`);
    }
  }
  if (res.destination && c.kind === "place") {
    // 地名案例：destination 只能是完整地名或（可接受的）父城市；不得截斷成其他片段。
    const d = compact(res.destination);
    const full = compact(c.label);
    if (d !== full && d !== compact(c.parent)) {
      fail(id, `destination 被截斷／錯誤：${res.destination}（期望 ${c.label}）`);
    }
  }
  if (res.activityPreference !== undefined && res.destination && compact(res.activityPreference).includes(compact(res.destination))) {
    fail(id, `activityPreference 含 destination：${res.activityPreference}`);
  }
}

const table = [];
for (const c of CASES) {
  for (const [pi, phrase] of PHRASES.entries()) {
    const text = phrase(c.label);
    const id0 = `${c.id}#${pi + 1}「${text}」`;
    silence();
    const init = R.resolveDestination({ text, sessionDestination: null, geocodeFn: geocodeSpy });
    restore();
    checkInvariants(`${id0} init`, init, c);
    if (init.activityPreference !== undefined) fail(`${id0} init`, `初判即切出 activityPreference=${init.activityPreference}`);
    const row = {
      id: `${c.id}#${pi + 1}`,
      init: `${init.confidence}/${init.source}/${init.destination ?? "-"}/raw=${init.rawLabel ?? "-"}`,
      cand: init.areaCandidate
        ? `area:${init.areaCandidate.parentCity}+${init.areaCandidate.area}`
        : init.provisionalCandidate
          ? `prov:${init.provisionalCandidate.areaCandidate}`
          : "-",
    };
    // 契約：place 案例初判若為 confirmed/curated，destination 必須是完整地名（不得只剩父城市而丟尾段）
    if (c.kind === "place" && init.destination && compact(init.destination) !== compact(c.label)) {
      fail(`${id0} init`, `合法地名初判被截斷：destination=${init.destination}`);
    }
    // 契約：activity 案例初判不得 confirmed 成「父城市＋活動」
    if (c.kind === "activity" && init.destination && compact(init.destination).includes(compact(c.tail))) {
      fail(`${id0} init`, `活動被併入 destination：${init.destination}`);
    }
    const candidate = init.areaCandidate ?? init.provisionalCandidate;
    if (init.confidence !== "pending_provider" || !candidate) {
      for (const s of ["validated", "validated_poi", "rejected", "unavailable", "timeout", "zero_results"]) row[s] = "n/a(非 pending)";
      table.push(row);
      continue;
    }
    // provisional 候選的 rawLabel 必須是本句中的地理片段（不得是「我」等雜訊）
    if (init.provisionalCandidate && !compact(c.label).includes(compact(init.provisionalCandidate.areaCandidate))) {
      fail(`${id0} init`, `provisional 候選非地名片段：${init.provisionalCandidate.areaCandidate}`);
    }
    if (init.provisionalCandidate && compact(init.provisionalCandidate.areaCandidate).length < 2) {
      fail(`${id0} init`, `provisional 候選過短（雜訊）：${init.provisionalCandidate.areaCandidate}`);
    }
    if (init.areaCandidate && compact(init.areaCandidate.parentCity) !== compact(c.parent)) {
      fail(`${id0} init`, `父城市錯誤：${init.areaCandidate.parentCity}`);
    }
    if (init.areaCandidate && compact(`${init.areaCandidate.parentCity}${init.areaCandidate.area}`) !== compact(c.label)) {
      NOTE.push(`${id0} 候選尾段被正規化：area=${init.areaCandidate.area}（原文 ${c.tail}）`);
    }
    const sc = scenarios(candidate);
    for (const [sname, outcome] of Object.entries(sc)) {
      silence();
      const verdict = R.classifyDestinationProviderEvidence(candidate, outcome);
      const r0 = R.applyDestinationProviderValidation(init, verdict);
      const r1 = c.evidence ? R.applyDestinationProviderValidation(init, verdict, c.evidence) : null;
      restore();
      const id = `${id0} ${sname}`;
      if (sname === "validated" && c.kind === "activity") {
        // 契約字面情境（provider 直接確認 district=活動尾段，現實不會發生）：不列 P1，僅記錄。
        NOTE.push(`${id} [契約字面 district=尾段] → ${r0.confidence}/${r0.destination ?? "-"}`);
        if (r0.confidence !== "confirmed" && r0.confidence !== "ambiguous") fail(id, `非預期 confidence=${r0.confidence}`);
      } else {
        checkInvariants(`${id} noEv`, r0, c);
        if (r1) checkInvariants(`${id} ev`, r1, c);
      }
      // 無活動證據 → activityPreference 必須 undefined
      if (r0.activityPreference !== undefined) fail(`${id} noEv`, `無證據卻切出活動 ${r0.activityPreference}`);
      // 期望 verdict
      const isProv = Boolean(init.provisionalCandidate);
      if (sname === "validated" && isProv) {
        // provisional 實際形狀：validated 時 destination 必須含完整片段；否則只能 unavailable（安全）。
        if (verdict.status === "validated" && !compact(r0.destination).includes(compact(candidate.areaCandidate))) {
          fail(id, `provisional validated destination 非完整地名：${r0.destination}`);
        }
        if (verdict.status === "rejected") fail(id, "provisional 不得 rejected");
        NOTE.push(`${id} provisional 實際形狀 mock → ${verdict.status}/${r0.confidence}/${r0.destination ?? "-"}`);
      } else if (sname !== "validated_poi") {
        const expectVerdict =
          sname === "validated" ? "validated" : sname === "rejected" ? (isProv ? "unavailable" : "rejected") : "unavailable";
        if (verdict.status !== expectVerdict) fail(id, `verdict=${verdict.status}（期望 ${expectVerdict}）`);
      }
      if (sname === "validated" && !isProv && verdict.status === "validated" && c.kind === "place") {
        if (r0.confidence !== "confirmed") fail(id, `validated 後 confidence=${r0.confidence}`);
        if (compact(r0.destination) !== compact(c.label)) {
          fail(id, `validated destination 非完整地名：${r0.destination}`);
        }
      }
      if (sname.startsWith("validated") && r0.activityPreference !== undefined) fail(id, "validated 不得有 activityPreference");
      if (["unavailable", "timeout", "zero_results"].includes(sname)) {
        for (const [tag, r] of [["noEv", r0], ["ev", r1]]) {
          if (!r) continue;
          if (r.confidence !== "ambiguous" || r.destination !== undefined || r.activityPreference !== undefined) {
            fail(`${id} ${tag}`, `應 ambiguous 且無 destination/活動：${r.confidence}/${r.destination}/${r.activityPreference}`);
          }
        }
      }
      if (sname === "rejected") {
        if (r0.confidence !== "ambiguous" || r0.destination !== undefined) fail(`${id} noEv`, `rejected 無證據應 ambiguous：${r0.confidence}/${r0.destination}`);
        if (r1 && !isProv) {
          if (r1.confidence !== "confirmed" || compact(r1.destination) !== compact(c.parent) || r1.activityPreference === undefined) {
            fail(`${id} ev`, `rejected+證據應分離：${r1.confidence}/${r1.destination}/${r1.activityPreference}`);
          } else if (compact(r1.activityPreference) !== compact(c.tail)) {
            NOTE.push(`${id} activityPreference=${r1.activityPreference} ≠ 原文尾段 ${c.tail}`);
          }
        }
      }
      row[sname] =
        `${verdict.status[0].toUpperCase()}→${r0.confidence}/${r0.destination ?? "-"}` +
        (r1 ? ` | ev:${r1.confidence}/${r1.destination ?? "-"}/act=${r1.activityPreference ?? "-"}` : "");
    }
    table.push(row);
  }
}

// ── provisional（無已知父城市）額外：exact-match validated mock 與父城市不符 ──
{
  silence();
  const prov = { rawLabel: "釣崎海岸", areaCandidate: "釣崎海岸", parentCity: undefined, validationStatus: "pending_provider" };
  const vExact = R.classifyDestinationProviderEvidence(prov, {
    kind: "envelope",
    envelope: { location: loc({ city: "一宮町", region: "千葉縣", district: "釣崎海岸", formattedName: "千葉縣一宮町釣崎海岸", displayLabel: "釣崎海岸" }), error: null },
  });
  const vRej = R.classifyDestinationProviderEvidence(prov, {
    kind: "envelope",
    envelope: { location: loc({ city: "千葉", formattedName: "千葉" }), error: null },
  });
  restore();
  NOTE.push(`provisional「釣崎海岸」exact mock → ${vExact.status}${vExact.scope ? `（${vExact.scope.displayLabel}）` : ""}；父城市退回 mock → ${vRej.status}`);
  if (vRej.status === "rejected") fail("PROV", "provisional 候選不得被判 rejected");
}

// ── validated 但父城市不符 ──
{
  silence();
  const init = R.resolveDestination({ text: "香港跑馬地推薦景點" });
  const bad = R.applyDestinationProviderValidation(init, {
    status: "validated",
    scope: { displayLabel: "澳門跑馬地", parentCity: "澳門", area: "跑馬地", searchScope: "area" },
  });
  restore();
  if (init.confidence === "pending_provider") {
    if (bad.confidence !== "ambiguous" || bad.destination !== undefined) fail("PARENT-MISMATCH", `應 ambiguous：${bad.confidence}/${bad.destination}`);
    NOTE.push(`validated 父城市不符 → ${bad.confidence}/providerValidation=${bad.providerValidation}`);
  }
}

// ── rejected + 弱證據（單字）是否可切斷合法地名 ──
{
  silence();
  const init = R.resolveDestination({ text: "台南看西街教會推薦景點" });
  const cand = init.areaCandidate;
  let r = null;
  if (cand) {
    const v = R.classifyDestinationProviderEvidence(cand, scenarios(cand).rejected);
    r = R.applyDestinationProviderValidation(init, v, "看");
  }
  restore();
  if (r) NOTE.push(`台南看西街教會 rejected + 證據「看」→ ${r.confidence}/${r.destination ?? "-"}/act=${r.activityPreference ?? "-"}（證據採 tail.includes 子字串判定）`);
}

// ── (c) activityPreference 是否保留原文尾段 ──
{
  silence();
  const out = [];
  for (const [text, ev] of [["北海道滑雪美食推薦", "滑雪"], ["沖繩潛水購物推薦", "潛水"], ["京都的看楓葉推薦", "楓葉"]]) {
    const init = R.resolveDestination({ text });
    const cand = init.areaCandidate;
    if (!cand) {
      out.push(`${text} → ${init.confidence}/${init.source}`);
      continue;
    }
    const v = R.classifyDestinationProviderEvidence(cand, scenarios(cand).rejected);
    const r = R.applyDestinationProviderValidation(init, v, ev);
    out.push(`${text} → area=${cand.area} act=${r.activityPreference ?? "-"} dest=${r.destination ?? "-"}`);
  }
  restore();
  NOTE.push(`(c) 尾段原文保留：${out.join("；")}`);
}

// ── session ──
{
  const S = { destination: "京都" };
  silence();
  const s1 = R.resolveDestination({ text: "推薦景點", sessionDestination: S });
  const s2 = R.resolveDestination({ text: "大阪推薦景點", sessionDestination: S });
  const s3 = R.resolveDestination({ text: "我想去香港跑馬地，推薦景點", sessionDestination: S });
  const s4 = R.resolveDestination({ text: "有什麼推薦景點？", sessionDestination: null });
  const s5 = R.resolveDestination({ text: "我想去千葉釣崎海岸，推薦景點", sessionDestination: S });
  restore();
  if (!(s1.confidence === "confirmed" && s1.source === "session" && s1.destination === "京都")) fail("SESSION-1", `無目的地應沿用 session：${JSON.stringify([s1.confidence, s1.source, s1.destination])}`);
  if (!(s2.destination === "大阪" && s2.source !== "session")) fail("SESSION-2", `本句目的地應優先：${JSON.stringify([s2.confidence, s2.source, s2.destination])}`);
  if (s3.source === "session" || s3.destination === "京都") fail("SESSION-3", `本句目的地（pending）不得退回 session：${JSON.stringify([s3.confidence, s3.source, s3.destination])}`);
  if (s4.destination !== undefined || s4.confidence !== "ambiguous") fail("SESSION-4", `無 session 無目的地應 ambiguous：${s4.confidence}/${s4.destination}`);
  if (s5.source === "session" || s5.destination === "京都") fail("SESSION-5", `本句目的地（千葉）不得退回 session：${JSON.stringify([s5.confidence, s5.source, s5.destination])}`);
  NOTE.push(`session: s1=${s1.confidence}/${s1.source}/${s1.destination} s2=${s2.confidence}/${s2.source}/${s2.destination} s3=${s3.confidence}/${s3.source}/${s3.destination ?? "-"} s5=${s5.confidence}/${s5.source}/${s5.destination ?? "-"} raw=${s5.rawLabel ?? "-"}`);
}

// ── 非 pending 直接 apply 不變 ──
{
  silence();
  const init = R.resolveDestination({ text: "大阪推薦景點" });
  const after = R.applyDestinationProviderValidation(init, { status: "rejected" }, "大阪");
  restore();
  if (after !== init) fail("NONPENDING", "非 pending resolution 應原樣回傳");
}

if (fetchCalls !== 0) fail("COST", `fetch 被呼叫 ${fetchCalls} 次`);
if (geocodeCalls !== 0) fail("COST", `geocodeFn 被呼叫 ${geocodeCalls} 次`);

console.log("\n=== A–L × 情境（verdict→noEv 結果 | ev:有活動證據結果）===");
for (const row of table) {
  console.log(`\n[${row.id}] init=${row.init} cand=${row.cand}`);
  for (const s of ["validated", "validated_poi", "rejected", "unavailable", "timeout", "zero_results"]) {
    if (row[s] !== undefined) console.log(`   ${s.padEnd(13)} ${row[s]}`);
  }
}
console.log("\n=== NOTE ===");
for (const n of NOTE) console.log(" - " + n);
console.log(`\nfetchCalls=${fetchCalls} geocodeCalls=${geocodeCalls}`);
console.log(`\n=== P1 = ${P1.length} ===`);
for (const p of P1) console.log(" ✗ " + p);
if (P1.length) process.exitCode = 1;
