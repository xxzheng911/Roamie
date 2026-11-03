// verify-duo-device-chat-composer.mjs — iPhone Duo 裝置（html.duo-device）聊聊輸入列滿版、背景不透明（任務單 #H2b-2-T，tester 獨立審查）
//
// 需求：Duo 完全展開直向（無直欄、無雙欄、非筆電）時，聊聊輸入列（含快捷按鍵列）滿版、背景完整遮住後方；
//   一般 iPhone、iPad、web 完全不變；雙欄（輸入列限制左頁）與筆電（全寬）維持既有行為。
//
// Part A（靜態）
//   A1 src/routes/_app.chat.tsx 差異只落在 #L1 生成鎖與 #PL-FIX Planner 授權段落（移除後＝95e7866a0e96f036；不寫死目前 sha）
//   A2 styles.css 中 duo-device 只出現在兩條聊聊規則（selector／宣告逐字）、位於 @layer 外、前綴含 :not(.duo-rail)
//   A3 _app.tsx：以 useDuoDevice() 決定、useLayoutEffect 加／移除 html.duo-device；不直接引用 hinge
//   A4 fixture class 由原始碼抽取，依賴的 inline style／use-messenger-chat-layout 公式仍存在
//
// Part B（headless Chrome＋以目前 styles.css 實際編譯的 Tailwind CSS；fixture class 由 MobileFrame／_app.tsx／
//   app-scroll-contract／BottomNav／_app.chat.tsx／ChatComposer 抽取；輸入列 inline style 依 _app.chat.tsx；
//   輸入列 bottom 與訊息列表 padding-bottom 依 use-messenger-chat-layout 公式由實測高度算出）
//   CSS 兩份：NEW＝目前 styles.css；OLD＝只移除 html.duo-device 兩條規則（其餘不變）
//   D1 duo-device 直向（669×951、底部導覽；safe-bottom 0／20；快捷列 無／一般／很多）：輸入列左右＝視窗左右
//   D2 同上：後方地點卡在輸入列範圍內不可點（elementFromPoint 全落在輸入列）且不可見
//      （截圖比對：地點卡顯示／隱藏時輸入列範圍像素完全相同）；輸入列與 .chat-composer 背景 alpha＝1
//   D3 同上：捲到底時最後一則訊息（含重試鈕與錨點）底部不被輸入列遮住
//   D4 鍵盤開（chat-keyboard-open、輸入列貼鍵盤）：同樣滿版、不可點、不可見；最後一則訊息不被遮住
//   D5 duo-device＋duo-rail（直欄單頁、直欄＋雙欄）：新規則不生效 → 所有元素量測＝OLD；雙欄輸入列仍限制左頁
//   D6 duo-device＋duo-laptop（底部導覽、直欄；鍵盤開）：位置／尺寸／內距＝OLD（筆電規則決定），只差背景變不透明
//   D7 無 duo-device（一般 iPhone、iPad 原生、Duo 尺寸但無 hinge、web 窄版、web 桌機；鍵盤開）：所有元素量測（含背景）＝OLD
//   D8 B0 對照：OLD CSS＋duo-device 直向時 D1／D2 必須失敗
// Part H（真實模組：esbuild 打包 src/hooks/use-duo-laptop.ts＋真實 src/lib/layout/duo-hinge.ts＋真實 src/routes/_app.tsx，
//   只 mock @capacitor/core（假 DuoHinge 外掛）、@/services/platform 與 _app.tsx 的周邊服務）
//   H1 非原生（web）：useDuoDevice＝false、不註冊外掛
//   H2 原生 iOS、外掛回報 supported:false → false；H3 外掛不存在（呼叫 reject）→ false
//   H4 原生 iOS、supported:true → true；hingeChange 改 unsupported → false、再改回 → true
//   H5 SSR（renderToString）：即使 client store 為 supported 仍輸出 false
//   H6 _app.tsx（StrictMode）：supported 時 <html> 加 duo-device、變 unsupported 移除、unmount 移除；非原生從不加；不加 duo-rail／duo-laptop
//   H9 瀏覽器無例外、無外部請求
//
// 限制：不渲染真實 _app.chat.tsx（14k 行、依賴大量服務），輸入列 DOM 依原始碼抽取的 class 與 inline style 組成（A4 確認契約）。
// 執行：node scripts/verify-duo-device-chat-composer.mjs（不讀 .env、不連網；瀏覽器只連 127.0.0.1 fixture server）

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const styles = read("src/styles.css");
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 24).join("\n     "));
  }
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

// ───────────────────────── Part A：靜態 ─────────────────────────
// #L1-T2：_app.chat.tsx 經 #L1（行程生成全域鎖）授權修改，sha256 前 16 碼 95e7866a0e96f036 作廢 → bb3a7f395ea8d58e。
// #L1-T3：第 2 輪授權修改（清除聊聊上鎖、離開原對話時的失敗提示、提示取目前語系）→ 1f9f6c91787031f6（bb3a7f395ea8d58e 作廢）。
// #L1-T4：第 3 輪授權修改（不在原對話時失敗只一則提示、具體原因、保存後失效改發完成提示、finally 通知 try／catch）→ 8e2dd996d9c89771（1f9f6c91787031f6 作廢）。
//   「聊聊頁除生成鎖外未修改」改由 verify-chat-generation-lock-authorized-diff.mjs 逐字移除授權段落後與改動前版本比對。
// #PL-FIX-T3：不再寫死 _app.chat.tsx 的 sha（#PL-FIX 授權變更後 sha 隨 Planner 段落改變）。改為逐字移除 #L1 生成鎖與
//   #PL-FIX Planner 選擇入口的授權段落（長段落以 sha16 釘死）後必須＝改動前版本 95e7866a0e96f036：
//   聊聊頁差異只能落在授權段落，Duo 工作若改到聊聊頁任何其他地方都會失敗。
await check("A1 src/routes/_app.chat.tsx 差異只落在授權的 #L1 生成鎖與 #PL-FIX Planner 段落（移除後＝95e7866a0e96f036）", async () => {
  const { assertChatTsxOnlyLockChanges } = await import("./verify-chat-generation-lock-authorized-diff.mjs");
  const h = assertChatTsxOnlyLockChanges();
  assert.equal(typeof h, "string");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "src/routes/_app.chat.tsx"))).digest("hex"), h);
});

