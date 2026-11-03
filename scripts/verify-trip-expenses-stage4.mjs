// verify-trip-expenses-stage4.mjs — Trip Workspace V1 第 4 階段：記帳金額函式庫獨立驗證（任務單 #TW4-T1）
//
// 範圍：src/lib/money/{iso4217,currency-list,money-parse,money-format,split,settle}.ts
//   M1  純邏輯：不得 import "@/..."，可被 Node 直接載入（type stripping）
//   M2  iso4217 小數位（11 種常用 + IQD/LBP/BHD/KWD/CLF）
//   M3  currency-list：ISO ∩ Intl.supportedValuesOf；iOS 15 無 supportedValuesOf 退回 ISO 表；
//       DisplayNames 名稱／不可用時退回代碼
//   M4  money-parse：不經浮點、千分位、小數位、0／負數、10^13、safe integer
//   M5  money-format：zh-TW／en／ja／ko；小數 0 省略；兩種以上幣別加代碼
//   M6  split：施工指令案例；percent 10^13 不溢位；exact 差額正負
//   M7  split 與 supabase/migrations/20261102120000_trip_expenses.sql（331–362 行）演算法對照：
//       以 JS 依 SQL 語意（BigInt、uuid 位元組排序）重寫驗證邏輯，數千組隨機輸入比對
//   M8  settle：兩幣別各自歸零、轉帳 ≤ 人數−1、settlement 沖銷、deleted_at 不計、不同幣別不相加
//   M9  所有結果與輸入順序無關（隨機打亂多次）
//
// 不連網路、不讀 .env。執行：node scripts/verify-trip-expenses-stage4.mjs
// 可用 SEED=<整數> 重現隨機案例。結束碼：0 全部通過；1 有失敗。

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONEY_DIR = join(ROOT, "src/lib/money");

const iso = await import("../src/lib/money/iso4217.ts");
const list = await import("../src/lib/money/currency-list.ts");
const parse = await import("../src/lib/money/money-parse.ts");
const fmt = await import("../src/lib/money/money-format.ts");
const split = await import("../src/lib/money/split.ts");
const settle = await import("../src/lib/money/settle.ts");

const failures = [];
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 14).join("\n     "));
  }
}

// ── 決定性亂數 ──
const SEED = Number.parseInt(process.env.SEED ?? "", 10) || 20261103;
console.log("INFO SEED=" + SEED);
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)); // 含兩端
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const HEX = "0123456789abcdef";
function randUuid({ prefix = "", mixedCase = false } = {}) {
  let h = prefix;
  while (h.length < 32) h += HEX[Math.floor(rnd() * 16)];
  let s = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  if (mixedCase) s = [...s].map((c) => (rnd() < 0.5 ? c.toUpperCase() : c)).join("");
  return s;
}
/** 產生 n 個不重複 uuid；部分共用前綴以製造排序上的近似值。 */
function randUuids(n, mixedCase = false) {
  const set = new Set();
  const out = [];
  const prefixes = ["", "", "0", "f", "a1", "a10", "ff", "00"];
  while (out.length < n) {
    const u = randUuid({ prefix: pick(prefixes), mixedCase });
    if (set.has(u.toLowerCase())) continue;
    set.add(u.toLowerCase());
    out.push(u);
  }
  return out;
}

