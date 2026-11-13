/**
 * D4 — independent zh-TW before/after sample of Google Latin place names (D2 r4/r5).
 *
 * Every sample is resolved with resolvePlaceDisplayName(…, "zh-TW") as a Google zh-TW Places
 * result (hard place id, sourceLocale zh-TW, Latin name = no 繁中 name on Google), in this
 * working tree and in a HEAD snapshot child (`--head-dir=<snapshot>`), then compared.
 *
 *   1. No meaningless transliteration in the working tree (no non-known-token syllable output).
 *   2. Known names (verified / known tokens) are byte-equal to HEAD.
 *   3. Only a pure category name ("Night Market") is replaced by the category (夜市).
 *   4. Every HEAD→now difference is an allowed "phonetic/category → kept Google name" change.
 *
 * Network: fetch stubbed to throw (must stay 0).
 * Run: npx vite-node scripts/verify-d4-zh-latin-name-sample.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const watchdog = setTimeout(() => { out("FAIL watchdog: verify-d4-zh-latin-name-sample exceeded 4 minutes"); process.exit(3); }, 4 * 60_000);
watchdog.unref();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK in verify-d4-zh-latin-name-sample"); };

const argv = process.argv.slice(2);
const EMIT = argv.includes("--emit");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

// [region, Google name (Latin, as returned for a zh-TW request), primaryType]
const SAMPLES = [
  ["JP", "Tokyo Tower", "tourist_attraction"],
  ["JP", "Tokyo Skytree", "tourist_attraction"],
  ["JP", "Osaka Castle", "tourist_attraction"],
  ["JP", "teamLab Planets TOKYO", "museum"],
  ["JP", "Shibuya Sky", "tourist_attraction"],
  ["JP", "Omoide Yokocho", "tourist_attraction"],
  ["JP", "Arashiyama Bamboo Grove", "tourist_attraction"],
  ["JP", "Sapporo Clock Tower", "tourist_attraction"],
  ["JP", "Odaiba Seaside Park", "park"],
  ["JP", "Kiyomizu-dera Temple", "place_of_worship"],
  ["JP", "Nakameguro Bridge", "tourist_attraction"],
  ["KR", "N Seoul Tower", "tourist_attraction"],
  ["KR", "Namsan Park", "park"],
  ["KR", "Bukchon Hanok Village", "tourist_attraction"],
  ["KR", "Gwangjang Market", "market"],
  ["KR", "Camellia Hill", "tourist_attraction"],
  ["KR", "Hello Kitty Island", "tourist_attraction"],
  ["KR", "Seongsan Ilchulbong", "tourist_attraction"],
  ["KR", "Haeundae Beach", "tourist_attraction"],
  ["AU", "Sydney Opera House", "tourist_attraction"],
  ["AU", "Bondi Beach", "tourist_attraction"],
  ["AU", "Darling Harbour", "tourist_attraction"],
  ["AU", "Manly Beach", "tourist_attraction"],
  ["AU", "Taronga Zoo", "zoo"],
  ["AU", "Hyde Park", "park"],
  ["AU", "Barangaroo Reserve Park", "park"],
  ["EU-US", "Eiffel Tower", "tourist_attraction"],
  ["EU-US", "Louvre Museum", "museum"],
  ["EU-US", "Central Park", "park"],
  ["EU-US", "Brooklyn Bridge", "tourist_attraction"],
  ["EU-US", "Times Square", "tourist_attraction"],
  ["EU-US", "Charles Bridge", "tourist_attraction"],
  ["EU-US", "Neuschwanstein Castle", "tourist_attraction"],
  ["EU-US", "Golden Gate Bridge", "tourist_attraction"],
  ["EU-US", "Temple of Hephaestus", "tourist_attraction"],
  ["EU-US", "Athens Museum", "museum"],
  ["TW", "Taipei 101", "tourist_attraction"],
  ["TW", "Raohe Street Night Market", "market"],
  ["TW", "Wenhua Road Night Market", "market"],
  ["TW", "Liuhe Night Market", "market"],
  ["TW", "Night Market", "market"],
  ["TW", "Ximending", "tourist_attraction"],
  ["TW", "Jiufen Old Street", "tourist_attraction"],
  ["TW", "Daan Forest Park", "park"],
  ["TW", "Longshan Temple", "place_of_worship"],
  ["VN", "Ghềnh Bàng", "tourist_attraction"],
  ["VN", "Chùa Linh Ứng", "place_of_worship"],
  ["VN", "Bãi biển Mỹ Khê", "tourist_attraction"],
  ["VN", "Cầu Rồng", "tourist_attraction"],
  ["VN", "Chợ Hàn", "market"],
  ["VN", "Bảo tàng Điêu khắc Chăm", "museum"],
  ["VN", "Hội An Ancient Town", "tourist_attraction"],
  ["BRAND", "Starbucks Reserve Roastery Tokyo", "cafe"],
  ["BRAND", "Blue Bottle Coffee Kiyosumi", "cafe"],
  ["BRAND", "Ichiran Shibuya", "restaurant"],
  ["BRAND", "Don Quijote Shibuya", "store"],
  ["BRAND", "Uniqlo Ginza", "clothing_store"],
  ["BRAND", "% Arabica Kyoto Higashiyama", "cafe"],
  ["BRAND", "McDonald's", "restaurant"],
];

const input = (s, i) => {
  const id = `ChIJD4Sample${String(i + 1).padStart(3, "0")}`;
  return { name: s[1], placeId: id, canonicalPlaceId: id, sourceLocale: "zh-TW", primaryType: s[2], types: [s[2], "point_of_interest", "establishment"] };
};

async function emit() {
  const { resolvePlaceDisplayName } = await import(/* @vite-ignore */ "/src/lib/place-display-name.ts");
  const R = SAMPLES.map((s, i) => {
    const r = resolvePlaceDisplayName(input(s, i), "zh-TW");
    return { name: s[1], display: r.localizedDisplayName, source: r.localizationSource };
  });
  // No Google place id (AI-authored / legacy items), as verify-itinerary-localization-runtime feeds them.
  const NO_ID = SAMPLES.map((s) => {
    const r = resolvePlaceDisplayName({ name: s[1], originalName: s[1], primaryType: s[2], types: [s[2], "point_of_interest"] }, "zh-TW");
    return { name: s[1], display: r.localizedDisplayName, source: r.localizationSource };
  });
  return { R, NO_ID, fetchCalls };
}

