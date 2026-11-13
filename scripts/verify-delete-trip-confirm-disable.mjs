// verify-delete-trip-confirm-disable.mjs — 任務單 #6：刪除共享行程確認鍵停用流程
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-delete-trip-confirm-disable.mjs
// 不連網（全域 fetch 攔截）、不讀 .env。
//
// 覆蓋：
//   D1-D3 TripDeleteConfirmDialog（真實元件，react-dom/server 實際 render；alert-dialog 換成純 HTML）：
//         confirmDisabled → 確認鍵 disabled＋aria-busy、onClick 不觸發 onConfirm、取消鍵仍可按；
//         confirming → 兩鍵皆鎖；都沒有 → 可按且 onConfirm 只呼叫一次
//   D4    deleteTripDialogLabels 四語系：有其他成員 → 原說明＋提醒句；只有自己 → 文字不變
//   D5-D6 TripDetailScreen／_app.saved.index 停用狀態與計時器（靜態結構：5 秒逾時、清除計時器、
//         失敗視為有其他成員、決定後不被晚到結果改寫）
// 未覆蓋：TripDetailScreen／Saved 整頁的實際 effect 執行（專案沒有 jsdom／@testing-library，未安裝）。

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NET_BLOCKED = [];
globalThis.fetch = async (input) => {
  NET_BLOCKED.push(String(input?.url ?? input).slice(0, 120));
  throw new TypeError("NETWORK_BLOCKED");
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const say = (s) => fs.writeSync(1, s + "\n");
const failures = [];
let passCount = 0;
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    say("PASS " + name);
  } catch (e) {
    failures.push(name);
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 14).join("\n     "));
  }
}

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-delete-dialog-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
const mocks = {
  // Plain HTML stand-ins so the real dialog renders on the server (Radix portals render nothing in SSR).
  "@/components/ui/alert-dialog": `
    import * as React from "react";
    const pass = (tag, role) => (props) => {
      const { children, onOpenChange, open, ...rest } = props;
      return React.createElement(tag, { ...rest, "data-role": role }, children);
    };
    export const AlertDialog = (p) => (p.open ? React.createElement("div", { "data-role": "root" }, p.children) : null);
    export const AlertDialogContent = pass("section", "content");
    export const AlertDialogHeader = pass("header", "header");
    export const AlertDialogTitle = pass("h2", "title");
    export const AlertDialogDescription = pass("p", "description");
    export const AlertDialogFooter = pass("footer", "footer");
    export const AlertDialogCancel = pass("button", "cancel");
    export const AlertDialogAction = pass("button", "action");`,
};
const entry = path.join(tmp, "entry.tsx");
fs.writeFileSync(
  entry,
  `export { TripDeleteConfirmDialog } from ${JSON.stringify(path.join(root, "src/components/saved/TripDeleteConfirmDialog.tsx"))};
   export * as AD from "@/components/ui/alert-dialog";
   export { deleteTripDialogLabels } from ${JSON.stringify(path.join(root, "src/lib/i18n/delete-trip-dialog.ts"))};
   export { renderToStaticMarkup } from "react-dom/server";
   export { createElement } from "react";`,
);
const outFile = path.join(tmp, "bundle.mjs");
try {
  await build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    jsx: "automatic",
    outfile: outFile,
    logLevel: "silent",
    plugins: [
      {
        name: "dialog-mocks",
        setup(b) {
          b.onResolve({ filter: /^@\/components\/ui\/alert-dialog$/ }, (a) => ({ path: a.path, namespace: "mock" }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
        },
      },
    ],
  });
} catch (e) {
  say("INFRA-FAIL bundle: " + String(e?.message ?? e).slice(0, 1500));
  process.exit(1);
}
const mod = await import(pathToFileURL(outFile).href);
const { TripDeleteConfirmDialog, AD, deleteTripDialogLabels, renderToStaticMarkup, createElement } = mod;