const DEVICE_PREFIX = "html.duo-device.chat-route-active:not(.duo-rail) .messenger-chat-composer";
const DEVICE_RULES = [
  [[DEVICE_PREFIX], ["max-width: none !important", "margin-inline: 0 !important"]],
  [[DEVICE_PREFIX, DEVICE_PREFIX + " .chat-composer"], ["background: var(--background)"]],
];
await check("A2 styles.css：duo-device 只出現在兩條聊聊輸入列規則（selector／宣告逐字）、@layer 外、前綴含 :not(.duo-rail)", () => {
  const nc = stripComments(styles);
  let depth = 0;
  const depthAt = new Int32Array(nc.length);
  for (let i = 0; i < nc.length; i++) {
    depthAt[i] = depth;
    if (nc[i] === "{") depth++;
    else if (nc[i] === "}") depth--;
  }
  const rules = [...nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].includes("duo-device"))
    .map((m) => ({
      sels: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
      decls: m[2].split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean),
      depth: depthAt[m.index + m[0].indexOf("{")],
    }));
  assert.deepEqual(rules.map((r) => [r.sels, r.decls]), DEVICE_RULES);
  for (const r of rules) assert.equal(r.depth, 0, "規則在 @layer／區塊內：" + r.sels.join(", "));
  // duo-device 不出現在規則 selector 以外（例如 @media、其他 selector）
  const occurrences = [...nc.matchAll(/duo-device/g)].length;
  assert.equal(occurrences, 3, "duo-device 在 styles.css（不含註解）出現次數");
});

