/**
 * Avatar and cover sheets share one media-action translation authority.
 * Run: vite-node --config scripts/vite.verify.config.mjs scripts/verify-media-action-i18n.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { translate } from "../src/lib/i18n/translate.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const keys = {
  changeAvatar: "profile.editAvatar",
  changeCover: "productionUi.p54fa653aeb",
  chooseFromLibrary: "productionUi.p30784c6dd2",
  takePhoto: "productionUi.p6e3a10ade7",
  deletePhoto: "profile.removeAvatar",
  close: "productionUi.pc7fdddf79e",
};
const expected = {
  "zh-TW": {
    changeAvatar: "更換頭像",
    changeCover: "更換封面照片",
    chooseFromLibrary: "從相簿選取",
    takePhoto: "拍照",
    deletePhoto: "刪除",
    close: "關閉",
  },
  en: {
    changeAvatar: "Change profile photo",
    changeCover: "Change cover photo",
    chooseFromLibrary: "Choose from Photos",
    takePhoto: "Take Photo",
    deletePhoto: "Delete",
    close: "Close",
  },
  ja: {
    changeAvatar: "アイコンを変更",
    changeCover: "カバー写真を変更",
    chooseFromLibrary: "写真から選択",
    takePhoto: "写真を撮る",
    deletePhoto: "削除",
    close: "閉じる",
  },
  ko: {
    changeAvatar: "프로필 사진 변경",
    changeCover: "커버 사진 변경",
    chooseFromLibrary: "사진에서 선택",
    takePhoto: "사진 촬영",
    deletePhoto: "삭제",
    close: "닫기",
  },
};

for (const locale of locales) {
  for (const [name, key] of Object.entries(keys)) {
    const value = translate(locale, key);
    assert.equal(value, expected[locale][name], `${locale} ${name}`);
    assert.ok(!value.startsWith("profile.") && !value.startsWith("productionUi."));
    assert.doesNotMatch(value, /…|\.\.\./);
  }
  if (locale !== "zh-TW") {
    for (const name of [
      "chooseFromLibrary",
      "takePhoto",
      "deletePhoto",
      "close",
      "changeAvatar",
      "changeCover",
    ]) {
      assert.notEqual(
        expected[locale][name],
        expected["zh-TW"][name],
        `${locale} ${name} leaked zh-TW`,
      );
    }
  }
}

const sheet = fs.readFileSync("src/components/ImageSourceSheet.tsx", "utf8");
const profile = fs.readFileSync("src/routes/_app.profile.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");

assert.match(sheet, /albumLabel \?\? uiT\("productionUi\.p30784c6dd2"\)/);
assert.match(sheet, /cameraLabel \?\? uiT\("productionUi\.p6e3a10ade7"\)/);
assert.match(sheet, /removeLabel \?\? uiT\("profile\.removeAvatar"\)/);
assert.match(sheet, /uiT\("productionUi\.pc7fdddf79e"\)/);
assert.match(sheet, /closeLabel=\{resolvedCloseLabel\}/);
assert.doesNotMatch(sheet, /albumLabel = "|cameraLabel = "|removeLabel = "/);
assert.match(sheet, /media-action-grid/);
assert.match(sheet, /whitespace-normal/);
assert.match(sheet, /break-words/);
assert.match(sheet, /min-w-0/);
assert.match(sheet, /min-h-11/);
assert.match(sheet, /shrink-0/);
assert.doesNotMatch(sheet, /truncate|line-clamp|text-ellipsis|text-\[10px\]|locale\s*===/);

function sheetBlock(start, end) {
  const from = profile.indexOf(start);
  const to = profile.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return profile.slice(from, to);
}

const cover = sheetBlock("open={coverSourceOpen}", "<ProfileImageCropSheet");
const avatar = sheetBlock("open={avatarSourceOpen}", "<AvatarCropSheet");
for (const block of [cover, avatar]) {
  assert.match(block, /albumLabel=\{uiT\("productionUi\.p30784c6dd2"\)\}/);
  assert.match(block, /cameraLabel=\{uiT\("productionUi\.p6e3a10ade7"\)\}/);
  assert.match(block, /removeLabel=\{t\("profile\.removeAvatar"\)\}/);
  assert.doesNotMatch(block, /從相簿選取|拍照|刪除/);
}
assert.match(avatar, /title=\{t\("profile\.editAvatar"\)\}/);
assert.match(cover, /title=\{uiT\("productionUi\.p54fa653aeb"\)\}/);
assert.match(
  css,
  /\.media-action-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*8rem\),\s*1fr\)\)/,
);
assert.doesNotMatch(css, /media-action-grid[\s\S]{0,240}locale\s*===/);

const jaSurface = ["chooseFromLibrary", "takePhoto", "deletePhoto"]
  .map((name) => expected.ja[name])
  .join("\n");
for (const leaked of ["從相簿選取", "從相簿選擇", "拍照", "刪除"]) {
  assert.ok(!jaSurface.includes(leaked), leaked);
}
assert.match(jaSurface, /写真から選択/);
assert.match(jaSurface, /写真を撮る/);
assert.match(jaSurface, /削除/);

console.log("PASS media action i18n for avatar and cover");
for (const locale of locales) {
  console.log(
    `  ${locale}: ${expected[locale].chooseFromLibrary} / ${expected[locale].takePhoto} / ${expected[locale].deletePhoto} / ${expected[locale].close}`,
  );
}
