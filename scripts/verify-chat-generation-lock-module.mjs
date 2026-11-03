// verify-chat-generation-lock-module.mjs — 任務單 #L1-T2：src/lib/ai/chat-generation-lock.ts 模組層級行為（計時器殘留、owner、強制解鎖）
//
// 受測：真實 src/lib/ai/chat-generation-lock.ts（esbuild 打包；sonner 以記錄器取代，其餘真實）。
// 假時鐘：覆寫 globalThis.setTimeout／clearTimeout（模組在呼叫時才取用全域計時器），可精確推進並計算「仍掛著的計時器數」。
//
// U1  begin → 鎖住且恰 2 個計時器（90 秒、5 分鐘）；end → 解鎖且 0 個計時器
// U2  90 秒整才出現 slow（89_999ms 沒有）；slow 只在同 owner 時設定；通知訂閱者
// U3  同 owner 巢狀 begin 只計數、不重設計時；end 次數對上才解鎖；解鎖後 0 計時器
// U4  舊 owner 的 end 不解除新 owner 的鎖；換 owner 時清掉舊 owner 的計時器（不殘留）
// U5  滿 CREDITS_RESERVE_STALE_MAX_AGE_MS（300 秒）強制解鎖：299_999ms 仍鎖、300_000ms 解鎖、0 計時器、印出 FORCE_RELEASED；
//     被強制解鎖的 owner 再 begin 不會重新上鎖、其 end 為 no-op；其他 owner 照常可鎖
// U6  新 owner 的 5 分鐘從自己的 begin 起算（不被舊 owner 的計時器提早解除）
// U7  空字串 owner 被忽略
// U8  blockIfChatGenerationLocked：未鎖 → false 且不 toast；鎖住 → true 且 toast.message(文案) 恰 1 次
// U9  markChatPageMounted：計數、release 冪等、StrictMode（mount→release→mount）後仍為掛載中
// U10 getChatGenerationLockState 在沒有變化時回傳同一物件（useSyncExternalStore 需要穩定 snapshot）；伺服器 snapshot 為未鎖
// U11 （#L1-T3）notifyChatGenerationFailed：toast.error 恰 1 次、四語系文案＝目前裝置語系、id＝chat-generation-failed:<owner>；不動鎖／計時器
// U12 （#L1-T3）notifyChatGenerationDone：四語系文案與「查看」、duration 10000、action.onClick＝傳入的 onView
// U13 （#L1-T3）語系在顯示當下才取（切換 navigator.language 後下一次即為新語系）
// U14 （#L1-T3）強制解鎖後才失敗：通知照常、不重新上鎖
// U15 （#L1-T4）notifyChatGenerationFailed(owner, reasonKey)：具體原因四語系、查無 key／空字串退回通用文案
// 執行：node scripts/verify-chat-generation-lock-module.mjs（不連網、不讀 .env）

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 12).join("\n     "));
  }
}

// ── 假時鐘 ──
let now = 0;
let seq = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => {
  const id = ++seq;
  timers.set(id, { fn, due: now + Number(ms) });
  return id;
};
globalThis.clearTimeout = (id) => {
  timers.delete(id);
};
const advance = (ms) => {
  const target = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.due <= target && (!next || t.due < next[1].due)) next = [id, t];
    if (!next) break;
    timers.delete(next[0]);
    now = next[1].due;
    next[1].fn();
  }
  now = target;
};
const active = () => timers.size;
const infos = [];
const origInfo = console.info;
console.info = (...a) => infos.push(a);

// ── 打包受測模組 ──
const { build } = await import("esbuild");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-lock-module-"));
const outfile = path.join(dir, "lock.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/ai/chat-generation-lock.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "error",
  alias: { "@": path.join(root, "src") },
  external: ["react"],
  plugins: [
    {
      name: "sonner-recorder",
      setup(b) {
        b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "rec" }));
        b.onLoad({ filter: /.*/, namespace: "rec" }, () => ({
          contents: "export const toast=Object.assign((...a)=>{(globalThis.__toasts||(globalThis.__toasts=[])).push(['toast',...a]);},{message:(...a)=>{(globalThis.__toasts||(globalThis.__toasts=[])).push(['message',...a]);},error:(...a)=>{(globalThis.__toasts||(globalThis.__toasts=[])).push(['error',...a]);}});",
          loader: "js",
        }));
      },
    },
  ],
});
// #L1-T3：期望文案由真實 translate 取得（不寫死）
const trOut = path.join(dir, "tr.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/i18n/translate.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: trOut,
  logLevel: "error",
  alias: { "@": path.join(root, "src") },
});
fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
const L = await import(pathToFileURL(outfile).href);
const { translate } = await import(pathToFileURL(trOut).href);
// 裝置語系（effectiveAppLocale → detectDeviceLocale 讀 navigator.language，每次呼叫時才讀）
const setDeviceLanguage = (lang) => Object.defineProperty(globalThis, "navigator", { value: { language: lang }, configurable: true, writable: true });
const { CREDITS_RESERVE_STALE_MAX_AGE_MS } = await import(pathToFileURL(path.join(root, "src/lib/credits/constants.ts")).href).catch(() => ({ CREDITS_RESERVE_STALE_MAX_AGE_MS: L.CHAT_GENERATION_FORCE_UNLOCK_MS }));
const st = () => L.getChatGenerationLockState();
const toasts = () => globalThis.__toasts ?? [];