const appSrc = read("src/routes/_app.tsx");
await check("A3 _app.tsx：useDuoDevice() 決定、useLayoutEffect 加／移除 html.duo-device；不直接引用 hinge", () => {
  assert.match(appSrc, /import \{[^}]*\buseDuoDevice\b[^}]*\} from "@\/hooks\/use-duo-laptop";/);
  assert.match(
    appSrc,
    /const duoDevice = useDuoDevice\(\);\s*\n\s*useLayoutEffect\(\(\) => \{\s*\n\s*if \(!duoDevice\) return;\s*\n\s*const root = document\.documentElement;\s*\n\s*root\.classList\.add\("duo-device"\);\s*\n\s*return \(\) => \{\s*\n\s*root\.classList\.remove\("duo-device"\);\s*\n\s*\};\s*\n\s*\}, \[duoDevice\]\);/,
  );
  // 只檢查程式引用（--duo-hinge-* CSS 變數名稱不算引用 hinge store）
  assert.doesNotMatch(appSrc, /from "@\/lib\/layout\/duo-hinge"|from "@\/hooks\/use-duo-hinge"|\buseDuoHinge\b|\bgetDuoHingeSnapshot\b|\bsubscribeDuoHinge\b/, "_app.tsx 直接引用 hinge");
  const hook = read("src/hooks/use-duo-laptop.ts");
  assert.match(hook, /export function useDuoDevice\(\): boolean \{\s*\n\s*return useSyncExternalStore\(subscribeDuoHinge, getDuoDeviceSnapshot, getDuoDeviceServerSnapshot\);/);
  assert.match(hook, /function getDuoDeviceSnapshot\(\): boolean \{\s*\n\s*return getDuoHingeSnapshot\(\)\.supported;/);
  assert.match(hook, /function getDuoDeviceServerSnapshot\(\): boolean \{\s*\n\s*return false;/);
});

const src = {
  frame: read("src/components/MobileFrame.tsx"),
  app: appSrc,
  contract: read("src/lib/app-scroll-contract.ts"),
  nav: read("src/components/BottomNav.tsx"),
  chat: read("src/routes/_app.chat.tsx"),
  composer: read("src/components/chat/ChatComposer.tsx"),
  layoutHook: read("src/hooks/use-messenger-chat-layout.ts"),
};
function lit(key, needle, nth = 0) {
  const s = src[key];
  let i = -1;
  for (let k = 0; k <= nth; k++) {
    i = s.indexOf(needle, i + 1);
    if (i < 0) throw new Error(`fixture 抽取失敗：${key} 找不到 ${needle}（第 ${nth} 次）`);
  }
  let a = i;
  while (a > 0 && s[a - 1] !== '"' && s[a - 1] !== "`") a--;
  const q = s[a - 1];
  let b = i;
  while (b < s.length && s[b] !== q && !(q === "`" && s.startsWith("${", b))) b++;
  return s.slice(a, b).trim();
}
function exact(key, str) {
  if (!src[key].includes('"' + str + '"')) throw new Error(`fixture 抽取失敗：${key} 找不到 "${str}"`);
  return str;
}
let C;
await check("A4 fixture class 由原始碼抽取成功，且依賴的 inline style／版面公式仍存在", () => {
  C = {
    FRAME_OUTER: lit("frame", "mobile-frame-outer"),
    FRAME_INNER_FULL: lit("frame", "mobile-frame-inner", 0),
    FRAME_INNER: lit("frame", "mobile-frame-inner", 1),
    SHELL_COL: lit("app", "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"),
    MAIN_BASE: lit("app", "app-scroll flex"),
    MAIN_LOCK: exact("app", "min-h-0 flex-1 overflow-hidden"),
    CONTENT: lit("contract", "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"),
    NAV_BOTTOM: lit("nav", "bottom-nav fixed"),
    NAV_RAIL: lit("nav", "app-right-rail fixed"),
    NAV_UL: lit("nav", "flex h-[var(--bottom-nav-height,4.25rem)]"),
    CHAT_ROOT: lit("chat", "messenger-chat-root"),
    CHAT_HEADER: lit("chat", "messenger-chat-header"),
    CHAT_BACK: exact("chat", "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"),
    CHAT_BODY: lit("chat", "messenger-chat-body"),
    CHAT_MSGS: lit("chat", "messenger-chat-messages"),
    CHAT_INNER: exact("chat", "space-y-4"),
    CHAT_ANCHOR: exact("chat", "h-px w-full shrink-0"),
    CHAT_RETRY: lit("chat", "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3"),
    COMPOSER: exact("chat", "messenger-chat-composer"),
    COMPOSER_KB: exact("chat", "messenger-chat-composer--keyboard-open"),
    CC_ROOT: lit("composer", "chat-composer border-t"),
    CC_ROW: lit("composer", "mb-2 flex gap-2 overflow-x-auto no-scrollbar"),
    CC_CHIP: lit("composer", "shrink-0 rounded-full border border-border bg-card text-foreground/80"),
    CC_CHIP_SIZE: exact("composer", "px-3 py-1.5 text-xs"),
    CC_CHIP_SIZE_KB: exact("composer", "px-2.5 py-1 text-[11px]"),
    CC_ACTION: lit("composer", "inline-flex items-center gap-1.5 border-primary/40"),
    CC_PLAN: lit("composer", "shrink-0 rounded-full border border-dashed"),
    CC_INPUT_ROW: lit("composer", "chat-input-row"),
    CC_TEXTAREA: lit("composer", "flex-1 resize-none"),
    CC_SEND: lit("composer", "flex h-10 w-10 items-center justify-center rounded-full bg-primary"),
  };
  assert.ok(src.app.includes('pathname === "/chat" ? "pb-0"'), "_app：/chat 的 main 為 pb-0");
  assert.ok(src.app.includes("<MobileFrame fullBleed={rightRail}>"), "_app：MobileFrame fullBleed 只在直欄");
  for (const t of ['position: "fixed"', "left: 0", "right: 0", 'marginInline: "auto"', 'maxWidth: "440px"', "bottom: `${messengerLayout.composerBottomPx}px`", "zIndex: 45", 'flex: "1 1 0%"', "paddingBottom: `${Math.max(messengerLayout.messagesPaddingBottomPx, 0)}px`"])
    assert.ok(src.chat.includes(t), "_app.chat.tsx inline style 缺少：" + t);
  for (const t of [
    "? nativeKeyboardHeightPx\n      : bottomNavHeightPx + safeAreaBottomPx",
    "? composerHeightPx + nativeKeyboardHeightPx\n      : composerHeightPx + bottomNavHeightPx + safeAreaBottomPx",
    "const bottomNavHeightPx = Math.max(0, measuredTotal - safeAreaBottomPx);",
    'const inner = composerRoot.querySelector(".chat-composer");',
  ])
    assert.ok(src.layoutHook.includes(t), "use-messenger-chat-layout 公式已變更：" + t);
});

// ───────────────────────── PNG 解碼（截圖像素比對用）─────────────────────────
function decodePng(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, "不是 PNG");
  let off = 8;
  let w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bd = data[8];
      ct = data[9];
      assert.equal(data[12], 0, "不支援 interlace PNG");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  assert.equal(bd, 8, "PNG bit depth " + bd);
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  assert.ok(bpp, "PNG color type " + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = line[x * bpp];
      out[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px: out };
}

// ───────────────────────── Part B：瀏覽器 fixture ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

// 瀏覽器端程式（以 toString 序列化；不得引用 node 端變數）
function browserMain() {
  const C = window.__C;
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const R = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  window.setCss = (which) => {
    document.getElementById("css").textContent = window.__CSS[which];
    return true;
  };
  // 地點卡封面以深色標記（fixture 專用 inline style），任何透出都會在截圖比對中出現
  const bubble = (i) =>
    `<div class="flex ${i % 2 ? "justify-start" : "justify-end"}"><div class="max-w-[85%] rounded-3xl bg-card px-4 py-3 text-[15px]">Message ${i} lorem ipsum dolor sit amet</div></div>` +
    (i % 3 === 2
      ? `<div class="space-y-3" data-chat-place-cards><article data-card="${i}" class="overflow-hidden rounded-3xl border border-border bg-card"><div class="aspect-[16/10] w-full bg-secondary" style="background:#111"></div><div class="p-4" style="background:#123"><p>Place ${i}</p><button type="button" data-btn="card-${i}" class="mt-2 rounded-full bg-secondary px-3 py-2 text-xs">add ${i}</button></div></article></div>`
      : "");
  function chatDom(o) {
    const kb = o.kb > 0;
    const chipSize = kb ? C.CC_CHIP_SIZE_KB : C.CC_CHIP_SIZE;
    let chips = "";
    if (o.chips !== "none") {
      const n = o.chips === "many" ? 14 : 5;
      const actions = o.chips === "many" ? ["生成行程", "再推薦一些", "重新生成"] : [];
      chips =
        `<div class="${C.CC_ROW}" id="chipRow">` +
        actions.map((a, i) => `<button type="button" data-btn="action-${i}" class="${C.CC_CHIP} ${chipSize} ${C.CC_ACTION}">${a}</button>`).join("") +
        `<a href="#" data-btn="plan" class="${C.CC_PLAN} ${chipSize}">規劃行程</a>` +
        Array.from({ length: n }, (_, i) => `<button type="button" data-btn="chip-${i}" class="${C.CC_CHIP} ${chipSize}">快捷 ${i}</button>`).join("") +
        `</div>`;
    }
    // 最後一則訊息是地點卡（i＝msgCount−1 且 i%3===2），驗證「最後一則訊息底部不被遮住」
    const msgs = Array.from({ length: o.msgCount ?? 18 }, (_, i) => bubble(i)).join("");
    return `<div id="chatRoot" class="${C.CHAT_ROOT}">
 <header id="chatHeader" class="${C.CHAT_HEADER}"><button type="button" data-btn="back" class="${C.CHAT_BACK}">b</button><p class="flex-1">Roamie</p></header>
 <div id="chatBody" class="${C.CHAT_BODY}">
  <div id="msgs" data-keyboard-scroll-root class="${C.CHAT_MSGS}" style="flex:1 1 0%">
   <div id="inner" class="${C.CHAT_INNER}">${msgs}<div class="flex justify-center"><button type="button" id="retry" data-btn="retry" class="${C.CHAT_RETRY}">retry</button></div><div id="anchor" aria-hidden class="${C.CHAT_ANCHOR}"></div></div>
  </div>
  <div id="composer" class="${C.COMPOSER}${kb ? " " + C.COMPOSER_KB : ""}" style="position:fixed;left:0;right:0;margin-inline:auto;max-width:440px;z-index:45">
   <div id="cc" class="${C.CC_ROOT}${kb ? " pb-0" : ""}">${chips}
    <div id="inputRow" class="${C.CC_INPUT_ROW}"><textarea id="ta" rows="1" placeholder="說點什麼" class="${C.CC_TEXTAREA}"></textarea><button type="button" data-btn="send" class="${C.CC_SEND}">s</button></div>
   </div>
  </div>
 </div>
</div>`;
  }
  // use-messenger-chat-layout：輸入列 bottom 與訊息列表 padding-bottom（由實測高度計算，量測後回寫）
  function applyHookLayout(o) {
    const h = document.documentElement;
    const safe = o.safeBottom || 0;
    const navEl = q(".bottom-nav");
    const measured = navEl ? Math.round(navEl.getBoundingClientRect().height) : 0;
    const bottomNavHeightPx =
      measured > 0 ? Math.max(0, measured - safe) : Math.round(parseFloat(getComputedStyle(h).getPropertyValue("--bottom-nav-height")) || 68);
    const cc = q("#cc");
    const ccH = Math.max(Math.round(cc.getBoundingClientRect().height), Math.round(cc.offsetHeight));
    const composerBottomPx = o.kb > 0 ? o.kb : bottomNavHeightPx + safe;
    const pad = o.kb > 0 ? ccH + o.kb : ccH + bottomNavHeightPx + safe;
    q("#composer").style.bottom = composerBottomPx + "px";
    q("#msgs").style.paddingBottom = Math.max(pad, 0) + "px";
    return { composerBottomPx, messagesPaddingBottomPx: pad, composerHeightPx: ccH, bottomNavHeightPx };
  }
  window.setup = (o) => {
    window.setCss(o.css || "new");
    const h = document.documentElement;
    const rail = !!o.rail;
    const cls = [];
    if (o.native !== false) cls.push("native-shell");
    cls.push("chat-route-active");
    if (o.device) cls.push("duo-device");
    if (rail) cls.push("duo-rail");
    if (o.twoPane) cls.push("duo-two-pane");
    if (o.laptop) cls.push("duo-laptop");
    if (o.kb > 0) cls.push("chat-keyboard-open", "app-keyboard-open");
    h.className = cls.join(" ");
    h.removeAttribute("style");
    for (const [k, v] of [["--safe-area-top", o.safeTop || 0], ["--safe-area-bottom", o.safeBottom || 0], ["--safe-area-left", 0], ["--safe-area-right", 0]])
      h.style.setProperty(k, v + "px");
    if (rail) {
      h.style.setProperty("--bottom-nav-height", "0.01px");
      h.style.setProperty("--app-rail-width", "64px");
    }
    if (o.twoPane) {
      h.style.setProperty("--duo-fold-left-edge", o.foldX - 12 + "px");
      h.style.setProperty("--duo-fold-right-edge", o.foldX + 12 + "px");
    }
    if (o.laptop) {
      h.style.setProperty("--duo-hinge-top", o.top + "px");
      h.style.setProperty("--duo-hinge-bottom", o.bottom + "px");
    }
    const mainCls = [C.MAIN_BASE, "pb-0", C.MAIN_LOCK].join(" ");
    const mainStyle = "overflow:hidden;min-height:0;" + (rail ? "padding-right:var(--app-rail-width);" : "");
    const navUl = `<ul class="${C.NAV_UL}${rail ? "" : " items-center justify-between px-2"}">${["home", "chat", "map", "saved", "me"].map((k) => `<li class="flex-1"><a href="#" data-btn="nav-${k}">${k}</a></li>`).join("")}</ul>`;
    const nav = rail
      ? `<nav id="nav" class="${C.NAV_RAIL}" style="width:var(--app-rail-width)">${navUl}</nav>`
      : `<nav id="nav" class="${C.NAV_BOTTOM} chat-nav-keyboard-hide">${navUl}</nav>`;
    document.getElementById("root").innerHTML = `<div class="${C.FRAME_OUTER}"><div id="frameInner" class="${rail ? C.FRAME_INNER_FULL : C.FRAME_INNER}"><div class="${C.SHELL_COL}"><main id="main" class="${mainCls}" style="${mainStyle}"><div id="content" class="${C.CONTENT}"${rail ? ' style="--safe-area-right:0px"' : ""}>${chatDom(o)}</div></main>${nav}</div></div></div>`;
    let st = applyHookLayout(o);
    // ResizeObserver 回寫：輸入列寬度改變後高度可能改變，重算到穩定
    for (let k = 0; k < 3; k++) {
      const next = applyHookLayout(o);
      const same = JSON.stringify(next) === JSON.stringify(st);
      st = next;
      if (same) break;
    }
    window.state = st;
    return st;
  };
  const alphaOf = (c) => {
    const m = c.match(/\/\s*([\d.]+%?)\s*\)$/) || c.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
    if (!m) return c === "transparent" ? 0 : 1;
    return m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  };
  window.measure = () => {
    const m = { vw: innerWidth, vh: innerHeight, state: window.state };
    for (const id of ["frameInner", "main", "chatRoot", "msgs", "inner", "composer", "cc", "chipRow", "inputRow", "ta", "nav", "retry", "anchor"]) m[id] = R(document.getElementById(id));
    const comp = q("#composer");
    m.bg = { composer: getComputedStyle(comp).backgroundColor, cc: getComputedStyle(q("#cc")).backgroundColor };
    m.alpha = { composer: alphaOf(m.bg.composer), cc: alphaOf(m.bg.cc) };
    m.ccPad = [getComputedStyle(q("#cc")).paddingLeft, getComputedStyle(q("#cc")).paddingRight];
    const cards = qa("#inner [data-chat-place-cards]");
    m.lastCard = R(cards[cards.length - 1]);
    m.lastBlock = R(q("#inner").lastElementChild.previousElementSibling.previousElementSibling);
    return m;
  };
  // 讓某張地點卡橫跨輸入列（卡片上緣在輸入列上緣上方 60px）
  window.cardBehind = () => {
    const c = q("#composer").getBoundingClientRect();
    const msgs = q("#msgs");
    const arts = qa("#inner article[data-card]");
    const art = arts[Math.floor(arts.length / 2)];
    msgs.scrollTop += art.getBoundingClientRect().top - (c.top - 60);
    const a = art.getBoundingClientRect();
    return { card: R(art), composer: R(q("#composer")), spans: a.top < c.top && a.bottom > c.bottom, cardL: a.left, cardR: a.right };
  };
  window.scrollBottom = () => {
    const msgs = q("#msgs");
    msgs.scrollTop = msgs.scrollHeight;
    return msgs.scrollTop;
  };
  window.hideMsgs = (on) => {
    q("#inner").style.visibility = on ? "hidden" : "";
    return true;
  };
  // 輸入列所在的整條水平帶（y＝輸入列上下緣、x＝0～視窗寬）格點：最上層元素必須屬於輸入列
  // （使用者回報的是輸入列兩側透出卡片，所以範圍取整個視窗寬，而不是輸入列自己的寬度）
  window.composerHits = () => {
    const c = q("#composer").getBoundingClientRect();
    const out = [];
    let n = 0;
    for (let y = Math.ceil(c.top) + 1; y <= Math.floor(c.bottom) - 1; y += 4)
      for (let x = 1; x <= innerWidth - 1; x += 12) {
        n++;
        const e = document.elementFromPoint(x, y);
        if (!e || !e.closest("#composer")) out.push({ x, y, hit: e ? (e.getAttribute("data-btn") || e.id || e.tagName) + (e.closest("[data-card]") ? "@card" : "") : null });
      }
    return { n, bad: out };
  };
  window.snapshot = (opts = {}) => {
    const props = ["position", "left", "right", "top", "bottom", "width", "height", "maxWidth", "marginLeft", "marginRight", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "zIndex", "overflowX", "overflowY", "visibility", "display"];
    const bgProps = ["backgroundColor", "backdropFilter"];
    const out = [];
    for (const el of qa("#root *")) {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      out.push([el.tagName + (el.id ? "#" + el.id : ""), +b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2), ...props.map((p) => cs[p]), ...(opts.noBg ? [] : bgProps.map((p) => cs[p])), el.scrollHeight]);
    }
    return { els: out, msgsScrollTop: q("#msgs").scrollTop, state: window.state };
  };
  window.__ready = true;
}