// ── SQL 參考實作（依 migration 331–362 行語意，獨立於 src/lib/money/split.ts）──
// Postgres uuid 比較＝16 位元組逐一比較；這裡真的轉成位元組，而不是用字串比較。
function uuidBytes(u) {
  const h = u.replace(/-/g, "").toLowerCase();
  assert.match(h, /^[0-9a-f]{32}$/);
  return Uint8Array.from(h.match(/../g).map((x) => Number.parseInt(x, 16)));
}
function cmpUuidBytes(a, b) {
  const x = uuidBytes(a);
  const y = uuidBytes(b);
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
/** 回傳 SQL 會丟出的錯誤碼，接受則回 null。rows: [{u, a, b}] */
function sqlValidate(method, amount, rows) {
  const A = BigInt(amount);
  if (rows.length < 1) return "expense_shares_mismatch";
  if (rows.reduce((s, r) => s + BigInt(r.a), 0n) !== A) return "expense_shares_mismatch";
  const distinct = new Set(rows.map((r) => uuidBytes(r.u).join(",")));
  if (distinct.size !== rows.length) return "expense_duplicate_participant";
  if (method === "equal") {
    const n = BigInt(rows.length);
    const q = A / n; // bigint 除法＝向零取整（皆為正數，等同 floor）
    const r = A - q * n;
    const z = [...rows].sort((p, s) => cmpUuidBytes(p.u, s.u));
    for (let i = 0; i < z.length; i++) {
      const rn = BigInt(i + 1);
      if (BigInt(z[i].a) !== q + (rn <= r ? 1n : 0n)) return "expense_split_mismatch";
    }
    return null;
  }
  if (method === "percent") {
    if (rows.reduce((s, r) => s + r.b, 0) !== 10000) return "expense_percent_mismatch";
    const leftover = A - rows.reduce((s, r) => s + (A * BigInt(r.b)) / 10000n, 0n);
    const z = rows
      .map((r) => ({ ...r, base: (A * BigInt(r.b)) / 10000n, rem: (A * BigInt(r.b)) % 10000n }))
      .sort((p, s) => (p.rem !== s.rem ? (p.rem > s.rem ? -1 : 1) : cmpUuidBytes(p.u, s.u)));
    for (let i = 0; i < z.length; i++) {
      const rn = BigInt(i + 1);
      if (BigInt(z[i].a) !== z[i].base + (rn <= leftover ? 1n : 0n)) return "expense_split_mismatch";
    }
    return null;
  }
  return null; // exact：僅檢查總和
}
/** 隨機 bp 分配，總和 10000；mode 控制是否製造大量同餘數。 */
function randBps(n) {
  const mode = randInt(0, 3);
  if (mode === 0) {
    // 平均 + 零頭
    const q = Math.floor(10000 / n);
    const bps = Array(n).fill(q);
    for (let i = 0; i < 10000 - q * n; i++) bps[i] += 1;
    return shuffle(bps);
  }
  if (mode === 1 && n >= 2) {
    // 含 0 bp 的人
    const bps = Array(n).fill(0);
    const k = randInt(1, n);
    for (let i = 0; i < 10000; i++) bps[randInt(0, k - 1)] += 1;
    return shuffle(bps);
  }
  // 隨機切點
  const cuts = [0, 10000];
  for (let i = 0; i < n - 1; i++) cuts.push(randInt(0, 10000));
  cuts.sort((a, b) => a - b);
  return shuffle(cuts.slice(1).map((c, i) => c - cuts[i]));
}
function randAmount() {
  const mode = randInt(0, 4);
  if (mode === 0) return randInt(1, 100);
  if (mode === 1) return randInt(1, 1_000_000);
  if (mode === 2) return 10_000_000_000_000 - randInt(0, 1000);
  if (mode === 3) return randInt(1, 2 ** 30) * randInt(1, 9000) + randInt(0, 9999);
  return pick([1, 2, 3, 7, 9999, 10000, 10001, 99999, 10_000_000_000_000]);
}

// ── 斷言輔助 ──
function sharesOf(r) {
  assert.ok(r.ok, "預期成功，實際：" + JSON.stringify(r));
  return r.shares.map((s) => s.share_minor);
}
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// ═══════════════════════════════════════════════════════════════════════════
check("M1 src/lib/money 不 import \"@/...\"，相對 import 皆為同目錄 .ts", () => {
  const files = readdirSync(MONEY_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of ["iso4217.ts", "currency-list.ts", "money-parse.ts", "money-format.ts", "split.ts", "settle.ts"]) {
    assert.ok(files.includes(f), `缺少 ${f}`);
  }
  for (const f of files) {
    const src = readFileSync(join(MONEY_DIR, f), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(!spec.startsWith("@/"), `${f} import ${spec}`);
      assert.match(spec, /^\.\/[\w-]+\.ts$/, `${f} import ${spec} 不是同目錄 .ts（Node 直接執行會失敗）`);
    }
  }
});

check("M2 iso4217 小數位：常用 11 種 + IQD3/LBP2/BHD3/KWD3/CLF4", () => {
  const expected = {
    TWD: 2, JPY: 0, USD: 2, KRW: 0, EUR: 2, GBP: 2, AUD: 2, HKD: 2, CNY: 2, SGD: 2, THB: 2,
    IQD: 3, LBP: 2, BHD: 3, KWD: 3, CLF: 4,
    // 其他易錯者
    JOD: 3, OMR: 3, TND: 3, LYD: 3, ISK: 0, VND: 0, CLP: 0, UYW: 4, IDR: 2, HUF: 2,
  };
  for (const [code, exp] of Object.entries(expected)) {
    assert.equal(iso.getIsoCurrencyExponent(code), exp, code);
  }
  assert.equal(iso.getIsoCurrencyExponent("twd"), 2, "小寫代碼");
  assert.equal(iso.getIsoCurrencyExponent(" jpy "), 0, "含空白");
  assert.equal(iso.getIsoCurrencyExponent("XAU"), undefined, "XAU 不應收錄");
  assert.equal(iso.getIsoCurrencyExponent("ABC"), undefined);
  const codes = iso.ISO_4217_CURRENCIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length, "代碼重複");
  for (const c of iso.ISO_4217_CURRENCIES) {
    assert.match(c.code, /^[A-Z]{3}$/);
    assert.match(c.numeric, /^\d{3}$/);
    assert.ok(iso.isValidCurrencyExponent(c.exponent), c.code);
  }
  assert.deepEqual(list.COMMON_CURRENCY_CODES, ["TWD", "JPY", "USD", "KRW", "EUR", "GBP", "AUD", "HKD", "CNY", "SGD", "THB"]);
});

// ═══════════════════════════════════════════════════════════════════════════
function withIntlPatch(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) {
    saved[k] = Object.getOwnPropertyDescriptor(Intl, k);
    if (patch[k] === undefined) delete Intl[k];
    else Object.defineProperty(Intl, k, { value: patch[k], configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (saved[k]) Object.defineProperty(Intl, k, saved[k]);
      else delete Intl[k];
    }
  }
}

check("M3a currency-list：Node 實際 Intl → 結果 ⊆ ISO ∩ supportedValuesOf，常用 11 種齊全，小數位取 ISO", () => {
  assert.equal(typeof Intl.supportedValuesOf, "function", "此 Node 應有 supportedValuesOf");
  const supported = new Set(Intl.supportedValuesOf("currency"));
  const all = list.getSelectableCurrencies("en");
  const codes = all.map((c) => c.code);
  assert.deepEqual(codes, [...codes].sort(), "未依代碼排序");
  for (const c of all) {
    assert.ok(supported.has(c.code), `${c.code} 不在 supportedValuesOf`);
    assert.equal(c.exponent, iso.getIsoCurrencyExponent(c.code), `${c.code} 小數位不是 ISO`);
  }
  const expectedCodes = iso.ISO_4217_CURRENCIES.map((c) => c.code).filter((c) => supported.has(c)).sort();
  assert.deepEqual(codes, expectedCodes, "不是 ISO ∩ supportedValuesOf");
  assert.deepEqual(list.getCommonCurrencies("en").map((c) => c.code), list.COMMON_CURRENCY_CODES);
  assert.equal(list.getCurrencyDisplayName("JPY", "en"), "Japanese Yen");
  assert.equal(list.getCurrencyDisplayName("twd", "zh-TW"), "新台幣");
});

