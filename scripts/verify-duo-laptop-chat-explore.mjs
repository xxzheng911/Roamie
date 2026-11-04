// verify-duo-laptop-chat-explore.mjs — iPhone Duo 筆電半開：聊聊（/chat）與探索（/map）上下分區版型（任務單 #H2b-1-T）
//
// Part A（靜態）
//   A1 src/routes/_app.chat.tsx 差異只落在 #L1 生成鎖與 #PL-FIX Planner 授權段落（移除後＝95e7866a0e96f036；不寫死目前 sha）
//   （#TS-BASE：下列「相對 HEAD」一律改為相對功能 commit 前基準 aa2db59＝PRE_FEATURE_BASE）
//   A2b （#H3-1）_app.map.tsx、map-search-keyboard.ts 相對 HEAD 只新增詳情一頁式 effect／鍵盤動畫 class 兩段
//   A2 探索／聊聊相關元件（MapExploreSheet、MapSearchBarOverlay、GoogleMapBackground、ChatComposer、
//      use-messenger-chat-layout 等）相對 HEAD 無變更 → 姿勢切換只靠 CSS class，React 樹不變（不 remount、不重新搜尋）
//   A3 新規則（聊聊／探索）位於筆電區塊內、地點詳情雙頁區塊之前、@layer 外；每個 selector 以列舉的前綴開頭；
//      styles.css 最後一條規則屬 .place-duo-root；styles.css 相對 HEAD 只有新增
//   A4 fixture 依賴的原始碼契約（inline style、版面公式）仍存在，避免 fixture 與實作脫節
//
// Part B（headless Chrome＋以目前 styles.css 實際編譯的 Tailwind CSS）
//   fixture 的 class 字串由原始碼抽取（MobileFrame／_app.tsx／BottomNav／_app.chat.tsx／ChatComposer／_app.map.tsx／
//   MapExploreSheet／MapSearchBarOverlay／MapExploreSearchResults／MapExploreCategoryChips／MapExplorePlaceCards／
//   GoogleMapBackground／PlaceDetailSheet／ui/*）；inline style 依原始碼公式計算（見 A4）。
//   map-visible-padding 以 esbuild 打包「真實」src/lib/map-visible-padding.ts 在頁面中呼叫。
//   CSS 有兩份：NEW＝目前 styles.css；OLD＝移除本任務新增的聊聊／探索筆電規則（其餘不變）。
//
//   C*  聊聊（筆電：底部導覽 safe-bottom 0／20、右側直欄；快捷按鍵列 無／一般／很多）
//       C1 標頭與訊息列表在上半部、列表下緣＝摺痕上緣、可捲動、捲到底最後一個按鈕可點
//       C2 快捷按鍵列＋輸入列在下半部 [摺痕下緣, 底部導覽上緣]、可點
//       C3 摺痕帶 elementFromPoint 沒有可點元素
//       C4 fixed 元素（輸入列、導覽、浮層）祖先鏈無 transform／filter／contain／will-change／overflow 捲動容器
//       C5 浮層（置中對話框、底部／頂部／側邊面板）不跨摺痕
//       C6 鍵盤開（chat-keyboard-open，第 2 版）：輸入列照既有邏輯貼鍵盤（垂直位置與舊 CSS 相同）但維持全寬；
//          推薦區 visibility hidden（DOM 保留、捲動位置保留＝C6b）；輸入列子樹以外與移除新規則時完全相同
//       C2c 輸入列（快捷按鍵列＋輸入框）拉滿下半部寬度
//       C7 推薦區（第 2 版，fixture＝portal 到 body 的 aside.chat-laptop-rec）：[摺痕下緣, 輸入列上緣]、不進摺痕帶、
//          卡片橫向排列可橫捲、照片 96px、卡片內捲到底按鈕可點、訊息列標籤可點；C7e 量到輸入列高度前的預設值
//       C8 無推薦時（推薦區不渲染）其餘斷言仍成立
//       （React 實際渲染、handler、切換、remount 見 verify-chat-duo-laptop-rec-pane.mjs）
//   M*  探索（筆電：底部導覽 safe-bottom 0／20、右側直欄）
//       M1 地圖層與地圖畫布＝上半部 [0, 摺痕上緣]
//       M2 搜尋列、分類膠囊、地點清單（面板）在下半部且可點；面板填滿、拖曳把手停用
//       M3 摺痕帶沒有可點元素（含地圖畫布）
//       M4 真實 measureMapExplorePadding：筆電時可視區＝上半部（不被搜尋列／面板遮住、不跨摺痕）
//       M5 地點詳情（同一面板）在下半部、遮罩只蓋上半部；搜尋下拉（失焦）在下半部、疊在面板上可點
//       M6 搜尋聚焦（map-keyboard-open）：搜尋列、下拉與面板層整塊在上半部（#H3-1 新設計）、有建議時面板 hidden、不跨摺痕
//       M7 探索頁無 fixed 元素；浮層不跨摺痕
//       M8 姿勢切換：同一 DOM 節點、面板尺寸變化會觸發 ResizeObserver（GoogleMapBackground 重新同步 padding）
//   E*  邊界：摺痕下方剛好 200px（duo-laptop 判定下限）時下半部仍放得下輸入列／搜尋列＋膠囊
//       E3 聊聊推薦區在下半部 200～386.5px 時卡片可視高度（只記錄、不判失敗：使用者裁定接受極矮時推薦卡幾乎看不到，
//          因 Duo 摺痕為硬體固定於螢幕中間，見 E3 區塊註解）
//   N*  非筆電（一般 iPhone、Duo 合起（直欄單頁）、Duo 雙欄、iPad、web、殘留 --duo-hinge-* 變數、鍵盤開）：
//       整頁所有元素的位置／尺寸／關鍵 computed style 與移除新規則時完全相同
//   B0  對照：OLD CSS（移除新規則）＋筆電 class 時，C／M 的主要斷言必須失敗（證明斷言有效）
//   B9  無外部請求、無瀏覽器例外
//
// 限制：headless Chrome 不會重現 iOS WebKit「捲動容器裁切 fixed 子孫」，C4 以祖先鏈結構斷言代替；
//   不渲染真實 React 元件（_app.chat.tsx 14k 行、依賴大量服務）；React 樹不變以 A2（元件未修改、只有 CSS／padding 變更）佐證。
// 執行：node scripts/verify-duo-laptop-chat-explore.mjs（不讀 .env、不連網）

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
// #TS-BASE：功能 commit（943a047…）之前的基準 commit。功能已 commit 進 HEAD 後，A2／A2b／A3「相對 HEAD」比對會因
//   HEAD＝工作區而失效，改以此基準比對（日後基準前移時只改這一行；ChatComposer 的基準在 verify-chat-generation-lock-authorized-diff.mjs）。
const PRE_FEATURE_BASE = "aa2db59";
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

// ───────────────────────── Part A：靜態 ─────────────────────────
// #L1-T2：_app.chat.tsx 經 #L1（行程生成全域鎖）授權修改，sha256 前 16 碼 95e7866a0e96f036 作廢 → bb3a7f395ea8d58e。
// #L1-T3：第 2 輪授權修改（清除聊聊上鎖、離開原對話時的失敗提示、提示取目前語系）→ 1f9f6c91787031f6（bb3a7f395ea8d58e 作廢）。
// #L1-T4：第 3 輪授權修改（不在原對話時失敗只一則提示、具體原因、保存後失效改發完成提示、finally 通知 try／catch）→ 8e2dd996d9c89771（1f9f6c91787031f6 作廢）。
//   「聊聊頁除生成鎖外未修改（React 樹不變）」改由 verify-chat-generation-lock-authorized-diff.mjs 逐字移除授權段落後與改動前版本比對。
// #PL-FIX-T3：不再寫死 _app.chat.tsx 的 sha（#PL-FIX 授權變更後 sha 隨 Planner 段落改變）。改為逐字移除 #L1 生成鎖與
//   #PL-FIX Planner 選擇入口的授權段落（長段落以 sha16 釘死）後必須＝改動前版本 95e7866a0e96f036：
//   聊聊頁差異只能落在授權段落，Duo 工作若改到聊聊頁任何其他地方都會失敗。
await check("A1 src/routes/_app.chat.tsx 差異只落在授權的 #L1 生成鎖與 #PL-FIX Planner 段落（移除後＝95e7866a0e96f036）", async () => {
  const { assertChatTsxOnlyLockChanges } = await import("./verify-chat-generation-lock-authorized-diff.mjs");
  const h = assertChatTsxOnlyLockChanges();
  assert.equal(typeof h, "string");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "src/routes/_app.chat.tsx"))).digest("hex"), h);
});