if (EMIT) {
  process.stdout.write(`@@JSON@@${JSON.stringify(await emit())}@@END@@\n`);
  process.exit(0);
}

function runChild(cwd) {
  return new Promise((resolve) => {
    const self = fileURLToPath(import.meta.url);
    const child = spawn("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--emit"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
const translit = await import(/* @vite-ignore */ "/src/lib/place-localization/latin-zh-transliteration.ts");

const HAN = /\p{Script=Han}/u;
/** A token of the name spelled syllable-by-syllable (not from the known-token table) appears in the output. */
function phoneticPieces(name, display) {
  if (!HAN.test(display)) return [];
  const fold = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d");
  return fold.split(/[\s\-_/]+/).filter(Boolean).map((tok) => translit.transliterateLatinToZh(tok))
    .filter((t) => t && !t.allKnownTokens && t.zh.length >= 2 && display.includes(t.zh)).map((t) => t.zh);
}

const rows = SAMPLES.map((s, i) => ({ region: s[0], name: s[1], head: head.R[i], now: now.R[i] }));
out("region | Google name | HEAD | now");
for (const r of rows) out(`${r.region} | ${r.name} | ${r.head.display} [${r.head.source}] | ${r.now.display} [${r.now.source}]${r.head.display !== r.now.display ? "  << changed" : ""}`);

const failures = [];
function check(name, fn) { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").join("\n  ")}`); } }

check(`sample size ≥ 40 across JP/KR/AU/EU-US/TW/VN/BRAND (${rows.length})`, () => {
  assert.ok(rows.length >= 40);
  for (const g of ["JP", "KR", "AU", "EU-US", "TW", "VN", "BRAND"]) assert.ok(rows.some((r) => r.region === g), g);
});
check("now: no syllable-level phonetic transliteration in any zh-TW display name", () => {
  const bad = rows.map((r) => [r, phoneticPieces(r.name, r.now.display)]).filter(([, p]) => p.length).map(([r, p]) => `${r.name} → ${r.now.display} (${p.join(",")})`);
  assert.deepEqual(bad, []);
});
check("HEAD had phonetic transliterations (the check above is not vacuous)", () => {
  const n = rows.filter((r) => phoneticPieces(r.name, r.head.display).length).length;
  out(`  HEAD phonetic outputs: ${n}`);
  assert.ok(n > 0);
});
check("known names unchanged vs HEAD (東京鐵塔/晴空塔/N首爾塔/大阪城/台北101 …): every non-phonetic HEAD Han name is byte-equal now", () => {
  const bad = rows.filter((r) => HAN.test(r.head.display) && !phoneticPieces(r.name, r.head.display).length && !/^(夜市|傳統市場|乾貨市場|跳蚤市場|Hello Kitty 島)$/u.test(r.head.display))
    .filter((r) => r.now.display !== r.head.display).map((r) => `${r.name}: HEAD ${r.head.display} → now ${r.now.display}`);
  assert.deepEqual(bad, []);
});
check("category replacement only for a pure category name (\"Night Market\" → 夜市)", () => {
  const cat = rows.filter((r) => r.now.display === "夜市").map((r) => r.name);
  assert.deepEqual(cat, ["Night Market"]);
});
check("every HEAD→now difference is phonetic/category → kept Google Latin name (google_locale)", () => {
  const bad = rows.filter((r) => r.head.display !== r.now.display)
    .filter((r) => !(r.now.display === r.name && r.now.source === "google_locale"))
    .map((r) => `${r.name}: ${r.head.display}[${r.head.source}] → ${r.now.display}[${r.now.source}]`);
  assert.deepEqual(bad, []);
});
{
  const changed = SAMPLES.map((s, i) => ({ name: s[1], head: head.NO_ID[i], now: now.NO_ID[i] })).filter((r) => r.head.display !== r.now.display);
  out(`\nno place id (AI-authored / legacy): ${changed.length} differ from HEAD`);
  for (const r of changed) out(`  ${r.name} | HEAD ${r.head.display} [${r.head.source}] | now ${r.now.display} [${r.now.source}]`);
  check("no place id: no phonetic transliteration now; every HEAD→now difference is a phonetic/category HEAD name", () => {
    const bad = now.NO_ID.map((r, i) => [r, phoneticPieces(SAMPLES[i][1], r.display)]).filter(([, p]) => p.length).map(([r]) => `${r.name} → ${r.display}`);
    const unexplained = changed.filter((r) => !phoneticPieces(r.name, r.head.display).length && !/^夜市$/u.test(r.head.display)).map((r) => `${r.name}: ${r.head.display} → ${r.now.display}`);
    assert.deepEqual({ bad, unexplained }, { bad: [], unexplained: [] });
  });
}
check("no network (now + HEAD child)", () => { assert.equal(fetchCalls, 0); assert.equal(head.fetchCalls, 0); });

if (failures.length) { out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`); process.exit(1); }
out("PASS d4 zh Latin name sample");
process.exit(0);