// 每個情境前確保乾淨（上一個情境必須已解鎖、無計時器）
const clean = () => {
  assert.equal(st().locked, false, "前一情境殘留鎖");
  assert.equal(active(), 0, "前一情境殘留計時器 " + active() + " 個");
};

await check("U1 begin → 鎖住且恰 2 個計時器；end → 解鎖且 0 個計時器", () => {
  clean();
  L.beginChatGenerationLock("g1");
  assert.deepEqual(st(), { locked: true, slow: false, owner: "g1" });
  assert.equal(active(), 2);
  assert.equal(L.isChatGenerationLocked(), true);
  L.endChatGenerationLock("g1");
  assert.deepEqual(st(), { locked: false, slow: false, owner: null });
  assert.equal(active(), 0, "end 後計時器殘留");
});

await check("U2 90 秒整才 slow（89_999ms 沒有）；未變化時 snapshot 為同一物件", async () => {
  clean();
  L.beginChatGenerationLock("g2");
  const s0 = st();
  advance(89_999);
  assert.equal(st().slow, false, "89.999 秒就 slow");
  assert.equal(st(), s0, "未變化時 snapshot 應為同一物件");
  advance(1);
  assert.deepEqual(st(), { locked: true, slow: true, owner: "g2" });
  assert.equal(active(), 1, "90 秒後應只剩強制解鎖計時器");
  L.endChatGenerationLock("g2");
  assert.equal(active(), 0);
});

await check("U3 同 owner 巢狀 begin 只計數、不重設計時；end 次數對上才解鎖", () => {
  clean();
  L.beginChatGenerationLock("g3");
  advance(60_000);
  L.beginChatGenerationLock("g3"); // 巢狀（runDirectItinerary → handleGenerateItinerary 同 owner）
  assert.equal(active(), 2, "巢狀 begin 不應新增計時器");
  advance(30_000); // 從第一次 begin 起算 90 秒
  assert.equal(st().slow, true, "巢狀 begin 重設了 90 秒計時");
  L.endChatGenerationLock("g3");
  assert.equal(st().locked, true, "內層 end 就解鎖了");
  L.endChatGenerationLock("g3");
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
  L.endChatGenerationLock("g3"); // 多餘的 end：no-op
  assert.equal(st().locked, false);
});

await check("U4 舊 owner 的 end 不解除新 owner；換 owner 時舊計時器被清掉", () => {
  clean();
  L.beginChatGenerationLock("old");
  L.beginChatGenerationLock("new");
  assert.equal(active(), 2, "換 owner 後應只有新 owner 的 2 個計時器");
  L.endChatGenerationLock("old");
  assert.deepEqual(st(), { locked: true, slow: false, owner: "new" });
  L.endChatGenerationLock("new");
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
});

await check(`U5 滿 ${CREDITS_RESERVE_STALE_MAX_AGE_MS}ms 強制解鎖；過期 owner 不能再上鎖、其 end 為 no-op；其他 owner 可鎖`, () => {
  clean();
  assert.equal(L.CHAT_GENERATION_FORCE_UNLOCK_MS, CREDITS_RESERVE_STALE_MAX_AGE_MS);
  assert.equal(CREDITS_RESERVE_STALE_MAX_AGE_MS, 300_000);
  infos.length = 0;
  L.beginChatGenerationLock("stuck");
  advance(299_999);
  assert.equal(st().locked, true, "299.999 秒就解鎖");
  advance(1);
  assert.deepEqual(st(), { locked: false, slow: false, owner: null });
  assert.equal(active(), 0, "強制解鎖後計時器殘留");
  assert.ok(infos.some((a) => a[0] === "[CHAT_GENERATION_LOCK_FORCE_RELEASED]"), "未記錄 FORCE_RELEASED");
  L.beginChatGenerationLock("stuck");
  assert.equal(st().locked, false, "過期 owner 再 begin 重新上鎖");
  assert.equal(active(), 0);
  L.beginChatGenerationLock("fresh");
  L.endChatGenerationLock("stuck");
  assert.deepEqual(st(), { locked: true, slow: false, owner: "fresh" }, "過期 owner 的 end 解除了新鎖");
  L.endChatGenerationLock("fresh");
  assert.equal(active(), 0);
});