// #H3-1-T：_app.map.tsx 與 map-search-keyboard.ts 已授權修改（地點詳情一頁式 class、鍵盤開合動畫 class），
//   改由 A2b 檢查「相對 HEAD 只有新增這兩段、其餘逐字相同」；其他元件仍須完全未改。
const UNCHANGED = [
  "src/components/MapExploreSheet.tsx",
  "src/components/MapExploreSheetSafe.tsx",
  "src/components/map/MapSearchBarOverlay.tsx",
  "src/components/map/MapExploreSearchResults.tsx",
  "src/components/map/MapExploreCategoryChips.tsx",
  "src/components/map/MapExplorePlaceCards.tsx",
  "src/components/map/GoogleMapBackground.tsx",
  "src/hooks/use-messenger-chat-layout.ts",
  "src/lib/app-scroll-contract.ts",
];
await check(`A2 探索／聊聊元件相對 ${PRE_FEATURE_BASE} 無變更（姿勢切換只靠 CSS class，React 樹不變）；ChatComposer 只有 #L1 生成鎖段落`, async () => {
  // #TS-BASE：工作區 vs 功能 commit 前基準（涵蓋已 commit 與未 commit 的變更）
  const out = execFileSync("git", ["diff", "--name-only", PRE_FEATURE_BASE, "--", ...UNCHANGED], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(out, "", "下列檔案有變更：\n" + out);
  // #L1-T2：ChatComposer.tsx 經 #L1 授權新增 lockedPlaceholder／lockedHint（未鎖時不傳，DOM 與基準相同）。
  //   逐字移除這些段落後必須與 PRE_FEATURE_BASE 版相同（其他變更仍會失敗；基準定義在 verify-chat-generation-lock-authorized-diff.mjs）。
  const { assertComposerOnlyLockChanges } = await import("./verify-chat-generation-lock-authorized-diff.mjs");
  assertComposerOnlyLockChanges();
});
await check(`A2b _app.map.tsx／map-search-keyboard.ts 相對 ${PRE_FEATURE_BASE} 只新增 #H3-1 的兩段＋#H3-2 鍵盤上緣段（移除後與基準逐字相同；JSX 不變）`, () => {
  const head = (p) => execFileSync("git", ["show", PRE_FEATURE_BASE + ":" + p], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const cut = (s, from, to, label) => {
    const a = s.indexOf(from);
    const b = s.indexOf(to, a);
    assert.ok(a >= 0 && b > a, "找不到段落：" + label);
    return s.slice(0, a) + s.slice(b + to.length);
  };
  let map = read("src/routes/_app.map.tsx");
  map = map.replace('import { useDuoFlatPortrait, useDuoLaptop } from "@/hooks/use-duo-laptop";\nimport { useDuoLayout } from "@/hooks/use-duo-layout";\n', "");
  map = cut(map, "  // iPhone Duo 筆電／直向攤平（雙欄除外", "  }, [duoMapDetailPage]);\n\n", "_app.map.tsx 詳情一頁式 effect");
  // #L1-T2：#L1 行程生成全域鎖授權新增兩段（import 一行、openInChat 開頭一行），各恰好一次
  for (const line of [
    'import { blockIfChatGenerationLocked } from "@/lib/ai/chat-generation-lock";\n',
    '  const openInChat = (p: MapPlaceCard) => {\n    if (blockIfChatGenerationLocked(tt("uiCoverage.chatGenerationLockedNotice"))) return;\n',
  ]) {
    assert.equal(map.split(line).length, 2, "#L1 段落應恰好一次：" + JSON.stringify(line.slice(0, 80)));
  }
  map = map.replace('import { blockIfChatGenerationLocked } from "@/lib/ai/chat-generation-lock";\n', "");
  map = map.replace('    if (blockIfChatGenerationLocked(tt("uiCoverage.chatGenerationLockedNotice"))) return;\n', "");
  assert.equal(map, head("src/routes/_app.map.tsx"), "_app.map.tsx 有上述兩段以外的變更");
  let kb = read("src/lib/map-search-keyboard.ts");
  // #H3-2：鍵盤上緣變數（--duo-map-keyboard-top）——import、整段函式、enter／exit／reset／release 的呼叫各一行
  {
    const IMP = 'import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";\n';
    assert.equal(kb.split(IMP).length, 2, "#H3-2 import 應恰好一行");
    kb = kb.replace(IMP, "");
    kb = cut(kb, "/**\n * iPhone Duo 上下版型（html.duo-laptop／html.duo-flat-portrait）：鍵盤展開時把鍵盤上緣", "    onHide: clearDuoKeyboardTop,\n  });\n}\n\n", "map-search-keyboard #H3-2 鍵盤上緣");
    assert.equal(kb.split("    startDuoKeyboardTop();\n").length, 2, "startDuoKeyboardTop 應只在 enter 呼叫一次");
    kb = kb.replace("    startDuoKeyboardTop();\n", "");
    assert.equal(kb.split("  stopDuoKeyboardTop();\n").length, 4, "stopDuoKeyboardTop 應只在 release／exit／reset 各呼叫一次");
    kb = kb.split("  stopDuoKeyboardTop();\n").join("");
  }
  kb = cut(kb, "/**\n * iPhone Duo 上下版型","    cl.remove(DUO_KB_ANIM_CLASS);\n  }, DUO_KB_ANIM_MS);\n}\n\n", "map-search-keyboard 動畫函式");
  kb = kb.split("  clearDuoKeyboardAnim();\n").join("");
  kb = kb.replace("    markDuoKeyboardAnim();\n", "").replace('  if (document.documentElement.classList.contains("map-keyboard-open")) markDuoKeyboardAnim();\n', "");
  assert.equal(kb, head("src/lib/map-search-keyboard.ts"), "map-search-keyboard.ts 有動畫 class 以外的變更");
});

const blockStart = styles.indexOf(" * iPhone Duo 筆電半開（橫向摺痕）");
const placeStart = styles.indexOf(" * 地點詳情頁雙頁");
const newStart = styles.indexOf(" * 筆電半開＋聊聊（/chat");
const newRegionStart = styles.lastIndexOf("/*", newStart);
const newRegionEnd = styles.lastIndexOf("/*", placeStart);
const newRegion = styles.slice(newRegionStart, newRegionEnd);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const selectorsOf = (s) =>
  [...stripComments(s).matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
// 本任務新增規則允許的 selector 前綴（逐一列舉，不放寬成任意 html.duo-laptop）
// 第 2 輪（聊聊第 2 版＋探索路由限定）：新增輸入列全寬（.messenger-chat-composer）、下半部推薦區（.chat-laptop-rec*）；
//   探索規則改為 html.duo-laptop.map-route-active，舊的未限定路由前綴（html.duo-laptop .map-page …）移除、不再允許。
const NEW_PREFIXES = [
  "html.duo-laptop.chat-route-active:not(.chat-keyboard-open) .messenger-chat-messages",
  "html.duo-laptop.chat-route-active .messenger-chat-composer",
  "html.duo-laptop.chat-route-active .chat-laptop-rec",
  "html.duo-laptop.chat-route-active .chat-laptop-rec__scroll",
  "html.duo-laptop.chat-route-active [",
  "html.duo-laptop.map-route-active [",
  "html.duo-laptop.map-route-active .map-page",
  // #H3-1-T：探索頁鍵盤整塊上滑（map-keyboard-open）、開合動畫（duo-map-kb-anim）、地點詳情一頁式（duo-map-detail-page），
  //   以及直向攤平（duo-flat-portrait，與筆電規則逐條成對，見 verify-duo-explore-keyboard-flat.mjs A7）。
  //   舊的「:not(.map-keyboard-open) .map-page > .map-stage > .z-10」規則已改寫為無 :not 的版本＋鍵盤展開覆寫，故移除。
  "html.duo-flat-portrait.map-route-active .map-page",
  "html.duo-laptop.map-route-active.map-keyboard-open .map-page",
  "html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page",
  "html.duo-laptop.map-route-active.duo-map-kb-anim .map-page",
  "html.duo-flat-portrait.map-route-active.duo-map-kb-anim .map-page",
  "html.duo-laptop.map-route-active.duo-map-detail-page .map-page",
  "html.duo-flat-portrait.map-route-active.duo-map-detail-page .map-page",
];
// 只允許逐字相同（不接受後代 selector）
const NEW_EXACT = [
  "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec",
  // #H3-1-T：有搜尋建議（搜尋列外層第 2 個子元素）時隱藏面板內容
  'html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"]',
  'html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"]',
  // #H3-2-T2：內容外層（appContentWrapperClass 鎖定時 overflow hidden、起點在 main padding-top 下方）會裁掉 .map-page 的 -mt，
  //   頂端露出米白底；只在筆電／直向攤平＋/map 改為 overflow visible，由 main（overflow hidden !important，padding box 含 padding-top）裁切。
  //   逐字列舉（不接受後代 selector）；宣告與範圍另見 verify-duo-explore-keyboard-flat.mjs A8c／K14。
  "html.duo-laptop.map-route-active main.app-scroll > div",
  "html.duo-flat-portrait.map-route-active main.app-scroll > div",
];
// #H2b-3-T：本段落之後另有收藏／首頁／我的規則（註解「筆電半開＋收藏（/saved」起）。逐字列舉（不用前綴），
//   順序與內容都必須相同；量測見 verify-duo-laptop-saved-home-profile.mjs。
const SHP_OVERLAY_TAILS = [
  ' [role="dialog"][class*="translate-y-[-50%]"]',
  ' [role="alertdialog"][class*="translate-y-[-50%]"]',
  ' [data-vaul-drawer][data-vaul-drawer-direction="bottom"]',
  ' [role="dialog"][class*="slide-in-from-bottom"]',
  ' [data-vaul-drawer][data-vaul-drawer-direction="top"]',
  ' [role="dialog"][class*="slide-in-from-top"]',
  ' [role="dialog"][class*="slide-in-from-right"]',
  ' [role="dialog"][class*="slide-in-from-left"]',
];
const SHP_EXACT = [
  "html.duo-laptop .saved-laptop-root",
  "html.duo-laptop .saved-laptop-root > .saved-duo-header",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:first-child",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:last-child",
  // #H2b-4 第 2 輪：收藏下半部讓出導覽 1px 上框線、空白提示卡縮小留白
  "html.duo-laptop .saved-laptop-root",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:last-child > .border-dashed",
  // #H2b-5：首頁／我的改回一頁式捲動，home-laptop-*／profile-laptop-root/card/plus 版面規則已移除（下方另檢查不得存在）
  ...[[0, 2], [2, 4], [4, 6], [6, 8]].flatMap(([a, b]) =>
    ["saved", "home", "profile"].flatMap((p) => SHP_OVERLAY_TAILS.slice(a, b).map((t) => `html.duo-laptop.${p}-laptop-active${t}`)),
  ),
  // #H2b-4 第 2 輪：我的頁裁切編輯器（唯一 h-[92dvh] 底部 Sheet）維持手機全高
  'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]',
];
const shpStart = styles.indexOf(" * 筆電半開＋收藏（/saved");
const shpRegionStart = shpStart > 0 ? styles.lastIndexOf("/*", shpStart) : newRegionEnd;
const chatMapRegion = styles.slice(newRegionStart, shpRegionStart);
const shpRegion = styles.slice(shpRegionStart, newRegionEnd);
const allowedNew = (s) => NEW_EXACT.includes(s) || NEW_PREFIXES.some((p) => s === p || s.startsWith(p.endsWith("[") ? p : p + " "));
await check("A3 新規則：筆電區塊內、地點詳情雙頁之前、@layer 外、selector 前綴逐一列舉；最後規則屬 .place-duo-root；只新增", () => {
  assert.ok(blockStart > 0 && newStart > blockStart && placeStart > newStart, "位置：筆電區塊 < 聊聊／探索規則 < 地點詳情雙頁");
  assert.ok(shpStart > newStart && shpRegionStart < newRegionEnd, "收藏／首頁／我的段落須在聊聊／探索段落之後、地點詳情雙頁之前");
  assert.deepEqual(selectorsOf(shpRegion), SHP_EXACT, "收藏／首頁／我的段落 selector 與逐字列舉清單不同");
  assert.doesNotMatch(
    stripComments(styles.slice(0, shpRegionStart) + styles.slice(newRegionEnd)),
    /saved-laptop|home-laptop|profile-laptop/,
    "收藏／首頁／我的筆電規則出現在其段落以外",
  );
  assert.doesNotMatch(stripComments(styles), /home-laptop-root|home-laptop-bottom|profile-laptop-root|profile-laptop-card|profile-laptop-plus/, "殘留已移除的首頁／我的筆電版面規則");
  const sels = selectorsOf(chatMapRegion);
  assert.ok(sels.length >= 20, "selector 數量：" + sels.length);
  const bad = sels.filter((s) => !allowedNew(s));
  assert.deepEqual(bad, [], "不在允許清單的 selector");
  const unused = [...NEW_PREFIXES, ...NEW_EXACT].filter((p) => !sels.some((s) => s === p || (!NEW_EXACT.includes(p) && s.startsWith(p.endsWith("[") ? p : p + " "))));
  assert.deepEqual(unused, [], "白名單有未使用的項目");
  // duo-flat-portrait 只用於探索頁（map-route-active）
  assert.deepEqual(sels.filter((s) => !/^html\.(duo-laptop\.(chat|map)|duo-flat-portrait\.map)-route-active[\s.:[]/.test(s)), [], "未限定路由（chat-route-active／map-route-active）的 selector");
  for (const s of [
    "html.duo-laptop .map-page",
    "html.duo-laptop .map-page > .map-stage",
    "html.duo-laptop:not(.map-keyboard-open) .map-page > .map-stage > .z-10",
    "html.duo-laptop .chat-laptop-rec",
    "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec .x",
    "html.duo-laptop.chat-route-active .chat-laptop-recx",
    "html.duo-laptop.chat-route-active .messenger-chat-composerx",
    "html.duo-laptop.chat-route-active main",
    "html.duo-laptop.map-route-active main",
    "html.duo-flat-portrait .map-page",
    "html.duo-flat-portrait.chat-route-active .messenger-chat-composer",
    "html.duo-flat-portrait.map-route-active main",
    "html.duo-laptop.map-route-active.map-keyboard-open main",
    "html.duo-laptop.map-route-active.duo-map-kb-anim main",
    "html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(.x)",
    'html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"] .x',
    "html.duo-laptop.map-route-active main.app-scroll",
    "html.duo-laptop.map-route-active main.app-scroll > div > div",
    "html.duo-laptop.map-route-active main.app-scroll > div .x",
    "html.duo-flat-portrait.map-route-active main.app-scroll > div *",
    "html.duo-laptop main.app-scroll > div",
    "html.duo-laptop.chat-route-active main.app-scroll > div",
    "html.duo-laptop.map-route-active.map-keyboard-open main.app-scroll > div",
  ])
    assert.equal(allowedNew(s), false, "白名單過寬，接受了：" + s);
  // .chat-laptop-rec 只出現在本段落（且皆為 chat-route-active 前綴，上面已檢查）
  const outsideRegion = stripComments(styles.slice(0, newRegionStart) + styles.slice(newRegionEnd));
  assert.doesNotMatch(outsideRegion, /chat-laptop-rec/, ".chat-laptop-rec 規則出現在本段落以外");
  const nc = styles.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  let depth = 0;
  const depthAt = [];
  for (let i = 0; i < nc.length; i++) {
    depthAt[i] = depth;
    if (nc[i] === "{") depth++;
    else if (nc[i] === "}") depth--;
  }
  for (const m of nc.slice(newRegionStart, newRegionEnd).matchAll(/([^{}]+)\{[^{}]*\}/g))
    assert.equal(depthAt[newRegionStart + m.index + m[0].indexOf("{")], 0, "規則在 @layer／區塊內：" + m[1].trim().slice(0, 80));
  const rules = [...nc.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.match(rules[rules.length - 1][1], /\.place-duo-root/);
  // #TS-BASE：「只新增」對 PRE_FEATURE_BASE 比對；numstat 為空時 [1] 為 undefined → 失敗
  const numstat = execFileSync("git", ["diff", "--numstat", PRE_FEATURE_BASE, "--", "src/styles.css"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(numstat.split(/\s+/)[1], "0", `styles.css 相對 ${PRE_FEATURE_BASE} 有刪除行：` + numstat);
});

const src = {
  frame: read("src/components/MobileFrame.tsx"),
  app: read("src/routes/_app.tsx"),
  contract: read("src/lib/app-scroll-contract.ts"),
  nav: read("src/components/BottomNav.tsx"),
  chat: read("src/routes/_app.chat.tsx"),
  composer: read("src/components/chat/ChatComposer.tsx"),
  pane: read("src/components/chat/ChatDuoRecommendationPane.tsx"),
  list: read("src/components/chat/ChatMessageList.tsx"),
  layoutHook: read("src/hooks/use-messenger-chat-layout.ts"),
  map: read("src/routes/_app.map.tsx"),
  sheet: read("src/components/MapExploreSheet.tsx"),
  search: read("src/components/map/MapSearchBarOverlay.tsx"),
  results: read("src/components/map/MapExploreSearchResults.tsx"),
  chips: read("src/components/map/MapExploreCategoryChips.tsx"),
  cards: read("src/components/map/MapExplorePlaceCards.tsx"),
  canvas: read("src/components/map/GoogleMapBackground.tsx"),
  detail: read("src/components/map/PlaceDetailSheet.tsx"),
  alert: read("src/components/ui/alert-dialog.tsx"),
  uisheet: read("src/components/ui/sheet.tsx"),
  drawer: read("src/components/ui/drawer.tsx"),
};
/** 取出原始碼中包含 needle 的字串常值（" 或 `，遇 ${ 停止）；nth 指第幾次出現 */
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
/** 原始碼必須含有完整字串常值 "<str>" */
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
    MAIN_PB: lit("app", "pb-[var(--app-nav-total-height)]"),
    MAIN_LOCK: exact("app", "min-h-0 flex-1 overflow-hidden"),
    CONTENT: lit("contract", "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"),
    NAV_BOTTOM: lit("nav", "bottom-nav fixed"),
    NAV_RAIL: lit("nav", "app-right-rail fixed"),
    NAV_UL: lit("nav", "flex h-[var(--bottom-nav-height,4.25rem)]"),
    // 聊聊
    CHAT_ROOT: lit("chat", "messenger-chat-root"),
    CHAT_HEADER: lit("chat", "messenger-chat-header"),
    CHAT_BACK: exact("chat", "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"),
    CHAT_CLEAR: lit("chat", "relative z-20 flex h-11 w-11"),
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
    // 筆電推薦區（ChatDuoRecommendationPane variant="laptop"）與訊息列標籤（ChatMessageList）
    REC: exact("pane", "chat-laptop-rec"),
    REC_TITLE: lit("pane", "flex shrink-0 items-center gap-1 px-5"),
    REC_SCROLL: exact("pane", "chat-laptop-rec__scroll"),
    TAG_WRAP: exact("list", "basis-full pl-[2.625rem]"),
    TAG: lit("list", "inline-flex items-center gap-1 rounded-full border px-2.5 py-1"),
    // 探索
    MAP_PAGE: lit("map", "map-page relative"),
    MAP_STAGE: lit("map", "map-stage absolute"),
    MAP_UNAVAILABLE: lit("map", "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cream"),
    MAP_OVERLAY_WRAP: exact("map", "pointer-events-none absolute inset-0 z-10"),
    MAP_DIM: lit("map", "pointer-events-none absolute inset-0 z-[5]"),
    // #H3-1-T2：needle 必須是 JSX className 的開頭。_app.map.tsx 的詳情一頁式 effect（K5）在 JSX 之前新增了
    //   selector 字串 ".map-page > .map-sheet-layer, …"，只用 "map-sheet-layer" 會抽到 selector，面板層失去定位（量到 0×0）。
    MAP_LAYER: lit("map", "map-sheet-layer pointer-events-none"),
    MAP_SHEET_TITLE_WRAP: exact("map", "px-5 pb-2"),
    MAP_CANVAS: lit("canvas", "map-stage-canvas"),
    SEARCH_OUTER: lit("search", "pointer-events-none absolute inset-x-0 top-0 z-20"),
    SEARCH_ROW: exact("search", "pointer-events-auto flex items-center gap-2"),
    SEARCH_FORM: lit("search", "flex min-w-0 flex-1 items-center gap-2 rounded-full"),
    SEARCH_INPUT: lit("search", "min-w-0 flex-1 bg-transparent text-sm"),
    SEARCH_LOCATE: lit("search", "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"),
    RESULTS: lit("results", "pointer-events-auto mt-2 max-h-"),
    RESULTS_UL: lit("results", "max-h-[min(42vh,300px)] overflow-y-auto"),
    RESULTS_ITEM: lit("results", "flex w-full items-start gap-2 rounded-xl"),
    SHEET: lit("sheet", "pointer-events-auto relative z-40 flex w-full"),
    SHEET_ISOLATE: exact("sheet", "isolate"),
    SHEET_HEADWRAP: lit("sheet", "min-w-0 shrink-0 overflow-visible bg-cream"),
    SHEET_HANDLE: lit("sheet", "cursor-grab select-none bg-cream"),
    SHEET_HANDLE_INNER: lit("sheet", "flex justify-center bg-cream py-2.5"),
    SHEET_HANDLE_BAR: lit("sheet", "block h-1 w-11"),
    SHEET_HEADER: lit("sheet", "min-w-0 w-full overflow-visible bg-cream"),
    SHEET_BODY: lit("sheet", "min-h-0 min-w-0 flex-1 overflow-y-auto"),
    SHEET_BODY_INNER: lit("sheet", "min-w-0 w-full overflow-x-visible bg-cream pb-4"),
    CHIPS: lit("chips", "map-explore-chips"),
    CHIPS_INNER: lit("chips", "inline-flex max-w-none flex-nowrap"),
    CHIP: lit("chips", "shrink-0 grow-0 basis-auto"),
    CHIP_ON: exact("chips", "border-foreground bg-foreground text-background"),
    CHIP_OFF: exact("chips", "border-border bg-card"),
    CARDS_WRAP: exact("cards", "relative min-w-0 w-full"),
    CARDS: exact("cards", "map-explore-cards"),
    CARD: lit("cards", "map-place-card map-explore-card-item"),
    CARD_BORDER: exact("cards", "border-border hover:border-foreground/30"),
    CARD_COVER: lit("cards", "relative h-[170px] w-full"),
    CARD_SAVE: lit("cards", "absolute bottom-2 right-2 flex h-9 w-9"),
    DETAIL_HEADER: exact("detail", "flex items-center gap-2 px-5 pb-1 pt-0"),
    DETAIL_BACK: lit("detail", "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-soft"),
    // 浮層（ui/*）
    ALERT: lit("alert", "fixed left-[50%] top-[50%]"),
    UISHEET: lit("uisheet", "fixed z-50 gap-4 bg-background p-6"),
    UISHEET_BOTTOM: lit("uisheet", "inset-x-0 bottom-0 border-t"),
    UISHEET_TOP: lit("uisheet", "inset-x-0 top-0 border-b"),
    UISHEET_RIGHT: lit("uisheet", "inset-y-0 right-0 h-full w-3/4"),
    DRAWER: lit("drawer", "fixed inset-x-0 bottom-0 z-50 mt-24"),
  };
  // #H3-1-T2：抽到的必須是 class 字串，不得是 CSS selector（含 > , : 或以 . 開頭的 token），避免抽取靜默錯位
  const notClassList = Object.entries(C).filter(([, v]) => /[>,]|(^|\s)\.[a-z]/i.test(v.replace(/\[[^\]]*\]/g, "")));
  assert.deepEqual(notClassList, [], "fixture 抽到的不是 class 字串（needle 命中了 selector 或其他常值）");
  assert.ok(C.MAP_LAYER.startsWith("map-sheet-layer ") && /\babsolute\b/.test(C.MAP_LAYER) && /\bz-40\b/.test(C.MAP_LAYER), "MAP_LAYER：" + C.MAP_LAYER);
  assert.ok(src.app.includes('pathname === "/chat" ? "pb-0"'), "_app：/chat 的 main 為 pb-0");
  for (const t of ['position: "fixed"', "left: 0", "right: 0", 'marginInline: "auto"', 'maxWidth: "440px"', "bottom: `${messengerLayout.composerBottomPx}px`", "zIndex: 45", 'flex: "1 1 0%"', "paddingBottom: `${Math.max(messengerLayout.messagesPaddingBottomPx, 0)}px`"])
    assert.ok(src.chat.includes(t), "_app.chat.tsx inline style 缺少：" + t);
  for (const t of [
    "? nativeKeyboardHeightPx\n      : bottomNavHeightPx + safeAreaBottomPx",
    "? composerHeightPx + nativeKeyboardHeightPx\n      : composerHeightPx + bottomNavHeightPx + safeAreaBottomPx",
    "const bottomNavHeightPx = Math.max(0, measuredTotal - safeAreaBottomPx);",
  ])
    assert.ok(src.layoutHook.includes(t), "use-messenger-chat-layout 公式已變更：" + t);
  for (const t of ["const COLLAPSED_FRACTION = 0.28;", "const MIN_SHEET_PX = 200;", "const DETAIL_SHEET_FRACTION = 0.82;", "isMapDetailOpen(sheetMode) ? 0.88 : 0.7"])
    assert.ok(src.sheet.includes(t), "MapExploreSheet 高度公式已變更：" + t);
  assert.ok(src.map.includes("{!searchDropdownOpen ? (\n                  <MapExploreCategoryChips"), "搜尋下拉開啟時隱藏分類膠囊");
  // 推薦區 fixture 依賴：portal 到 body、量測 .messenger-chat-composer 的 getBoundingClientRect 高度並寫入 CSS 變數
  for (const t of [
    'document.querySelector<HTMLElement>(".messenger-chat-composer")',
    "Math.round(el.getBoundingClientRect().height)",
    '"--chat-laptop-composer-height": `${composerHeight}px`',
    "document.body,",
    'data-variant="laptop"',
  ])
    assert.ok(src.pane.includes(t), "ChatDuoRecommendationPane 契約已變更：" + t);
});

// ───────────────────────── Part B：瀏覽器 ─────────────────────────
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
  window.state = {};
  // recPane（筆電第 2 版）：訊息列只留文字＋「推薦 · N」標籤，卡片在 body 下的推薦區
  const bubble = (i, recPane) =>
    `<div class="flex ${i % 2 ? "justify-start" : "justify-end"}${recPane && i % 3 === 2 ? " flex-wrap" : ""}"><div class="max-w-[85%] rounded-3xl bg-card px-4 py-3 text-[15px]">Message ${i} lorem ipsum dolor sit amet</div>` +
    (recPane && i % 3 === 2
      ? `<div class="${C.TAG_WRAP}"><button type="button" aria-pressed="false" data-btn="tag-${i}" class="${C.TAG} border-border bg-card text-muted-foreground">推薦 · 5</button></div>`
      : "") +
    `</div>` +
    (!recPane && i % 3 === 2
      ? `<div class="space-y-3" data-chat-place-cards><article class="overflow-hidden rounded-3xl border border-border bg-card"><div class="aspect-[16/10] w-full bg-secondary"></div><div class="p-4"><p>Place ${i}</p><button type="button" data-btn="card-${i}" class="mt-2 rounded-full bg-secondary px-3 py-2 text-xs">add ${i}</button></div></article></div>`
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
    const msgs = Array.from({ length: o.msgCount ?? 18 }, (_, i) => bubble(i, !!o.recPane)).join("");
    return `<div id="chatRoot" class="${C.CHAT_ROOT}">
 <header id="chatHeader" class="${C.CHAT_HEADER}"><button type="button" data-btn="back" class="${C.CHAT_BACK}">b</button>
  <div class="flex min-w-0 flex-1 items-center gap-2.5"><div class="h-9 w-9 rounded-full bg-secondary"></div><div class="min-w-0 flex-1"><p class="text-[15px] font-medium leading-tight">Roamie</p><p class="truncate text-[11px] text-muted-foreground">status</p></div></div>
  <button type="button" data-btn="clear" class="${C.CHAT_CLEAR}">x</button></header>
 <div id="chatBody" class="${C.CHAT_BODY}">
  <div id="msgs" data-keyboard-scroll-root class="${C.CHAT_MSGS}" style="flex:1 1 0%">
   <div class="${C.CHAT_INNER}">${msgs}<div class="flex justify-center"><button type="button" data-btn="retry" class="${C.CHAT_RETRY}">retry</button></div><div id="anchor" aria-hidden class="${C.CHAT_ANCHOR}"></div></div>
  </div>
  <div id="composer" class="${C.COMPOSER}${kb ? " " + C.COMPOSER_KB : ""}" style="position:fixed;left:0;right:0;margin-inline:auto;max-width:440px;z-index:45">
   <div id="cc" class="${C.CC_ROOT}${kb ? " pb-0" : ""}">${chips}
    <div id="inputRow" class="${C.CC_INPUT_ROW}"><textarea id="ta" rows="1" placeholder="說點什麼" class="${C.CC_TEXTAREA}"></textarea><button type="button" data-btn="send" class="${C.CC_SEND}">s</button></div>
   </div>
  </div>
 </div>
</div>`;
  }
  function mapDom(o) {
    const detail = !!o.detail;
    const dropdown = !!o.dropdown;
    const results = dropdown
      ? `<div id="results" class="${C.RESULTS}"><ul class="${C.RESULTS_UL}">${Array.from({ length: 8 }, (_, i) => `<li><button type="button" data-btn="res-${i}" class="${C.RESULTS_ITEM}"><div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">p</div><span>Result ${i}</span></button></li>`).join("")}</ul></div>`
      : "";
    const chips = dropdown
      ? ""
      : `<div id="chips" class="${C.CHIPS}" data-sheet-chips-scroll data-no-sheet-drag><div class="${C.CHIPS_INNER}" style="width:max-content">${Array.from({ length: 9 }, (_, i) => `<button type="button" data-btn="cat-${i}" class="${C.CHIP} ${i === 0 ? C.CHIP_ON : C.CHIP_OFF}">分類 ${i}</button>`).join("")}</div></div>`;
    const header = detail
      ? `<div id="detailHeader" class="${C.DETAIL_HEADER}" data-no-sheet-drag><button type="button" data-btn="detail-back" class="${C.DETAIL_BACK}">&lt;</button><p class="font-display text-lg leading-tight">地點詳情</p></div>`
      : `<div class="${C.MAP_SHEET_TITLE_WRAP}"><p class="font-display text-lg leading-tight">全部</p><p class="mt-0.5 text-xs text-muted-foreground">12 筆結果</p></div>${chips}`;
    const cards = `<div ${detail ? 'class="hidden" aria-hidden="true"' : ""}><div class="${C.CARDS_WRAP}"><div id="cards" class="${C.CARDS}" data-sheet-cards-scroll data-no-sheet-drag role="list">${Array.from({ length: 6 }, (_, i) => `<article data-place-card data-place-index="${i}" role="listitem" class="${C.CARD} ${C.CARD_BORDER}"><div class="${C.CARD_COVER}"><button type="button" data-btn="save-${i}" class="${C.CARD_SAVE}">♡</button></div><div class="p-4"><p>Place ${i}</p><p class="text-xs">desc</p></div></article>`).join("")}</div></div></div>`;
    const detailBody = detail
      ? `<div id="detailBody"><div class="mx-5 aspect-[16/10] rounded-3xl bg-secondary"></div>${Array.from({ length: 6 }, (_, i) => `<div class="mx-5 mt-3 rounded-2xl border border-border bg-card p-4"><p>Info ${i}</p><button type="button" data-btn="detail-${i}" class="mt-2 rounded-full bg-secondary px-3 py-2 text-xs">act ${i}</button></div>`).join("")}</div>`
      : "";
    return `<div id="mapPage" class="${C.MAP_PAGE}">
 <div id="stage" class="${C.MAP_STAGE}">
  <div id="canvas" class="${C.MAP_CANVAS}" data-roamie-map-background="true"><div class="h-full w-full" style="background:#9cf"></div></div>
  <div id="overlayWrap" class="${C.MAP_OVERLAY_WRAP}">
   <div id="searchOuter" class="${C.SEARCH_OUTER}"><div class="${C.SEARCH_ROW}"><form id="searchForm" class="${C.SEARCH_FORM}"><span class="h-4 w-4 shrink-0">q</span><input id="searchInput" type="search" placeholder="搜尋" class="${C.SEARCH_INPUT}" autocomplete="off"></form><button type="button" id="locate" data-btn="locate" class="${C.SEARCH_LOCATE}">L</button></div>${results}</div>
  </div>
  ${detail ? `<div id="dim" class="${C.MAP_DIM}" aria-hidden></div>` : ""}
 </div>
 <div id="layer" class="${C.MAP_LAYER}">
  <div id="sheet" role="dialog" aria-label="explore" data-map-explore-sheet="true" class="${C.SHEET} ${C.SHEET_ISOLATE}" style="background-color:var(--cream)">
   <div class="${C.SHEET_HEADWRAP}" style="background-color:var(--cream)">
    <div id="handle" data-sheet-drag-handle class="${C.SHEET_HANDLE}" style="touch-action:none;background-color:var(--cream)"><div class="${C.SHEET_HANDLE_INNER}" aria-hidden><span id="handleBar" class="${C.SHEET_HANDLE_BAR}"></span></div></div>
    <div id="sheetHeader" class="${C.SHEET_HEADER}">${header}</div>
   </div>
   <div id="sheetBody" data-sheet-body-scroll class="${C.SHEET_BODY}" style="-webkit-overflow-scrolling:touch;background-color:var(--cream)"><div id="sheetInner" class="${C.SHEET_BODY_INNER}" style="background-color:var(--cream)">${cards}${detailBody}</div></div>
  </div>
 </div>
</div>`;
  }
  window.setup = (o) => {
    window.setCss(o.css || "new");
    const h = document.documentElement;
    const rail = !!o.rail;
    const cls = ["native-shell", o.page === "chat" ? "chat-route-active" : "map-route-active"];
    if (rail) cls.push("duo-rail");
    if (o.twoPane) cls.push("duo-two-pane");
    if (o.laptop) cls.push("duo-laptop");
    // #H3-1：_app.map.tsx 在筆電／直向攤平且 sheetMode＝detail 時於 useLayoutEffect（paint 前）加上 duo-map-detail-page
    if (o.page === "map" && o.detailPage) cls.push("duo-map-detail-page");
    if (o.page === "chat" && o.kb > 0) cls.push("chat-keyboard-open", "app-keyboard-open");
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
    if (o.laptop || o.hingeVars) {
      h.style.setProperty("--duo-hinge-top", o.top + "px");
      h.style.setProperty("--duo-hinge-bottom", o.bottom + "px");
    }
    const page = o.page === "chat" ? chatDom(o) : mapDom(o);
    const mainCls = [C.MAIN_BASE, o.page === "chat" ? "pb-0" : C.MAIN_PB, C.MAIN_LOCK].join(" ");
    const mainStyle = "overflow:hidden;min-height:0;" + (rail ? "padding-right:var(--app-rail-width);" : "");
    const navUl = `<ul class="${C.NAV_UL}${rail ? "" : " items-center justify-between px-2"}">${["home", "chat", "map", "saved", "me"].map((k) => `<li class="flex-1"><a href="#" data-btn="nav-${k}">${k}</a></li>`).join("")}</ul>`;
    const nav = rail
      ? `<nav id="nav" class="${C.NAV_RAIL}" style="width:var(--app-rail-width)">${navUl}</nav>`
      : `<nav id="nav" class="${C.NAV_BOTTOM}${o.page === "chat" ? " chat-nav-keyboard-hide" : ""}">${navUl}</nav>`;
    document.getElementById("root").innerHTML = `<div class="${C.FRAME_OUTER}"><div id="frameInner" class="${rail ? C.FRAME_INNER_FULL : C.FRAME_INNER}"><div class="${C.SHELL_COL}"><main id="main" class="${mainCls}" style="${mainStyle}"><div id="content" class="${C.CONTENT}"${rail ? ' style="--safe-area-right:0px"' : ""}>${page}</div></main>${nav}</div></div></div>`;
    document.getElementById("overlays").innerHTML = o.overlays || "";
    for (const old of document.querySelectorAll("body > aside[data-chat-duo-rec-pane]")) old.remove();
    if (o.page === "chat" && o.recPane) {
      // ChatDuoRecommendationPane variant="laptop"：createPortal 到 document.body（祖先只有 body／html）
      const longText = (k) => Array.from({ length: 6 }, (_, j) => `Line ${j} of place ${k} reason lorem ipsum dolor sit amet consectetur.`).join(" ");
      const cards = Array.from({ length: 5 }, (_, k) => `<article data-rec-card="${k}" class="overflow-hidden rounded-3xl border border-border bg-card"><div class="aspect-[16/10] w-full bg-secondary" data-rec-photo="${k}"></div><div class="p-4"><h4 class="font-medium">Place ${k}</h4><p class="text-xs">${longText(k)}</p><div class="mt-2 flex gap-2"><button type="button" data-btn="rec-${k}-save" class="rounded-full bg-secondary px-3 py-2 text-xs">save ${k}</button><button type="button" data-btn="rec-${k}-add" class="rounded-full bg-secondary px-3 py-2 text-xs">add ${k}</button></div><button type="button" data-btn="rec-${k}-last" class="mt-2 rounded-full bg-secondary px-3 py-2 text-xs">discuss ${k}</button></div></article>`).join("");
      const aside = document.createElement("aside");
      aside.id = "recPane";
      aside.className = C.REC;
      aside.setAttribute("data-chat-duo-rec-pane", "");
      aside.setAttribute("data-variant", "laptop");
      aside.innerHTML = `<p id="recTitle" class="${C.REC_TITLE}"><span class="h-3 w-3"></span> 推薦</p><div id="recScroll" class="${C.REC_SCROLL}"><div class="space-y-4"><div class="space-y-3" data-chat-place-cards><p class="text-[11px]">✦ 推薦</p>${cards}</div></div></div>`;
      document.body.appendChild(aside);
    }
    if (o.page === "chat") {
      // use-messenger-chat-layout 的公式（A4 確認原始碼一致）：readTabBarHeightPx＝.bottom-nav 高度；
      // safeAreaBottomPx 在裝置上＝env(safe-area-inset-bottom)，fixture 以 --safe-area-bottom 模擬。
      const safe = o.safeBottom || 0;
      const navEl = q(".bottom-nav");
      const measured = navEl ? Math.round(navEl.getBoundingClientRect().height) : 0;
      const bottomNavHeightPx =
        measured > 0 ? Math.max(0, measured - safe) : Math.round(parseFloat(getComputedStyle(h).getPropertyValue("--bottom-nav-height")) || 68);
      const composer = q("#composer");
      const ccH = Math.max(Math.round(q("#cc").getBoundingClientRect().height), q("#cc").offsetHeight);
      const composerBottomPx = o.kb > 0 ? o.kb : bottomNavHeightPx + safe;
      const pad = o.kb > 0 ? ccH + o.kb : ccH + bottomNavHeightPx + safe;
      composer.style.bottom = composerBottomPx + "px";
      q("#msgs").style.paddingBottom = Math.max(pad, 0) + "px";
      // useComposerHeight：Math.round(.messenger-chat-composer 的 getBoundingClientRect().height)，> 0 才寫入
      const pane = q("#recPane");
      if (pane && !o.noComposerMeasure) {
        const ch = Math.round(composer.getBoundingClientRect().height);
        if (ch > 0) pane.style.setProperty("--chat-laptop-composer-height", ch + "px");
      }
      window.state = { composerBottomPx, messagesPaddingBottomPx: pad, composerHeightPx: ccH, bottomNavHeightPx };
    } else {
      if (o.mapKb) {
        // captureMapLayoutHeight：main.clientHeight，之後加 map-keyboard-open
        h.style.setProperty("--map-layout-height", Math.round(q("#main").clientHeight) + "px");
        h.classList.add("map-keyboard-open");
      }
      // MapExploreSheet 的 inline 高度（A4 確認公式一致）：pageH＝.map-page clientHeight
      const pageH = q("#mapPage").clientHeight;
      const collapsedH = pageH <= 0 ? 200 : Math.max(200, Math.round(pageH * 0.28));
      const frac = o.detail ? 0.88 : 0.7;
      const maxH = Math.min(Math.round(pageH * frac), Math.round(innerHeight * frac));
      const detailH = Math.min(maxH, Math.max(collapsedH + 80, Math.round(pageH * 0.82)));
      const hgt = o.detail ? detailH : o.expanded ? maxH : collapsedH;
      const sheet = q("#sheet");
      sheet.style.height = hgt + "px";
      sheet.style.maxHeight = (maxH > 0 ? maxH + "px" : "70dvh");
      sheet.style.transition = "height 0.48s cubic-bezier(0.33, 1.1, 0.68, 1)";
      window.state = { pageH, sheetInlineH: hgt };
    }
    return true;
  };
  const INTERACTIVE =
    "button,a[href],input,textarea,select,[role=tab],[tabindex],[data-btn],[data-roamie-map-background],[data-place-card],[data-sheet-drag-handle],[data-sheet-chips-scroll],[data-sheet-cards-scroll],[data-sheet-body-scroll],[data-keyboard-scroll-root]";
  window.foldHits = (top, bottom, xMax) => {
    const out = [];
    for (let y = Math.ceil(top) + 0.5; y < bottom; y += 2)
      for (let x = 1; x < (xMax ?? innerWidth); x += 8) {
        const el = document.elementFromPoint(x, y);
        const hit = el && el.closest(INTERACTIVE);
        if (hit) out.push({ x, y, hit: hit.getAttribute("data-btn") || hit.id || hit.tagName });
      }
    return out;
  };
  window.hit = (sel) => {
    const el = q(sel);
    if (!el) return { sel, missing: true };
    const b = el.getBoundingClientRect();
    const e = document.elementFromPoint(b.left + Math.min(b.width / 2, 12), b.top + b.height / 2);
    return { sel, ok: !!e && el.contains(e), by: e ? e.id || e.getAttribute("data-btn") || e.tagName : null, rect: R(el) };
  };
  window.scrollHit = (scrollerSel, sel) => {
    const sc = q(scrollerSel);
    const el = q(sel);
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = window.hit(sel);
    const st = sc.scrollTop;
    sc.scrollTop = 0;
    return { ...r, scrollTop: st };
  };
  window.measure = () => {
    const ids = ["frameInner", "main", "chatRoot", "chatHeader", "chatBody", "msgs", "anchor", "composer", "cc", "chipRow", "inputRow", "ta", "nav", "mapPage", "stage", "canvas", "overlayWrap", "searchOuter", "searchForm", "locate", "results", "dim", "layer", "sheet", "handle", "handleBar", "sheetHeader", "sheetBody", "chips", "cards", "detailHeader", "alert", "sheetB", "sheetT", "sheetR", "drawer"];
    const m = { vw: innerWidth, vh: innerHeight, state: window.state };
    for (const id of ids) m[id] = R(document.getElementById(id));
    for (const id of ["recPane", "recTitle", "recScroll"]) m[id] = R(document.getElementById(id));
    const pane = q("#recPane");
    if (pane) {
      const sc = q("#recScroll");
      const cs = getComputedStyle(pane);
      m.rec = {
        pos: cs.position,
        vis: cs.visibility,
        z: cs.zIndex,
        parent: pane.parentElement.tagName,
        scroll: { sw: sc.scrollWidth, cw: sc.clientWidth, ox: getComputedStyle(sc).overflowX, oy: getComputedStyle(sc).overflowY },
        cards: qa("#recPane [data-rec-card]").map((a) => ({ ...R(a), oy: getComputedStyle(a).overflowY, sh: a.scrollHeight, ch: a.clientHeight })),
        photos: qa("#recPane [data-rec-photo]").map((p) => p.getBoundingClientRect().height),
      };
    }
    const msgs = q("#msgs");
    if (msgs) m.msgsScroll = { sh: msgs.scrollHeight, ch: msgs.clientHeight, pb: getComputedStyle(msgs).paddingBottom, mb: getComputedStyle(msgs).marginBottom };
    const handle = q("#handle");
    if (handle) {
      m.handlePE = getComputedStyle(handle).pointerEvents;
      m.handleBarVis = getComputedStyle(q("#handleBar")).visibility;
      m.sheetBodyScroll = { sh: q("#sheetBody").scrollHeight, ch: q("#sheetBody").clientHeight };
      m.padding = window.__padding(q("#sheet"));
      m.stageZ = getComputedStyle(q("#stage")).zIndex;
    }
    return m;
  };
  // 所有元素的幾何與關鍵 computed style（非筆電「完全相同」比對用）
  window.snapshot = () => {
    const props = ["position", "top", "bottom", "height", "maxHeight", "marginBottom", "paddingTop", "paddingBottom", "zIndex", "overflowX", "overflowY", "pointerEvents", "visibility", "transform", "display"];
    const out = [];
    for (const el of qa("#root *, #overlays *")) {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      out.push([el.tagName + (el.id ? "#" + el.id : "") + (el.closest("#composer") ? "@composer" : ""), +b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2), ...props.map((p) => cs[p]), el.scrollHeight]);
    }
    const sheet = q("#sheet");
    return { els: out, padding: sheet ? window.__padding(sheet) : null };
  };
  const ancestorIssues = (el) => {
    const out = [];
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const name = a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") + (a.classList.length ? "." + [...a.classList].slice(0, 2).join(".") : "");
      const bad = [];
      if (cs.transform !== "none") bad.push("transform:" + cs.transform);
      for (const k of ["translate", "rotate", "scale"]) if (cs[k] && cs[k] !== "none") bad.push(k + ":" + cs[k]);
      if (cs.filter !== "none") bad.push("filter:" + cs.filter);
      if (cs.backdropFilter && cs.backdropFilter !== "none") bad.push("backdrop-filter:" + cs.backdropFilter);
      if (cs.perspective !== "none") bad.push("perspective:" + cs.perspective);
      if (cs.contain !== "none") bad.push("contain:" + cs.contain);
      if (cs.willChange !== "auto") bad.push("will-change:" + cs.willChange);
      if (cs.containerType && cs.containerType !== "normal") bad.push("container-type:" + cs.containerType);
      if (cs.contentVisibility && cs.contentVisibility !== "visible") bad.push("content-visibility:" + cs.contentVisibility);
      if (/auto|scroll|overlay/.test(cs.overflowX + " " + cs.overflowY)) bad.push("overflow:" + cs.overflowX + "/" + cs.overflowY);
      if (bad.length) out.push(name + " → " + bad.join(", "));
    }
    return out;
  };
  // 推薦卡內捲到最後一個按鈕後是否可點（卡片內容不刪減、超出時卡片本身內捲）
  window.recCardHit = (k) => {
    const art = q(`#recPane [data-rec-card="${k}"]`);
    const sc = q("#recScroll");
    sc.scrollLeft = Math.max(0, art.offsetLeft - 20);
    const docTop = document.scrollingElement.scrollTop;
    art.scrollTop = art.scrollHeight;
    const r = window.hit(`[data-btn=rec-${k}-last]`);
    // 第一個動作鈕：捲入卡片可視範圍後可點
    art.scrollTop = 0;
    const btn = q(`[data-btn=rec-${k}-save]`);
    art.scrollTop = Math.max(0, btn.getBoundingClientRect().top - art.getBoundingClientRect().top - art.clientHeight / 2);
    const first = window.hit(`[data-btn=rec-${k}-save]`);
    const out = { last: r, first, scrollLeft: sc.scrollLeft, artScrollMax: art.scrollHeight - art.clientHeight, docScrolled: document.scrollingElement.scrollTop !== docTop };
    art.scrollTop = 0;
    sc.scrollLeft = 0;
    return out;
  };
  window.fixedChains = () =>
    qa("#root *, #overlays *, body > aside[data-chat-duo-rec-pane]")
      .filter((e) => getComputedStyle(e).position === "fixed")
      .map((e) => ({ el: e.id || e.className.slice(0, 40), bad: ancestorIssues(e), inMsgs: !!e.closest("#msgs"), inMapPage: !!e.closest("#mapPage") }));
  // 姿勢切換（只換 html class 與變數，不重建 DOM）：節點是否相同、面板 ResizeObserver 是否觸發
  window.toggleProbe = async (o) => {
    const nodes = ["#canvas", "#sheet", "#msgs", "#composer", "#searchInput"].map((s) => q(s));
    let roCount = 0;
    const sheet = q("#sheet");
    const ro = sheet ? new ResizeObserver(() => roCount++) : null;
    if (ro) ro.observe(sheet);
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await raf();
    const base = roCount;
    const h = document.documentElement;
    const seq = [];
    for (const lap of o.seq) {
      h.classList.toggle("duo-laptop", lap);
      if (lap) {
        h.style.setProperty("--duo-hinge-top", o.top + "px");
        h.style.setProperty("--duo-hinge-bottom", o.bottom + "px");
      } else {
        h.style.removeProperty("--duo-hinge-top");
        h.style.removeProperty("--duo-hinge-bottom");
      }
      const before = roCount;
      await raf();
      const early = sheet ? { h: sheet.offsetHeight, padding: window.__padding(sheet) } : null;
      // 等待 MapExploreSheet inline transition（0.48s）結束
      await new Promise((r) => setTimeout(r, 700));
      await raf();
      seq.push({ lap, roFired: roCount > before, early, padding: sheet ? window.__padding(sheet) : null, sheetH: sheet ? sheet.offsetHeight : null });
    }
    ro?.disconnect();
    const same = ["#canvas", "#sheet", "#msgs", "#composer", "#searchInput"].map((s, i) => q(s) === nodes[i]);
    return { base, seq, same };
  };
  window.__ready = true;
}

