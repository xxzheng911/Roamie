// verify-chat-duo-rec-pane.mjs — 聊天推薦卡在 iPhone Duo 展開雙頁時移到右頁（C1-T tester 獨立審查）
//
// Part S（靜態）：
//   S1 styles.css 中 chat-duo-rec-pane 規則全部以 html.duo-rail.duo-two-pane 開頭、位於 @layer 外；
//      若有改動前副本（S1b），確認改動前內容逐行、逐頂層 statement 全部保留（純插入）；C1 三條右頁規則
//      selector 與宣告逐字存在、在 @layer 外；其他新增只能是以 html.duo-rail.duo-two-pane 或 html.duo-laptop
//      開頭的一般規則（其他合法 Duo 改動，例如行程詳情雙欄）。--mutants 另以記憶體突變驗證 S1b。
//   S2 styles.css 最後一個規則仍是地點詳情 Duo（.place-duo-root）區塊。
//   S3 RoamieResponseView diff 只新增 hideSummary（預設 false），三處既有條件只多 `!hideSummary &&`。
//   S4 ChatMessageList 雙頁判斷與 _app.place.tsx 相同；右頁只在 duoTwoPane 時渲染。
//   S5 dialog／sheet／drawer／alert-dialog 皆為 z-50（> 右頁 40）。
//   S6（有 baseline 時）HEAD 版 ChatMessageList／RoamieResponseView 即改動前版本；_app.chat.tsx 除 #L1 生成鎖授權段落外未被改動。
// Part B（真實 Chrome + 真實 React render，HEAD 版與目前版並排比對；useDuoLayout 以可控 store 取代）：
//   B1 非 Duo（手機／Duo 合起／筆電半開／rail 但無 pane／iPad 類 two-pane 非 rail）各情境：
//      目前版 HTML 與 HEAD 版逐字相同、body 沒有多出 portal。
//   B2 非 Duo 姿勢切換、父層 re-render：ChatMessageRow 0 次 re-render。
//   B3 [CHAT_RECOMMENDATION_MOUNT] log 與 HEAD 相同；姿勢切換不 remount 訊息列、不多出 log。
//   B4 Duo：左頁無卡片、只留文字；標籤「推薦 · N」+ aria-pressed；預設最新；點標籤／泡泡切換；選取泡泡加框。
//   B5 Duo：右頁卡片 HTML 與非 Duo 左頁卡片逐字相同；每個按鈕／卡片點擊／Enter 呼叫的 handler 與參數相同。
//   B6 Duo：新推薦出現自動切到最新；只新增文字回覆時保留使用者選擇；切換時右頁捲回頂端。
//   B7 Duo：無推薦／generating／suppressPlaceCards 時右頁不渲染、HTML 與非 Duo 相同。
//   B8 Duo：右頁位置在 [摺痕右緣, 直欄左緣]、獨立捲動、z-index 40 且被 z-50 dialog 蓋住。
//   B9 RoamieResponseView：hideSummary 預設下與 HEAD 逐字相同；hideSummary 時只隱藏 mood／summary／點點。
//
// 不讀 .env、不呼叫外部服務；瀏覽器只連 127.0.0.1 fixture server。
// 執行：node scripts/verify-chat-duo-rec-pane.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  "));
  }
};
const PREFIX = "html.duo-rail.duo-two-pane ";
const sameHtml = (a, b, label = "HTML 不同") => {
  if (a === b) return;
  a = String(a);
  b = String(b);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(`${label}（第 ${i} 字元起）\n  實際：…${String(a).slice(Math.max(0, i - 80), i + 160)}\n  預期：…${String(b).slice(Math.max(0, i - 80), i + 160)}`);
};
const SCRATCH = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const braceDepth = (s) => {
  let d = 0;
  for (const ch of stripComments(s)) d += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  return d;
};

// ───────────────────────── Part S：靜態 ─────────────────────────
const styles = read("src/styles.css");

check("S1a chat-duo-rec-pane 規則全部以 html.duo-rail.duo-two-pane 開頭、位於 @layer 外", () => {
  const all = stripComments(styles);
  const rules = [...all.matchAll(/([^{}]+)\{[^{}]*\}/g)].filter((r) => r[1].includes("chat-duo-rec-pane"));
  assert.ok(rules.length >= 2, "找不到 chat-duo-rec-pane 規則");
  for (const r of rules) {
    for (const s of r[1].split(",").map((x) => x.trim())) assert.ok(s.startsWith(PREFIX), "未加前綴：" + s);
    assert.equal(braceDepth(all.slice(0, r.index)), 0, "位於某個區塊（@layer?）內：" + r[1].trim());
  }
});