const baseProps = (over = {}) => ({
  open: true,
  title: "T",
  description: "D",
  confirmLabel: "Delete",
  cancelLabel: "Cancel",
  onOpenChange: () => {},
  onConfirm: () => {},
  ...over,
});
/** Walk the element tree returned by the real component function (no hooks inside it). */
function find(node, type) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = find(n, type);
      if (r) return r;
    }
    return null;
  }
  if (node.type === type) return node;
  return find(node.props?.children, type);
}
const html = (props) => renderToStaticMarkup(createElement(TripDeleteConfirmDialog, props));
const buttonTag = (markup, role) => new RegExp(`<button[^>]*data-role="${role}"[^>]*>`).exec(markup)?.[0] ?? "";

await check("D1 confirmDisabled：確認鍵 disabled＋aria-busy；點擊不觸發 onConfirm；取消鍵可按", () => {
  let confirms = 0;
  const props = baseProps({ confirmDisabled: true, onConfirm: () => void (confirms += 1) });
  const markup = html(props);
  assert.match(buttonTag(markup, "action"), /disabled=""/);
  assert.match(buttonTag(markup, "action"), /aria-busy="true"/);
  assert.doesNotMatch(buttonTag(markup, "cancel"), /disabled/);
  const tree = TripDeleteConfirmDialog(props);
  const action = find(tree, AD.AlertDialogAction);
  let prevented = 0;
  action.props.onClick({ preventDefault: () => void (prevented += 1) });
  assert.equal(confirms, 0, "onClick guard must not confirm while disabled");
  assert.equal(prevented, 1);
});

await check("D2 confirming：確認與取消皆鎖；點擊不重複觸發", () => {
  let confirms = 0;
  const props = baseProps({ confirming: true, onConfirm: () => void (confirms += 1) });
  const markup = html(props);
  assert.match(buttonTag(markup, "action"), /disabled=""/);
  assert.match(buttonTag(markup, "cancel"), /disabled=""/);
  assert.doesNotMatch(buttonTag(markup, "action"), /aria-busy/);
  find(TripDeleteConfirmDialog(props), AD.AlertDialogAction).props.onClick({ preventDefault() {} });
  assert.equal(confirms, 0);
});

await check("D3 查回後（未停用、未刪除中）：確認鍵可按，onConfirm 只呼叫一次", () => {
  let confirms = 0;
  const props = baseProps({ onConfirm: () => void (confirms += 1) });
  const markup = html(props);
  assert.doesNotMatch(buttonTag(markup, "action"), /disabled|aria-busy/);
  find(TripDeleteConfirmDialog(props), AD.AlertDialogAction).props.onClick({ preventDefault() {} });
  assert.equal(confirms, 1);
});