if (!chromeBin) {
  failures.push("B 無可用 Chrome");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else if (C) {
  await runBrowser();
}

async function runBrowser() {
  const { build } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-laptop-chat-explore-"));
  fs.writeFileSync(path.join(dir, "fixture.html"), Object.values(C).join("\n") + "\n" + browserMain.toString());
  const compileCss = async (text) => {
    const compiler = await compile(text.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: [...compiler.sources, { base: dir, pattern: "**/*", negated: false }] });
    return compiler.build(scanner.scan());
  };
  const cssNew = await compileCss(styles);
  const cssOld = await compileCss(styles.slice(0, newRegionStart) + styles.slice(newRegionEnd));
  assert.match(cssNew, /html\.duo-laptop\.chat-route-active/);
  assert.doesNotMatch(cssOld, /html\.duo-laptop\.chat-route-active|html\.duo-laptop\.map-route-active|html\.duo-laptop \.map-page|chat-laptop-rec/);
  assert.match(cssNew, /\.chat-laptop-rec/);
  assert.match(cssOld, /html\.duo-laptop\.trip-detail-route-active/, "OLD 只移除聊聊／探索規則，行程頁規則保留");

  await build({
    stdin: {
      contents: "import {measureMapExplorePadding} from '@/lib/map-visible-padding';window.__padding=measureMapExplorePadding;",
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "padding.js"),
    format: "iife",
    alias: { "@": path.join(root, "src") },
  });
  const pageJs =
    "window.__C=" + JSON.stringify(C) + ";window.__CSS=" + JSON.stringify({ new: cssNew, old: cssOld }) + ";\n" +
    fs.readFileSync(path.join(dir, "padding.js"), "utf8") + "\n(" + browserMain.toString() + ")();";

  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(pageJs);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="css"></style></head><body style="margin:0"><div id="root"></div><div id="overlays"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
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
    let vp = "";
    const viewport = async (w, h, mobile = true) => {
      if (vp === `${w}x${h}${mobile}`) return;
      vp = `${w}x${h}${mobile}`;
      await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    };
    await viewport(669, 951);
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));

    const VW = 669;
    const VH = 951;
    const TOP = 455.5;
    const BOTTOM = 495.5;
    const RAIL = 64;
    const near = (a, b, msg, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
    const within = (r, t, b, msg) => {
      assert.ok(r, msg + "：元素不存在");
      assert.ok(r.h > 0, msg + "：高度 0");
      assert.ok(r.t >= t - 0.5 && r.b <= b + 0.5, `${msg}：[${r.t}, ${r.b}] 不在 [${t}, ${b}]`);
    };
    const setup = async (o) => {
      await viewport(o.vw ?? VW, o.vh ?? VH, o.mobile ?? true);
      await evaluate("window.setup(" + JSON.stringify(o) + ")");
    };
    const measure = () => evaluate("window.measure()");
    const overlaysHtml = () =>
      `<div role="alertdialog" id="alert" class="${C.ALERT}" style="height:600px"><p>clear?</p><button type="button" data-btn="ov-ok">ok</button></div>` +
      `<div role="dialog" id="sheetB" class="${C.UISHEET} ${C.UISHEET_BOTTOM}" style="height:900px">b</div>` +
      `<div role="dialog" id="sheetT" class="${C.UISHEET} ${C.UISHEET_TOP}" style="height:900px">t</div>` +
      `<div role="dialog" id="sheetR" class="${C.UISHEET} ${C.UISHEET_RIGHT}">r</div>` +
      `<div role="dialog" data-vaul-drawer data-vaul-drawer-direction="bottom" id="drawer" class="${C.DRAWER}" style="height:900px">d</div>`;

    // ── 共用斷言（B0 對照會以 OLD CSS 重跑，預期失敗）──
    const LAPTOPS = [
      { name: "底部導覽 safe-bottom=0", rail: false, safeBottom: 0 },
      { name: "底部導覽 safe-bottom=20", rail: false, safeBottom: 20 },
      { name: "右側直欄", rail: true, safeBottom: 0 },
    ];
    const navTop = (L, m) => (L.rail ? VH - L.safeBottom : m.nav.t);
    async function assertChatLaptop(L, chipsMode, opts = {}) {
      const top = opts.top ?? TOP;
      const bottom = opts.bottom ?? BOTTOM;
      const recPane = opts.recPane ?? true;
      // 浮層另外量（見下方 C5）；版面與可點測試時不放浮層，避免遮住
      await setup({ page: "chat", laptop: true, rail: L.rail, safeBottom: L.safeBottom, top, bottom, chips: chipsMode, css: opts.css, recPane, overlays: overlaysHtml() });
      const ov = await measure();
      await setup({ page: "chat", laptop: true, rail: L.rail, safeBottom: L.safeBottom, top, bottom, chips: chipsMode, css: opts.css, recPane, noComposerMeasure: opts.noComposerMeasure });
      const m = { ...(await measure()), alert: ov.alert, sheetB: ov.sheetB, sheetT: ov.sheetT, sheetR: ov.sheetR, drawer: ov.drawer };
      const xMax = L.rail ? VW - RAIL : VW;
      const errs = [];
      const sub = (name, fn) => {
        try {
          fn();
        } catch (e) {
          errs.push(name + "：" + e.message);
        }
      };
      sub("C1 上半部", () => {
        within(m.chatHeader, 0, top, "標頭");
        near(m.msgs.b, top, "訊息列表下緣＝摺痕上緣");
        assert.ok(m.msgs.t >= m.chatHeader.b - 0.5, "訊息列表在標頭下方");
        assert.ok(m.msgs.h >= 120, "訊息列表高度：" + m.msgs.h);
        assert.ok(m.msgsScroll.sh > m.msgsScroll.ch, "訊息列表可捲動");
      });
      sub("C2 下半部", () => {
        const nt = navTop(L, m);
        within(m.composer, bottom, nt, "輸入列（composer）");
        within(m.inputRow, bottom, nt, "輸入列 chat-input-row");
        if (chipsMode !== "none") within(m.chipRow, bottom, nt, "快捷按鍵列");
        near(m.composer.b, nt, "輸入列貼底部導覽上緣", 1.01);
      });
      const hits = await evaluate(`window.foldHits(${top},${bottom},${xMax})`);
      sub("C3 摺痕帶", () => assert.deepEqual(hits.slice(0, 6), [], "摺痕帶有可點元素"));
      const hitsUi = await Promise.all(["#ta", "[data-btn=send]", "[data-btn=back]", "[data-btn=clear]", ...(chipsMode !== "none" ? ["[data-btn=plan]", "[data-btn=chip-0]"] : []), ...(chipsMode === "many" ? ["[data-btn=action-0]"] : [])].map((s) => evaluate(`window.hit(${JSON.stringify(s)})`)));
      sub("C2b 可點", () => assert.deepEqual(hitsUi.filter((h) => !h.ok), []));
      // C2c 輸入列（快捷按鍵列＋輸入框）拉滿下半部寬度
      sub("C2c 輸入列全寬", () => {
        near(m.composer.l, 0, "輸入列左緣＝safe-left");
        near(m.composer.r, xMax, "輸入列右緣＝直欄左緣／螢幕右緣");
        near(m.inputRow.l, 20, "輸入框左邊距 20px", 1.01);
        near(m.inputRow.r, xMax - 20, "輸入框右邊距 20px", 1.01);
      });
      if (recPane) {
        sub("C7a 推薦區位置", () => {
          assert.ok(m.recPane, "推薦區不存在");
          assert.equal(m.rec.pos, "fixed", "推薦區 position");
          assert.equal(m.rec.parent, "BODY", "推薦區 portal 到 body");
          assert.equal(m.rec.vis, "visible", "推薦區可見");
          near(m.recPane.t, bottom, "推薦區上緣＝摺痕下緣");
          near(m.recPane.b, m.composer.t, "推薦區下緣＝輸入列上緣", 1.01);
          assert.ok(m.recPane.t >= bottom - 0.5, "推薦區進入摺痕帶");
          assert.ok(m.recPane.b <= m.composer.t + 1.01, `推薦區下緣 ${m.recPane.b} 低於輸入列上緣 ${m.composer.t}`);
          near(m.recPane.l, 0, "推薦區左緣");
          near(m.recPane.r, xMax, "推薦區右緣＝直欄左緣／螢幕右緣");
        });
        sub("C7b 推薦卡片", () => {
          assert.ok(m.recTitle.t >= m.recPane.t - 0.5 && m.recTitle.b <= m.recPane.b + 0.5, "「✦ 推薦」標題在推薦區內");
          const cards = m.rec.cards;
          assert.equal(cards.length, 5);
          for (let k = 1; k < cards.length; k++) {
            near(cards[k].t, cards[0].t, `第 ${k + 1} 張卡片與第 1 張同一列`);
            assert.ok(cards[k].l >= cards[k - 1].r - 0.5, `卡片 ${k + 1} 未排在右側`);
          }
          assert.equal(m.rec.scroll.ox, "auto", "推薦區橫向可捲");
          assert.ok(m.rec.scroll.sw > m.rec.scroll.cw + 100, "卡片超出時可橫向捲動 " + JSON.stringify(m.rec.scroll));
          assert.ok(cards[0].t >= m.recPane.t - 0.5 && cards[0].b <= m.recPane.b + 0.5, `卡片 [${cards[0].t}, ${cards[0].b}] 超出推薦區 [${m.recPane.t}, ${m.recPane.b}]`);
          assert.ok(cards[0].h >= 96, "卡片可視高度過小：" + cards[0].h);
          for (const ph of m.rec.photos) near(ph, 96, "照片高度 96px");
          assert.equal(cards[0].oy, "auto", "卡片本身可內捲");
        });
      }
      const recHits = recPane && m.recPane ? await Promise.all([0, 3].map((k) => evaluate(`window.recCardHit(${k})`))) : [];
      if (recPane)
        sub("C7c 推薦卡按鈕可點（含橫向捲到第 4 張、卡片內捲到底）", () => {
          for (const r of recHits) {
            assert.ok(r.first.ok, "卡片第一個按鈕不可點：" + JSON.stringify(r.first));
            assert.ok(r.last.ok, "卡片內捲到底後最後一個按鈕不可點：" + JSON.stringify(r.last));
            within(r.last.rect, bottom, m.composer.t + 1.01, "最後一個按鈕在推薦區內");
            within(r.first.rect, bottom, m.composer.t + 1.01, "第一個按鈕在推薦區內");
            assert.ok(r.artScrollMax > 0, "fixture 卡片內容不夠長，無法驗證內捲");
            assert.equal(r.docScrolled, false, "捲動卡片時整頁被捲動");
          }
        });
      if (recPane) {
        const tagHit = await evaluate(`window.scrollHit('#msgs','[data-btn=tag-17]')`);
        sub("C7d 訊息列「推薦 · N」標籤捲入後可點且在上半部", () => {
          assert.ok(tagHit.ok, JSON.stringify(tagHit));
          assert.ok(tagHit.rect.b <= top + 0.5, "標籤跨過摺痕上緣");
        });
      }
      const last = await evaluate(`window.scrollHit('#msgs','[data-btn=retry]')`);
      sub("C1b 捲到底", () => {
        assert.ok(last.ok, "捲到底後最後一個按鈕被遮住：" + JSON.stringify(last));
        assert.ok(last.rect.b <= top + 0.5, "最後一個按鈕跨過摺痕上緣：" + last.rect.b);
        assert.ok(last.scrollTop > 0, "未捲動");
      });
      sub("C5 浮層", () => {
        assert.ok(m.alert.t >= bottom - 0.5 && m.alert.b <= VH - L.safeBottom + 0.5, `置中對話框 [${m.alert.t}, ${m.alert.b}]`);
        assert.ok(m.sheetB.t >= bottom - 0.5, "底部面板 top " + m.sheetB.t);
        assert.ok(m.drawer.t >= bottom - 0.5, "drawer top " + m.drawer.t);
        assert.ok(m.sheetT.b <= top + 0.5, "頂部面板 bottom " + m.sheetT.b);
        assert.ok(m.sheetR.t >= bottom - 0.5, "側邊面板 top " + m.sheetR.t);
      });
      return { errs, m };
    }
    async function assertMapLaptop(L, opts = {}) {
      const top = opts.top ?? TOP;
      const bottom = opts.bottom ?? BOTTOM;
      await setup({ page: "map", laptop: true, rail: L.rail, safeBottom: L.safeBottom, top, bottom, css: opts.css, detail: opts.detail, dropdown: opts.dropdown, overlays: opts.overlays });
      const m = await measure();
      const xMax = L.rail ? VW - RAIL : VW;
      const errs = [];
      const sub = (name, fn) => {
        try {
          fn();
        } catch (e) {
          errs.push(name + "：" + e.message);
        }
      };
      const nt = L.rail ? VH - L.safeBottom : m.nav.t;
      sub("M1 地圖上半部", () => {
        near(m.stage.t, 0, "地圖層 top");
        near(m.stage.b, top, "地圖層 bottom＝摺痕上緣");
        near(m.canvas.t, 0, "畫布 top");
        near(m.canvas.b, top, "畫布 bottom＝摺痕上緣");
        near(m.canvas.r, xMax, "畫布右緣");
      });
      sub("M2 下半部", () => {
        within(m.searchForm, bottom, nt, "搜尋框");
        within(m.locate, bottom, nt, "定位鈕");
        assert.ok(m.searchForm.b <= m.layer.t + 0.5 && m.locate.b <= m.layer.t + 0.5, "搜尋列與面板重疊");
        assert.ok(m.layer.t >= bottom - 0.5, "面板層 top " + m.layer.t);
        near(m.layer.b, nt, "面板層 bottom 貼底部導覽上緣", 1.01);
        near(m.sheet.t, m.layer.t, "面板填滿面板層（top）");
        near(m.sheet.h, m.layer.h, "面板填滿面板層（height）");
        assert.equal(m.handlePE, "none", "拖曳把手停用");
        assert.equal(m.handleBarVis, "hidden", "拖曳橫條隱藏");
        if (!opts.detail && !opts.dropdown) within(m.chips, bottom, nt, "分類膠囊");
        assert.ok(m.sheetBody.h > 0, "清單區高度：" + m.sheetBody.h);
      });
      // #H3-1：搜尋列底板（面板層 ::before，bottom:100%）與面板層屬同一塊：底板下緣＝面板層上緣、底板上緣不進摺痕帶、
      //   搜尋框落在底板範圍內（OLD CSS 沒有底板時 height 為 auto／0，不檢查，交由 B0）
      const plateH = await evaluate("parseFloat(getComputedStyle(document.getElementById('layer'),'::before').height)||0");
      if (opts.css !== "old")
        sub("M2d 搜尋列底板與面板層同一塊", () => {
          assert.ok(plateH > 0, "面板層沒有搜尋列底板（::before）");
          const plateT = m.layer.t - plateH;
          assert.ok(plateT >= bottom - 0.5, "底板上緣進入摺痕帶：" + plateT);
          assert.ok(m.searchForm.t >= plateT - 0.5 && m.searchForm.b <= m.layer.t + 0.5, `搜尋框 [${m.searchForm.t}, ${m.searchForm.b}] 不在底板 [${plateT}, ${m.layer.t}] 內`);
        });
      const hits = await evaluate(`window.foldHits(${top},${bottom},${xMax})`);
      sub("M3 摺痕帶", () => assert.deepEqual(hits.slice(0, 6), [], "摺痕帶有可點元素"));
      const sels = ["#searchInput", "#locate"];
      if (!opts.detail && !opts.dropdown) sels.push("[data-btn=cat-0]", "[data-btn=cat-1]");
      if (opts.detail) sels.push("[data-btn=detail-back]");
      if (opts.dropdown) sels.push("[data-btn=res-0]", "[data-btn=res-3]");
      const hitsUi = await Promise.all(sels.map((s) => evaluate(`window.hit(${JSON.stringify(s)})`)));
      sub("M2b 可點", () => assert.deepEqual(hitsUi.filter((h) => !h.ok), []));
      // 搜尋下拉開啟時本來就疊在清單上（不測清單可點）；下緣以面板層下緣為準（底部導覽 1px border-t 與 main pb 的既有重疊）
      if (!opts.dropdown) {
        const card = await evaluate(opts.detail ? `window.scrollHit('#sheetBody','[data-btn=detail-5]')` : `window.scrollHit('#sheetBody','[data-btn=save-0]')`);
        sub("M2c 清單／詳情捲入後可點且在下半部", () => {
          assert.ok(card.ok, JSON.stringify(card));
          within(card.rect, bottom, m.layer.b, "清單按鈕");
        });
      }
      sub("M4 padding", () => {
        const p = m.padding;
        const vis = { t: m.canvas.t + p.top, b: m.canvas.b - p.bottom, l: m.canvas.l + p.left, r: m.canvas.r - p.right };
        assert.ok(vis.t >= 0 && vis.b <= top + 0.5, "可視區超出上半部：" + JSON.stringify(vis));
        assert.ok(vis.b - vis.t >= 0.5 * top, "可視區高度過小：" + JSON.stringify({ vis, p }));
        assert.ok(vis.r - vis.l >= 0.8 * (xMax - 0), "可視區寬度過小：" + JSON.stringify(vis));
      });
      if (opts.detail) sub("M5 遮罩只蓋上半部", () => assert.ok(m.dim && m.dim.b <= top + 0.5, "遮罩 " + JSON.stringify(m.dim)));
      if (opts.dropdown)
        sub("M5b 搜尋下拉在下半部", () => {
          within(m.results, bottom, nt, "搜尋下拉");
        });
      return { errs, m };
    }

    // ── C：聊聊筆電 ──
    for (const L of LAPTOPS) {
      for (const chipsMode of ["normal", "none", "many"]) {
        if (L.safeBottom === 20 && chipsMode !== "normal") continue;
        const { errs, m } = await assertChatLaptop(L, chipsMode);
        await check(`C1–C3,C5,C7 聊聊筆電（${L.name}，快捷按鍵 ${chipsMode}）：上半部列表＋標籤、推薦區 [摺痕下緣, 輸入列上緣]、全寬輸入列、摺痕帶無可點、浮層不跨摺痕`, () => {
          assert.deepEqual(errs, []);
          console.log(`     （資訊）列表 [${m.msgs.t.toFixed(1)}, ${m.msgs.b.toFixed(1)}]；推薦區 [${m.recPane.t.toFixed(1)}, ${m.recPane.b.toFixed(1)}]（卡片高 ${m.rec.cards[0].h.toFixed(1)}）；輸入列 [${m.composer.t.toFixed(1)}, ${m.composer.b.toFixed(1)}]（高 ${m.composer.h.toFixed(1)}）；下半部可用 ${(navTop(L, m) - BOTTOM).toFixed(1)}`);
        });
      }
      {
        const { errs } = await assertChatLaptop(L, "normal", { recPane: false });
        await check(`C8 聊聊筆電無推薦（${L.name}）：推薦區不渲染時，列表／輸入列／摺痕帶／浮層斷言仍成立`, () => assert.deepEqual(errs, []));
      }
      {
        // 量測前（--chat-laptop-composer-height 未寫入，預設 7.5rem）：推薦區仍不得進入摺痕帶，且不得低於輸入列上緣以下太多（被輸入列蓋住的部分 z-index 較低）
        const { m } = await assertChatLaptop(L, "many", { noComposerMeasure: true });
        await check(`C7e 聊聊筆電（${L.name}）：輸入列高度量到前（預設 7.5rem）推薦區不進摺痕帶、z-index 低於輸入列`, () => {
          assert.ok(m.recPane.t >= BOTTOM - 0.5, "推薦區上緣 " + m.recPane.t);
          assert.equal(m.rec.z, "40");
          console.log(`     （資訊）預設高度時推薦區下緣 ${m.recPane.b.toFixed(1)}、輸入列上緣 ${m.composer.t.toFixed(1)}（差 ${(m.recPane.b - m.composer.t).toFixed(1)}px）`);
        });
      }
      const chains = await evaluate("window.fixedChains()");
      await check(`C4 聊聊筆電（${L.name}）：fixed 元素祖先鏈乾淨、不在訊息列表內`, () => {
        const composer = chains.find((c) => c.el === "composer");
        assert.ok(composer, "找不到 fixed 輸入列");
        assert.ok(chains.find((c) => c.el === "recPane"), "找不到 fixed 推薦區（應 portal 到 body）");
        assert.deepEqual(chains.filter((c) => c.bad.length || c.inMsgs), [], JSON.stringify(chains.filter((c) => c.bad.length || c.inMsgs)));
      });
    }

    // C6 鍵盤開（第 2 版設計）：輸入列照既有邏輯貼鍵盤（垂直位置與舊 CSS 相同）但維持全寬；推薦區 visibility hidden（不卸載）；
    //   輸入列子樹以外的所有元素位置／樣式與移除新規則時完全相同。
    const X_IDX = [1, 3]; // snapshot 列：[name, left, top, width, height, ...]
    const dropX = (row) => row.filter((_, i) => !X_IDX.includes(i));
    for (const L of LAPTOPS.filter((l) => l.safeBottom === 0)) {
      for (const kb of [300, 420]) {
        await setup({ page: "chat", laptop: true, rail: L.rail, top: TOP, bottom: BOTTOM, kb, chips: "normal", recPane: true });
        const a = await evaluate("window.snapshot()");
        const m = await measure();
        const paneHit = await evaluate("(()=>{const b=document.getElementById('recPane').getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+Math.min(b.height/2,20));return {hitPane:!!e&&!!e.closest('#recPane')}})()");
        await evaluate("window.setCss('old')");
        const b = await evaluate("window.snapshot()");
        const mOld = await measure();
        await evaluate("window.setCss('new')");
        const xMax = L.rail ? VW - RAIL : VW;
        await check(`C6 聊聊筆電＋鍵盤開（${L.name}，鍵盤 ${kb}px）：輸入列貼鍵盤且全寬、推薦區 hidden，其餘與移除新規則時完全相同`, () => {
          assert.equal(a.els.length, b.els.length);
          const outside = a.els.map((x, i) => [x, b.els[i]]).filter(([x]) => !x[0].endsWith("@composer"));
          const diffOut = outside.filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y));
          assert.deepEqual(diffOut.slice(0, 3), [], "輸入列以外的元素與舊 CSS 不同");
          const inside = a.els.map((x, i) => [x, b.els[i]]).filter(([x]) => x[0].endsWith("@composer"));
          assert.ok(inside.length >= 5, "輸入列子樹元素數 " + inside.length);
          const diffV = inside.filter(([x, y]) => JSON.stringify(dropX(x)) !== JSON.stringify(dropX(y)));
          assert.deepEqual(diffV.slice(0, 3), [], "輸入列子樹的垂直位置／樣式與舊 CSS 不同（應只有水平寬度不同）");
          near(m.composer.b, VH - kb, "輸入列貼鍵盤上緣");
          near(m.composer.t, mOld.composer.t, "輸入列上緣與舊 CSS 相同");
          near(m.composer.l, 0, "鍵盤開：輸入列左緣");
          near(m.composer.r, xMax, "鍵盤開：輸入列右緣（全寬）");
          near(mOld.composer.w, 440, "對照：舊 CSS 輸入列為 440px 置中（證明全寬斷言有效）");
          assert.equal(m.rec.vis, "hidden", "鍵盤開時推薦區應 visibility hidden");
          assert.equal(paneHit.hitPane, false, "鍵盤開時推薦區仍可點");
          assert.ok(m.recPane && m.recPane.h > 0, "推薦區 DOM 應保留（不卸載）");
          const inFold = m.composer.b > TOP && m.composer.t < BOTTOM;
          console.log(`     （資訊）鍵盤 ${kb}px：輸入列 [${m.composer.t.toFixed(1)}, ${m.composer.b.toFixed(1)}]${inFold ? "，跨入摺痕帶（既有鍵盤行為，見報告）" : ""}`);
        });
      }
    }
    // C6b 鍵盤開→收起：推薦區同一節點、橫向捲動位置保留、恢復可見
    {
      await setup({ page: "chat", laptop: true, rail: false, top: TOP, bottom: BOTTOM, chips: "normal", recPane: true });
      const r = await evaluate(`(async()=>{const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const p=document.getElementById('recPane');const sc=document.getElementById('recScroll');sc.scrollLeft=300;const before=sc.scrollLeft;
        document.documentElement.classList.add('chat-keyboard-open','app-keyboard-open');await raf();const visKb=getComputedStyle(p).visibility;
        document.documentElement.classList.remove('chat-keyboard-open','app-keyboard-open');await raf();
        return {before,after:sc.scrollLeft,same:document.getElementById('recPane')===p&&p.isConnected,visKb,visAfter:getComputedStyle(p).visibility};})()`);
      await check("C6b 聊聊筆電鍵盤開→收起：推薦區不卸載、捲動位置保留、收起後恢復可見", () => {
        assert.ok(r.before > 100, "無法橫向捲動 " + JSON.stringify(r));
        assert.equal(r.visKb, "hidden");
        assert.equal(r.visAfter, "visible");
        assert.equal(r.same, true);
        assert.equal(r.after, r.before, "捲動位置未保留");
      });
    }

    // ── M：探索筆電 ──
    for (const L of LAPTOPS) {
      const { errs, m } = await assertMapLaptop(L);
      await check(`M1–M4 探索筆電（${L.name}）：地圖上半部、搜尋列／膠囊／清單下半部、摺痕帶無可點、padding 可視區＝上半部`, () => {
        assert.deepEqual(errs, []);
        console.log(`     （資訊）padding ${JSON.stringify(m.padding)}；面板 [${m.sheet.t.toFixed(1)}, ${m.sheet.b.toFixed(1)}]；清單區高 ${m.sheetBody.h.toFixed(1)}`);
      });
      const chains = await evaluate("window.fixedChains()");
      await check(`M7 探索筆電（${L.name}）：.map-page 內沒有 fixed 元素`, () => {
        assert.deepEqual(chains.filter((c) => c.inMapPage), []);
      });
    }
    // M5（#H3-1 新設計，設計稿 LapExploreKb3／3b）：地點詳情一頁式（html.duo-map-detail-page）。
    //   取代舊斷言「詳情在同一面板（下半部）、遮罩只蓋上半部」：真實 App 在筆電上進入詳情時以 useLayoutEffect 於 paint 前
    //   加上 class，「詳情在下半部面板」的畫面不會出現。新斷言：面板層＝[.map-page 上緣, 底部導覽上緣]、面板填滿面板層、
    //   面板是唯一捲動容器（內層 body overflow visible）、搜尋列隱藏且不可點、搜尋列底板（::before）不顯示、
    //   面板頂端讓出頂部安全區、返回鈕與捲到底的按鈕可點。面板佔滿整頁是設計本身，摺痕帶會有詳情內容（只記錄）。
    for (const L of [LAPTOPS[0], LAPTOPS[1], LAPTOPS[2]]) {
      for (const safeTop of [0, 47]) {
        await setup({ page: "map", laptop: true, rail: L.rail, safeBottom: L.safeBottom, safeTop, top: TOP, bottom: BOTTOM, detail: true, detailPage: true });
        const m = await measure();
        const nt = L.rail ? VH - L.safeBottom : m.nav.t;
        const xMax = L.rail ? VW - RAIL : VW;
        const g = await evaluate(`(()=>{const s=document.getElementById('sheet');const b=document.getElementById('sheetBody');const l=document.getElementById('layer');const bf=getComputedStyle(l,'::before');
          return {sheetOy:getComputedStyle(s).overflowY,sheetSh:s.scrollHeight,sheetCh:s.clientHeight,bodyOy:getComputedStyle(b).overflowY,bodyCh:b.clientHeight,bodySh:b.scrollHeight,
            padTop:parseFloat(getComputedStyle(s).paddingTop),beforeDisplay:bf.display,searchVis:getComputedStyle(document.getElementById('searchOuter')).visibility,
            hdrTop:document.getElementById('detailHeader').getBoundingClientRect().top,
            safeTopInPage:(()=>{const p=document.createElement('div');p.style.cssText='position:absolute;visibility:hidden;padding-top:var(--safe-area-top)';document.getElementById('mapPage').appendChild(p);const v=parseFloat(getComputedStyle(p).paddingTop);p.remove();return v})()}})()`);
        const back = await evaluate("window.hit('[data-btn=detail-back]')");
        const search = await evaluate("window.hit('#searchInput')");
        const topHit = await evaluate("(()=>{const e=document.elementFromPoint(100,200);return !!e&&!!e.closest('#sheet')})()");
        const lastBtn = await evaluate(`window.scrollHit('#sheet','[data-btn=detail-5]')`);
        const hits = await evaluate(`window.foldHits(${TOP},${BOTTOM},${xMax})`);
        await check(`M5 探索筆電地點詳情一頁式（${L.name}，safe-top=${safeTop}）：面板佔滿整頁、整頁一起捲、搜尋列隱藏、返回鈕與捲到底可點`, () => {
          near(m.layer.t, m.mapPage.t, "面板層 top＝.map-page 上緣");
          near(m.mapPage.t, 0, ".map-page 上緣＝視窗上緣");
          near(m.layer.b, nt, "面板層 bottom 貼底部導覽上緣", 1.01);
          near(m.sheet.t, m.layer.t, "面板填滿面板層（top）");
          near(m.sheet.h, m.layer.h, "面板填滿面板層（height）");
          near(m.sheet.r, xMax, "面板右緣");
          assert.equal(g.beforeDisplay, "none", "搜尋列底板（::before）應不顯示");
          assert.equal(g.searchVis, "hidden", "搜尋列應 hidden");
          assert.equal(search.ok, false, "搜尋列仍可點：" + JSON.stringify(search));
          assert.equal(topHit, true, "上半部點擊應落在詳情面板（遮罩／地圖不在面板之上）");
          assert.match(g.sheetOy, /auto|scroll/, "面板應為捲動容器");
          assert.ok(g.sheetSh > g.sheetCh + 50, "面板內容不夠長，無法驗證整頁捲動：" + JSON.stringify(g));
          assert.equal(g.bodyOy, "visible", "內層 body 不得自行捲動（整頁一起捲）");
          assert.ok(g.bodySh <= g.bodyCh + 1, "內層 body 有自身捲動範圍：" + JSON.stringify(g));
          // .map-page 內的 --safe-area-top：一般＝safe-top；右側直欄（html.duo-rail .map-page）＝max(safe-top, --duo-top-gap)（既有規則）
          assert.ok(g.safeTopInPage >= safeTop - 0.5, "頁內安全區 " + g.safeTopInPage);
          near(g.padTop, g.safeTopInPage, "面板頂端讓出頂部安全區（.map-page 內的 --safe-area-top）");
          assert.ok(g.hdrTop >= g.safeTopInPage - 0.5, "詳情標頭在安全區下方：" + g.hdrTop);
          assert.ok(back.ok, "返回鈕不可點：" + JSON.stringify(back));
          assert.ok(lastBtn.ok, "捲到底的按鈕不可點：" + JSON.stringify(lastBtn));
          assert.ok(lastBtn.scrollTop > 0, "面板未捲動（捲動容器不是面板）");
          console.log(`     （資訊）面板 [${m.sheet.t.toFixed(1)}, ${m.sheet.b.toFixed(1)}]、捲動高 ${g.sheetSh}/${g.sheetCh}；摺痕帶可點點數 ${hits.length}（一頁式設計本身跨摺痕）`);
        });
      }
      if (L === LAPTOPS[1]) continue;
      {
        // 對照：未加 duo-map-detail-page（K5 effect 失效）時，面板層仍在下半部 → M5 的「面板層 top＝.map-page 上緣」必定失敗
        await setup({ page: "map", laptop: true, rail: L.rail, safeBottom: L.safeBottom, top: TOP, bottom: BOTTOM, detail: true });
        const m0 = await measure();
        await check(`B0c 對照（${L.name}）：沒有 duo-map-detail-page 時面板層不在頁首（證明 M5 斷言有效）`, () => {
          assert.ok(m0.layer.t >= BOTTOM - 0.5, "面板層 top " + m0.layer.t);
        });
      }
      const r = await assertMapLaptop(L, { dropdown: true });
      await check(`M5b 探索筆電搜尋下拉（失焦，${L.name}）：下拉在下半部、疊在面板上可點`, () => assert.deepEqual(r.errs, []));
    }
    // M6 搜尋聚焦（map-keyboard-open）
    for (const L of [LAPTOPS[0], LAPTOPS[2]]) {
      await setup({ page: "map", laptop: true, rail: L.rail, top: TOP, bottom: BOTTOM, mapKb: true, dropdown: true });
      const m = await measure();
      const hits = await evaluate(`window.foldHits(${TOP},${BOTTOM},${L.rail ? VW - RAIL : VW})`);
      const h1 = await evaluate("window.hit('#searchInput')");
      const h2 = await evaluate("window.hit('[data-btn=res-0]')");
      const sheetVis = await evaluate("getComputedStyle(document.getElementById('sheet')).visibility");
      // #H3-1-T 新設計（設計稿 LapExploreKb2／Kb3）：鍵盤展開時下半部「整塊」（搜尋列＋面板層）上滑到〔頂端, 摺痕上緣〕；
      //   有搜尋建議時面板內容 visibility hidden（取代舊斷言「面板仍在下半部」）。真實 React 量測見 verify-duo-explore-keyboard-flat.mjs。
      await check(`M6 探索筆電搜尋聚焦（${L.name}）：搜尋列、下拉與面板層整塊在上半部、有建議時面板 hidden、摺痕帶無可點`, () => {
        within(m.searchForm, 0, TOP, "搜尋框");
        within(m.results, 0, TOP, "搜尋下拉");
        assert.ok(h1.ok && h2.ok, JSON.stringify([h1, h2]));
        within(m.layer, 0, TOP, "面板層（整塊上滑）");
        near(m.layer.b, TOP, "面板層下緣＝摺痕上緣", 1.01);
        assert.equal(sheetVis, "hidden", "有搜尋建議時面板內容應 hidden");
        near(m.stage.b, TOP, "地圖層 bottom");
        assert.deepEqual(hits.slice(0, 6), []);
      });
    }
    // M7 浮層
    {
      await setup({ page: "map", laptop: true, top: TOP, bottom: BOTTOM, overlays: overlaysHtml() });
      const m = await measure();
      await check("M7b 探索筆電浮層：置中對話框在下半部、底部／側邊面板不跨摺痕、頂部面板不超過上半部", () => {
        assert.ok(m.alert.t >= BOTTOM - 0.5 && m.alert.b <= VH + 0.5, `對話框 [${m.alert.t}, ${m.alert.b}]`);
        assert.ok(m.sheetB.t >= BOTTOM - 0.5 && m.drawer.t >= BOTTOM - 0.5 && m.sheetR.t >= BOTTOM - 0.5, "底部／側邊面板");
        assert.ok(m.sheetT.b <= TOP + 0.5, "頂部面板 " + m.sheetT.b);
      });
    }
    // M8 姿勢切換
    for (const L of [LAPTOPS[0], LAPTOPS[2]]) {
      await setup({ page: "map", laptop: false, rail: L.rail });
      const m0 = await measure();
      const p0 = m0.padding;
      const r = await evaluate(`window.toggleProbe(${JSON.stringify({ seq: [true, false, true, false], top: TOP, bottom: BOTTOM })})`);
      // #H3-2：地圖延伸到螢幕頂端，top＝頂部安全區（main 的 padding-top；右側直欄＝max(safe-top, --duo-top-gap 14px)）＋16
      const mainPadTop = await evaluate("parseFloat(getComputedStyle(document.getElementById('main')).paddingTop)");
      await check(`M8 探索姿勢切換（${L.name}，非筆電→筆電→非筆電…）：同一 DOM 節點、面板 ResizeObserver 每次觸發、padding 穩定後隨姿勢切換`, () => {
        assert.deepEqual(r.same.filter((x, i) => [0, 1, 4].includes(i)), [true, true, true]);
        for (const s of r.seq) assert.ok(s.roFired, "面板尺寸未變化，GoogleMapBackground 不會重新同步 padding：" + JSON.stringify(s));
        assert.equal(mainPadTop, L.rail ? 14 : 0, "main padding-top（safe-top 0）");
        assert.deepEqual(r.seq[0].padding, { top: mainPadTop + 16, right: 16, bottom: 56, left: 16 });
        assert.deepEqual(r.seq[2].padding, r.seq[0].padding, "第二次進入筆電 padding 相同");
        assert.deepEqual(r.seq[1].padding, p0);
        assert.equal(r.seq[1].sheetH, Math.round(m0.sheet.h));
      });
      await check(`M8c 探索離開筆電（${L.name}）：面板高度不會在轉場中短暫跳到內容高度（不閃動）`, () => {
        const off = r.seq.filter((s) => !s.lap);
        for (const s of off)
          assert.ok(
            s.early.h <= Math.max(Math.round(m0.sheet.h), r.seq[0].sheetH) + 1,
            `離開筆電後第 2 幀面板高 ${s.early.h}px（筆電 ${r.seq[0].sheetH}px → 手機 ${s.sheetH}px），padding.bottom ${s.early.padding.bottom}`,
          );
      });
    }
    {
      await setup({ page: "chat", laptop: false, rail: false, chips: "normal" });
      const r = await evaluate(`window.toggleProbe(${JSON.stringify({ seq: [true, false], top: TOP, bottom: BOTTOM })})`);
      await check("M8b 聊聊姿勢切換：訊息列表／輸入列為同一 DOM 節點", () => assert.deepEqual([r.same[2], r.same[3]], [true, true]));
    }

    // ── E：邊界（摺痕下方剛好 200px）──
    {
      const top = VH - 200 - 40;
      const bottom = VH - 200;
      for (const L of [LAPTOPS[0], LAPTOPS[1], LAPTOPS[2]]) {
        const c = await assertChatLaptop(L, "normal", { top, bottom });
        await check(`E1 聊聊筆電邊界（下半部 200px，${L.name}）：輸入列＋快捷按鍵列仍在下半部、不進摺痕帶；推薦區不進摺痕帶、不蓋輸入列`, () => {
          console.log(`     （資訊）推薦區 [${c.m.recPane.t.toFixed(1)}, ${c.m.recPane.b.toFixed(1)}]（高 ${c.m.recPane.h.toFixed(1)}）；第 1 張卡片可視高 ${Math.max(0, Math.min(c.m.rec.cards[0].b, c.m.recPane.b) - c.m.rec.cards[0].t).toFixed(1)}`);
          assert.deepEqual(c.errs.filter((e) => /^C2|^C3/.test(e)), []);
          // 推薦區不進摺痕帶；若因 padding 下限溢出到輸入列範圍，必須在輸入列之下（z-index 40 < 45）
          assert.ok(c.m.recPane.t >= bottom - 0.5, "推薦區進入摺痕帶：" + c.m.recPane.t);
          assert.equal(c.m.rec.z, "40");
          if (c.m.recPane.b > c.m.composer.t + 1.01)
            console.log(`     （資訊）推薦區下緣 ${c.m.recPane.b} 超過輸入列上緣 ${c.m.composer.t}（${(c.m.recPane.b - c.m.composer.t).toFixed(1)}px，被 z-index 45 的輸入列蓋住）`);
        });
        const mm = await assertMapLaptop(L, { top, bottom });
        await check(`E2 探索筆電邊界（下半部 200px，${L.name}）：搜尋列、分類膠囊、清單仍在下半部且可用`, () => {
          console.log(`     （資訊）面板 [${mm.m.sheet.t.toFixed(1)}, ${mm.m.sheet.b.toFixed(1)}]（高 ${mm.m.sheet.h.toFixed(1)}）；標頭＋膠囊 ${mm.m.sheetHeader.h.toFixed(1)}；清單區高 ${mm.m.sheetBody.h.toFixed(1)}`);
          assert.deepEqual(mm.errs.filter((e) => /^M2|^M3/.test(e)).map((e) => e.slice(0, 160)), []);
        });
      }
    }

    // ── E3：聊聊推薦區在不同下半部高度下是否仍可用（卡片可視高度至少容納 96px 照片） ──
    {
      const rows = [];
      for (const lower of [200, 240, 280, 320, 386.5]) {
        const c = await assertChatLaptop(LAPTOPS[0], "normal", { top: VH - lower - 40, bottom: VH - lower });
        const card = c.m.rec.cards[0];
        rows.push({ lower, pane: +c.m.recPane.h.toFixed(1), cardVisible: +Math.max(0, Math.min(card.b, c.m.recPane.b) - card.t).toFixed(1), errs: c.errs.map((e) => e.split("：")[0]) });
      }
      console.log("     （資訊）下半部高度 → 推薦區高／卡片可視高：" + rows.map((r) => `${r.lower}px→${r.pane}/${r.cardVisible}`).join("、"));
      // E3 只記錄、不判失敗（任務單 #H2b-2-T，使用者裁定接受）：
      //   下半部極矮時推薦卡幾乎看不到（例如 200px→卡片可視 0px）。原因：iPhone Duo 摺痕為硬體固定於螢幕中間，
      //   實機筆電姿勢的上下半部比例不會改變，200～320px 只是 duo-laptop 判定下限附近的理論邊界；
      //   使用者已接受此取捨，不為極矮情境另做版型。E3 以外斷言（E1／E2 推薦區不進摺痕帶、不蓋輸入列等）不變。
      const bad = rows.filter((r) => r.cardVisible < 96);
      console.log(
        `INFO E3 聊聊筆電（只記錄，使用者裁定接受）：推薦卡可視高度 < 96px 的下半部高度：${bad.length ? bad.map((r) => `${r.lower}px（可視 ${r.cardVisible}px）`).join("、") : "無"}`,
      );
    }

    // ── N：非筆電完全相同 ──
    const NON = [
      { name: "一般 iPhone", vw: 390, vh: 844, safeTop: 47, safeBottom: 34 },
      { name: "一般 iPhone（殘留 --duo-hinge-* 變數）", vw: 390, vh: 844, safeTop: 47, safeBottom: 34, hingeVars: true, top: 300, bottom: 340 },
      { name: "Duo 合起／直欄單頁", vw: 669, vh: 951, rail: true },
      { name: "Duo 雙欄", vw: 1300, vh: 951, rail: true, twoPane: true, foldX: 650 },
      { name: "iPad", vw: 820, vh: 1180, safeTop: 24, safeBottom: 20 },
      { name: "web 桌機", vw: 1280, vh: 800, mobile: false },
    ];
    for (const N of NON) {
      for (const variant of [
        { page: "chat", chips: "normal" },
        { page: "chat", chips: "normal", kb: 320 },
        { page: "map" },
        { page: "map", detail: true },
        { page: "map", dropdown: true },
        { page: "map", mapKb: true, dropdown: true },
      ]) {
        await setup({ ...N, ...variant, laptop: false, overlays: overlaysHtml() });
        const a = await evaluate("window.snapshot()");
        await evaluate("window.setCss('old')");
        const b = await evaluate("window.snapshot()");
        await evaluate("window.setCss('new')");
        const label = `${variant.page}${variant.kb ? "＋鍵盤" : ""}${variant.detail ? "＋詳情" : ""}${variant.dropdown ? "＋下拉" : ""}${variant.mapKb ? "＋搜尋聚焦" : ""}`;
        await check(`N ${N.name}／${label}：所有元素位置與樣式＝移除新規則時（${a.els.length} 個元素）`, () => {
          assert.ok(a.els.length > 30);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            const diff = a.els.map((x, i) => [x, b.els[i]]).filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y)).slice(0, 3);
            assert.fail("不同：" + JSON.stringify(diff) + (JSON.stringify(a.padding) !== JSON.stringify(b.padding) ? " padding " + JSON.stringify([a.padding, b.padding]) : ""));
          }
          if (variant.page === "map" && !N.twoPane) assert.equal(a.padding.top, 88, "非筆電 padding 維持手機公式");
        });
      }
    }

    // ── B0 對照：OLD CSS＋筆電 class → 斷言必須失敗 ──
    {
      const c = await assertChatLaptop(LAPTOPS[0], "normal", { css: "old" });
      const mm = await assertMapLaptop(LAPTOPS[0], { css: "old" });
      await check("B0 對照：移除新規則時，聊聊 C1／C3 與探索 M1／M2／M3／M4 斷言會失敗（斷言有效）", () => {
        for (const k of ["C1 上半部", "C3 摺痕帶", "C2c 輸入列全寬", "C7a 推薦區位置", "C7b 推薦卡片"]) assert.ok(c.errs.some((e) => e.startsWith(k)), "聊聊 " + k + " 應失敗：" + JSON.stringify(c.errs));
        for (const k of ["M1 地圖上半部", "M2 下半部", "M3 摺痕帶"]) assert.ok(mm.errs.some((e) => e.startsWith(k)), "探索 " + k + " 應失敗：" + JSON.stringify(mm.errs));
        console.log("     （資訊）OLD 失敗項：" + [...c.errs, ...mm.errs].map((e) => e.split("：")[0]).join("、"));
      });
    }
    // B0b padding：若沒有筆電分支（手機公式），可視區高度會 ≤ 0
    {
      await setup({ page: "map", laptop: true, top: TOP, bottom: BOTTOM });
      const m = await measure();
      const phoneBottom = Math.max(220, m.sheet.h + 68 + 0 + 56 + 12);
      await check("B0b 對照：筆電時若沿用手機 padding 公式，地圖可視區高度 ≤ 0（證明 M4 的筆電分支必要）", () => {
        assert.ok(m.canvas.h - 88 - phoneBottom <= 0, JSON.stringify({ canvasH: m.canvas.h, phoneBottom }));
      });
    }

    await check("B9 無外部請求、無瀏覽器例外", () => {
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(browserErrors, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

console.log(failures.length ? `\nverify-duo-laptop-chat-explore: FAIL (${failures.length})` : "\nverify-duo-laptop-chat-explore: PASS");
process.exit(failures.length ? 1 : 0);
