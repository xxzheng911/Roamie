#!/usr/bin/env node
import "./verify-netguard-full.mjs";
/**
 * #TS-PHOTO3 第 3 輪：isRoamieDefaultImageUrl 來源判斷。
 * 執行：node scripts/verify-roamie-default-image-url.mjs
 *
 * 以 esbuild 打包 src/lib/saved-place-utils.ts（不寫檔，write:false），資產用 file loader＋publicPath "/assets"
 * 模擬 Vite 打包後的 "/assets/<name>-<hash>.<ext>"。placeImageService 以同樣的資產 import 取代（避免載入整個服務層）。
 * 分別在「無 window」（SSR／Node）、window.location.origin = https://roamie.tw、capacitor://localhost（iOS bundled）下驗證。
 * 注意：Node 的 WHATWG URL 對非 special scheme（capacitor:）的 .origin 回傳 "null"，與 Chrome 相同；
 * WebKit 實機行為無法在此環境驗證。
 */
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log(
      "FAIL " +
        name +
        "\n     " +
        String(e?.message || e)
          .split("\n")
          .slice(0, 6)
          .join("\n     "),
    );
  }
};

const { build } = await import("esbuild");
const stubSvc = `import cafe from "@/assets/scene-cafe.jpg";import cover from "@/assets/roamie-default-cover.png";
export const getRoamieDefaultImage=(c)=>/cafe|coffee|food|street|sight/.test(String(c??''))?cafe:cover;
export const getPlaceImage=async()=>({url:cover,source:'default'});`;
const res = await build({
  stdin: {
    contents: `export {isRoamieDefaultImageUrl} from './src/lib/saved-place-utils';export {getRoamieDefaultImage} from '@/services/placeImageService';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  outdir: path.join(os.tmpdir(), "roamie-verify-default-image-url"),
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  logLevel: "error",
  loader: { ".png": "file", ".jpg": "file", ".jpeg": "file", ".webp": "file", ".svg": "file" },
  assetNames: "[name]-[hash]",
  publicPath: "/assets",
  define: { "import.meta.env": "{}" },
  plugins: [
    {
      name: "stub",
      setup(b) {
        b.onResolve({ filter: /^@\/services\/placeImageService$/ }, () => ({
          path: "svc",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: stubSvc,
          loader: "ts",
          resolveDir: root,
        }));
        b.onResolve({ filter: /^@\/lib\/capacitor-native-shell$/ }, () => ({
          path: "cap",
          namespace: "stub2",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub2" }, () => ({
          contents: "export const isCapacitorNativeShell=()=>false;",
          loader: "ts",
        }));
      },
    },
  ],
});
const js = res.outputFiles.find((f) => f.path.endsWith(".js")).text;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { isRoamieDefaultImageUrl: isDef, getRoamieDefaultImage } = mod;

const DEF_CAFE = getRoamieDefaultImage("cafe");
const DEF_ANY = getRoamieDefaultImage(null);
console.info("     （資訊）打包後預設圖：", DEF_CAFE, DEF_ANY);
const cafeFile = DEF_CAFE.replace(/^\/assets\//, "");
const coverFile = DEF_ANY.replace(/^\/assets\//, "");

const setOrigin = (origin) => {
  if (origin === null) delete globalThis.window;
  else globalThis.window = { location: { origin } };
};

const POSITIVE = [
  DEF_CAFE,
  DEF_ANY,
  "/assets/scene-cafe-AbC_12-3.jpg",
  "/src/assets/scene-tokyo.jpg",
  "assets/scene-walk.jpg",
  "https://roamie.tw/" + "assets/" + cafeFile,
  "https://www.roamie.tw/assets/" + coverFile,
  "http://localhost/assets/scene-onsen.jpg",
  "https://localhost/assets/" + cafeFile,
  "capacitor://localhost/assets/" + cafeFile,
  "capacitor://localhost/assets/" + coverFile,
  "capacitor://localhost/assets/scene-cafe-AbC123.jpg?v=1",
];
const NEGATIVE = [
  "https://cdn.example.com/assets/scene-cafe-hero.jpg",
  "https://cdn.example.com/assets/" + cafeFile,
  "//cdn.example.com/assets/scene-cafe.jpg",
  "https://roamie.tw.evil.com/assets/scene-cafe.jpg",
  "https://evil.com/?u=https://roamie.tw/assets/scene-cafe.jpg",
  "https://abcd.supabase.co/storage/v1/object/public/place-images/u1/assets/scene-cafe.jpg",
  "https://images.unsplash.com/photo-1?w=600",
  "/api/place-photo?photo=places%2Fx%2Fphotos%2Fy&w=600",
  "/fixture-user-cover.png",
  "/assets/roamie-brand-mascot.png",
  "/assets/scene-cafe.gif",
  "",
  null,
];
const OPAQUE_FOREIGN = [
  "file:///assets/scene-cafe.jpg",
  "foo://evil/assets/scene-cafe.jpg",
  "ionic://evil/assets/scene-cafe.jpg",
];

for (const [label, origin] of [
  ["無 window（SSR）", null],
  ["window.origin=https://roamie.tw", "https://roamie.tw"],
  ["window.origin=capacitor://localhost（iOS bundled）", "capacitor://localhost"],
]) {
  setOrigin(origin);
  await check(`R1 [${label}] 預設圖（相對路徑／本站／App 來源／打包值）都要認得`, () => {
    const miss = POSITIVE.filter((u) => !isDef(u));
    assert.deepEqual(miss, [], "未被認成預設圖：" + JSON.stringify(miss));
  });
  await check(`R2 [${label}] 第三方網址／上傳／Google／非預設資產不能被認成預設圖`, () => {
    const hit = NEGATIVE.filter((u) => isDef(u));
    assert.deepEqual(hit, [], "被誤認成預設圖：" + JSON.stringify(hit));
  });
  await check(
    `R3 [${label}] 其他 opaque-origin scheme（file:／foo:／ionic:）不能被認成預設圖`,
    () => {
      const hit = OPAQUE_FOREIGN.filter((u) => isDef(u));
      assert.deepEqual(hit, [], "被誤認成預設圖：" + JSON.stringify(hit));
    },
  );
}
setOrigin(null);
await check("（資訊）WHATWG URL 對 capacitor: 的 origin", () => {
  console.info(
    "     （資訊）new URL('capacitor://localhost/assets/x.jpg').origin =",
    JSON.stringify(new URL("capacitor://localhost/assets/x.jpg").origin),
  );
});

console.log(
  failures.length
    ? `\nverify-roamie-default-image-url: FAIL (${failures.length})\n  - ${failures.join("\n  - ")}`
    : "\nverify-roamie-default-image-url: PASS",
);
process.exitCode = failures.length ? 1 : 0;