await check("U6 新 owner 的 5 分鐘從自己的 begin 起算（舊 owner 的計時器不提早解除）", () => {
  clean();
  L.beginChatGenerationLock("a");
  advance(200_000);
  L.beginChatGenerationLock("b");
  advance(150_000); // a 起算 350 秒、b 起算 150 秒
  assert.deepEqual(st(), { locked: true, slow: true, owner: "b" }, "b 被提早解除或 slow 不正確");
  advance(149_999);
  assert.equal(st().locked, true);
  advance(1);
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
});

await check("U7 空字串 owner 被忽略", () => {
  clean();
  L.beginChatGenerationLock("");
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
});

await check("U8 blockIfChatGenerationLocked：未鎖 false 且不 toast；鎖住 true 且 toast.message 恰 1 次", () => {
  clean();
  const n0 = toasts().length;
  assert.equal(L.blockIfChatGenerationLocked("訊息"), false);
  assert.equal(toasts().length, n0, "未鎖卻 toast");
  L.beginChatGenerationLock("g8");
  assert.equal(L.blockIfChatGenerationLocked("行程生成中，完成後再試一次"), true);
  assert.deepEqual(toasts().slice(n0), [["message", "行程生成中，完成後再試一次"]]);
  L.endChatGenerationLock("g8");
});

await check("U9 markChatPageMounted：計數、release 冪等、StrictMode mount→release→mount 後仍掛載", () => {
  clean();
  assert.equal(L.isChatPageMounted(), false);
  const r1 = L.markChatPageMounted();
  r1();
  r1(); // 冪等
  assert.equal(L.isChatPageMounted(), false);
  const r2 = L.markChatPageMounted(); // StrictMode 第二次 mount
  assert.equal(L.isChatPageMounted(), true);
  const r3 = L.markChatPageMounted(); // 另一個聊聊實例（新頁先 mount、舊頁後 unmount）
  r2();
  assert.equal(L.isChatPageMounted(), true, "舊實例卸載後誤判未掛載");
  r3();
  r1();
  assert.equal(L.isChatPageMounted(), false, "計數變成負數或殘留");
});

await check("U10 未鎖 snapshot 為固定物件；伺服器 snapshot 未鎖", async () => {
  clean();
  const a = st();
  const b = st();
  assert.equal(a, b);
  const React = await import("react");
  const { renderToString } = await import("react-dom/server");
  L.beginChatGenerationLock("ssr");
  let seen = null;
  function Probe() {
    seen = L.useChatGenerationLock();
    return null;
  }
  renderToString(React.createElement(Probe));
  assert.deepEqual(seen, { locked: false, slow: false, owner: null }, "SSR 應使用未鎖 snapshot");
  L.endChatGenerationLock("ssr");
  assert.equal(active(), 0);
});

// ── #L1-T3：離開原對話時的完成／失敗提示（文案在顯示當下取目前語系） ──
const LANGS = [["zh-TW", "zh-TW"], ["en-US", "en"], ["ja-JP", "ja"], ["ko-KR", "ko"]];

await check("U11 notifyChatGenerationFailed：toast.error 恰 1 次、文案＝目前裝置語系的 uiCoverage.chatGenerationFailed（四語系）、id 依 owner 固定", () => {
  clean();
  const seen = new Set();
  for (const [lang, locale] of LANGS) {
    setDeviceLanguage(lang);
    const n0 = toasts().length;
    L.notifyChatGenerationFailed("owner-" + locale);
    const added = toasts().slice(n0);
    const expect = translate(locale, "uiCoverage.chatGenerationFailed");
    assert.ok(expect && expect !== "uiCoverage.chatGenerationFailed", locale + " 文案缺漏");
    assert.equal(added.length, 1, locale + " toast 次數：" + JSON.stringify(added));
    assert.equal(added[0][0], "error", locale + " 應為 toast.error");
    assert.equal(added[0][1], expect, locale + " 文案");
    assert.deepEqual(added[0][2], { id: "chat-generation-failed:owner-" + locale }, locale + " options");
    seen.add(expect);
  }
  assert.equal(seen.size, 4, "四語系文案應互不相同");
  // 同一 owner 重複呼叫：同一個 id（sonner 以 id 更新同一則，不疊加）
  const n0 = toasts().length;
  L.notifyChatGenerationFailed("same");
  L.notifyChatGenerationFailed("same");
  const ids = toasts().slice(n0).map((t) => t[2]?.id);
  assert.deepEqual(ids, ["chat-generation-failed:same", "chat-generation-failed:same"]);
  assert.equal(st().locked, false, "通知不得改變鎖狀態");
  assert.equal(active(), 0, "通知不得新增計時器");
  setDeviceLanguage("zh-TW");
});

