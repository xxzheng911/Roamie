import "./verify-netguard-full.mjs";
/**
 * T-AC (tester, independent re-check of B23: whitelist lookbehind for bare 「多」 in EXTRA_DAYS_PHRASE_RE).
 * W (working tree) vs H (HEAD via --head-dir).
 *  P) place names containing 多: parseDayCountFromText + mergeTravelContext(createEmptySession(), t).context.days must equal HEAD
 *  X) 「多一天」 exclusions must not be read as trip length; 不多/最多/頂多/至多/差不多 3天 -> 3
 *  C) colloquial outside the whitelist: report only
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-tac-b23-place-names.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 250s"); process.exit(3); }, 250_000).unref();
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const PLACES = [
  "博多3天", "我想去博多3天", "博多 3 天", "福岡博多2天", "博多2日間",
  "多倫多3天", "我想去多倫多3天", "多倫多 5 天", "去多倫多3天",
  "多摩2天", "我想去多摩2天",
  "多良間3天", "我想去多良間3天",
  "喜多方3天", "我想去喜多方3天",
  "宇多津2天", "我想去宇多津2天",
];
// [text, expected parseDayCountFromText]  "none" = must not yield the extra-day number as trip length
const EXCL = [
  ["可以多一天嗎", "none"], ["多一天", "none"], ["想多2天", "none"], ["再多1天", "none"], ["還多一天", "none"],
  ["不多3天", 3], ["最多3天", 3], ["頂多3天", 3], ["至多3天", 3], ["差不多3天", 3],
];
const COLLOQ = ["我們多一天", "多一天好了", "那多一天吧", "那就多一天"];

async function collect() {
  const R = { days: {}, merge: {} };
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const tc = await load("src/lib/ai/travel-context.ts");
  const sess = await load("src/lib/chat-session.ts");
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undefined" : JSON.stringify(v); } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  for (const t of [...PLACES, ...EXCL.map((r) => r[0]), ...COLLOQ]) {
    R.days[t] = g(() => dur.parseDayCountFromText(t));
    R.merge[t] = g(() => { const m = tc.mergeTravelContext(sess.createEmptySession(), t).context; return { dest: m.destination ?? null, days: m.days ?? null }; });
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAC_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tac-b23-place-names.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
    const m = (r.stdout ?? "").match(/@@TAC_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const mdays = (s) => { try { return JSON.parse(s).days; } catch { return s; } };
  if (!HR) fail("HEAD", "no HEAD result; item 1 requires W == H");

  out("\n==== 1) place names: parseDayCountFromText | merge.days  (W vs H) ====");
  for (const t of PLACES) {
    const same = HR && W.days[t] === HR.days?.[t] && W.merge[t] === HR.merge?.[t];
    out(`  ${same ? "OK  " : "DIFF"} ${t} | W days=${W.days[t]} merge=${W.merge[t]} | H days=${HR?.days?.[t] ?? "n/a"} merge=${HR?.merge?.[t] ?? "n/a"}`);
    if (HR && !same) fail(`P#${t}`, `W ${W.days[t]}/${W.merge[t]} != H ${HR.days?.[t]}/${HR.merge?.[t]}`);
    const want = Number((t.match(/(\d+)\s*(?:天|日)/) ?? [])[1]);
    if (W.days[t] !== String(want)) fail(`P#${t}#value`, `W days ${W.days[t]} expected ${want}`);
    if (mdays(W.merge[t]) !== want) fail(`P#${t}#merge`, `W merge days ${mdays(W.merge[t])} expected ${want}`);
  }

  out("\n==== 2) extra-day exclusions (text | W days merge | H days merge) ====");
  for (const [t, exp] of EXCL) {
    out(`  ${t} | W ${W.days[t]} merge=${W.merge[t]} | H ${HR?.days?.[t] ?? "n/a"} merge=${HR?.merge?.[t] ?? "n/a"} expect ${exp === "none" ? "not a trip length" : exp}`);
    if (exp === "none") {
      const n = Number((t.match(/(\d+)/) ?? [])[1] ?? 1);
      if (W.days[t] !== "undefined") fail(`X#${t}`, `W days ${W.days[t]} expected undefined (extra ${n})`);
      if (mdays(W.merge[t]) === n) fail(`X#${t}#merge`, `W merge days ${mdays(W.merge[t])} equals extra-day count`);
    } else {
      if (W.days[t] !== String(exp)) fail(`X#${t}`, `W days ${W.days[t]} expected ${exp}`);
      if (mdays(W.merge[t]) !== exp) fail(`X#${t}#merge`, `W merge days ${mdays(W.merge[t])} expected ${exp}`);
    }
  }

  out("\n==== C) colloquial outside whitelist (report only) ====");
  for (const t of COLLOQ) out(`  ${t} | W ${W.days[t]} merge=${W.merge[t]} | H ${HR?.days?.[t] ?? "n/a"} merge=${HR?.merge?.[t] ?? "n/a"}`);

  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