check("M3b currency-list：supportedValuesOf 為子集合（含非 ISO 代碼與小寫）→ 取交集", () => {
  const r = withIntlPatch({ supportedValuesOf: () => ["USD", "jpy", "XAU", "ABC", "TWD"] }, () =>
    list.getSelectableCurrencies("en").map((c) => c.code),
  );
  assert.deepEqual(r, ["JPY", "TWD", "USD"]);
  const common = withIntlPatch({ supportedValuesOf: () => ["USD", "TWD"] }, () =>
    list.getCommonCurrencies("en").map((c) => c.code),
  );
  assert.deepEqual(common, ["TWD", "USD"], "常用清單應略過不支援者並維持順序");
});

check("M3c iOS 15：刪除 Intl.supportedValuesOf → 退回完整 ISO 表；丟例外時亦同", () => {
  const isoCodes = iso.ISO_4217_CURRENCIES.map((c) => c.code).sort();
  const r = withIntlPatch({ supportedValuesOf: undefined }, () => {
    assert.equal("supportedValuesOf" in Intl, false, "未成功刪除");
    return list.getSelectableCurrencies("zh-TW");
  });
  assert.deepEqual(r.map((c) => c.code), isoCodes);
  assert.equal(r.find((c) => c.code === "IQD").exponent, 3);
  assert.deepEqual(
    withIntlPatch({ supportedValuesOf: undefined }, () => list.getCommonCurrencies("ja").map((c) => c.code)),
    list.COMMON_CURRENCY_CODES,
  );
  const thrown = withIntlPatch(
    { supportedValuesOf: () => { throw new RangeError("x"); } },
    () => list.getSelectableCurrencies().map((c) => c.code),
  );
  assert.deepEqual(thrown, isoCodes);
  assert.equal(typeof Intl.supportedValuesOf, "function", "還原失敗");
});

check("M3d DisplayNames 不可用（刪除／建構丟例外）→ 名稱退回代碼", () => {
  const r = withIntlPatch({ DisplayNames: undefined }, () => ({
    all: list.getSelectableCurrencies("zh-TW"),
    one: list.getCurrencyDisplayName("twd", "zh-TW"),
  }));
  for (const c of r.all) assert.equal(c.name, c.code);
  assert.equal(r.one, "TWD");
  class Boom { constructor() { throw new RangeError("unsupported"); } }
  assert.equal(withIntlPatch({ DisplayNames: Boom }, () => list.getCurrencyDisplayName("JPY", "ja")), "JPY");
  class Empty { of() { return undefined; } }
  assert.equal(withIntlPatch({ DisplayNames: Empty }, () => list.getCurrencyDisplayName("KRW", "ko")), "KRW");
  assert.equal(list.getCurrencyDisplayName("JPY", "ja"), "日本円", "還原後應恢復");
});

// ═══════════════════════════════════════════════════════════════════════════
const P = (s, e) => parse.parseMoneyInput(s, e);
const okMinor = (s, e, minor) => assert.deepEqual(P(s, e), { ok: true, minor }, `parse(${JSON.stringify(s)}, ${e})`);
const fail = (s, e, reason) => assert.deepEqual(P(s, e), { ok: false, reason }, `parse(${JSON.stringify(s)}, ${e})`);

check("M4a money-parse：施工指令案例（JPY 12.5 拒、BHD 1.234→1234、CLF 4 位、JPY 1000.00→1000）", () => {
  fail("12.5", 0, "too_many_decimals");
  okMinor("1.234", iso.getIsoCurrencyExponent("BHD"), 1234);
  assert.equal(iso.getIsoCurrencyExponent("BHD"), 3);
  okMinor("1.2345", 4, 12345);
  fail("1.23456", 4, "too_many_decimals");
  okMinor("1.23450", 4, 12345);
  okMinor("1000.00", 0, 1000);
  okMinor("1,000", 0, 1000);
  okMinor("1000.", 0, 1000);
  fail("1000.01", 0, "too_many_decimals");
  okMinor("1.2", 3, 1200);
});

check("M4b money-parse：千分位格式、空白、正負號、0", () => {
  okMinor("1,234,567.89", 2, 123456789);
  okMinor("  12.30 ", 2, 1230);
  okMinor("+5", 2, 500);
  okMinor(".5", 2, 50);
  okMinor("007", 0, 7);
  for (const bad of ["1,00", "1,0000", ",100", "100,", "1,,000", "12,34.5", "1.000,5", "1 000", "1e3", "0x10", "abc", ".", "1.2.3", "１０００", "Infinity", "NaN", "$100", "+-1", "--1", "1_000"]) {
    fail(bad, 2, "invalid_format");
  }
  fail("", 2, "empty");
  fail("   ", 2, "empty");
  fail("0", 2, "not_positive");
  fail("0.00", 2, "not_positive");
  fail("0.000", 2, "not_positive");
  fail("-1", 2, "not_positive");
  fail("-0.5", 2, "not_positive");
  fail("-abc", 2, "invalid_format");
  fail("0.001", 2, "too_many_decimals");
  fail("1", 5, "invalid_exponent");
  fail("1", -1, "invalid_exponent");
  fail("1", 1.5, "invalid_exponent");
  assert.deepEqual(parse.parseMoneyInput(undefined, 2), { ok: false, reason: "empty" });
  assert.deepEqual(parse.parseMoneyInput(123, 2), { ok: false, reason: "empty" });
});