await check("U12 notifyChatGenerationDone：toast 恰 1 次、文案／「查看」＝目前裝置語系、duration 10000、action.onClick 就是傳入的 onView", () => {
  clean();
  for (const [lang, locale] of LANGS) {
    setDeviceLanguage(lang);
    const n0 = toasts().length;
    let viewed = 0;
    const onView = () => viewed++;
    L.notifyChatGenerationDone(onView);
    const added = toasts().slice(n0);
    assert.equal(added.length, 1, locale + " toast 次數");
    const [kind, msg, opts] = added[0];
    assert.equal(kind, "toast");
    assert.equal(msg, translate(locale, "uiCoverage.chatGenerationDone"), locale + " 文案");
    assert.equal(opts.action.label, translate(locale, "uiCoverage.chatGenerationDoneView"), locale + " 查看");
    assert.equal(opts.duration, 10000);
    assert.equal(opts.action.onClick, onView, "action.onClick 不是 onView");
    opts.action.onClick();
    assert.equal(viewed, 1);
  }
  setDeviceLanguage("zh-TW");
});

await check("U13 語系在「顯示當下」才取：同一模組實例，切換裝置語系後下一次提示即為新語系（不快取）", () => {
  clean();
  setDeviceLanguage("zh-TW");
  const n0 = toasts().length;
  L.notifyChatGenerationFailed("g13");
  setDeviceLanguage("ja-JP");
  L.notifyChatGenerationFailed("g13");
  L.notifyChatGenerationDone(() => {});
  setDeviceLanguage("ko-KR");
  L.notifyChatGenerationDone(() => {});
  const got = toasts().slice(n0).map((t) => t[1]);
  assert.deepEqual(got, [
    translate("zh-TW", "uiCoverage.chatGenerationFailed"),
    translate("ja", "uiCoverage.chatGenerationFailed"),
    translate("ja", "uiCoverage.chatGenerationDone"),
    translate("ko", "uiCoverage.chatGenerationDone"),
  ]);
  setDeviceLanguage("zh-TW");
});

await check("U14 強制解鎖（5 分鐘）後才失敗：通知照常顯示、不重新上鎖", () => {
  clean();
  L.beginChatGenerationLock("late");
  advance(CREDITS_RESERVE_STALE_MAX_AGE_MS);
  assert.equal(st().locked, false, "未強制解鎖");
  const n0 = toasts().length;
  L.endChatGenerationLock("late");
  L.notifyChatGenerationFailed("late");
  const added = toasts().slice(n0);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], "error");
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
});

await check("U15 （#L1-T4）notifyChatGenerationFailed(owner, reasonKey)：具體原因以顯示當下的裝置語系取文案（四語系 chatRuntime.capacity）；查無 key／空字串時用通用失敗文案；id 仍依 owner", () => {
  clean();
  const seen = new Set();
  for (const [lang, locale] of LANGS) {
    setDeviceLanguage(lang);
    const n0 = toasts().length;
    L.notifyChatGenerationFailed("cap-" + locale, "chatRuntime.capacity");
    const added = toasts().slice(n0);
    const expect = translate(locale, "chatRuntime.capacity");
    assert.ok(expect && expect !== "chatRuntime.capacity", locale + " capacity 文案缺漏");
    assert.equal(added.length, 1, locale + " toast 次數");
    assert.equal(added[0][0], "error");
    assert.equal(added[0][1], expect, locale + " capacity 文案");
    assert.deepEqual(added[0][2], { id: "chat-generation-failed:cap-" + locale });
    seen.add(expect);
  }
  assert.equal(seen.size, 4, "四語系 capacity 文案應互不相同");
  setDeviceLanguage("ja-JP");
  const n1 = toasts().length;
  L.notifyChatGenerationFailed("u15", "chatRuntime.__verify_missing_key__");
  L.notifyChatGenerationFailed("u15", "");
  L.notifyChatGenerationFailed("u15", undefined);
  const generic = translate("ja", "uiCoverage.chatGenerationFailed");
  assert.deepEqual(
    toasts().slice(n1).map((t) => [t[0], t[1], t[2]?.id]),
    [0, 1, 2].map(() => ["error", generic, "chat-generation-failed:u15"]),
    "查無翻譯／未提供原因時應為目前語系的通用失敗文案",
  );
  assert.equal(st().locked, false);
  assert.equal(active(), 0);
  setDeviceLanguage("zh-TW");
});

console.info = origInfo;
console.log(`\n${passed} PASS / ${failures.length} FAIL`);
process.exit(failures.length ? 1 : 0);
