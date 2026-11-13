/**
 * D4 — downstream of the zh-TW "keep Google Latin name" change (D2 r4/r5).
 *
 * zh-TW device, Google returns Latin names (no 繁中 name) with hard place ids for 雪梨 / 峴港.
 * The same calls run in this working tree and in a HEAD snapshot child; compared:
 *   - Google searchPlaces calls (mock count) for discovery, and a same-locale repeat (+0)
 *   - fetch (any AI / network) = 0
 *   - combination gate: no candidate dropped for foreign script, every kept name is the Google name
 *   - itinerary localization gate: same stops / place ids in and out (no swap / drop), and
 *     foreignScriptStops = 0 for kept Google names (diacritics allowed), nothing triggers a replan
 *     (gate result is not consumed for retries; the counts below must not grow vs HEAD).
 *
 * Run: npx vite-node scripts/verify-d4-kept-name-downstream.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const watchdog = setTimeout(() => { out("FAIL watchdog: verify-d4-kept-name-downstream exceeded 5 minutes"); process.exit(3); }, 5 * 60_000);
watchdog.unref();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK in verify-d4-kept-name-downstream"); };
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;
Object.defineProperty(globalThis, "navigator", { value: { language: "zh-TW" }, configurable: true, writable: true });

const argv = process.argv.slice(2);
const EMIT = argv.includes("--emit");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

const DESTS = {
  雪梨: {
    center: [-33.86, 151.2], address: "澳洲新南威爾斯州雪梨",
    places: [
      ["tourist_attraction", "Bondi Beach"], ["tourist_attraction", "Manly Beach"], ["park", "Hyde Park"],
      ["park", "Barangaroo Reserve Park"], ["tourist_attraction", "Sydney Harbour Bridge"], ["zoo", "Taronga Zoo Sydney"],
      ["tourist_attraction", "Darling Harbour"], ["park", "Royal Botanic Garden Sydney"], ["museum", "Art Gallery of New South Wales"],
      ["museum", "Australian Museum"], ["tourist_attraction", "The Rocks"], ["shopping_mall", "Queen Victoria Building"],
      ["park", "Centennial Park"], ["restaurant", "Mr. Wong"], ["cafe", "Single O Surry Hills"],
    ],
  },
  東京: {
    center: [35.68, 139.76], address: "日本東京都",
    places: [
      ["museum", "teamLab Planets TOKYO"], ["park", "Odaiba Seaside Park"], ["place_of_worship", "Kiyomizu-dera Temple"],
      ["tourist_attraction", "Nakameguro Bridge"], ["tourist_attraction", "Tokyo Tower"], ["tourist_attraction", "Tokyo Skytree"],
      ["tourist_attraction", "Shibuya Sky"], ["tourist_attraction", "Omoide Yokocho"], ["park", "Ueno Park"],
      ["museum", "Mori Art Museum"], ["market", "Tsukiji Outer Market"], ["park", "Yoyogi Park"],
      ["restaurant", "Ichiran Shibuya"], ["cafe", "Blue Bottle Coffee Kiyosumi"], ["tourist_attraction", "Senso-ji"],
    ],
  },
  // Da Nang: discovery needs a geocode (fetch → 0 here, same on HEAD); kept for the itinerary gate.
  峴港: {
    center: [16.05, 108.22], address: "越南峴港",
    places: [
      ["tourist_attraction", "Bãi biển Mỹ Khê"], ["natural_feature", "Ghềnh Bàng"], ["place_of_worship", "Chùa Linh Ứng"],
      ["tourist_attraction", "Cầu Rồng"], ["market", "Chợ Hàn"], ["museum", "Bảo tàng Điêu khắc Chăm"],
      ["tourist_attraction", "Bà Nà Hills"], ["tourist_attraction", "Ngũ Hành Sơn"], ["park", "Công viên Biển Đông"],
      ["tourist_attraction", "Cầu Tình Yêu"], ["market", "Chợ Cồn"], ["tourist_attraction", "Bãi biển Non Nước"],
      ["cafe", "Cộng Cà Phê"], ["restaurant", "Mì Quảng Bà Mua"], ["tourist_attraction", "Bán đảo Sơn Trà"],
    ],
  },
};
const pool = (dest) => DESTS[dest].places.map(([type, name], i) => {
  const id = `ChIJD4Down${{ 雪梨: "S", 東京: "T", 峴港: "D" }[dest]}${String(i + 1).padStart(3, "0")}`;
  return {
    id, googlePlaceId: id, placeId: id, name, address: DESTS[dest].address,
    lat: DESTS[dest].center[0] + (i % 5) * 0.006, lng: DESTS[dest].center[1] + Math.floor(i / 5) * 0.006,
    rating: 4.6, userRatingCount: 6000 + i, photoName: null, primaryType: type, types: [type, "point_of_interest", "establishment"],
    businessStatus: "OPERATIONAL", openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  };
});

async function emit() {
  const load = (p) => import(/* @vite-ignore */ `/${p}`);
  const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
  const combos = await load("src/lib/ai/destination-combination-suggestions.ts");
  const gate = await load("src/lib/ai/itinerary-localization-gate.ts");
  const guards = await load("src/lib/trip/itinerary-guards.ts");
  const R = {};
  for (const dest of Object.keys(DESTS)) {
    discovery.clearDiscoveredCombinationsCache();
    let calls = 0;
    const searchPlaces = async () => { calls++; return { places: pool(dest), error: null }; };
    await discovery.discoverDestinationCombinations({ destination: dest, locale: "zh-TW", searchPlaces });
    const first = calls;
    await discovery.discoverDestinationCombinations({ destination: dest, locale: "zh-TW", searchPlaces });
    const repeat = calls - first;
    const payload = combos.buildDestinationCombinationSuggestionPayload(dest, 3, { locale: "zh-TW", startDate: "2026-12-10", endDate: "2026-12-12", tentativeDates: false });
    const shown = (payload?.shownCandidates ?? []).map((c) => ({ id: c.googlePlaceId, name: c.displayName ?? c.name }));
    const raw = guards.buildFallbackItineraryFromPlaces(pool(dest), 3, "2026-12-10", dest, { selectedCombinationIds: [1] });
    const g = gate.applyItineraryLocalizationGate(raw, { locale: "zh-TW", softPassEnglish: true });
    R[dest] = {
      searchCalls: first, repeatCalls: repeat, comboCount: payload?.offeredCombinations?.length ?? 0,
      displayText: payload?.displayText ?? "", shown,
      gateIn: raw.map((i) => i.googlePlaceId), gateOut: g.items.map((i) => i.googlePlaceId),
      gateNames: g.items.map((i, k) => [i.googlePlaceId, i.localizedDisplayName, i.localizationSource, g.traces[k]?.gateResult]),
      gate: { ok: g.ok, foreign: g.foreignScriptStops, english: g.englishFallbackStops, original: g.originalFallbackStops, localized: g.localizedStops, total: g.totalStops },
    };
  }
  return { R, fetchCalls };
}