check("M4c money-parse：上限 10^13（含）、超大輸入不經浮點、safe integer", () => {
  assert.equal(parse.MAX_AMOUNT_MINOR, 10_000_000_000_000);
  okMinor("10000000000000", 0, 1e13);
  okMinor("10,000,000,000,000", 0, 1e13);
  fail("10000000000001", 0, "too_large");
  okMinor("100000000000", 2, 1e13);
  fail("100000000000.01", 2, "too_large");
  okMinor("1000000000", 4, 1e13);
  fail("9".repeat(400), 0, "too_large");
  fail("9007199254740993", 0, "too_large");
  // 浮點陷阱：0.1+0.2 類、3 位小數
  okMinor("0.07", 2, 7);
  okMinor("1.005", 3, 1005);
  okMinor("4.35", 2, 435); // 4.35*100 = 434.99999999999994
  okMinor("1.15", 2, 115); // 1.15*100 = 114.99999999999999
  okMinor("9999999999.99", 2, 999999999999);
  okMinor("99999999999.99", 2, 9999999999999);
});

check("M4d money-parse：隨機 property（minor → 十進位字串 → parse 回原值，exponent 0–4）", () => {
  for (let i = 0; i < 3000; i++) {
    const e = randInt(0, 4);
    const minor = randInt(1, 2) === 1 ? randInt(1, 1_000_000) : 10_000_000_000_000 - randInt(0, 1e9);
    const s = parse.minorToDecimalString(minor, e);
    assert.deepEqual(P(s, e), { ok: true, minor }, `${minor}/${e} → ${s}`);
    // 加千分位
    const [ip, fp] = s.split(".");
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fp ? "." + fp : "");
    assert.deepEqual(P(grouped, e), { ok: true, minor }, `grouped ${grouped}`);
  }
  assert.equal(parse.minorToDecimalString(-1234, 2), "-12.34");
  assert.equal(parse.minorToDecimalString(5, 3), "0.005");
  assert.equal(parse.minorToDecimalString(1200, 2), "12");
  assert.equal(parse.minorToDecimalString(1230, 2), "12.30");
});

// ═══════════════════════════════════════════════════════════════════════════
const F = (minor, cur, exp, opt) => fmt.formatMoney(minor, cur, exp, opt);
const norm = (s) => s.replace(/[  ]/g, " ");
check("M5a money-format：zh-TW／en／ja／ko 輸出", () => {
  const cases = [
    [[100000, "TWD", 2, { locale: "zh-TW" }], "$1,000"],
    [[100050, "TWD", 2, { locale: "zh-TW" }], "$1,000.50"],
    [[100000, "TWD", 2, { locale: "zh-TW", showCode: true }], "$1,000 TWD"],
    [[1050, "USD", 2, { locale: "zh-TW", showCode: true }], "US$10.50 USD"],
    [[1050, "USD", 2, { locale: "en" }], "$10.50"],
    [[1000, "USD", 2, { locale: "en" }], "$10"],
    [[100000, "TWD", 2, { locale: "en" }], "NT$1,000"],
    [[1000, "JPY", 0, { locale: "ja" }], "￥1,000"],
    [[1000, "JPY", 0, { locale: "en" }], "¥1,000"],
    [[50000, "KRW", 0, { locale: "ko" }], "₩50,000"],
    [[1234, "BHD", 3, { locale: "en" }], "BHD 1.234"],
    [[12345, "CLF", 4, { locale: "en" }], "CLF 1.2345"],
    [[1000, "BHD", 3, { locale: "en" }], "BHD 1"],
    [[1100, "BHD", 3, { locale: "en" }], "BHD 1.100"],
    [[1000, "JPY", 0, { locale: "ja", showSymbol: false, showCode: true }], "1,000 JPY"],
    [[-2550, "EUR", 2, { locale: "en" }], "-€25.50"],
  ];
  const errs = [];
  for (const [args, want] of cases) {
    const got = norm(F(...args));
    console.log(`     format(${args.slice(0, 3).join(", ")}, ${JSON.stringify(args[3])}) → ${got}`);
    if (got !== want) errs.push(`${JSON.stringify(args)}：預期 ${want}，實際 ${got}`);
  }
  assert.equal(errs.length, 0, errs.join("\n"));
});

check("M5b money-format：IQD 用 ISO 3 位（不是 Intl 的 0 位）、LBP 2 位", () => {
  assert.equal(norm(F(1500, "IQD", 3, { locale: "en" })), "IQD 1.500");
  assert.equal(norm(F(1000, "IQD", 3, { locale: "en" })), "IQD 1");
  assert.equal(norm(F(150, "LBP", 2, { locale: "en" })), "LBP 1.50");
});

check("M5c shouldShowCurrencyCode：兩種以上（大小寫／空白視為同一種）才為 true", () => {
  assert.equal(fmt.shouldShowCurrencyCode([]), false);
  assert.equal(fmt.shouldShowCurrencyCode(["TWD", "twd", " TWD "]), false);
  assert.equal(fmt.shouldShowCurrencyCode(["TWD", "USD"]), true);
  assert.equal(fmt.shouldShowCurrencyCode(new Set(["JPY", "KRW", "TWD"])), true);
});

check("M5d money-format：非法 minor／exponent 丟 RangeError（不默默輸出錯誤金額）", () => {
  assert.throws(() => F(1.5, "USD", 2), RangeError);
  assert.throws(() => F(100, "USD", 5), RangeError);
  assert.throws(() => F(2 ** 53, "USD", 2), RangeError);
});