await check("D4 deleteTripDialogLabels 四語系：有其他成員 → 原說明＋提醒句（render 出來的文字）；只有自己 → 與原本完全相同", () => {
  const notice = {
    "zh-TW": "其他成員也將無法再查看這趟行程與花費紀錄。",
    en: "Other members will also lose access to this trip and its expense records.",
    ja: "ほかのメンバーも、この旅程と費用の記録を見られなくなります。",
    ko: "다른 멤버도 더 이상 이 여행 일정과 지출 기록을 볼 수 없게 됩니다.",
  };
  const sep = { "zh-TW": "", en: " ", ja: "", ko: " " };
  for (const locale of Object.keys(notice)) {
    const solo = deleteTripDialogLabels(locale);
    assert.deepEqual(deleteTripDialogLabels(locale, { hasOtherMembers: false }), solo, locale);
    assert.deepEqual(deleteTripDialogLabels(locale, { hasOtherMembers: undefined }), solo, locale);
    const shared = deleteTripDialogLabels(locale, { hasOtherMembers: true });
    assert.equal(shared.description, solo.description + sep[locale] + notice[locale], locale);
    assert.equal(shared.title, solo.title);
    assert.equal(shared.confirmLabel, solo.confirmLabel);
    const markup = html(baseProps({ ...shared }));
    assert.ok(markup.includes(notice[locale].replace(/'/g, "&#x27;")), locale + " notice rendered");
    if (locale !== "zh-TW")
      for (const zh of ["其他成員", "花費紀錄", "這趟行程"]) assert.equal(shared.description.includes(zh), false, locale + " zh leak " + zh);
  }
  assert.equal(
    deleteTripDialogLabels("zh-TW", { hasOtherMembers: true }).description.includes("其他成員也將無法再查看這趟行程與花費紀錄"),
    true,
  );
});

await check("D5 TripDetailScreen：查回前停用、5 秒逾時視為有其他成員、失敗視為有其他成員、計時器在關閉／查回／卸載時清除、每次開啟重設", () => {
  const src = read("src/components/trip/TripDetailScreen.tsx");
  assert.match(src, /const deleteConfirmDisabled = deleteOpen && membersPending && !deleteMembersTimedOut;/);
  assert.match(src, /confirmDisabled=\{deleteConfirmDisabled\}/);
  assert.match(src, /deleteTripDialogLabels\(locale, \{ hasOtherMembers \}\)/);
  const effect = /useEffect\(\(\) => \{\s+if \(!deleteOpen \|\| !membersPending\) return;\s+const timer = window\.setTimeout\(\(\) => setDeleteMembersTimedOut\(true\), 5000\);\s+return \(\) => window\.clearTimeout\(timer\);\s+\}, \[deleteOpen, membersPending, tripId\]\);/;
  assert.match(src, effect);
  assert.match(src, /const hasOtherMembers =\s+membersFailed \|\|\s+deleteMembersTimedOut \|\|\s+\(members \?\? \[\]\)\.some\(\(m\) => !m\.is_owner && m\.status === "accepted"\);/);
  const open = src.slice(src.indexOf("const openDeleteDialog = () => {"), src.indexOf("const membersPending"));
  assert.ok(open.indexOf("setDeleteMembersTimedOut(false)") < open.indexOf("setDeleteOpen(true)"), "reset before opening");
  assert.match(open, /\.catch\([\s\S]*setMembers\(\[\]\);\s+setMembersFailed\(true\);/);
  // Trip switch resets the failure / timeout flags (no stale "has other members").
  assert.match(src, /setMembers\(null\);\s+setMembersFailed\(false\);\s+setDeleteMembersTimedOut\(false\);/);
  // The delete button opens through openDeleteDialog (members fetched if not yet requested).
  assert.match(src, /onClick=\{openDeleteDialog\}/);
});

await check("D6 _app.saved.index：查回前停用；失敗／5 秒逾時 → 有其他成員；已決定後不被晚到結果改寫；關閉／換目標／卸載清計時器", () => {
  const src = read("src/routes/_app.saved.index.tsx");
  assert.match(src, /confirmDisabled=\{deleteTarget != null && deleteTarget\.hasOtherMembers === undefined\}/);
  assert.match(src, /deleteTripDialogLabels\(locale, \{ hasOtherMembers: deleteTarget\?\.hasOtherMembers \}\)/);
  assert.match(src, /prev\?\.id === targetId && prev\.hasOtherMembers === undefined\s+\? \{ \.\.\.prev, hasOtherMembers \}\s+: prev/);
  assert.match(src, /clearDeleteMembersTimer\(\);\s+deleteMembersTimerRef\.current = window\.setTimeout\(\(\) => \{\s+deleteMembersTimerRef\.current = null;\s+resolveMembers\(true\);\s+\}, 5000\);/);
  assert.match(src, /\.catch\(\(err\) => \{[\s\S]{0,200}?resolveMembers\(true\);/);
  assert.match(src, /resolveMembers\(rows\.some\(\(m\) => !m\.is_owner && m\.status === "accepted"\)\)/);
  assert.match(src, /if \(!open\) \{\s+clearDeleteMembersTimer\(\);\s+setDeleteTarget\(null\);/);
  assert.match(src, /useEffect\(\(\) => clearDeleteMembersTimer, \[clearDeleteMembersTimer\]\);/);
  // The delete control only exists for trips the user owns.
  assert.match(src, /deleteSlot=\{\s+\(trip\.isOwner \?\? true\) \?/);
});

await check("NET 沒有任何網路請求", () => assert.deepEqual(NET_BLOCKED, []));

fs.rmSync(tmp, { recursive: true, force: true });
say(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) say("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