if (EMIT) {
  const r = await emit();
  process.stdout.write(`@@JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

function runChild(cwd) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vite-node", fileURLToPath(import.meta.url), "--config", "scripts/vite.verify.config.mjs", "--", "--emit"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 3 * 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      const m = stdout.match(/@@JSON@@([\s\S]*?)@@END@@/);
      resolve(m ? JSON.parse(m[1]) : { error: stdout.slice(-800) });
    });
  });
}

assert.ok(headDir && existsSync(join(headDir, "src")), "pass -- --head-dir=<snapshot>");
const now = await emit();
const head = await runChild(headDir);
assert.ok(!head.error, `HEAD child failed: ${head.error}`);

const failures = [];
function check(name, fn) { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").join("\n  ")}`); } }

for (const dest of Object.keys(DESTS)) {
  const n = now.R[dest];
  const h = head.R[dest];
  out(`\n[${dest}] HEAD search=${h.searchCalls} repeat=+${h.repeatCalls} combos=${h.comboCount} gate=${JSON.stringify(h.gate)}`);
  out(`[${dest}] NOW  search=${n.searchCalls} repeat=+${n.repeatCalls} combos=${n.comboCount} gate=${JSON.stringify(n.gate)}`);
  out(`  HEAD list: ${h.displayText.split("\n").filter((l) => /^\d+\. /.test(l)).join(" / ")}`);
  out(`  NOW  list: ${n.displayText.split("\n").filter((l) => /^\d+\. /.test(l)).join(" / ")}`);
  out(`  NOW  gate: ${n.gateNames.map(([, d, s]) => `${d}[${s}]`).join(" | ")}`);
  check(`${dest}: Google searchPlaces calls not above HEAD (now ${n.searchCalls} vs HEAD ${h.searchCalls}); same-locale repeat +0`, () => {
    assert.ok(n.searchCalls <= h.searchCalls);
    assert.equal(n.repeatCalls, 0);
  });
  if (h.comboCount > 0) check(`${dest}: combination count not below HEAD (${n.comboCount} vs ${h.comboCount}); shown names are the Google names (no phonetic)`, () => {
    assert.ok(n.comboCount >= h.comboCount && n.comboCount >= 2);
    const names = new Set(pool(dest).map((p) => p.name));
    const bad = n.shown.filter((c) => !names.has(c.name) && !/\p{Script=Han}/u.test(c.name ?? "")).map((c) => c.name);
    assert.deepEqual(bad, []);
  });
  check(`${dest}: itinerary gate keeps the same stops (no swap / drop); kept Google names verbatim and never counted foreign; foreign/english/original not above HEAD`, () => {
    assert.deepEqual(n.gateOut, n.gateIn);
    // Builder (pre-gate) stop set must equal HEAD; ordering may follow the name re-classification.
    if (JSON.stringify(n.gateIn) !== JSON.stringify(h.gateIn)) out(`  INFO ${dest} builder order differs: HEAD ${JSON.stringify(h.gateIn)} NOW ${JSON.stringify(n.gateIn)}`);
    assert.deepEqual([...n.gateIn].sort(), [...h.gateIn].sort(), "builder stop set identical to HEAD");
    assert.ok(n.gate.foreign <= h.gate.foreign && n.gate.english <= h.gate.english && n.gate.original <= h.gate.original, JSON.stringify({ now: n.gate, head: h.gate }));
    assert.ok(n.gate.localized >= h.gate.localized);
    const byId = Object.fromEntries(pool(dest).map((p) => [p.googlePlaceId, p.name]));
    const bad = n.gateNames.filter(([id, d, s, r]) => s === "google_locale" && (d !== byId[id] || r === "foreign_script")).map(([, d, , r]) => `${d}:${r}`);
    assert.deepEqual(bad, []);
  });
}
check("no network (now + HEAD child): fetch = 0", () => { assert.equal(fetchCalls, 0); assert.equal(head.fetchCalls, 0); });

if (failures.length) { out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`); process.exit(1); }
out("PASS d4 kept-name downstream");
process.exit(0);