if (!chromeBin) {
  failures.push("B 無可用 Chrome");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else if (C) {
  try {
    await runBrowser();
  } catch (e) {
    failures.push("B-crash 瀏覽器驗證中斷");
    console.log("FAIL B-crash 瀏覽器驗證中斷（之後的檢查未執行）\n     " + String(e?.stack ?? e).split("\n").slice(0, 8).join("\n     "));
  }
}

async function runBrowser() {
  const { build, stop } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-device-composer-"));
  fs.writeFileSync(path.join(dir, "fixture.html"), Object.values(C).join("\n") + "\n" + browserMain.toString());
  const compileCss = async (text) => {
    const compiler = await compile(text.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: [...compiler.sources, { base: dir, pattern: "**/*", negated: false }] });
    return compiler.build(scanner.scan());
  };
  // OLD：只移除 html.duo-device 兩條規則
  const RULE_RE = /\nhtml\.duo-device[^{]*\{[^}]*\}/g;
  const removed = styles.match(RULE_RE) ?? [];
  assert.equal(removed.length, 2, "OLD：應移除 2 條 duo-device 規則，實際 " + removed.length);
  const stylesOld = styles.replace(RULE_RE, "");
  assert.doesNotMatch(stripComments(stylesOld), /duo-device/);
  const cssNew = await compileCss(styles);
  const cssOld = await compileCss(stylesOld);
  assert.match(cssNew, /html\.duo-device\.chat-route-active:not\(\.duo-rail\) \.messenger-chat-composer/);
  assert.doesNotMatch(cssOld, /duo-device/);
  assert.match(cssOld, /html\.duo-laptop\.chat-route-active \.messenger-chat-composer/, "OLD 保留筆電規則");

  // Part H：真實 use-duo-laptop／duo-hinge／_app.tsx
  const noop = "export {}";
  const hookMocks = {
    "@capacitor/core": `export function registerPlugin(name){(window.__registered=window.__registered||[]).push(name);return {getState:(...a)=>window.__pluginImpl.getState(...a),addListener:(...a)=>window.__pluginImpl.addListener(...a)};}`,
    "@/services/platform": `export const detectPlatform=()=>window.__platform;`,
    "@tanstack/react-router": `import React from 'react';export const createFileRoute=()=>(o)=>o;export const Outlet=()=>React.createElement('div',{id:'outlet'});const R={state:{location:{pathname:'/chat'}},subscribe:()=>()=>{}};export const useRouter=()=>R;`,
    "@/hooks/use-i18n": `export const useI18n=()=>({locale:'zh-TW',t:(k)=>k});`,
    "@/lib/boot-diagnostics": `export const markBootPhase=()=>{};`,
    "@/lib/ios-snapshot-bridge": `export const scheduleIosSnapshotRefreshBurst=()=>{};`,
    "@/lib/startup-path": `export const readBrowserPathname=()=>'/chat';`,
    "@/components/BottomNav": `export const RIGHT_RAIL_WIDTH_VALUE='max(56px, var(--safe-area-right))';export const RIGHT_RAIL_WIDTH_VAR='var(--app-rail-width)';export function BottomNav(){return null;}`,
    "@/components/AppErrorBoundary": `export function AppErrorBoundary({children}){return children;}`,
    "@/lib/require-auth": `export const requireAppShellAccess=()=>{};`,
    "@/lib/location-coordinator": `export const enterHomeLocationMode=()=>{};export const leaveHomeLocationMode=()=>{};`,
    "@/lib/home-route-active": `export const setHomeRouteVisible=()=>{};`,
    "@/lib/route-keyboard-mode": `export const syncRouteKeyboardMode=()=>{};`,
    "@/lib/app-perf": `export const logPerfRouteChange=()=>{};export const logPerfRouteDuration=()=>{};`,
    "@/hooks/use-scroll-perf-monitor": `export const useScrollPerfMonitor=()=>{};`,
    "@/hooks/use-duo-layout": `const L={navPlacement:'bottom',tripLayout:'single',usableWidth:669};export const useDuoLayout=()=>L;`,
    "@/lib/location-watch-cleanup": `export const stopNavigationLocationWatch=()=>{};`,
    "@/lib/home-startup": `export const prefetchHomeData=()=>{};`,
    "@/lib/capacitor-keyboard-bridge": `export const bootstrapCapacitorKeyboardBridge=()=>{};`,
    "@/lib/i18n/types": noop,
  };
  const hookEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {renderToString} from 'react-dom/server';
import {useDuoDevice} from '@/hooks/use-duo-laptop';
import {Route} from '@/routes/_app';
window.__platform={isCapacitor:false,isIOS:false,isAndroid:false};
const listeners=[];
const PLUGINS={
 ok:(state)=>({getState:async()=>state,addListener:async(ev,cb)=>{listeners.push(cb);return {remove:async()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1);}};}}),
 missing:()=>({getState:()=>Promise.reject(new Error('"DuoHinge" plugin is not implemented on ios')),addListener:()=>Promise.reject(new Error('"DuoHinge" plugin is not implemented on ios'))}),
};
window.__pluginImpl=PLUGINS.ok({supported:false});
window.setEnv=(native,mode,state)=>{window.__platform={isCapacitor:native,isIOS:native,isAndroid:false};window.__pluginImpl=PLUGINS[mode](state);return true;};
window.emit=(state)=>{flushSync(()=>{for(const cb of [...listeners])cb(state);});return listeners.length;};
window.registered=()=>(window.__registered||[]).slice();
window.__renders=[];
function Probe(){const v=useDuoDevice();window.__renders.push(v);return <i id="probe" data-v={String(v)}/>;}
const AppLayout=Route.component;
let root=null;
window.mountProbe=()=>{window.__renders=[];const el=document.getElementById('hookRoot');root=createRoot(el);flushSync(()=>root.render(<Probe/>));return window.probe();};
// 回傳 mount 當下（同一個 task 內、外掛 async 回報之前）的 <html> class
window.mountApp=(strict)=>{const el=document.getElementById('hookRoot');root=createRoot(el);flushSync(()=>root.render(strict?<StrictMode><AppLayout/></StrictMode>:<AppLayout/>));return window.htmlCls();};
window.unmount=()=>{flushSync(()=>root.unmount());root=null;return true;};
window.probe=()=>document.getElementById('probe')?.getAttribute('data-v')??null;
window.lastRender=()=>window.__renders[window.__renders.length-1];
window.htmlCls=()=>[...document.documentElement.classList];
window.ssr=()=>renderToString(<Probe/>);
window.tick=()=>new Promise(r=>setTimeout(r,30));
window.__hookReady=true;`;
  const devDefine = { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","SSR":false}', "process.env.NODE_ENV": '"development"' };
  await build({
    stdin: { contents: hookEntry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "hook.js"),
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    define: devDefine,
    plugins: [
      {
        name: "mocks",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => (a.path in hookMocks ? { path: a.path, namespace: "mock" } : null));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: hookMocks[a.path], loader: "tsx", resolveDir: root }));
        },
      },
    ],
  });
  const hookJs = fs.readFileSync(path.join(dir, "hook.js"), "utf8");
  // 確認打包的是真實模組（不是 mock）
  for (const t of ["getDuoDeviceSnapshot", "normalizeDuoHingeState", "classList.add(\"duo-device\")", "resolveDuoLaptop"]) assert.ok(hookJs.includes(t), "hook bundle 缺少真實模組片段：" + t);

  const pageJs = "window.__C=" + JSON.stringify(C) + ";window.__CSS=" + JSON.stringify({ new: cssNew, old: cssOld }) + ";\n(" + browserMain.toString() + ")();";
  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/app.js" || u === "/hook.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(u === "/app.js" ? pageJs : hookJs);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      u === "/hook"
        ? '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="hookRoot"></div><script src="/hook.js"></script></body></html>'
        : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="css"></style></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--hide-scrollbars", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
  const browserErrors = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      chrome.stderr.on("data", (b) => {
        output += b;
        const m = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      chrome.on("error", reject);
      setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
    });
    ws = new WebSocket(endpoint);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const r = JSON.parse(e.data);
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(r.params.exceptionDetails.exception?.description);
      if (r.method === "Network.requestWillBeSent") {
        const u = r.params.request.url;
        if (!/^(data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(u)) externalRequests.push(u);
      }
      if (r.id && pending.has(r.id)) {
        const p = pending.get(r.id);
        pending.delete(r.id);
        r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const next = ++id;
        pending.set(next, { resolve, reject });
        ws.send(JSON.stringify({ id: next, method, params, sessionId }));
      });
    const { targetInfos } = await send("Target.getTargets");
    const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.enable");
    let vp = "";
    const viewport = async (w, h, mobile = true) => {
      if (vp === `${w}x${h}${mobile}`) return;
      vp = `${w}x${h}${mobile}`;
      await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    };
    const load = async (p, flag) => {
      await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + p });
      for (let i = 0; i < 100 && !(await evaluate(`!!window.${flag}`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(await evaluate(`!!window.${flag}`), "fixture 未載入：" + browserErrors.join("\n"));
    };
    await viewport(669, 951);
    await load("/", "__ready");

    const VW = 669;
    const VH = 951;
    const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
    const raf = () => evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const setup = async (o) => {
      await viewport(o.vw ?? VW, o.vh ?? VH, o.mobile ?? true);
      const st = await evaluate("window.setup(" + JSON.stringify(o) + ")");
      await raf();
      return st;
    };
    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    // 截圖輸入列範圍（整數像素，內縮 1px 避開邊緣抗鋸齒）→ 地點卡顯示／隱藏比對
    const shot = async (r) => {
      const clip = { x: Math.ceil(r.l), y: Math.ceil(r.t), width: Math.floor(r.r) - Math.ceil(r.l), height: Math.floor(r.b) - Math.ceil(r.t), scale: 1 };
      const { data } = await call("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
      return decodePng(Buffer.from(data, "base64"));
    };
    const showThrough = async () => {
      const m = await ev("measure");
      // 輸入列所在水平帶、整個視窗寬
      const band = { l: 0, r: m.vw, t: m.composer.t, b: m.composer.b };
      m.composer = band;
      await raf();
      const a = await shot(band);
      await ev("hideMsgs", true);
      await raf();
      const b = await shot(band);
      await ev("hideMsgs", false);
      await raf();
      assert.equal(a.w, b.w);
      let diff = 0;
      let maxD = 0;
      const cols = new Set();
      for (let i = 0; i < a.px.length; i += 4) {
        const d = Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2]));
        if (d > 1) {
          diff++;
          cols.add(((i / 4) % a.w) + Math.ceil(m.composer.l));
        }
        maxD = Math.max(maxD, d);
      }
      const xs = [...cols].sort((x, y) => x - y);
      return { diff, total: a.px.length / 4, maxD, xRange: xs.length ? [xs[0], xs[xs.length - 1]] : null };
    };

    // 共用：Duo 直向（或鍵盤）斷言；回傳錯誤清單（B0 以 OLD CSS 重跑，預期失敗）
    const assertFullOpaque = async (o) => {
      const st = await setup(o);
      const behind = await ev("cardBehind");
      await raf();
      const m = await ev("measure");
      const hits = await ev("composerHits");
      const px = await showThrough();
      await ev("scrollBottom");
      await raf();
      const mb = await ev("measure");
      const errs = [];
      const sub = (n, fn) => {
        try {
          fn();
        } catch (e) {
          errs.push(n + "：" + e.message);
        }
      };
      sub("D1 滿版", () => {
        near(m.composer.l, 0, "輸入列左緣＝視窗左緣");
        near(m.composer.r, m.vw, "輸入列右緣＝視窗右緣");
        near(m.cc.l, 0, ".chat-composer 左緣");
        near(m.cc.r, m.vw, ".chat-composer 右緣");
        if (m.chipRow) assert.ok(m.chipRow.l >= -0.5 && m.chipRow.r <= m.vw + 0.5, "快捷列超出視窗");
        if (o.kb > 0) near(m.composer.b, m.vh - o.kb, "鍵盤開：輸入列貼鍵盤");
        else near(m.composer.b, m.nav.t, "輸入列下緣＝底部導覽上緣");
      });
      sub("D2 不透明", () => {
        assert.ok(behind.spans, "fixture：地點卡未橫跨輸入列 " + JSON.stringify(behind));
        assert.ok(behind.cardL < 114 && behind.cardR > 555, "fixture：地點卡未超出舊 440px 範圍 " + JSON.stringify(behind));
        assert.ok(hits.n > 100, "格點數 " + hits.n);
        assert.deepEqual(hits.bad.slice(0, 5), [], `輸入列範圍內有 ${hits.bad.length} 點落在後方元素`);
        assert.equal(px.diff, 0, `輸入列範圍透出後方地點卡：${px.diff}/${px.total} 像素不同（最大差 ${px.maxD}，x ${JSON.stringify(px.xRange)}）`);
        assert.equal(m.alpha.composer, 1, "輸入列背景 alpha：" + m.bg.composer);
        assert.equal(m.alpha.cc, 1, ".chat-composer 背景 alpha：" + m.bg.cc);
      });
      sub("D3 最後訊息", () => {
        assert.ok(mb.lastCard && mb.lastBlock, "fixture：缺少最後一則訊息");
        assert.ok(mb.lastCard.b <= mb.composer.t + 0.5, `最後一張地點卡底部 ${mb.lastCard.b} 被輸入列（上緣 ${mb.composer.t}）遮住`);
        assert.ok(mb.retry.b <= mb.composer.t + 0.5, `重試鈕底部 ${mb.retry.b} 被輸入列遮住`);
        assert.ok(mb.anchor.b <= mb.composer.t + 0.5, `錨點 ${mb.anchor.b} 被輸入列遮住`);
        assert.equal(st.messagesPaddingBottomPx, st.composerHeightPx + (o.kb > 0 ? o.kb : st.bottomNavHeightPx + (o.safeBottom || 0)));
      });
      return { errs, m, mb, st, px, hits };
    };

    // ── D1～D3 Duo 直向 ──
    for (const safeBottom of [0, 20])
      for (const chips of ["none", "normal", "many"]) {
        const r = await assertFullOpaque({ device: true, safeBottom, chips });
        await check(`D1～D3 duo-device 直向 669×951（底部導覽、safe-bottom ${safeBottom}、快捷列 ${chips}）：輸入列滿版、後方地點卡不可點不可見、最後訊息不被遮住`, () => {
          assert.deepEqual(r.errs, []);
          if (safeBottom === 0 && chips === "normal")
            console.log(`     （資訊）輸入列 [${r.m.composer.l}, ${r.m.composer.r}]×[${r.m.composer.t}, ${r.m.composer.b}]；背景 ${r.m.bg.composer}；padding-bottom ${r.st.messagesPaddingBottomPx}`);
        });
      }
    // ── D4 鍵盤開 ──
    for (const chips of ["normal", "many"]) {
      const r = await assertFullOpaque({ device: true, kb: 320, chips });
      await check(`D4 duo-device 直向＋鍵盤開（320px、快捷列 ${chips}）：輸入列貼鍵盤且滿版、不可點不可見、最後訊息不被遮住`, () => assert.deepEqual(r.errs, []));
    }

    // 比對 NEW 與 OLD 的整頁量測
    const compareOld = async (o, opts = {}) => {
      await setup(o);
      await ev("cardBehind");
      const a = await ev("snapshot", opts);
      const ma = await ev("measure");
      await setup({ ...o, css: "old" });
      await ev("cardBehind");
      const b = await ev("snapshot", opts);
      const mbm = await ev("measure");
      await evaluate("window.setCss('new')");
      const diff = a.els.map((x, i) => [x, b.els[i]]).filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y));
      return { a, b, diff, same: JSON.stringify(a) === JSON.stringify(b), ma, mb: mbm };
    };

    // ── D5 duo-device＋duo-rail（直欄單頁、雙欄）──
    {
      const cases = [
        { name: "直欄單頁 669×951", o: { device: true, rail: true, chips: "normal" } },
        { name: "直欄單頁＋鍵盤", o: { device: true, rail: true, chips: "normal", kb: 320 } },
        { name: "直欄＋雙欄 943×951", o: { device: true, rail: true, twoPane: true, foldX: 475.5, vw: 943, chips: "normal" } },
        { name: "直欄＋雙欄＋鍵盤", o: { device: true, rail: true, twoPane: true, foldX: 475.5, vw: 943, chips: "normal", kb: 320 } },
      ];
      for (const c of cases) {
        const r = await compareOld(c.o);
        await check(`D5 duo-device＋${c.name}：新規則不生效，所有元素量測（含背景）＝移除新規則時（${r.a.els.length} 個元素）`, () => {
          assert.ok(r.a.els.length > 30);
          assert.equal(r.same, true, "不同：" + JSON.stringify(r.diff.slice(0, 3)));
          // 既有行為：輸入列仍受 inline max-width 440px 限制，置中在可用範圍內（雙欄＝左頁 [0, 摺痕左緣]；直欄＝[0, 直欄左緣]）
          const xMax = c.o.twoPane ? c.o.foldX - 12 : VW - 64;
          assert.ok(r.ma.composer.l >= -0.5 && r.ma.composer.r <= xMax + 0.5, `輸入列 [${r.ma.composer.l}, ${r.ma.composer.r}] 超出 [0, ${xMax}]`);
          near((r.ma.composer.l + r.ma.composer.r) / 2, xMax / 2, "輸入列置中於可用範圍");
          assert.notEqual(r.ma.alpha.composer, 1, "直欄／雙欄輸入列背景維持既有半透明（新規則不應生效）");
          console.log(`     （資訊）輸入列 [${r.ma.composer.l}, ${r.ma.composer.r}]（可用範圍 [0, ${xMax}]）；背景 ${r.ma.bg.composer}`);
        });
      }
    }

    // ── D6 duo-device＋duo-laptop ──
    {
      const TOP = 455.5;
      const BOTTOM = 495.5;
      const cases = [
        { name: "筆電底部導覽", o: { device: true, laptop: true, top: TOP, bottom: BOTTOM, chips: "normal" }, xMax: VW },
        { name: "筆電底部導覽 safe-bottom 20", o: { device: true, laptop: true, top: TOP, bottom: BOTTOM, chips: "many", safeBottom: 20 }, xMax: VW },
        { name: "筆電直欄", o: { device: true, laptop: true, rail: true, top: TOP, bottom: BOTTOM, chips: "normal" }, xMax: VW - 64 },
        { name: "筆電＋鍵盤", o: { device: true, laptop: true, top: TOP, bottom: BOTTOM, chips: "normal", kb: 320 }, xMax: VW },
      ];
      for (const c of cases) {
        const r = await compareOld(c.o, { noBg: true });
        const rBg = await compareOld(c.o);
        await check(`D6 duo-device＋${c.name}：位置／尺寸／內距＝移除新規則時（筆電規則決定）；${c.o.rail ? "直欄時新規則完全不生效" : "只有輸入列背景改為不透明"}`, () => {
          assert.equal(r.same, true, "幾何不同：" + JSON.stringify(r.diff.slice(0, 3)));
          near(r.ma.composer.l, 0, "輸入列左緣");
          near(r.ma.composer.r, c.xMax, "輸入列右緣");
          assert.deepEqual(r.ma.ccPad, ["20px", "20px"], "筆電輸入列左右 20px 內距（筆電規則）");
          const bgDiff = rBg.diff.map(([x]) => x[0]);
          if (c.o.rail) {
            // 筆電＋直欄：:not(.duo-rail) 排除，新規則完全不生效（背景維持既有半透明）
            assert.deepEqual(bgDiff, [], "筆電直欄時新規則不應生效：" + JSON.stringify(bgDiff));
            assert.notEqual(r.ma.alpha.composer, 1);
          } else {
            assert.deepEqual([...new Set(bgDiff)].sort(), ["DIV#cc", "DIV#composer"], "背景差異應只在輸入列與 .chat-composer：" + JSON.stringify(bgDiff));
            assert.equal(r.ma.alpha.composer, 1, "筆電輸入列背景不透明（指派者接受的取捨）：" + r.ma.bg.composer);
            assert.equal(r.ma.alpha.cc, 1);
          }
          console.log(`     （資訊）筆電輸入列背景：OLD ${r.mb.bg.composer} → NEW ${r.ma.bg.composer}`);
        });
      }
    }

    // ── D7 無 duo-device ──
    {
      const NON = [
        { name: "一般 iPhone 390×844", o: { vw: 390, vh: 844, safeTop: 47, safeBottom: 34 } },
        { name: "iPad 原生 820×1180", o: { vw: 820, vh: 1180, safeTop: 24, safeBottom: 20 } },
        { name: "Duo 尺寸但無 hinge（原生 669×951）", o: { vw: 669, vh: 951 } },
        { name: "web 窄版 669×951", o: { vw: 669, vh: 951, native: false } },
        { name: "web 桌機 1280×800", o: { vw: 1280, vh: 800, native: false, mobile: false } },
      ];
      for (const N of NON)
        for (const v of [{ chips: "normal" }, { chips: "many", kb: 320 }]) {
          const r = await compareOld({ ...N.o, ...v });
          await check(`D7 無 duo-device：${N.name}${v.kb ? "＋鍵盤" : ""}：所有元素量測（含背景）＝移除新規則時（${r.a.els.length} 個元素）`, () => {
            assert.ok(r.a.els.length > 30);
            assert.equal(r.same, true, "不同：" + JSON.stringify(r.diff.slice(0, 3)));
          });
        }
    }

    // ── D8 B0 對照 ──
    {
      const r = await assertFullOpaque({ device: true, chips: "normal", css: "old" });
      const rk = await assertFullOpaque({ device: true, chips: "normal", kb: 320, css: "old" });
      await evaluate("window.setCss('new')");
      await check("D8 B0 對照：移除 duo-device 規則時，直向與鍵盤開的 D1 滿版、D2 不透明斷言都會失敗（斷言有效）", () => {
        for (const x of [r, rk]) for (const k of ["D1 滿版", "D2 不透明"]) assert.ok(x.errs.some((e) => e.startsWith(k)), k + " 應失敗：" + JSON.stringify(x.errs));
        console.log(`     （資訊）OLD：輸入列 [${r.m.composer.l}, ${r.m.composer.r}]；透出像素 ${r.px.diff}；落在後方元素 ${r.hits.bad.length} 點`);
      });
    }

    // ── Part H：真實 hook／_app.tsx ──
    // 每個情境重新載入頁面：duo-hinge 的 module-level 狀態（外掛快取）重置，對應實機「平台在執行期間不會改變」
    const fresh = async () => {
      await evaluate("window.__hookReady=false");
      await load("/hook?" + Math.random(), "__hookReady");
    };
    await fresh();
    const tick = async (n = 3) => {
      for (let i = 0; i < n; i++) await evaluate("window.tick()");
    };
    {
      await evaluate("window.setEnv(false,'ok',{supported:true,status:'fullyOpen',angle:180,divisions:[],occlusions:[]})");
      await ev("mountProbe");
      await tick();
      const v = await ev("probe");
      const reg = await ev("registered");
      await ev("unmount");
      await check("H1 非原生（web）：useDuoDevice＝false，且不註冊 DuoHinge 外掛", () => {
        assert.equal(v, "false");
        assert.deepEqual(reg, []);
      });
    }
    {
      await fresh();
      await evaluate("window.setEnv(true,'ok',{supported:false,status:'unknown',angle:null,divisions:[],occlusions:[]})");
      await ev("mountProbe");
      await tick();
      const v = await ev("probe");
      await ev("unmount");
      await fresh();
      await evaluate("window.setEnv(true,'missing')");
      await ev("mountProbe");
      await tick();
      const v2 = await ev("probe");
      await ev("unmount");
      await check("H2／H3 原生 iOS：外掛回報 supported:false → false；外掛不存在（呼叫 reject）→ false", () => {
        assert.equal(v, "false");
        assert.equal(v2, "false");
      });
    }
    {
      await fresh();
      await evaluate("window.setEnv(true,'ok',{supported:true,status:'fullyOpen',angle:180,divisions:[],occlusions:[]})");
      const first = await ev("mountProbe");
      await tick();
      const on = await ev("probe");
      const n1 = await ev("emit", { supported: false });
      const off = await ev("probe");
      await ev("emit", { supported: true, status: "partiallyOpen", angle: 90, divisions: [], occlusions: [] });
      const on2 = await ev("probe");
      const ssr = await ev("ssr");
      await ev("unmount");
      await check("H4 原生 iOS supported:true：初次 false（尚未回報）→ true；hingeChange unsupported → false、再 supported → true", () => {
        assert.equal(first, "false", "初次（外掛尚未回報）");
        assert.equal(on, "true", "getState 回報 supported 後");
        assert.ok(n1 >= 1, "外掛 listener 未註冊");
        assert.equal(off, "false", "hingeChange unsupported 後");
        assert.equal(on2, "true", "hingeChange 再 supported 後");
      });
      await check("H5 SSR（renderToString）：client store 為 supported 時仍輸出 false（getServerSnapshot）", () => {
        assert.match(ssr, /data-v="false"/);
      });
    }
    {
      // _app.tsx：非原生 → 從不加 duo-device
      await fresh();
      await evaluate("window.setEnv(false,'ok',{supported:true,status:'fullyOpen',angle:180,divisions:[],occlusions:[]})");
      await ev("mountApp", true);
      await tick();
      const webCls = await ev("htmlCls");
      await ev("unmount");
      // 原生＋supported
      await fresh();
      await evaluate("window.setEnv(true,'ok',{supported:true,status:'fullyOpen',angle:180,divisions:[],occlusions:[]})");
      const c0 = await ev("mountApp", true);
      await tick();
      const c1 = await ev("htmlCls");
      await ev("emit", { supported: false });
      const c2 = await ev("htmlCls");
      await ev("emit", { supported: true, status: "fullyOpen", angle: 180, divisions: [], occlusions: [] });
      const c3 = await ev("htmlCls");
      await ev("unmount");
      const c4 = await ev("htmlCls");
      // 原生但不支援（外掛不存在）
      await fresh();
      await evaluate("window.setEnv(true,'missing')");
      await ev("mountApp", false);
      await tick();
      const c5 = await ev("htmlCls");
      await ev("unmount");
      await check("H6 _app.tsx（StrictMode）：supported 時 <html> 加 duo-device、unsupported 移除、再 supported 加回、unmount 移除；非原生／外掛不存在從不加；不加 duo-rail／duo-laptop", () => {
        assert.ok(!webCls.includes("duo-device"), "非原生加了 duo-device：" + webCls);
        assert.ok(!c0.includes("duo-device"), "外掛回報前就加了 duo-device");
        assert.ok(c1.includes("duo-device"), "supported 後未加 duo-device：" + c1);
        assert.ok(!c2.includes("duo-device"), "unsupported 後未移除：" + c2);
        assert.ok(c3.includes("duo-device"), "再 supported 未加回：" + c3);
        assert.ok(!c4.includes("duo-device"), "unmount 後未移除：" + c4);
        assert.ok(!c5.includes("duo-device"), "外掛不存在卻加了 duo-device：" + c5);
        for (const c of [c1, c3]) for (const k of ["duo-rail", "duo-two-pane", "duo-laptop"]) assert.ok(!c.includes(k), "多加了 " + k);
        assert.equal(c1.filter((x) => x === "duo-device").length, 1);
        assert.ok(c1.includes("chat-route-active"), "fixture：_app 未套用 /chat 路由 class");
      });
    }

    await check("H9 瀏覽器無例外、無外部網路請求", () => {
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(externalRequests, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    server.closeAllConnections?.();
    stop();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

if (failures.length) {
  console.log(`\nverify-duo-device-chat-composer: FAIL（${failures.length}）\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log("\nverify-duo-device-chat-composer: PASS");