const beforeCopy = path.join(SCRATCH, "c1-styles-before.css");
let verifyS1bFn = null;
if (fs.existsSync(beforeCopy)) {
  // 改動前副本（C1 之前）之後，styles.css 另有其他合法 Duo 改動（例如行程詳情雙欄規則），
  // 因此不再要求「只插入一段連續規則」，改為：
  //   (1) 行層級：改動前每一行都依序保留（純插入，沒有刪改）；
  //   (2) 規則層級：以頂層 statement 切分（@layer 等巢狀區塊視為一個 statement），改動前的每個頂層 statement
  //       都原樣、依序存在（因此新規則若被塞進 @layer，該 @layer statement 會不同而失敗）；
  //   (3) 新增的頂層 statement 必須是一般規則，每個 selector 以 html.duo-rail.duo-two-pane、html.duo-laptop 或 html.duo-device 開頭；
  //   (4) C1 的三條 chat-duo-rec-pane 規則完整存在於新增 statement 中（selector 逐字、宣告逐項），
  //       且 chat-duo-rec-pane 不出現在其他任何地方。
  const topLevel = (src) => {
    const s = stripComments(src);
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        assert.ok(depth >= 0, "大括號不平衡（多出 }）");
        if (depth === 0) {
          out.push(s.slice(start, i + 1));
          start = i + 1;
        }
      } else if (ch === ";" && depth === 0) {
        out.push(s.slice(start, i + 1));
        start = i + 1;
      }
    }
    assert.equal(depth, 0, "大括號不平衡（缺 }）");
    assert.equal(s.slice(start).trim(), "", "結尾有未結束的 statement");
    return out.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  };
  // html.duo-device：iPhone Duo 裝置標記（任務單 #H2b-2，聊聊輸入列滿版）；lookahead 確保 class 名稱邊界（duo-devicex／duo-device-x 不接受）
  // html.duo-flat-portrait：iPhone Duo 直向攤平（任務單 #H3-1，只用於探索頁），只接受 .map-route-active 限定的 selector
  // html.duo-flat-portrait.trip-detail-route-active：#DT1（行程頁一頁式＋封面延伸）已核准範圍，與 verify-duo-explore-keyboard-flat A3b 同規則：
  //   只限行程詳情、且必須與同一規則內的 html.duo-laptop.trip-detail-route-active 並列；
  //   唯一非 Duo 前綴的例外是 #DT1 底板基底規則 `.trip-duo-status-backdrop { display: none }`（恰好一條、只能 display:none）。
  //   #DT1 的變數規則直接作用在 html 本身（selector 到此結束），因此 trip-detail-route-active 前綴也接受字串結尾（同 A3b 的 (?=$|[\s.])）。
  const DUO_BLOCK_PREFIX = /^(?:html\.(duo-rail\.duo-two-pane|duo-laptop|duo-device|duo-flat-portrait\.map-route-active)(?=[\s.:[>+~])|html\.duo-(?:laptop|flat-portrait)\.trip-detail-route-active(?=$|[\s.:[>+~]))/;
  const DT1_BACKDROP_BASE = ".trip-duo-status-backdrop";
  const C1_RULES = [
    [
      PREFIX + ".chat-duo-rec-pane",
      [
        "position: fixed",
        "top: var(--duo-app-top)",
        "bottom: var(--safe-area-bottom)",
        "left: var(--duo-fold-right-edge)",
        "right: var(--app-rail-width)",
        "z-index: 40",
        "display: flex",
        "flex-direction: column",
        "background: var(--background)",
      ],
    ],
    [
      PREFIX + ".chat-duo-rec-pane__scroll",
      [
        "flex: 1 1 0%",
        "min-height: 0",
        "overflow-y: auto",
        "overscroll-behavior: contain",
        "-webkit-overflow-scrolling: touch",
        "padding: 1.25rem 1.25rem 1.5rem",
      ],
    ],
    [
      PREFIX + ".chat-duo-rec-pane [data-chat-place-cards] > article > div:first-child",
      ["aspect-ratio: auto", "height: 132px", "min-height: 0"],
    ],
  ];
  const beforeSrc = fs.readFileSync(beforeCopy, "utf8");
  function verifyS1b(styles, quiet = false) {
    // (1) 行層級：改動前每一行依序保留
    const a = beforeSrc.split("\n");
    const b = styles.split("\n");
    let j = 0;
    for (let i = 0; i < a.length; i++) {
      while (j < b.length && b[j] !== a[i]) j++;
      assert.ok(j < b.length, `改動前第 ${i + 1} 行不見或順序被改：${JSON.stringify(a[i])}`);
      j++;
    }
    // (2) 規則層級：改動前的頂層 statement 依序原樣存在
    const before = topLevel(beforeSrc);
    const after = topLevel(styles);
    const added = [];
    let k = 0;
    for (const stmt of after) {
      if (k < before.length && stmt === before[k]) k++;
      else added.push(stmt);
    }
    assert.equal(k, before.length, "改動前的頂層 statement 被刪改或移位：" + (before[k] ?? "").slice(0, 200));
    assert.ok(!before.some((x) => x.includes("chat-duo-rec-pane")), "改動前副本已含 chat-duo-rec-pane（副本錯誤）");
    // (3) 新增 statement 只能是 Duo 前綴的一般規則（不得是 @layer／@media 等巢狀區塊或 at-rule）
    let dt1BackdropBase = 0;
    const parsed = added.map((stmt) => {
      const m = stmt.match(/^([^{}]+)\{([^{}]*)\}$/);
      assert.ok(m, "新增的不是單純規則（可能是 @layer／at-rule／巢狀區塊）：" + stmt.slice(0, 200));
      const sels = m[1].split(",").map((x) => x.trim());
      const decls = m[2].split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean);
      if (sels.length === 1 && sels[0] === DT1_BACKDROP_BASE) {
        // #DT1 底板基底規則：只能是 display:none，且只有一條
        assert.deepEqual(decls, ["display: none"], "#DT1 底板基底規則只能是 display:none：" + stmt.slice(0, 200));
        dt1BackdropBase++;
        assert.ok(dt1BackdropBase <= 1, "#DT1 底板基底規則超過一條");
        return { sels, decls };
      }
      for (const sel of sels) assert.match(sel, DUO_BLOCK_PREFIX, "新增規則未以 Duo 前綴開頭：" + sel);
      // #DT1：直向攤平的行程頁規則必須與筆電同一規則並列（範圍不得比筆電寬）
      for (const sel of sels.filter((s) => s.startsWith("html.duo-flat-portrait.trip-detail-route-active")))
        assert.ok(sels.includes(sel.replace("html.duo-flat-portrait.", "html.duo-laptop.")), "#DT1 直向攤平行程頁規則未與筆電並列：" + sel);
      return { sels, decls };
    });
    // (4) C1 三條規則完整存在（selector 逐字、宣告逐項、各恰好一次），且 chat-duo-rec-pane 只出現在這三條
    for (const [sel, decls] of C1_RULES) {
      const hit = parsed.filter((r) => r.sels.length === 1 && r.sels[0] === sel);
      assert.equal(hit.length, 1, `C1 規則數量不是 1：${sel}（${hit.length}）`);
      assert.deepEqual(hit[0].decls, decls, "C1 規則宣告不同：" + sel);
    }
    const recRules = parsed.filter((r) => r.sels.some((s) => s.includes("chat-duo-rec-pane")));
    assert.equal(recRules.length, C1_RULES.length, "chat-duo-rec-pane 規則數量異常 " + recRules.length);
    const recOutside = after.filter((x) => x.includes("chat-duo-rec-pane")).length;
    assert.equal(recOutside, C1_RULES.length, "chat-duo-rec-pane 出現在 C1 三條規則以外的頂層 statement");
    const others = parsed.filter((r) => !r.sels.some((s) => s.includes("chat-duo-rec-pane")));
    if (!quiet) console.log(
      `  改動前 ${before.length} 個頂層 statement 全部保留；新增 ${added.length} 條（C1 ${C1_RULES.length} 條＋其他 Duo ${others.length} 條）`,
    );
    if (!quiet) for (const r of others) console.log("    其他 Duo 新增：" + JSON.stringify(r.sels));
  }
  verifyS1bFn = verifyS1b;
  check("S1b 改動前 styles.css 全部保留（純插入）；C1 三條右頁規則完整、前綴正確、在 @layer 外；其他插入只限 Duo 區塊", () =>
    verifyS1b(styles),
  );
} else {
  console.log("SKIP S1b 找不到改動前副本 " + beforeCopy);
}