check("M5e money-format：大額（safe integer 範圍內）小數位不失真", () => {
  // 淨額為多筆加總（單筆上限 10^13，行程最多 2000 筆），可超過 10^15；
  // formatMoney 以 Number(decimal) 交給 Intl，超過 double 有效位數時最後一位會被改掉。
  const errs = [];
  for (const [minor, cur, e, want] of [
    [9007199254740991, "CLF", 4, "CLF 900,719,925,474.0991"],
    [9007199254740991, "USD", 2, "$90,071,992,547,409.91"],
    [1234567890123457, "USD", 2, "$12,345,678,901,234.57"],
  ]) {
    const got = norm(F(minor, cur, e, { locale: "en" }));
    if (got !== want) errs.push(`formatMoney(${minor}, ${cur}, ${e})：預期 ${want}，實際 ${got}`);
  }
  assert.equal(errs.length, 0, errs.join("\n"));
});

// ═══════════════════════════════════════════════════════════════════════════
const U = randUuids(3);
check("M6a split equal：¥1,000 三人 → 334／333／333（依 user_id 排序）", () => {
  const ids = ["cccccccc-0000-4000-8000-000000000000", "aaaaaaaa-0000-4000-8000-000000000000", "bbbbbbbb-0000-4000-8000-000000000000"];
  const r = split.splitEqual(1000, ids);
  assert.deepEqual(r.shares.map((s) => s.user_id), [ids[1], ids[2], ids[0]]);
  assert.deepEqual(sharesOf(r), [334, 333, 333]);
  assert.ok(r.shares.every((s) => s.percent_bp === null));
  assert.deepEqual(sharesOf(split.splitEqual(1001, ids)), [334, 334, 333]);
  assert.deepEqual(sharesOf(split.splitEqual(2, ids)), [1, 1, 0]);
  assert.deepEqual(sharesOf(split.splitEqual(1, ids)), [1, 0, 0]);
});

check("M6b split percent：US$100 bp 3333／3333／3334 → 3333／3333／3334 minor", () => {
  const ids = [...U].sort();
  const r = split.splitPercent(10000, [
    { user_id: ids[2], percent_bp: 3334 },
    { user_id: ids[0], percent_bp: 3333 },
    { user_id: ids[1], percent_bp: 3333 },
  ]);
  assert.deepEqual(r.shares, [
    { user_id: ids[0], share_minor: 3333, percent_bp: 3333 },
    { user_id: ids[1], share_minor: 3333, percent_bp: 3333 },
    { user_id: ids[2], share_minor: 3334, percent_bp: 3334 },
  ]);
  // 零頭：$1.00 三人 3333/3333/3334 → base 33/33/33，rem 3300/3300/3400 → leftover 1 給 rem 最大者
  assert.deepEqual(
    sharesOf(split.splitPercent(100, [
      { user_id: ids[0], percent_bp: 3333 },
      { user_id: ids[1], percent_bp: 3333 },
      { user_id: ids[2], percent_bp: 3334 },
    ])),
    [33, 33, 34],
  );
  // 同餘數依 user_id：100 minor、bp 5000/5000 無零頭；101 minor → 50.5/50.5 → 第一位 +1
  assert.deepEqual(sharesOf(split.splitPercent(101, [{ user_id: ids[1], percent_bp: 5000 }, { user_id: ids[0], percent_bp: 5000 }])), [51, 50]);
});

check("M6c split percent：大金額 10^13 不溢位（與 BigInt 精確值一致）", () => {
  const ids = [...randUuids(3)].sort();
  const T = 10_000_000_000_000;
  const r = split.splitPercent(T, ids.map((u, i) => ({ user_id: u, percent_bp: [3333, 3333, 3334][i] })));
  assert.deepEqual(sharesOf(r), [3_333_000_000_000, 3_333_000_000_000, 3_334_000_000_000]);
  const T2 = 9_999_999_999_999;
  const r2 = split.splitPercent(T2, ids.map((u, i) => ({ user_id: u, percent_bp: [1, 4999, 5000][i] })));
  const s2 = sharesOf(r2);
  assert.equal(sum(s2), T2);
  assert.equal(sqlValidate("percent", T2, ids.map((u, i) => ({ u, a: s2[i], b: [1, 4999, 5000][i] }))), null);
  assert.ok(s2.every((x) => Number.isSafeInteger(x)));
  assert.deepEqual(split.splitPercent(T + 1, [{ user_id: ids[0], percent_bp: 10000 }]), { ok: false, reason: "invalid_amount" });
});

check("M6d split 拒絕：bp 總和≠10000、bp 非整數／負數、重複（大小寫不同視為同一人）、空、>50 人、金額非法", () => {
  const [a, b] = randUuids(2);
  assert.equal(split.splitPercent(100, [{ user_id: a, percent_bp: 5000 }, { user_id: b, percent_bp: 4999 }]).reason, "percent_sum_mismatch");
  assert.equal(split.splitPercent(100, [{ user_id: a, percent_bp: 5000.5 }, { user_id: b, percent_bp: 4999.5 }]).reason, "invalid_percent");
  assert.equal(split.splitPercent(100, [{ user_id: a, percent_bp: -1 }, { user_id: b, percent_bp: 10001 }]).reason, "invalid_percent");
  assert.equal(split.splitEqual(100, [a, a.toUpperCase()]).reason, "duplicate_participant");
  assert.equal(sqlValidate("equal", 100, [{ u: a, a: 50 }, { u: a.toUpperCase(), a: 50 }]), "expense_duplicate_participant");
  assert.equal(split.splitEqual(100, []).reason, "no_participants");
  assert.equal(split.splitEqual(100, randUuids(51)).reason, "too_many_participants");
  assert.ok(split.splitEqual(100, randUuids(50)).ok);
  for (const bad of [0, -1, 1.5, NaN, 1e13 + 1, 2 ** 53]) assert.equal(split.splitEqual(bad, [a]).reason, "invalid_amount", String(bad));
});

