import "./verify-netguard-full.mjs";
/**
 * T-AD (tester, independent re-check of B24: 們/们/就/那 added to the bare 「多」 lookbehind of EXTRA_DAYS_PHRASE_RE).
 * W (working tree) vs H (HEAD via --head-dir). Pure function + mergeTravelContext rows.
 *  N) 「X那多N天」 boundary: 那覇/那霸/那須 place names keep N; 「那多3天」 reported
 *  J) 就/們 not followed by 多: trip length must stay N
 *  M) multi-turn: 「我想去東京 3 天」 -> 「那就多一天」 (and variants) must keep days=3
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-tad-b24-colloquial-extra-days.mjs -- --head-dir=<snapshot>
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

// [text, expected parseDayCountFromText (number | undefined) | null = report only]
const NA = [
  ["那覇3天", 3], ["那霸3天", 3], ["我想去那須3天", 3], ["那多3天", null],
  ["我想去那覇3天", 3], ["那須2天", 2], ["沖繩那霸 4 天", 4],
];
const JU = [
  ["就3天", 3], ["我們3天", 3], ["他們去博多3天", 3], ["就去博多3天", 3],
  ["我们3天", 3], ["那就3天", 3], ["我們去多倫多3天", 3], ["那就去博多3天", 3], ["就多3天", null], ["我們多3天", null],
];
// [first, second, expected days after second turn]
const MULTI = [
  ["我想去東京 3 天", "那就多一天", 3],
  ["我想去東京 3 天", "我們多一天", 3],
  ["我想去東京 3 天", "那多一天吧", 3],
  ["我想去東京 3 天", "我们多一天", 3],
  ["我想去東京 3 天", "就多一天", 3],
];

async function collect() {
  const R = { days: {}, merge: {}, multi: {}, repeat: "" };
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const tc = await load("src/lib/ai/travel-context.ts");
  const sess = await load("src/lib/chat-session.ts");
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undefined" : JSON.stringify(v); } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  for (const [t] of [...NA, ...JU]) {
    R.days[t] = g(() => dur.parseDayCountFromText(t));
    R.merge[t] = g(() => { const m = tc.mergeTravelContext(sess.createEmptySession(), t).context; return { dest: m.destination ?? null, days: m.days ?? null }; });
  }
  for (const [a, b] of MULTI) {
    R.multi[`${a} -> ${b}`] = g(() => {
      const r1 = tc.mergeTravelContext(sess.createEmptySession(), a);
      const r2 = tc.mergeTravelContext(r1.session, b);
      return {
        t1: { dest: r1.context.destination ?? null, days: r1.context.days ?? null, sDays: r1.session.tripDays ?? null },
        t2: { dest: r2.context.destination ?? null, days: r2.context.days ?? null, sDays: r2.session.tripDays ?? null },
        p2: dur.parseDayCountFromText(b) ?? null,
      };
    });
  }
  R.repeat = [1, 2, 3].map(() => g(() => dur.parseDayCountFromText("那就多一天，總共4天"))).join(",");
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAD_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tad-b24-colloquial-extra-days.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
    const m = (r.stdout ?? "").match(/@@TAD_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const mdays = (s) => { try { return JSON.parse(s).days; } catch { return s; } };
  const enc = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
  if (!HR) fail("HEAD", "no HEAD result");

  const rows = (title, list, tag) => {
    out(`\n==== ${title} (text | W days merge | H days merge) ====`);
    for (const [t, exp] of list) {
      const same = HR && W.days[t] === HR.days?.[t] && W.merge[t] === HR.merge?.[t];
      out(`  ${HR ? (same ? "same" : "DIFF") : "n/a "} ${t} | W ${W.days[t]} merge=${W.merge[t]} | H ${HR?.days?.[t] ?? "n/a"} merge=${HR?.merge?.[t] ?? "n/a"}${exp === null ? " (report)" : ` expect ${exp}`}`);
      if (exp === null) continue;
      if (W.days[t] !== enc(exp)) fail(`${tag}#${t}`, `W days ${W.days[t]} expected ${exp}`);
      if (mdays(W.merge[t]) !== exp) fail(`${tag}#${t}#merge`, `W merge days ${mdays(W.merge[t])} expected ${exp}`);
      if (HR && HR.days?.[t] === enc(exp) && W.days[t] !== HR.days[t]) out(`   REGRESSION vs HEAD: ${t} H ${HR.days[t]} -> W ${W.days[t]}`);
    }
  };
  rows("N) 那+place / 那多 boundary", NA, "N");
  rows("J) 就/們 without 多", JU, "J");

  out("\n==== M) multi-turn mergeTravelContext (W | H) ====");
  for (const [a, b, exp] of MULTI) {
    const k = `${a} -> ${b}`;
    out(`  ${k}\n     W ${W.multi[k]}\n     H ${HR?.multi?.[k] ?? "n/a"}`);
    let v; try { v = JSON.parse(W.multi[k]); } catch { fail(`M#${k}`, W.multi[k]); continue; }
    if (v.t1.days !== exp) fail(`M#${k}#t1`, `turn1 days ${v.t1.days} expected ${exp}`);
    if (v.t2.days !== exp) fail(`M#${k}#t2`, `turn2 context.days ${v.t2.days} expected ${exp}`);
    if (v.t2.sDays !== null && v.t2.sDays !== exp) fail(`M#${k}#t2session`, `turn2 session.tripDays ${v.t2.sDays} expected ${exp}`);
    if (v.p2 !== null) fail(`M#${k}#parse`, `parseDayCountFromText(${b}) = ${v.p2}, expected undefined`);
  }

  out(`\nrepeat (lastIndex state) 「那就多一天，總共4天」: W ${W.repeat} | H ${HR?.repeat ?? "n/a"}`);
  if (W.repeat !== "4,4,4") fail("repeat", W.repeat);

  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