check("S2 styles.css 最後一個規則仍屬地點詳情 Duo（.place-duo-root）區塊", () => {
  const all = stripComments(styles);
  const rules = [...all.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  const last = rules[rules.length - 1][1].trim();
  assert.ok(last.startsWith(PREFIX + ".place-duo-root"), "最後一條規則：" + last);
  assert.equal(all.slice(rules[rules.length - 1].index + rules[rules.length - 1][0].length).trim(), "");
  const lastRec = all.lastIndexOf("chat-duo-rec-pane");
  const firstPlace = all.indexOf(".place-duo-root");
  assert.ok(lastRec < firstPlace, "chat-duo-rec-pane 規則出現在 place-duo-root 區塊之後");
});

check("S3 RoamieResponseView diff 只新增 hideSummary（預設 false），三處條件只多 !hideSummary &&", () => {
  const diff = git("diff", "-U0", "--", "src/components/RoamieResponseView.tsx");
  const lines = diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const removed = lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
  const added = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  assert.deepEqual(removed.map((l) => l.trim()), ["{moodBadge ? (", "{summary && (", "{!summary && ("]);
  const rest = added.filter((l) => !removed.some((r) => l === r.replace("{", "{!hideSummary && ")));
  assert.equal(added.length - rest.length, 3, "既有條件改寫不是單純前置 !hideSummary &&");
  assert.deepEqual(
    rest.map((l) => l.trim()).filter((l) => !l.startsWith("/**")),
    ["hideSummary?: boolean;", "hideSummary = false,"],
  );
});

check("S4 雙頁判斷與 _app.place.tsx 相同；右頁、標籤只在 duoTwoPane 時渲染", () => {
  const list = read("src/components/chat/ChatMessageList.tsx");
  const place = read("src/routes/_app.place.tsx");
  for (const src of [list, place]) {
    assert.match(src, /navPlacement === "right-rail"/);
    assert.match(src, /tripLayout === "two-pane"/);
    assert.match(src, /\.pane != null/);
  }
  assert.match(list, /\{duoTwoPane && duoSelected \? \(\s*<ChatDuoRecommendationPane/);
  assert.match(list, /duoTwoPane && m\.role === "assistant"/);
  const pane = read("src/components/chat/ChatDuoRecommendationPane.tsx");
  assert.match(pane, /createPortal\(/);
  assert.match(pane, /className="chat-duo-rec-pane"/);
});

check("S5 dialog／sheet／drawer／alert-dialog 為 z-50（高於右頁 z-index 40）", () => {
  for (const f of ["dialog", "sheet", "drawer", "alert-dialog"]) {
    const src = read(`src/components/ui/${f}.tsx`);
    assert.ok(/\bz-50\b/.test(src), f + " 不是 z-50");
    assert.ok(!/\bz-(10|20|30|40)\b/.test(src), f + " 有低於 50 的 z-index");
  }
  const rule = stripComments(styles).match(/\.chat-duo-rec-pane\s*\{([^}]*)\}/)[1];
  assert.match(rule, /z-index:\s*40;/);
});

const baselineFile = path.join(SCRATCH, "c1-baseline.txt");
// #L1-T2：_app.chat.tsx 經 #L1（行程生成全域鎖）授權修改（sha256 前 16 碼 95e7866a0e96f036 作廢 → bb3a7f395ea8d58e）。
// #L1-T3：第 2 輪授權修改（清除聊聊上鎖、離開原對話時的失敗提示、提示取目前語系）→ 1f9f6c91787031f6（bb3a7f395ea8d58e 作廢）。
// #L1-T4：第 3 輪授權修改（不在原對話時失敗只一則提示、具體原因、保存後失效改發完成提示、finally 通知 try／catch）→ 8e2dd996d9c89771（1f9f6c91787031f6 作廢）。
//   S6 原意＝「Duo 推薦右頁沒有改動聊聊頁」：改為逐字移除 #L1 授權段落後，必須等於 baseline 的 _app.chat.tsx。
const { assertChatTsxOnlyLockChanges, CHAT_TSX_PRE_LOCK_SHA256 } = await import("./verify-chat-generation-lock-authorized-diff.mjs");
if (fs.existsSync(baselineFile)) {
  // #PL-FIX-T3：不再寫死目前 sha（#PL-FIX 授權變更後隨 Planner 段落改變）；改為移除 #L1＋#PL-FIX 授權段落後＝baseline。
  check("S6 HEAD 版 ChatMessageList／RoamieResponseView 等於改動前 baseline；_app.chat.tsx 差異只落在 #L1 生成鎖與 #PL-FIX Planner 授權段落", () => {
    const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
    const base = Object.fromEntries(
      fs
        .readFileSync(baselineFile, "utf8")
        .trim()
        .split("\n")
        .map((l) => l.trim().split(/\s+/))
        .map(([h, p]) => [p, h]),
    );
    assert.equal(sha(git("show", "HEAD:src/components/chat/ChatMessageList.tsx")), base["src/components/chat/ChatMessageList.tsx"]);
    assert.equal(sha(git("show", "HEAD:src/components/RoamieResponseView.tsx")), base["src/components/RoamieResponseView.tsx"]);
    assert.equal(base["src/routes/_app.chat.tsx"], CHAT_TSX_PRE_LOCK_SHA256, "baseline 的 _app.chat.tsx sha 不是 #L1 改動前版本");
    assert.equal(assertChatTsxOnlyLockChanges(), sha(read("src/routes/_app.chat.tsx")), "授權段落比對讀到的 _app.chat.tsx 與本腳本不同");
  });
} else {
  console.log("SKIP S6 找不到 baseline " + baselineFile);
}

// ───────────────────────── Part B：真實瀏覽器 ─────────────────────────
// 突變測試（只在記憶體中改寫 fixture，不碰 source）：node scripts/verify-chat-duo-rec-pane.mjs --mutants
// 每個突變都必須讓至少一個 B 檢查 FAIL，證明檢查真的覆蓋到宣稱的行為。
const MUTANTS = {
  nonDuoExtraClass: ["list", '${duoTag ? " flex-wrap" : ""}', '${duoTag ? " flex-wrap" : " "}'],
  unstableRowProp: ["list", "onDuoSelect={duoTwoPane ? handleDuoSelect : undefined}", "onDuoSelect={duoTwoPane ? handleDuoSelect : () => {}}"],
  remountOnPosture: ["list", "key={stableKeys[i]}\n", 'key={stableKeys[i] + (duoTwoPane ? ":duo" : "")}\n'],
  noAutoSwitch: ["list", "duoPick && duoPick.latest === latestDuoKey", "duoPick"],
  cardsStayLeft: ["list", "hideRecommendations={duoTwoPane}", "hideRecommendations={false}"],
  noAriaPressed: ["list", "aria-pressed={duoSelected}", ""],
  noScrollReset: ["pane", "if (scrollRef.current) scrollRef.current.scrollTop = 0;", ""],
  paneShowsSummary: ["pane", "          hideSummary\n", ""],
  paneDropsHandler: ["pane", "onDiscussPlace={onDiscussPlace}", ""],
};
const activeMutant = process.env.CHAT_DUO_MUTANT || null;
function mutate(kind, src) {
  if (!activeMutant) return src;
  const [k, from, to] = MUTANTS[activeMutant];
  if (k !== kind) return src;
  assert.ok(src.includes(from), `突變 ${activeMutant} 找不到原始片段`);
  return src.replace(from, to);
}
if (process.argv.includes("--mutants")) {
  const { spawnSync } = await import("node:child_process");
  let survived = 0;
  // S1b 突變（只在記憶體中改寫 styles.css 字串）：每個突變都必須讓 verifyS1b 丟出錯誤
  if (!verifyS1bFn) {
    survived++;
    console.log("SURVIVED S1b-*  → 找不到改動前副本，無法執行 S1b 突變");
  } else {
    const REC = "html.duo-rail.duo-two-pane .chat-duo-rec-pane {";
    const S1B_MUTANTS = {
      dropC1Decl: (s) => s.replace("  z-index: 40;\n  display: flex;\n  flex-direction: column;\n  background: var(--background);", "  display: flex;\n  flex-direction: column;\n  background: var(--background);"),
      changeC1Value: (s) => s.replace("  height: 132px;", "  height: 120px;"),
      weakPrefix: (s) => s.replace(REC, "html.duo-rail .chat-duo-rec-pane {"),
      dropC1Rule: (s) => s.replace(/html\.duo-rail\.duo-two-pane \.chat-duo-rec-pane__scroll \{[^}]*\}\n/, ""),
      c1InsideLayer: (s) => {
        const m = s.match(/html\.duo-rail\.duo-two-pane \.chat-duo-rec-pane__scroll \{[^}]*\}\n/)[0];
        return s.replace(m, "").replace("@layer utilities {", "@layer utilities {\n" + m);
      },
      deleteOriginalLine: (s) => s.replace("  flex-direction: column !important;\n  overflow: hidden !important;", "  overflow: hidden !important;"),
      editOriginalValue: (s) => s.replace("  --duo-top-gap: 14px;", "  --duo-top-gap: 15px;"),
      reorderOriginal: (s) => {
        const a = "html.trip-detail-route-active main.app-scroll {\n  overflow: hidden !important;\n}\n";
        return s.replace(a, "") + "\n" + a;
      },
      nonDuoInsert: (s) => s.replace(REC, "main.app-scroll > div { flex-direction: row !important; }\n" + REC),
      duoMediaInsert: (s) => s.replace(REC, "@media (min-width: 1px) { html.duo-rail.duo-two-pane .x { color: red; } }\n" + REC),
      lookalikePrefix: (s) => s.replace(REC, "html.duo-laptopx .x { color: red; }\n" + REC),
      lookalikeDevice: (s) => s.replace(REC, "html.duo-devicex .x { color: red; }\n" + REC),
      lookalikeDeviceDash: (s) => s.replace(REC, "html.duo-device-x .x { color: red; }\n" + REC),
      deviceNotOnHtml: (s) => s.replace(REC, "body.duo-device .x { color: red; }\n" + REC),
      deviceMixedList: (s) => s.replace(REC, "html.duo-device .x, .y { color: red; }\n" + REC),
      mixedSelectorList: (s) => s.replace(REC, "html.duo-laptop .x, .y { color: red; }\n" + REC),
      extraRecRule: (s) => s.replace(REC, "html.duo-rail.duo-two-pane .chat-duo-rec-pane .z { color: red; }\n" + REC),
      // #DT1 允許範圍的邊界
      dt1FlatTripUnpaired: (s) => s.replace(REC, "html.duo-flat-portrait.trip-detail-route-active .x { color: red; }\n" + REC),
      dt1FlatTripLookalike: (s) => s.replace(REC, "html.duo-laptop.trip-detail-route-activex .x, html.duo-flat-portrait.trip-detail-route-activex .x { color: red; }\n" + REC),
      bareDuoHtml: (s) => s.replace(REC, "html.duo-device { color: red; }\n" + REC),
      dt1FlatOtherRoute:(s) => s.replace(REC, "html.duo-laptop.chat-route-active .x, html.duo-flat-portrait.chat-route-active .x { color: red; }\n" + REC),
      dt1BackdropBaseNotNone: (s) => s.replace(".trip-duo-status-backdrop {\n  display: none;\n}", ".trip-duo-status-backdrop {\n  display: block;\n}"),
      dt1BackdropBaseTwice: (s) => s.replace(REC, ".trip-duo-status-backdrop { display: none; }\n" + REC),
    };
    for (const [name, fn] of Object.entries(S1B_MUTANTS)) {
      const mutated = fn(styles);
      let killed = false;
      let why = "(none)";
      if (mutated === styles) why = "突變未套用（找不到原始片段）";
      else
        try {
          verifyS1bFn(mutated, true);
        } catch (e) {
          killed = true;
          why = String(e.message).split("\n")[0].slice(0, 120);
        }
      if (!killed) survived++;
      console.log(`${killed ? "KILLED  " : "SURVIVED"} S1b-${name}  → ${why}`);
    }
    // 合法插入（另一個 html.duo-laptop／html.duo-rail.duo-two-pane 規則）不得誤判
    for (const ok of ["html.duo-laptop.trip-detail-route-active .q { color: red; }\n", "html.duo-rail.duo-two-pane .q, html.duo-laptop .q { color: red; }\n", "html.duo-device.chat-route-active:not(.duo-rail) .q, html.duo-device .q { color: red; }\n", "html.duo-laptop.trip-detail-route-active .q, html.duo-flat-portrait.trip-detail-route-active .q { color: red; }\n"]) {
      try {
        verifyS1bFn(styles.replace(REC, ok + REC), true);
        console.log("OK       S1b 合法 Duo 插入未被誤判：" + ok.trim());
      } catch (e) {
        survived++;
        console.log("FALSE+   S1b 合法 Duo 插入被誤判：" + ok.trim() + " → " + e.message);
      }
    }
  }
  for (const name of Object.keys(MUTANTS)) {
    const r = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      env: { ...process.env, CHAT_DUO_MUTANT: name },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const failed = [...out.matchAll(/^FAIL (B\S*) /gm)].map((m) => m[1]);
    const killed = r.status !== 0 && failed.length > 0;
    if (!killed) survived++;
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${name}  → FAIL: ${[...new Set(failed)].join(", ") || "(none)"}`);
  }
  console.log(survived ? `\n突變測試：${survived} 個突變存活（檢查不足）` : "\n突變測試：全部突變都被抓到");
  process.exit(survived ? 1 : 0);
}
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(
    os.homedir(),
    "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("B 無可用 Chrome（未執行瀏覽器驗證）");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器驗證");
} else {
  await runBrowser();
}

async function runBrowser() {
  const { build, stop } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-chat-duo-"));

  const cssSrc = styles.replace(/^@import url\([^\n]*\n/m, "");
  const compiler = await compile(cssSrc, { base: path.join(root, "src"), onDependency() {} });
  const scanner = new Scanner({ sources: compiler.sources });
  const css = compiler.build(scanner.scan());
  assert.match(css, /chat-duo-rec-pane/, "編譯後 CSS 沒有 chat-duo-rec-pane");

  const mocks = {
    "@/integrations/supabase/client": `export const isSupabaseConfigured=false;export const supabase={auth:{getSession:async()=>({data:{session:null}})}}`,
    "@/lib/api-url": `export const resolveApiUrl=p=>location.origin+p`,
    "@/services/placeImageService": `export const getRoamieDefaultImage=()=>"/fallback.png"`,
    "@/hooks/use-i18n": `const M={"productionUi.p042d7d5a05":"推薦"};export const useI18n=()=>({locale:'zh-TW',t:k=>M[k]??k})`,
    "@/components/PlaceRecommendationReason": `export const PlaceRecommendationReason=({place})=>"reason:"+place.name`,
    "@/components/media/PlaceCoverImage": `export const PlaceCoverImage=({className,name})=><div className={className} data-fixture-cover={name}/>`,
    "@/lib/google-maps-client": `export const buildPlacePhotoUrl=()=>null`,
    "@/lib/maps-navigation": `export const openExternal=(u)=>{(window.__calls||[]).push(['openExternal'])};export const buildPlaceMapsUrl=()=>"https://maps.invalid/p";export const buildDirectionsUrl=()=>"https://maps.invalid/d";export const buildDirectionsUrlFromQuery=()=>"https://maps.invalid/q"`,
    "@/components/RoamieAssistantAvatar": `export function RoamieAssistantAvatar({className}){window.__avatarRenders=(window.__avatarRenders||0)+1;return <span className={className} data-fixture-avatar=""/>}`,
    "@/hooks/use-duo-layout": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={navPlacement:'bottom',tripLayout:'single',usableWidth:402};
export function setDuoLayout(v){cur=v;subs.forEach(f=>f());}
export function useDuoLayout(){window.__duoHookCalls=(window.__duoHookCalls||0)+1;return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
    "fixture:cur-list": mutate("list", read("src/components/chat/ChatMessageList.tsx")),
    "@/components/chat/ChatDuoRecommendationPane": mutate("pane", read("src/components/chat/ChatDuoRecommendationPane.tsx")),
    "fixture:head-list": git("show", "HEAD:src/components/chat/ChatMessageList.tsx"),
    "fixture:head-rrv": git("show", "HEAD:src/components/RoamieResponseView.tsx"),
  };
  const mockDir = {
    "fixture:cur-list": path.join(root, "src/components/chat"),
    "@/components/chat/ChatDuoRecommendationPane": path.join(root, "src/components/chat"),
    "fixture:head-list": path.join(root, "src/components/chat"),
    "fixture:head-rrv": path.join(root, "src/components"),
  };

  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ChatMessageList as CurList} from 'fixture:cur-list';
import {ChatMessageList as HeadList} from 'fixture:head-list';
import {RoamieResponseView as CurRRV} from '${root}/src/components/RoamieResponseView';
import {RoamieResponseView as HeadRRV} from 'fixture:head-rrv';
import {setDuoLayout} from '@/hooks/use-duo-layout';
window.__calls=[];window.__logs=[];
console.info=(...a)=>{if(a[0]==='[CHAT_RECOMMENDATION_MOUNT]')window.__logs.push(JSON.stringify(a[1]));};
console.debug=()=>{};console.log=()=>{};
const rec=(n)=>({name:n,placeName:n,description:'Desc '+n,reason:'Why '+n,address:n+' street 1-2-3',lat:35.6,lng:139.7,googlePlaceId:'gp-'+n,type:'cafe',rating:4.2});
const recs=(p,c)=>Array.from({length:c},(_,i)=>rec(p+(i+1)));
const BASE=[
 {id:'u1',role:'user',content:'推薦咖啡'},
 {id:'a1',role:'assistant',content:'這裡有兩間',recommendationRequestId:'rq1',roamie:{summary:'這裡有兩間咖啡廳',moodTag:'chill',recommendations:recs('A',2)}},
 {id:'u2',role:'user',content:'謝謝'},
 {role:'assistant',content:'不客氣，還需要什麼嗎'},
 {id:'u3',role:'user',content:'再來幾間'},
 {id:'a3',role:'assistant',content:'再給你五間',recommendationRequestId:'rq3',roamie:{summary:'再給你五間',recommendations:recs('B',5)}},
];
const GROWN=[...BASE,{id:'u4',role:'user',content:'還有嗎'},{id:'a5',role:'assistant',content:'再五間',recommendationRequestId:'rq5',roamie:{summary:'最後再五間',recommendations:recs('C',5)}}];
const GROWN_TEXT=[...BASE,{id:'u4',role:'user',content:'好'},{id:'a5',role:'assistant',content:'沒問題'}];
const NO_RECS=[{id:'u1',role:'user',content:'你好'},{id:'a1',role:'assistant',content:'你好！',roamie:{summary:'你好！',recommendations:[]}}];
const H={onRecommendationEngage:()=>window.__calls.push(['engage']),onSavePlace:r=>window.__calls.push(['save',r.name]),onAddToTrip:r=>window.__calls.push(['addToTrip',r.name]),onOpenPlaceDetail:r=>window.__calls.push(['openDetail',r.name]),onDiscussPlace:r=>window.__calls.push(['discuss',r.name])};
const SEL=new Set(['B2']);const SAVED=new Set(['B3','A1']);const EMPTY=new Set();
const P=(o)=>({msgs:BASE,hydrating:false,streaming:false,generating:false,suppressPlaceCards:false,loadingIndicator:null,partial:{},selectedNames:SEL,savedNames:SAVED,savingName:null,addToTripLabel:'加入行程',discussPlaceLabel:'聊這裡',viewMapLabel:'地圖',selectionMode:false,recommendationSessionId:'sess-1',...H,...o});
const STREAM_PARTIAL={summary:'串流中的回覆',recommendations:[rec('S1')]};
const SC={
 base:P({}),
 selection:P({selectionMode:true,addToTripLabel:'選取'}),
 saving:P({savingName:'B1',selectedNames:EMPTY}),
 generating:P({generating:true}),
 suppress:P({suppressPlaceCards:true}),
 streaming:P({msgs:[...BASE,{id:'u9',role:'user',content:'更多'},{id:'a9',role:'assistant',content:''}],streaming:true,partial:STREAM_PARTIAL}),
 loading:P({loadingIndicator:{baseText:'整理推薦中',requestId:'r1',dots:2}}),
 noRecs:P({msgs:NO_RECS}),
 hydrating:P({msgs:[],hydrating:true}),
 grown:P({msgs:GROWN}),
 grownText:P({msgs:GROWN_TEXT}),
};
const LAYOUTS={
 phone:{navPlacement:'bottom',tripLayout:'single',usableWidth:402},
 duoFolded:{navPlacement:'right-rail',tripLayout:'single',usableWidth:540},
 duoLaptop:{navPlacement:'right-rail',tripLayout:'single',usableWidth:879},
 railTwoPaneNoPane:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:879},
 ipadLike:{navPlacement:'bottom',tripLayout:'two-pane',usableWidth:1024,pane:{leftWidth:500,rightWidth:500,gutter:24,foldX:512}},
 duo:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:879,pane:{leftWidth:463.5,rightWidth:391.5,gutter:24,foldX:475.5}},
};
function App({version,scenario,tick}){const L=version==='head'?HeadList:CurList;return <div id="chat" className="space-y-4" data-tick={tick} style={{width:'440px'}}>{scenario?<L {...SC[scenario]}/>:null}</div>;}
const rootEl=createRoot(document.getElementById('root'));
window.mount=o=>flushSync(()=>rootEl.render(<App {...o}/>));
window.setDuo=name=>flushSync(()=>setDuoLayout(LAYOUTS[name]));
window.setHtml=on=>{const h=document.documentElement;h.classList.toggle('duo-rail',on);h.classList.toggle('duo-two-pane',on);
 h.style.setProperty('--safe-area-left','0px');h.style.setProperty('--app-rail-width','56px');h.style.setProperty('--duo-fold-left-edge','463.5px');h.style.setProperty('--duo-fold-right-edge','487.5px');};
window.snap=()=>({html:(document.getElementById('chat')??document.getElementById('root')).innerHTML,body:[...document.body.children].map(e=>e.tagName+'#'+e.id+'.'+e.className+(e.hasAttribute('data-chat-duo-rec-pane')?'[pane]':''))});
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
const row=id=>q('#chat [data-chat-message-id="'+id+'"]');
window.leftCards=()=>Object.fromEntries(qa('#chat [data-chat-message-id]').map(r=>[r.getAttribute('data-chat-message-id'),[...r.querySelectorAll('[data-chat-place-cards] > article h4')].map(h=>h.textContent)]).filter(([,v])=>v.length));
window.paneCards=()=>qa('[data-chat-duo-rec-pane] [data-chat-place-cards] > article h4').map(h=>h.textContent);
window.paneCount=()=>qa('[data-chat-duo-rec-pane]').length;
window.tags=()=>Object.fromEntries(qa('#chat [data-chat-message-id]').map(r=>{const b=r.querySelector(':scope > div:last-child > button[aria-pressed]');return b?[r.getAttribute('data-chat-message-id'),{text:b.textContent,pressed:b.getAttribute('aria-pressed'),type:b.getAttribute('type'),bubble:r.children[1].className}]:null}).filter(Boolean));
window.clickTag=id=>flushSync(()=>row(id).querySelector(':scope > div:last-child > button').click());
window.clickBubble=id=>flushSync(()=>row(id).children[1].click());
window.bubbleText=id=>row(id).children[1].textContent;
window.paneText=()=>q('[data-chat-duo-rec-pane]')?.textContent??null;
window.paneHeaderInfo=()=>{const p=q('[data-chat-duo-rec-pane] [data-chat-place-cards] > p');return p?p.textContent:null};
window.articleHtml=(scope,i)=>{const sel=scope==='pane'?'[data-chat-duo-rec-pane] [data-chat-place-cards] > article':'#chat [data-chat-message-id="'+scope+'"] [data-chat-place-cards] > article';return qa(sel)[i]?.outerHTML??null};
window.trace=(scope,i)=>{const sel=scope==='pane'?'[data-chat-duo-rec-pane] [data-chat-place-cards] > article':'#chat [data-chat-message-id="'+scope+'"] [data-chat-place-cards] > article';
 const out=[];const art=()=>qa(sel)[i];
 const n=art().querySelectorAll('button').length;
 for(let k=0;k<n;k++){window.__calls=[];const b=art().querySelectorAll('button')[k];const label=(b.getAttribute('aria-label')||b.textContent).trim();const disabled=b.disabled;flushSync(()=>b.click());out.push({label,disabled,calls:window.__calls});}
 window.__calls=[];flushSync(()=>art().querySelector('p.text-muted-foreground').click());out.push({label:'article-click',calls:window.__calls});
 window.__calls=[];flushSync(()=>art().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));out.push({label:'article-enter',calls:window.__calls});
 window.__calls=[];return out;};
window.rowNodes=()=>{window.__rows=qa('#chat [data-chat-message-id]').flatMap(r=>[r,r.children[0],r.children[1]].filter(Boolean));return window.__rows.length;};
window.sameRowNodes=()=>{const now=qa('#chat [data-chat-message-id]').flatMap(r=>[r,r.children[0],r.children[1]].filter(Boolean));return now.length===window.__rows.length&&now.every((n,i)=>n===window.__rows[i]&&n.isConnected);};
window.resetLogs=()=>{window.__logs=[];};
window.logs=()=>window.__logs;
window.avatar=()=>window.__avatarRenders||0;
window.paneScroll=(to)=>{const s=q('.chat-duo-rec-pane__scroll');if(to!=null)s.scrollTop=to;return {top:s.scrollTop,sh:s.scrollHeight,ch:s.clientHeight,overflowY:getComputedStyle(s).overflowY}};
window.raf2=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
window.paneGeom=()=>{const a=q('[data-chat-duo-rec-pane]');const b=a.getBoundingClientRect();const cs=getComputedStyle(a);return {l:b.left,r:b.right,t:b.top,b:b.bottom,z:cs.zIndex,pos:cs.position,vw:innerWidth,vh:innerHeight,parent:a.parentElement.tagName}};
window.dialogCover=()=>{const d=document.createElement('div');d.id='fixture-dialog';d.setAttribute('role','dialog');d.className='fixed inset-0 z-50';d.style.background='rgba(0,0,0,.5)';document.body.insertBefore(d,document.body.firstChild);
 const b=q('[data-chat-duo-rec-pane]').getBoundingClientRect();const hit=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);const res=hit===d;d.remove();
 const hit2=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);return {coveredByDialog:res,paneHitWithoutDialog:!!hit2&&!!hit2.closest('[data-chat-duo-rec-pane]')};};
const RRV_CASES=[
 {data:{summary:'摘要',moodTag:'chill',recommendations:recs('R',2)},compact:true,recommendationsPreFiltered:true,showItinerary:false,...H,selectedPlaceNames:SEL,savedPlaceNames:SAVED,savingPlaceName:null,addToTripLabel:'加入',discussPlaceLabel:'聊',viewMapLabel:'圖'},
 {data:{summary:'摘要',recommendations:recs('R',2)},...H},
 {data:{recommendations:recs('R',1)},compact:true,recommendationsPreFiltered:true},
 {data:{},compact:true},
 {data:{summary:'s',recommendations:recs('R',2)},hideRecommendations:true,...H},
 {data:{summary:'s',recommendations:recs('R',2)},selectionMode:true,...H,selectedPlaceNames:new Set(['R1'])},
 {data:{summary:'s',recommendations:recs('R',2)},pickMode:true,pickedPlaceNames:new Set(['R2']),onTogglePick:()=>{}},
 {data:{summary:'s',itinerary:[{day:1,date:'2026-11-01',time:'09:00',name:'X',placeName:'X',description:'d'}],recommendations:[]},showItinerary:true},
];
window.rrvCompare=()=>RRV_CASES.map((p,i)=>{flushSync(()=>rootEl.render(<div id="rrv"><HeadRRV {...p}/></div>));const a=q('#rrv').innerHTML;
 flushSync(()=>rootEl.render(<div id="rrv"><CurRRV {...p}/></div>));const b=q('#rrv').innerHTML;
 flushSync(()=>rootEl.render(<div id="rrv"><CurRRV {...p} hideSummary={false}/></div>));const c=q('#rrv').innerHTML;return {i,same:a===b&&a===c,a:a.slice(0,200),b:b.slice(0,200)};});
window.rrvHide=()=>{const p=RRV_CASES[0];flushSync(()=>rootEl.render(<div id="rrv"><CurRRV {...p} hideSummary/></div>));const el=q('#rrv');
 const r={text:el.textContent,cards:el.querySelectorAll('[data-chat-place-cards] > article').length,dots:el.querySelectorAll('.animate-pulse').length,cardsHtml:el.querySelector('[data-chat-place-cards]').outerHTML};
 flushSync(()=>rootEl.render(<div id="rrv"><CurRRV {...p}/></div>));r.fullCardsHtml=q('#rrv [data-chat-place-cards]').outerHTML;
 flushSync(()=>rootEl.render(<div id="rrv"><CurRRV data={{}} compact hideSummary/></div>));r.emptyDots=q('#rrv').querySelectorAll('.animate-pulse').length;
 flushSync(()=>rootEl.render(null));return r;};
window.ready=true;`;

  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app.js"),
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":false,"PROD":true,"MODE":"production"}', "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.importer === "fixture:head-list" && a.path === "@/components/RoamieResponseView")
              return { path: "fixture:head-rrv", namespace: "mock" };
            return a.path in mocks ? { path: a.path, namespace: "mock" } : null;
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "tsx",
            resolveDir: mockDir[a.path] ?? root,
          }));
        },
      },
    ],
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, "app.js")));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
        css +
        '</style></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chrome = spawn(
    chromeBin,
    [
      "--headless",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-port=0",
      "--user-data-dir=" + path.join(dir, "chrome"),
      "about:blank",
    ],
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
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: targetInfos.find((t) => t.type === "page").targetId,
      flatten: true,
    });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 935, height: 800, deviceScaleFactor: 1, mobile: false });
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.ready").catch(() => false)); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.ready"), "fixture 未載入：" + browserErrors.join("\n"));

    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    const mount = (o) => ev("mount", o);
    const snap = () => ev("snap");
    const unmountAll = () => mount({});

    // ─── B9 RoamieResponseView ───
    const rrv = await ev("rrvCompare");
    check("B9a RoamieResponseView 預設 hideSummary 時與 HEAD 逐字相同（8 種 props 組合）", () => {
      for (const r of rrv) assert.ok(r.same, `case ${r.i} 不同\nHEAD=${r.a}\nCUR =${r.b}`);
    });
    const hide = await ev("rrvHide");
    check("B9b hideSummary 只隱藏 mood／summary／載入點點，卡片 HTML 與未隱藏時相同", () => {
      assert.ok(!hide.text.includes("摘要"), "summary 未隱藏");
      assert.equal(hide.cards, 2);
      assert.equal(hide.cardsHtml, hide.fullCardsHtml, "卡片 HTML 因 hideSummary 改變");
      assert.equal(hide.emptyDots, 0, "無 summary 時仍顯示載入點點");
    });

    // ─── B1 非 Duo：與 HEAD 逐字相同 ───
    const NON_DUO = ["phone", "duoFolded", "duoLaptop", "railTwoPaneNoPane", "ipadLike"];
    const SCEN = ["base", "selection", "saving", "generating", "suppress", "streaming", "loading", "noRecs", "hydrating", "grown"];
    const headSnaps = {};
    await evaluate("window.setHtml(false)");
    for (const s of SCEN) {
      await unmountAll();
      await mount({ version: "head", scenario: s });
      headSnaps[s] = await snap();
    }
    for (const layout of NON_DUO) {
      for (const htmlDuo of layout === "railTwoPaneNoPane" ? [false, true] : [false]) {
        await evaluate(`window.setHtml(${htmlDuo})`);
        await ev("setDuo", layout);
        const diffs = [];
        for (const s of SCEN) {
          await unmountAll();
          await mount({ version: "cur", scenario: s });
          const c = await snap();
          if (c.html !== headSnaps[s].html) diffs.push(`${s}: HTML 不同`);
          if (JSON.stringify(c.body) !== JSON.stringify(headSnaps[s].body)) diffs.push(`${s}: body 子節點不同 ${JSON.stringify(c.body)}`);
        }
        check(`B1 非 Duo（${layout}${htmlDuo ? "＋html duo class" : ""}）10 種情境 HTML 與 HEAD 逐字相同、無 portal`, () =>
          assert.deepEqual(diffs, []),
        );
      }
    }
    await evaluate("window.setHtml(false)");

    // ─── B2 非 Duo memo：姿勢切換、父層 re-render 不 re-render 訊息列 ───
    await ev("setDuo", "phone");
    await unmountAll();
    await mount({ version: "cur", scenario: "base", tick: 0 });
    const a0 = await ev("avatar");
    await mount({ version: "cur", scenario: "base", tick: 1 });
    const a1 = await ev("avatar");
    for (const l of ["duoFolded", "duoLaptop", "railTwoPaneNoPane", "ipadLike", "phone"]) await ev("setDuo", l);
    const a2 = await ev("avatar");
    const htmlAfter = (await snap()).html;
    check("B2 非 Duo：父層 re-render 與 5 次非雙頁姿勢切換，ChatMessageRow re-render 0 次、HTML 不變", () => {
      assert.equal(a1 - a0, 0, "父層 re-render 讓訊息列 re-render " + (a1 - a0));
      assert.equal(a2 - a1, 0, "非雙頁姿勢切換讓訊息列 re-render " + (a2 - a1));
      sameHtml(htmlAfter, headSnaps.base.html);
    });

    // ─── B3 log 與 remount ───
    const logRun = async (version) => {
      await unmountAll();
      await ev("resetLogs");
      await mount({ version, scenario: "base" });
      await mount({ version, scenario: "grown" });
      await mount({ version, scenario: "generating" });
      await mount({ version, scenario: "grown" });
      await unmountAll();
      return ev("logs");
    };
    await ev("setDuo", "phone");
    const headLogs = await logRun("head");
    const curLogs = await logRun("cur");
    check("B3a 非 Duo：[CHAT_RECOMMENDATION_MOUNT] log 序列與 HEAD 完全相同", () => {
      assert.ok(headLogs.length >= 8, "log 數異常 " + headLogs.length);
      assert.deepEqual(curLogs, headLogs);
    });
    await mount({ version: "cur", scenario: "base" });
    const nonDuoHtml = (await snap()).html;
    await ev("rowNodes");
    await ev("resetLogs");
    await evaluate("window.setHtml(true)");
    await ev("setDuo", "duo");
    const sameOpen = await ev("sameRowNodes");
    const logsOpen = await ev("logs");
    await evaluate("window.setHtml(false)");
    await ev("setDuo", "duoFolded");
    const sameClose = await ev("sameRowNodes");
    const logsClose = await ev("logs");
    const closedSnap = await snap();
    await evaluate("window.setHtml(true)");
    await ev("setDuo", "duo");
    await evaluate("window.setHtml(false)");
    await ev("setDuo", "phone");
    const sameAgain = await ev("sameRowNodes");
    const logsAll = await ev("logs");
    check("B3b 展開↔合起：訊息列 DOM 節點沿用（不 remount）、不多出 [CHAT_RECOMMENDATION_MOUNT] log", () => {
      assert.equal(sameOpen, true, "展開時訊息列被重建");
      assert.equal(sameClose, true, "合起時訊息列被重建");
      assert.equal(sameAgain, true, "第二次開合時訊息列被重建");
      assert.deepEqual(logsOpen, [], "展開時多出 log");
      assert.deepEqual(logsClose, [], "合起時多出 log");
      assert.deepEqual(logsAll, [], "開合多出 log");
    });
    check("B3c 合起後 HTML 回到與 HEAD 相同、右頁 portal 移除", () => {
      sameHtml(closedSnap.html, nonDuoHtml);
      sameHtml(closedSnap.html, headSnaps.base.html);
      assert.ok(!closedSnap.body.some((b) => b.endsWith("[pane]")), "合起後右頁仍存在");
    });

    // ─── B4 Duo：左頁文字＋標籤，預設最新，點選切換 ───
    await ev("setDuo", "phone");
    const nonDuoCards = {};
    for (const s of ["base", "streaming", "loading", "selection", "grown"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      nonDuoCards[s] = await ev("leftCards");
    }
    await evaluate("window.setHtml(true)");
    await ev("setDuo", "duo");
    for (const s of ["base", "streaming", "loading", "selection", "grown"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      const left = await ev("leftCards");
      const tags = await ev("tags");
      const pane = await ev("paneCards");
      const paneCount = await ev("paneCount");
      const ids = Object.keys(nonDuoCards[s]);
      const latest = ids[ids.length - 1];
      check(`B4a Duo（${s}）：左頁無卡片；每則有卡片的回覆有「推薦 · N」標籤；預設最新；右頁＝最新那則卡片`, () => {
        assert.deepEqual(left, {}, "左頁仍有卡片");
        assert.deepEqual(Object.keys(tags), ids, "標籤所屬訊息與非 Duo 有卡片的訊息不同");
        for (const id of ids) {
          assert.equal(tags[id].text, `推薦 · ${nonDuoCards[s][id].length}`);
          assert.equal(tags[id].type, "button");
          assert.equal(tags[id].pressed, id === latest ? "true" : "false");
          assert.equal(/\bborder-clay\b/.test(tags[id].bubble), id === latest, "選取框與選取狀態不一致：" + id);
        }
        assert.equal(paneCount, 1);
        assert.deepEqual(pane, nonDuoCards[s][latest]);
      });
    }
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    const bubbleA1 = await ev("bubbleText", "a1");
    const paneTextBase = await ev("paneText");
    const paneHeader = await ev("paneHeaderInfo");
    await ev("clickTag", "a1");
    const tagsAfterTag = await ev("tags");
    const paneAfterTag = await ev("paneCards");
    await ev("clickBubble", "a3");
    const tagsAfterBubble = await ev("tags");
    const paneAfterBubble = await ev("paneCards");
    const aBefore = await ev("avatar");
    await ev("clickTag", "a1");
    const aDelta = (await ev("avatar")) - aBefore;
    check("B4b Duo：左頁泡泡保留 summary 文字；右頁不重複顯示 summary", () => {
      assert.ok(bubbleA1.includes("這裡有兩間咖啡廳"), "泡泡文字：" + bubbleA1);
      assert.ok(!paneTextBase.includes("再給你五間"), "右頁出現 summary");
    });
    check("B4c Duo：點標籤／點泡泡都會切換右頁，aria-pressed 與選取框跟著移動", () => {
      assert.equal(tagsAfterTag.a1.pressed, "true");
      assert.equal(tagsAfterTag.a3.pressed, "false");
      assert.match(tagsAfterTag.a1.bubble, /border-clay/);
      assert.doesNotMatch(tagsAfterTag.a3.bubble, /border-clay/);
      assert.deepEqual(paneAfterTag, ["A1", "A2"]);
      assert.equal(tagsAfterBubble.a3.pressed, "true");
      assert.deepEqual(paneAfterBubble, ["B1", "B2", "B3", "B4", "B5"]);
    });
    check("B4d Duo：切換選取只 re-render 前後兩則訊息列（其餘 memo 命中）", () => {
      assert.equal(aDelta, 2, "assistant 訊息列 re-render 次數 " + aDelta);
    });
    console.log("INFO 右頁卡片區頂端標題（RoamieResponseView 非 compact 才有）：" + JSON.stringify(paneHeader));

    // ─── B5 卡片與 handler 等價 ───
    await evaluate("window.setHtml(false)");
    await ev("setDuo", "phone");
    const left = {};
    for (const s of ["base", "selection", "saving"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      left[s] = { html: [], trace: [] };
      for (let i = 0; i < 5; i++) {
        left[s].html.push(await ev("articleHtml", "a3", i));
        left[s].trace.push(await ev("trace", "a3", i));
      }
    }
    await evaluate("window.setHtml(true)");
    await ev("setDuo", "duo");
    for (const s of ["base", "selection", "saving"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      const html = [];
      const trace = [];
      for (let i = 0; i < 5; i++) {
        html.push(await ev("articleHtml", "pane", i));
        trace.push(await ev("trace", "pane", i));
      }
      check(`B5 Duo（${s}）：右頁 5 張卡片 HTML 與非 Duo 左頁逐字相同；每個按鈕／卡片點擊／Enter 的 handler 呼叫相同`, () => {
        assert.ok(left[s].html.every(Boolean), "非 Duo 左頁找不到卡片");
        for (let i = 0; i < 5; i++) sameHtml(html[i], left[s].html[i], `第 ${i + 1} 張卡片 HTML 不同`);
        assert.deepEqual(trace, left[s].trace);
        assert.ok(trace.flat().some((t) => t.calls.length > 0), "trace 沒有任何 handler 呼叫（fixture 異常）");
      });
    }
    console.log("INFO base 第 1 張卡片 handler trace：" + JSON.stringify(left.base.trace[0]));

    // ─── B6 自動切到最新／保留選擇／捲回頂端 ───
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    await ev("clickTag", "a1");
    await mount({ version: "cur", scenario: "grownText" });
    const keepTags = await ev("tags");
    const keepPane = await ev("paneCards");
    await mount({ version: "cur", scenario: "base" });
    await ev("clickTag", "a3");
    await evaluate("window.raf2()");
    const sc0 = await ev("paneScroll", 100000);
    await mount({ version: "cur", scenario: "grown" });
    await evaluate("window.raf2()");
    const sc1 = await ev("paneScroll");
    const autoTags = await ev("tags");
    const autoPane = await ev("paneCards");
    await ev("paneScroll", 100000);
    const sc2pre = await ev("paneScroll");
    await ev("clickTag", "a3");
    await evaluate("window.raf2()");
    const sc2 = await ev("paneScroll");
    check("B6a 只新增文字回覆（最新推薦不變）時保留使用者選擇", () => {
      assert.equal(keepTags.a1.pressed, "true");
      assert.deepEqual(keepPane, ["A1", "A2"]);
    });
    check("B6b 新推薦出現時自動切到最新（即使使用者先前選了別則）", () => {
      assert.equal(autoTags.a5.pressed, "true");
      assert.equal(autoTags.a3.pressed, "false");
      assert.deepEqual(autoPane, ["C1", "C2", "C3", "C4", "C5"]);
    });
    check("B6c 右頁獨立捲動；自動切換與手動切換後都捲回頂端", () => {
      assert.equal(sc0.overflowY, "auto");
      assert.ok(sc0.sh > sc0.ch + 100, "右頁內容不夠長，無法驗證捲動 " + JSON.stringify(sc0));
      assert.ok(sc0.top > 100, "無法捲動右頁 " + JSON.stringify(sc0));
      assert.equal(sc1.top, 0, "自動切到最新後未捲回頂端 " + JSON.stringify(sc1));
      assert.ok(sc2pre.top > 100, "切換前未捲到下方 " + JSON.stringify(sc2pre));
      assert.equal(sc2.top, 0, "手動切換後未捲回頂端 " + JSON.stringify(sc2));
    });

    // ─── B7 Duo 無推薦／隱藏卡片 ───
    for (const s of ["noRecs", "generating", "suppress", "hydrating"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      const c = await snap();
      check(`B7 Duo（${s}）：右頁不渲染、無標籤、HTML 與非 Duo／HEAD 相同`, () => {
        sameHtml(c.html, headSnaps[s].html);
        assert.ok(!c.body.some((b) => b.endsWith("[pane]")), "右頁被渲染");
      });
    }

    // ─── B8 位置／z-index ───
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    const g = await ev("paneGeom");
    const cover = await ev("dialogCover");
    check("B8a 右頁 fixed 在 [摺痕右緣 487.5, 直欄左緣 879]、頂端 = --duo-app-top、portal 到 body", () => {
      assert.equal(g.pos, "fixed");
      assert.equal(g.parent, "BODY");
      assert.ok(Math.abs(g.l - 487.5) <= 0.5, "left " + g.l);
      assert.ok(Math.abs(g.r - (g.vw - 56)) <= 0.5, "right " + g.r);
      assert.ok(Math.abs(g.t - 14) <= 0.5, "top " + g.t);
      assert.ok(Math.abs(g.b - g.vh) <= 0.5, "bottom " + g.b);
    });
    check("B8b 右頁 z-index 40，被 z-50 dialog 蓋住（dialog 在 DOM 中位於右頁之前也一樣）", () => {
      assert.equal(g.z, "40");
      assert.equal(cover.coveredByDialog, true);
      assert.equal(cover.paneHitWithoutDialog, true);
    });

    await unmountAll();
    check("B10 瀏覽器無例外、無外部網路請求", () => {
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(externalRequests, []);
    });
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
    server.closeAllConnections?.();
    stop();
  }
}

if (failures.length) {
  console.log(`\nverify-chat-duo-rec-pane: FAIL（${failures.length}）\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log("\nverify-chat-duo-rec-pane: PASS");
