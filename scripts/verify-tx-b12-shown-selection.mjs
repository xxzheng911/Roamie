import "./verify-netguard-full.mjs";
/**
 * T-X (tester, independent review of B12: combination pick resolved by the SHOWN list).
 * W (working tree) vs H (HEAD via --head-dir). Harness: App-order turn of verify-m16-post-selection-switch-review.mjs
 * (same slice + Tokyo pools as verify-date-dest-review-d25.mjs x).
 *  p) chat locale × device locale (navigator.language) pairs, pools m16 / real3, Tokyo 3 days → combination_choice,
 *     then 「都可以」「全部」「1、3」「第2組」: shown list, source list (device + chat locale), locked ids / titles / places.
 *  c) confirm flow 「第2組的第一天改一下」→「幫我生成」(and localized variants) under the same pairs.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-tx-b12-shown-selection.mjs -- --head-dir=<snapshot> [--only=p|c]
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (s) => !ONLY || ONLY.includes(s);
const BRIEF = argv.includes("--brief");
const DETAIL = argv.find((a) => a.startsWith("--detail="))?.slice(9);
const DETAIL_RE = DETAIL ? new RegExp(DETAIL) : null;
const realOut = console.log.bind(console);
let detailOn = true;
const out = (...a) => { if (detailOn) realOut(...a); };
const outAlways = realOut;
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 370s"); process.exit(3); }, 370_000).unref();

const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};

const GO = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const DAYS = { "zh-TW": (d) => `${d}天`, en: (d) => `${d} days`, ja: (d) => `${d}日間`, ko: (d) => `${d}일` };
const TOKYO = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
// [chat locale, device locale]
const PAIRS = [["zh-TW", "zh-TW"], ["zh-TW", "en"], ["ja", "zh-TW"], ["ja", "ja"], ["en", "en"], ["en", "zh-TW"], ["ko", "zh-TW"]];
const WORDS = ["都可以", "全部", "1、3", "第2組"];
const EXPECT = { "都可以": "all", "全部": "all", "1、3": [1, 3], "第2組": [2] };
const CONFIRM = {
  "zh-TW": [["第2組的第一天改一下", "幫我生成"]],
  en: [["第2組的第一天改一下", "幫我生成"], ["change day 1 of combo 2", "create it"]],
  ja: [["第2組的第一天改一下", "幫我生成"], ["2番の組み合わせの1日目を変えたい", "作成して"]],
  ko: [["第2組的第一天改一下", "幫我生成"], ["2번 조합 첫째 날 바꿔줘", "이대로 만들어"]],
};

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
  const pendingMod = await load("src/lib/ai/destination-pending-question.ts");
  const authMod = await loadOpt("src/lib/ai/selected-combination-authority.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to).replace("const poolFor = (dest) => {", "const poolFor = (dest) => { if (globalThis.__POOL) return globalThis.__POOL(dest);");
  slice = slice.replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const offeredOf = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => ({ id: c.id, title: c.title ?? "",
    orig: (c.places ?? []).map((p) => p.originalName ?? p.name), names: (c.places ?? []).map((p) => p.name) }));
  const reset = async (loc) => { globalThis.__POOL = undefined; H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const REAL = ["Senso-ji", "Meiji Jingu", "Ueno Park", "Tokyo National Museum", "Shinjuku Gyoen", "Tokyo Tower", "Yoyogi Park", "Mori Art Museum", "Hamarikyu Gardens",
    "Nezu Shrine", "Edo-Tokyo Museum", "Inokashira Park", "Rikugien", "Zojo-ji", "Ginza Six", "Omotesando Hills", "Tsukiji Outer Market", "Yanaka Ginza"];
  const real3 = (dest) => (/tokyo|東京|도쿄/i.test(dest ?? "") ? REAL.map((name, i) => ({ id: `ChIJJPreal${i}`, name, sourceLocale: "en", lat: 35.6762 + i * 0.0007, lng: 139.6503 + (i % 5) * 0.0006,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Tokyo, Japan", businessStatus: "OPERATIONAL" })) : []);
  const toCombos = async (chat, device, pool) => {
    setNav(device);
    await reset(chat);
    globalThis.__POOL = pool === "real3" ? real3 : undefined;
    const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[chat](TOKYO[chat]), chat);
    const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[chat](3), chat);
    return { ...a2.s, lastAssistantReply: a2.s?.lastAssistantReply ?? (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
  };
  const rowOf = (a, shown, dest) => {
    const tc = a.s?.travelContext ?? {};
    const reply = a.row?.reply ?? "";
    return { branch: a.row?.branch ?? null, p: a.s?.pendingQuestion?.type ?? null, sel: tc.selectedCombinationIds ?? [], src: tc.selectionSource ?? null,
      style: tc.selectedTripStyle ?? null, locked: tc.selectedCombinationPlaceNames ?? [], excluded: tc.excludedCombinationPlaceNames ?? [],
      after: offeredOf(a.s), confirmTitles: a.s?.pendingQuestion?.confirmCombinationTitles ?? null,
      auth: authMod ? g(() => { const x = authMod.resolveSelectedCombinationAuthority(tc, dest); return x.ok ? { ok: true, ids: x.allowlist.selectedCombinationIds } : { ok: false, reason: x.reason }; }) : "n/a",
      reply: reply.replace(/\n/g, " / ").slice(0, 240) };
  };
  for (const pool of ["m16", "real3"]) for (const [chat, device] of PAIRS) {
    if (want("p")) for (const w of WORDS) {
      const s2 = await toCombos(chat, device, pool);
      const shown = offeredOf(s2);
      const dest = s2.pendingQuestion?.baseDestination ?? s2.travelContext?.destination ?? "";
      const sig = { pre: s2.pendingQuestion?.type ?? null,
        srcDevice: g(() => combo.getDestinationCombinations(dest).map((c) => ({ title: c.title, places: c.places }))),
        srcChat: g(() => combo.getDestinationCombinations(dest, { locale: chat }).map((c) => c.title)),
        pending: g(() => pendingMod.parsePendingOptionSelection(w, s2.pendingQuestion, s2.travelContext?.offeredCombinations)),
        resolved: g(() => { const x = combo.resolveSelectedCombinations(dest, w); return x ? x.indexes.map((i) => i + 1) : null; }) };
      let a3;
      try { a3 = await H.appTurn(structuredClone(s2), w, chat); } catch (e) { R[`P|${pool}|${chat}|${device}|${w}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
      R[`P|${pool}|${chat}|${device}|${w}`] = { shown, dest, sig, ...rowOf(a3, shown, dest) };
    }
    if (want("c")) for (const [t1, t2] of CONFIRM[chat]) {
      const s2 = await toCombos(chat, device, pool);
      const shown = offeredOf(s2);
      const dest = s2.pendingQuestion?.baseDestination ?? s2.travelContext?.destination ?? "";
      const srcDevice = g(() => combo.getDestinationCombinations(dest).map((c) => c.title));
      let a3; let a4;
      try {
        a3 = await H.appTurn(structuredClone(s2), t1, chat);
        const s3 = { ...a3.s, lastAssistantReply: a3.s?.lastAssistantReply ?? (a3.row?.reply ?? "").replace(/ \/ /g, "\n") };
        a4 = await H.appTurn(structuredClone(s3), t2, chat);
      } catch (e) { R[`C|${pool}|${chat}|${device}|${t1}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
      R[`C|${pool}|${chat}|${device}|${t1}`] = { t2, shown, dest, srcDevice, pre: s2.pendingQuestion?.type ?? null,
        isRef: g(() => pendingMod.resolveCombinationRefWithDaySelection ? JSON.stringify(pendingMod.resolveCombinationRefWithDaySelection(t1, s2.pendingQuestion, s2.travelContext)) : "n/a"),
        first: rowOf(a3, shown, dest), second: rowOf(a4, shown, dest) };
    }
  }
  globalThis.__POOL = undefined; setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TX12_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tx-b12-shown-selection.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TX12_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); outAlways(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  const expIds = (w, shown) => (EXPECT[w] === "all" ? shown.map((c) => c.id) : EXPECT[w].filter((n) => n <= shown.length).map((n) => shown[n - 1].id));
  /** locked places vs shown places of the expected ids: { exactOrig, exactName, outside, missing } */
  const lockCheck = (x, ids) => {
    const sel = x.shown.filter((c) => ids.includes(c.id));
    const orig = new Set(sel.flatMap((c) => c.orig)); const nm = new Set(sel.flatMap((c) => c.names));
    const all = new Set(x.shown.flatMap((c) => [...c.orig, ...c.names]));
    const L = new Set(x.locked);
    return { exactOrig: L.size === orig.size && [...orig].every((p) => L.has(p)), exactName: L.size === nm.size && [...nm].every((p) => L.has(p)),
      outsideShown: x.locked.filter((p) => !all.has(p)), missingOrig: [...orig].filter((p) => !L.has(p)) };
  };
  const verdict = (x, w) => {
    if (!x) return "n/a"; if (x.err) return `ERR ${x.err}`;
    const ids = expIds(w, x.shown);
    const lc = lockCheck(x, ids);
    const idsOk = S(x.sel) === S(ids);
    const afterSame = S(x.after.map((c) => `${c.id}:${c.title}`)) === S(x.shown.map((c) => `${c.id}:${c.title}`));
    return `${idsOk ? "IDS-OK" : "IDS-WRONG"}${lc.exactOrig ? "/LOCK=orig" : lc.exactName ? "/LOCK=name" : "/LOCK-MISMATCH"}${afterSame ? "" : "/LIST-REPLACED"}`;
  };
  if (want("p")) {
    out("==== P) chat × device pairs: pick words at combination_choice (Tokyo 3 days) ====");
    const table = [];
    for (const k of Object.keys(WR).filter((k) => k.startsWith("P|"))) {
      const [, pool, chat, device] = k.split("|"); const w = k.split("|").slice(4).join("|");
      const x = WR[k]; const h = HR?.[k];
      detailOn = !BRIEF || Boolean(DETAIL_RE?.test(k));
      const vw = verdict(x, w); const vh = verdict(h, w);
      out(`  ${k}  W ${vw} | H ${vh}`);
      if (x.err) { fail(k, x.err); continue; }
      out(`     shown(${x.shown.length})=${S(x.shown.map((c) => `${c.id}:${c.title}[${c.orig.join(",")}]`))}`);
      out(`     srcDevice(${Array.isArray(x.sig.srcDevice) ? x.sig.srcDevice.length : "-"})=${S(Array.isArray(x.sig.srcDevice) ? x.sig.srcDevice.map((c) => `${c.title}[${c.places.join(",")}]`) : x.sig.srcDevice)} srcChat=${S(x.sig.srcChat)}`);
      out(`     W [${x.branch}] p=${x.p} pending=${S(x.sig.pending)} resolvedSrc=${S(x.sig.resolved)} sel=${S(x.sel)} src=${x.src} style=${x.style} auth=${S(x.auth)}`);
      out(`       locked=${S(x.locked)} lock=${S(lockCheck(x, expIds(w, x.shown)))}`);
      if (!S(x.after) || S(x.after.map((c) => c.title)) !== S(x.shown.map((c) => c.title))) out(`       after=${S(x.after.map((c) => `${c.id}:${c.title}[${c.orig.join(",")}]`))}`);
      out(`       reply: ${x.reply}`);
      if (h && !h.err) {
        const hs = S(h.shown) === S(x.shown) ? "same" : S(h.shown.map((c) => `${c.id}:${c.title}[${c.orig.join(",")}]`));
        out(`     H shown=${hs} srcDevice(${Array.isArray(h.sig.srcDevice) ? h.sig.srcDevice.length : "-"})=${S(Array.isArray(h.sig.srcDevice) ? h.sig.srcDevice.map((c) => c.title) : h.sig.srcDevice)}`);
        out(`       [${h.branch}] p=${h.p} pending=${S(h.sig.pending)} resolvedSrc=${S(h.sig.resolved)} sel=${S(h.sel)} src=${h.src} style=${h.style} auth=${S(h.auth)}`);
        out(`       locked=${S(h.locked)} lock=${S(lockCheck(h, expIds(w, h.shown)))}`);
        if (S(h.after.map((c) => c.title)) !== S(h.shown.map((c) => c.title))) out(`       after=${S(h.after.map((c) => `${c.id}:${c.title}[${c.orig.join(",")}]`))}`);
        out(`       reply: ${h.reply}`);
      }
      const nSrc = (y) => (Array.isArray(y?.sig?.srcDevice) ? y.sig.srcDevice.length : "-");
      table.push(`${pool}|${chat}/${device}|${w} => W ${vw} sel=${S(x.sel)} shown=${x.shown.length} src=${nSrc(x)} [${x.branch}] | H ${vh} sel=${S(h?.sel ?? null)} shown=${h?.shown?.length ?? "-"}${h && S(h.shown) === S(x.shown) ? "(same)" : "(diff)"} src=${nSrc(h)} [${h?.branch ?? "-"}]`);
      if (x.sig.pre === "combination_choice" && x.shown.length >= 3 && !vw.startsWith("IDS-OK")) fail(k, `W ids wrong: sel=${S(x.sel)} expected ${S(expIds(w, x.shown))}`);
      if (x.sig.pre === "combination_choice" && x.shown.length >= 3 && /LOCK-MISMATCH|LIST-REPLACED/.test(vw)) fail(`${k}#lock`, `W locked places / list not the shown list: ${vw}`);
      if (chat === device && h && !h.err && S(h.shown) === S(x.shown) && (S(h.sel) !== S(x.sel))) notes.push(`SAME-LOCALE diff ${k}: W sel=${S(x.sel)} H sel=${S(h.sel)}`);
      if (h && !h.err && S(h.sel) === S(x.sel) && S(h.locked) !== S(x.locked)) notes.push(`LOCKED-NAMES diff (same ids) ${k}: W=${S(x.locked)} | H=${S(h.locked)}`);
    }
    detailOn = true;
    out("\n==== P TABLE ====");
    for (const l of table) out(`  ${l}`);
  }
  if (want("c")) {
    out("\n==== C) confirm flow 「第2組的第一天改一下」→ create (chat × device) ====");
    const table = [];
    for (const k of Object.keys(WR).filter((k) => k.startsWith("C|"))) {
      const x = WR[k]; const h = HR?.[k];
      const [, pool, chat, device] = k.split("|");
      detailOn = !BRIEF || Boolean(DETAIL_RE?.test(k));
      if (x.err) { fail(k, x.err); continue; }
      const want2 = x.shown[1];
      const okOf = (y) => {
        if (!y || y.err) return "n/a";
        const t2 = y.shown[1];
        const firstOk = S(y.first.sel) === S(t2 ? [t2.id] : []) && (y.first.confirmTitles ?? []).length === 1;
        const lc = lockCheck(y.second ? { ...y.second, shown: y.shown } : { locked: [], shown: y.shown }, t2 ? [t2.id] : []);
        const secondOk = S(y.second.sel) === S(t2 ? [t2.id] : []);
        const afterSame = S(y.second.after.map((c) => c.title)) === S(y.shown.map((c) => c.title));
        return `${firstOk ? "CONFIRM-OK" : "CONFIRM-WRONG"}/${secondOk ? "GEN-IDS-OK" : "GEN-IDS-WRONG"}${lc.exactOrig ? "/LOCK=orig" : lc.exactName ? "/LOCK=name" : "/LOCK-MISMATCH"}${afterSame ? "" : "/LIST-REPLACED"}`;
      };
      const vw = okOf(x); const vh = okOf(h);
      out(`  ${k} → 「${x.t2}」  W ${vw} | H ${vh}`);
      out(`     shown=${S(x.shown.map((c) => `${c.id}:${c.title}[${c.orig.join(",")}]`))} srcDevice=${S(x.srcDevice)} pre=${x.pre}`);
      out(`     refSel=${x.isRef}`);
      out(`     W1 [${x.first.branch}] p=${x.first.p} sel=${S(x.first.sel)} confirmTitles=${S(x.first.confirmTitles)} reply: ${x.first.reply}`);
      out(`     W2 [${x.second.branch}] p=${x.second.p} sel=${S(x.second.sel)} style=${x.second.style} locked=${S(x.second.locked)} after=${S(x.second.after.map((c) => `${c.id}:${c.title}`))}\n        reply: ${x.second.reply}`);
      if (h && !h.err) {
        out(`     H shown=${S(h.shown) === S(x.shown) ? "same" : S(h.shown.map((c) => `${c.id}:${c.title}`))} srcDevice=${S(h.srcDevice)} refSel=${h.isRef}`);
        out(`     H1 [${h.first.branch}] p=${h.first.p} sel=${S(h.first.sel)} confirmTitles=${S(h.first.confirmTitles)} reply: ${h.first.reply}`);
        out(`     H2 [${h.second.branch}] p=${h.second.p} sel=${S(h.second.sel)} style=${h.second.style} locked=${S(h.second.locked)} after=${S(h.second.after.map((c) => `${c.id}:${c.title}`))}\n        reply: ${h.second.reply}`);
      }
      table.push(`${pool}|${chat}/${device}|${k.split("|").slice(4).join("|")} => W ${vw} W1sel=${S(x.first.sel)} W2sel=${S(x.second.sel)} | H ${vh} H1sel=${S(h?.first?.sel ?? null)} H2sel=${S(h?.second?.sel ?? null)}`);
      if (want2 && x.pre === "combination_choice" && /WRONG|MISMATCH|REPLACED/.test(vw) && /CONFIRM-OK/.test(vw)) fail(k, `confirm accepted but generation not combination 2 of the shown list: ${vw}`);
      if (want2 && x.pre === "combination_choice" && x.first.sel.length && S(x.first.sel) !== S([want2.id])) fail(`${k}#confirm`, `confirm picked ${S(x.first.sel)} (shown #2 id ${want2.id})`);
    }
    detailOn = true;
    out("\n==== C TABLE ====");
    for (const l of table) out(`  ${l}`);
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.map((n) => n.slice(0, 300)).join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