check("M6e split exact：總和相等才 ok；difference 正＝還差、負＝超出", () => {
  const [a, b, c] = [...randUuids(3)].sort();
  const ok = split.checkExactSplit(1000, [{ user_id: c, share_minor: 500 }, { user_id: a, share_minor: 300 }, { user_id: b, share_minor: 200 }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.difference, 0);
  assert.deepEqual(ok.shares.map((s) => s.user_id), [a, b, c]);
  const under = split.checkExactSplit(1000, [{ user_id: a, share_minor: 300 }, { user_id: b, share_minor: 200 }]);
  assert.deepEqual([under.ok, under.reason, under.sum, under.difference], [false, "exact_sum_mismatch", 500, 500]);
  const over = split.checkExactSplit(1000, [{ user_id: a, share_minor: 900 }, { user_id: b, share_minor: 200 }]);
  assert.deepEqual([over.ok, over.reason, over.difference], [false, "exact_sum_mismatch", -100]);
  assert.equal(split.checkExactSplit(1000, [{ user_id: a, share_minor: -1 }, { user_id: b, share_minor: 1001 }]).reason, "invalid_share");
  assert.equal(split.checkExactSplit(1000, [{ user_id: a, share_minor: 0.5 }, { user_id: b, share_minor: 999.5 }]).reason, "invalid_share");
  assert.equal(split.checkExactSplit(1000, [{ user_id: a, share_minor: 1000 }, { user_id: a.toUpperCase(), share_minor: 0 }]).reason, "duplicate_participant");
  assert.deepEqual(split.splitExact(1000, [{ user_id: a, share_minor: 1000 }]), { ok: true, shares: [{ user_id: a, share_minor: 1000, percent_bp: null }] });
  assert.equal(split.splitExact(1000, [{ user_id: a, share_minor: 999 }]).reason, "exact_sum_mismatch");
});

check("M6f evenPercentBp：總和 10000、依 equal 規則", () => {
  const ids = randUuids(3);
  const bps = split.evenPercentBp(ids);
  assert.deepEqual(bps.map((x) => x.percent_bp), [3334, 3333, 3333]);
  assert.equal(sum(bps.map((x) => x.percent_bp)), 10000);
  assert.ok(split.splitPercent(10000, bps).ok);
  assert.deepEqual(split.evenPercentBp([]), []);
});

// ═══════════════════════════════════════════════════════════════════════════
const N_PROP = 4000;
check(`M7a equal 與 SQL 演算法對照（${N_PROP} 組隨機、混合大小寫 uuid、1–50 人）`, () => {
  for (let i = 0; i < N_PROP; i++) {
    const n = rnd() < 0.8 ? randInt(1, 8) : randInt(9, 50);
    const ids = randUuids(n, rnd() < 0.3);
    const amount = randAmount();
    const r = split.splitEqual(amount, ids);
    assert.ok(r.ok, `#${i} ${amount} n=${n} → ${JSON.stringify(r)}`);
    const rows = r.shares.map((s) => ({ u: s.user_id, a: s.share_minor }));
    const err = sqlValidate("equal", amount, rows);
    assert.equal(err, null, `#${i} SQL 拒絕 JS 結果 amount=${amount} n=${n} → ${err}`);
    // 非空洞：移動 1 單位後 SQL 必拒
    if (n >= 2) {
      const j = randInt(0, n - 1);
      let k = randInt(0, n - 1);
      if (k === j) k = (k + 1) % n;
      if (rows[j].a > 0 && rows[k].a + 1 !== rows[j].a) {
        const mutated = rows.map((x) => ({ ...x }));
        mutated[j].a -= 1;
        mutated[k].a += 1;
        assert.equal(sqlValidate("equal", amount, mutated), "expense_split_mismatch", `#${i} 參考實作未拒絕擾動`);
      }
    }
  }
});

check(`M7b percent 與 SQL 演算法對照（${N_PROP} 組隨機 bp，含大量同餘數、0 bp、10^13）`, () => {
  let ties = 0;
  for (let i = 0; i < N_PROP; i++) {
    const n = rnd() < 0.8 ? randInt(1, 8) : randInt(9, 50);
    const ids = randUuids(n, rnd() < 0.3);
    const bps = randBps(n);
    const amount = randAmount();
    const input = ids.map((u, k) => ({ user_id: u, percent_bp: bps[k] }));
    const r = split.splitPercent(amount, input);
    assert.ok(r.ok, `#${i} → ${JSON.stringify(r)}`);
    const rows = r.shares.map((s) => ({ u: s.user_id, a: s.share_minor, b: s.percent_bp }));
    const err = sqlValidate("percent", amount, rows);
    assert.equal(err, null, `#${i} SQL 拒絕 JS 結果 amount=${amount} bps=${bps} → ${err}`);
    const rems = rows.map((x) => (BigInt(amount) * BigInt(x.b)) % 10000n);
    if (new Set(rems.map(String)).size < rems.length) ties += 1;
    if (n >= 2) {
      const j = rows.findIndex((x) => x.a > 0);
      const k = (j + 1) % n;
      const mutated = rows.map((x) => ({ ...x }));
      mutated[j].a -= 1;
      mutated[k].a += 1;
      assert.equal(sqlValidate("percent", amount, mutated), "expense_split_mismatch", `#${i} 參考實作未拒絕擾動`);
    }
  }
  assert.ok(ties > N_PROP / 10, `同餘數案例太少（${ties}），未覆蓋 user_id 決勝`);
  console.log(`     （資訊）其中 ${ties} 組含同餘數，需以 user_id 決勝`);
});

check("M7c compareUserId 與 uuid 位元組順序一致（含大小寫混合）", () => {
  for (let i = 0; i < 4000; i++) {
    const [a, b] = randUuids(2, true);
    assert.equal(Math.sign(split.compareUserId(a, b)), Math.sign(cmpUuidBytes(a, b)), `${a} vs ${b}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
const S = (records, members) => settle.computeSettlements(records, members);
function exp(currency, exponent, amount, payers, shares, extra = {}) {
  return {
    kind: "expense",
    currency,
    currency_exponent: exponent,
    amount_minor: amount,
    payers: payers.map(([user_id, amount_minor]) => ({ user_id, amount_minor })),
    shares: shares.map(([user_id, share_minor]) => ({ user_id, share_minor })),
    ...extra,
  };
}
function stl(currency, exponent, from, to, amount, extra = {}) {
  return exp(currency, exponent, amount, [[from, amount]], [[to, amount]], { kind: "settlement", ...extra });
}
/** 套用建議轉帳後每人淨額歸零；轉帳筆數 ≤ 有餘額人數−1；方向正確。 */
function assertSettles(cs) {
  const nets = new Map(cs.members.map((m) => [m.user_id, BigInt(m.net_minor)]));
  const total = [...nets.values()].reduce((s, x) => s + x, 0n);
  assert.equal(total, 0n, `${cs.currency} 淨額總和 ≠ 0`);
  const nonzero = [...nets.values()].filter((x) => x !== 0n).length;
  assert.ok(cs.transfers.length <= Math.max(0, nonzero - 1), `${cs.currency} 轉帳 ${cs.transfers.length} 筆 > 有餘額人數−1（${nonzero - 1}）`);
  assert.ok(cs.transfers.length <= Math.max(0, cs.members.length - 1));
  for (const t of cs.transfers) {
    assert.ok(t.amount_minor > 0, "轉帳金額需 > 0");
    assert.notEqual(t.from_user_id, t.to_user_id);
    assert.ok(nets.get(t.from_user_id) < 0n, "付款方不是欠款人");
    assert.ok(nets.get(t.to_user_id) > 0n, "收款方不是墊款人");
    nets.set(t.from_user_id, nets.get(t.from_user_id) + BigInt(t.amount_minor));
    nets.set(t.to_user_id, nets.get(t.to_user_id) - BigInt(t.amount_minor));
  }
  for (const [u, v] of nets) assert.equal(v, 0n, `${cs.currency} ${u} 套用轉帳後未歸零（${v}）`);
}

const [A, B, C, D] = ["aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003", "dddddddd-0000-4000-8000-000000000004"];

check("M8a settle：兩幣別各自歸零、互不相加；轉帳 ≤ 人數−1", () => {
  const recs = [
    exp("JPY", 0, 3000, [[A, 3000]], [[A, 1000], [B, 1000], [C, 1000]]),
    exp("TWD", 2, 90000, [[B, 90000]], [[A, 30000], [B, 30000], [C, 30000]]),
    exp("jpy", 0, 1000, [[C, 1000]], [[A, 334], [B, 333], [C, 333]]),
  ];
  const out = S(recs);
  assert.deepEqual(out.map((c) => c.currency), ["JPY", "TWD"]);
  const jpy = out[0];
  const twd = out[1];
  assert.deepEqual(jpy.members.map((m) => [m.user_id, m.net_minor]), [[A, 3000 - 1334], [B, -1333], [C, 1000 - 1333]]);
  assert.deepEqual(twd.members.map((m) => [m.user_id, m.net_minor]), [[A, -30000], [B, 60000], [C, -30000]]);
  assert.deepEqual(twd.transfers, [
    { from_user_id: A, to_user_id: B, amount_minor: 30000 },
    { from_user_id: C, to_user_id: B, amount_minor: 30000 },
  ]);
  for (const cs of out) assertSettles(cs);
  assert.equal(jpy.currency_exponent, 0);
  assert.equal(twd.currency_exponent, 2);
  assert.equal(jpy.precision_exceeded, false);
});

check("M8b settle：settlement 沖銷後淨額為 0；deleted_at 不計", () => {
  const base = [exp("USD", 2, 3000, [[A, 3000]], [[A, 1000], [B, 1000], [C, 1000]])];
  const before = S(base)[0];
  assert.deepEqual(before.transfers, [
    { from_user_id: B, to_user_id: A, amount_minor: 1000 },
    { from_user_id: C, to_user_id: A, amount_minor: 1000 },
  ]);
  const after = S([...base, stl("USD", 2, B, A, 1000), stl("USD", 2, C, A, 1000)])[0];
  assert.ok(after.members.every((m) => m.net_minor === 0), JSON.stringify(after.members));
  assert.deepEqual(after.transfers, []);
  const b = after.members.find((m) => m.user_id === B);
  assert.deepEqual([b.paid_minor, b.owed_minor, b.settlement_sent_minor, b.settlement_received_minor], [0, 1000, 1000, 0]);
  const a = after.members.find((m) => m.user_id === A);
  assert.equal(a.settlement_received_minor, 2000);
  // 部分還款
  const partial = S([...base, stl("USD", 2, B, A, 400)])[0];
  assert.deepEqual(partial.members.map((m) => m.net_minor), [1600, -600, -1000]);
  assertSettles(partial);
  // 已刪除紀錄不計（含已刪除的 settlement）
  const del = S([...base, stl("USD", 2, B, A, 1000, { deleted_at: "2026-11-02T00:00:00Z" }), exp("USD", 2, 999999, [[D, 999999]], [[A, 999999]], { deleted_at: "2026-11-02T00:00:00Z" })])[0];
  assert.deepEqual(del.members.map((m) => [m.user_id, m.net_minor]), before.members.map((m) => [m.user_id, m.net_minor]));
  // 全部被刪除的幣別不出現
  assert.deepEqual(S([exp("EUR", 2, 100, [[A, 100]], [[B, 100]], { deleted_at: "x" })]), []);
  // memberIds：沒有紀錄的成員顯示 0
  const withMembers = S(base, [D.toUpperCase()])[0];
  assert.deepEqual(withMembers.members.find((m) => m.user_id === D)?.net_minor, 0);
});

check("M8c settle：同額依 user_id 配對（決定性）", () => {
  const recs = [exp("TWD", 2, 400, [[D, 200], [C, 200]], [[A, 100], [B, 100], [C, 100], [D, 100]])];
  const out = S(recs)[0];
  assert.deepEqual(out.transfers, [
    { from_user_id: A, to_user_id: C, amount_minor: 100 },
    { from_user_id: B, to_user_id: D, amount_minor: 100 },
  ]);
  assertSettles(out);
});

check("M8d settle：超過 safe integer 時 precision_exceeded=true", () => {
  const recs = Array.from({ length: 1000 }, () => exp("JPY", 0, 1e13, [[A, 1e13]], [[B, 1e13]]));
  const out = S(recs)[0];
  assert.equal(out.precision_exceeded, true);
});

function randRecords(nCurrencies, nMembers, nRecords) {
  const members = randUuids(nMembers, true);
  const curs = shuffle([["TWD", 2], ["JPY", 0], ["USD", 2], ["BHD", 3], ["CLF", 4], ["KRW", 0]]).slice(0, nCurrencies);
  const recs = [];
  for (let i = 0; i < nRecords; i++) {
    const [cur, e] = pick(curs);
    const deleted = rnd() < 0.1 ? "2026-11-01T00:00:00Z" : null;
    if (rnd() < 0.2 && nMembers >= 2) {
      const [f, t] = shuffle(members).slice(0, 2);
      recs.push(stl(cur, e, f, t, randInt(1, 50000), { deleted_at: deleted }));
      continue;
    }
    const amount = rnd() < 0.05 ? randInt(1e12, 1e13) : randInt(1, 1_000_000);
    const payersN = randInt(1, Math.min(3, nMembers));
    const payerIds = shuffle(members).slice(0, payersN);
    const pa = split.splitEqual(amount, payerIds);
    const sharers = shuffle(members).slice(0, randInt(1, nMembers));
    const shBps = randBps(sharers.length);
    const sh = rnd() < 0.5 ? split.splitEqual(amount, sharers) : split.splitPercent(amount, sharers.map((u, k) => ({ user_id: u, percent_bp: shBps[k] })));
    assert.ok(pa.ok && sh.ok);
    recs.push(exp(cur, e, amount, pa.shares.filter((s) => s.share_minor > 0).map((s) => [s.user_id, s.share_minor]), sh.shares.map((s) => [s.user_id, s.share_minor]), { deleted_at: deleted }));
  }
  return { recs, members };
}

check("M8e settle：隨機 property（500 組、1–4 幣別、2–12 人）淨額和 0、轉帳歸零、≤ 有餘額人數−1、每幣別獨立", () => {
  for (let i = 0; i < 500; i++) {
    const { recs } = randRecords(randInt(1, 4), randInt(2, 12), randInt(1, 40));
    const out = S(recs);
    for (const cs of out) assertSettles(cs);
    // 每幣別獨立：只算該幣別的紀錄 → 結果相同
    for (const cs of out) {
      const only = S(recs.filter((r) => r.currency === cs.currency));
      assert.deepEqual(only, [cs], `#${i} ${cs.currency} 受其他幣別影響`);
    }
    const live = new Set(recs.filter((r) => !r.deleted_at).map((r) => r.currency));
    assert.deepEqual(out.map((c) => c.currency).sort(), [...live].sort());
  }
});

// ═══════════════════════════════════════════════════════════════════════════
check("M9a 順序無關：split equal／percent／exact 打亂 200 次結果相同", () => {
  const ids = randUuids(7, true);
  const bps = randBps(7);
  const exactShares = ids.map((u, i) => ({ user_id: u, share_minor: i * 10 }));
  const exactTotal = sum(exactShares.map((x) => x.share_minor));
  const e0 = split.splitEqual(1_000_003, ids);
  const p0 = split.splitPercent(9_999_999_999_997, ids.map((u, i) => ({ user_id: u, percent_bp: bps[i] })));
  const x0 = split.checkExactSplit(exactTotal + 7, exactShares);
  for (let i = 0; i < 200; i++) {
    const perm = shuffle(ids.map((_, k) => k));
    assert.deepEqual(split.splitEqual(1_000_003, perm.map((k) => ids[k])), e0);
    assert.deepEqual(split.splitPercent(9_999_999_999_997, perm.map((k) => ({ user_id: ids[k], percent_bp: bps[k] }))), p0);
    assert.deepEqual(split.checkExactSplit(exactTotal + 7, perm.map((k) => exactShares[k])), x0);
  }
});

check("M9b 順序無關：settle 打亂紀錄／payers／shares／memberIds 各 50 次（共 100 組資料）結果相同", () => {
  for (let i = 0; i < 100; i++) {
    const { recs, members } = randRecords(randInt(1, 3), randInt(2, 10), randInt(1, 30));
    const ref = S(recs, members);
    for (let k = 0; k < 50; k++) {
      const shuffled = shuffle(recs).map((r) => ({ ...r, payers: shuffle(r.payers), shares: shuffle(r.shares) }));
      assert.deepEqual(S(shuffled, shuffle(members)), ref, `#${i}/${k}`);
    }
  }
});

console.log(`\n總結：${passed} PASS / ${failures.length} FAIL`);
if (failures.length) console.log("FAIL：" + failures.join("；"));
process.exit(failures.length ? 1 : 0);
