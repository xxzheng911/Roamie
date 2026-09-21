/**
 * Saved trip delete confirmation follows the current locale.
 * Run: vite-node --config scripts/vite.verify.config.mjs scripts/verify-delete-trip-dialog-i18n.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { deleteTripDialogLabels } from "../src/lib/i18n/delete-trip-dialog.ts";
import { translate } from "../src/lib/i18n/translate.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const expected = {
  "zh-TW": {
    title: "刪除這趟行程？",
    description: "刪除後將無法復原，Roamie 不會再保留這趟旅程。",
    confirmLabel: "刪除",
    cancelLabel: "取消",
  },
  en: {
    title: "Delete this trip?",
    description: "This can't be undone. Roamie will no longer keep this trip.",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
  },
  ja: {
    title: "この旅程を削除しますか？",
    description: "削除すると元に戻せません。Roamie にこの旅程は保存されなくなります。",
    confirmLabel: "削除",
    cancelLabel: "キャンセル",
  },
  ko: {
    title: "이 여행 일정을 삭제할까요?",
    description: "삭제하면 되돌릴 수 없으며 Roamie에 이 여행 일정이 더 이상 저장되지 않습니다.",
    confirmLabel: "삭제",
    cancelLabel: "취소",
  },
};
const zhLeak = ["刪除這趟行程", "刪除後將無法復原", "刪除", "取消"];

for (const locale of locales) {
  const labels = deleteTripDialogLabels(locale);
  assert.deepEqual(labels, expected[locale], locale);
  assert.equal(labels.confirmLabel, translate(locale, "productionUi.p3c8f5b363a"));
  assert.equal(labels.cancelLabel, translate(locale, "productionUi.p2cd0f3be87"));
  if (locale !== "zh-TW") {
    const surface = Object.values(labels).join("\n");
    for (const leaked of zhLeak)
      assert.equal(surface.includes(leaked), false, `${locale} ${leaked}`);
    for (const field of Object.keys(expected["zh-TW"])) {
      assert.notEqual(labels[field], expected["zh-TW"][field], `${locale} ${field}`);
    }
  }
}

const zhFirst = deleteTripDialogLabels("zh-TW");
const afterSwitch = deleteTripDialogLabels("en");
assert.equal(zhFirst.title, expected["zh-TW"].title);
assert.deepEqual(afterSwitch, expected.en);
assert.deepEqual(deleteTripDialogLabels("ja"), expected.ja);
assert.deepEqual(deleteTripDialogLabels("ko"), expected.ko);

const dialog = fs.readFileSync("src/components/saved/TripDeleteConfirmDialog.tsx", "utf8");
const deletion = fs.readFileSync("src/lib/saved-trip/delete-trip.ts", "utf8");
const saved = fs.readFileSync("src/routes/_app.saved.index.tsx", "utf8");
const trip = fs.readFileSync("src/routes/trip.tsx", "utf8");
const detail = fs.readFileSync("src/components/trip/TripDetailScreen.tsx", "utf8");
const placeDialog = fs.readFileSync(
  "src/components/saved/SavedPlaceRemoveConfirmDialog.tsx",
  "utf8",
);

assert.equal(dialog.includes("TRIP_DELETE_DIALOG"), false);
assert.equal(dialog.includes("刪除"), false);
assert.equal(deletion.includes("TRIP_DELETE_DIALOG"), false);
assert.equal(deletion.includes("刪除這趟行程"), false);
assert.match(deletion, /await deleteItinerary\(tripId\)/);
assert.equal(deletion.match(/deleteItinerary\(/g).length, 1);
assert.equal((dialog.match(/void onConfirm\(\)/g) || []).length, 1);
assert.match(dialog, /e\.preventDefault\(\)/);
const cancelBlock = dialog.slice(
  dialog.indexOf("<AlertDialogCancel"),
  dialog.indexOf("<AlertDialogAction"),
);
assert.equal(cancelBlock.includes("onClick"), false);
assert.match(dialog, /disabled=\{confirming\}/);
assert.match(dialog, /aria-label=\{cancelLabel\}/);
assert.match(dialog, /aria-label=\{confirmLabel\}/);
assert.match(dialog, /bg-destructive text-destructive-foreground hover:bg-destructive\/90/);
assert.match(dialog, /break-words whitespace-normal/);
assert.match(dialog, /max-w-\[min\(32rem,calc\(100vw-2rem\)\)\]/);
assert.doesNotMatch(dialog, /h-auto|min-h-|h-\d|text-\[/);
assert.doesNotMatch(dialog, /truncate|line-clamp|text-ellipsis/);
assert.equal(dialog.includes("title =") || dialog.includes("confirmLabel ="), false);

for (const source of [saved, trip, detail]) {
  assert.match(source, /deleteTripDialogLabels\(locale\)/);
  assert.equal(source.includes("TRIP_DELETE_DIALOG"), false);
}
assert.match(saved, /await deleteTrip\(deleteTarget\.id\)/);
assert.match(trip, /await deleteTrip\(trip\.id\)/);
assert.match(detail, /await deleteTrip\(stored\.id\)/);
assert.equal(placeDialog.includes("deleteTripDialogLabels"), false);
assert.equal(placeDialog.includes("TRIP_DELETE_DIALOG"), false);
assert.match(placeDialog, /productionUi\.p7028a164a2/);

function textWidth(text, fontPx) {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += fontPx * 0.33;
    else if (/\p{Script=Latin}/u.test(ch)) width += fontPx * 0.56;
    else width += fontPx;
  }
  return width;
}

function isCjk(ch) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(ch);
}

function units(text) {
  const out = [];
  let latin = "";
  const flush = () => {
    if (latin) out.push(latin);
    latin = "";
  };
  for (const ch of text) {
    if (ch === " " || isCjk(ch)) {
      flush();
      out.push(ch);
    } else latin += ch;
  }
  flush();
  return out;
}

function wrapped(text, fontPx, maxWidth) {
  const lines = [];
  let line = "";
  let width = 0;
  for (const unit of units(text)) {
    const unitWidth = textWidth(unit, fontPx);
    assert.ok(unitWidth <= maxWidth, `unbreakable unit wider than dialog: ${unit}`);
    if (line && unit !== " " && width + unitWidth > maxWidth) {
      lines.push(line);
      line = unit;
      width = unitWidth;
    } else {
      line += unit;
      width += unitWidth;
    }
  }
  if (line) lines.push(line);
  assert.equal(lines.join(""), text);
  return lines;
}

const rootPx = 16;
for (const viewport of [320, 390, 430]) {
  for (const scale of [1, 1.5]) {
    const dialogWidth = Math.min(32 * rootPx * scale, viewport - 2 * rootPx * scale);
    const contentWidth = dialogWidth - 2 * 1.5 * rootPx * scale - 2;
    assert.ok(dialogWidth <= viewport - 8, `${viewport} dialog overflows`);
    for (const locale of locales) {
      const labels = expected[locale];
      const titleLines = wrapped(labels.title, 1.125 * rootPx * scale, contentWidth);
      const bodyLines = wrapped(labels.description, 0.875 * rootPx * scale, contentWidth);
      assert.ok(titleLines.length >= 1);
      assert.ok(bodyLines.length >= 1);
      for (const label of [labels.confirmLabel, labels.cancelLabel]) {
        assert.ok(
          textWidth(label, 0.875 * rootPx * scale) <= contentWidth,
          `${locale} ${label} @ ${viewport}/${scale}`,
        );
      }
    }
  }
}

console.log("PASS delete-trip dialog i18n");
for (const locale of locales) {
  const labels = expected[locale];
  console.log(`  ${locale}: ${labels.title} / ${labels.confirmLabel} / ${labels.cancelLabel}`);
}
