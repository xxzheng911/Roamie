/**
 * Batch-remove cream backgrounds from Roamie mascot poses.
 * Usage: node scripts/process-mascot-cutouts.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ASSETS = resolve(ROOT, "src/assets");
const SPLASH_SET = resolve(ROOT, "ios/App/App/Assets.xcassets/SplashLogo.imageset");

const CREAM = { r: 253, g: 245, b: 234 };

const SOURCES = [
  { in: "roamie-brand-mascot.png", out: "roamie-brand-mascot-cutout.png" },
  { in: "roamie-mascot-walk.png", out: "roamie-mascot-walk-cutout.png" },
  { in: "roamie-mascot-map.png", out: "roamie-mascot-map-cutout.png" },
  { in: "roamie-mascot-camera.png", out: "roamie-mascot-camera-cutout.png" },
];

function colorDistance(r, g, b, target) {
  return Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2);
}

function isBackground(r, g, b, a) {
  if (a < 16) return true;
  if (colorDistance(r, g, b, CREAM) < 44) return true;
  if (r > 228 && g > 218 && b > 198 && r - b < 58) return true;
  return false;
}

async function buildCutout(sourcePath, outPath) {
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isBackground(r, g, b, a)) data[i + 3] = 0;
  }

  await sharp(data, { raw: { width, height, channels } })
    .trim({ threshold: 10 })
    .png({ compressionLevel: 9, force: true })
    .toFile(outPath);

  console.log("✓", outPath.replace(`${ROOT}/`, ""));
}

async function writeSplashAssets(cutoutBuffer) {
  await mkdir(SPLASH_SET, { recursive: true });
  for (const { name, width } of [
    { name: "splash-logo.png", width: 512 },
    { name: "splash-logo@2x.png", width: 768 },
    { name: "splash-logo@3x.png", width: 1024 },
  ]) {
    await sharp(cutoutBuffer)
      .resize(width, null, { fit: "inside", withoutEnlargement: false })
      .png({ compressionLevel: 9, force: true })
      .toFile(resolve(SPLASH_SET, name));
  }
  await writeFile(
    resolve(SPLASH_SET, "Contents.json"),
    `${JSON.stringify(
      {
        images: [
          { filename: "splash-logo.png", idiom: "universal", scale: "1x" },
          { filename: "splash-logo@2x.png", idiom: "universal", scale: "2x" },
          { filename: "splash-logo@3x.png", idiom: "universal", scale: "3x" },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    )}\n`,
  );
  console.log("✓ iOS SplashLogo.imageset");
}

for (const { in: input, out: output } of SOURCES) {
  await buildCutout(resolve(ASSETS, input), resolve(ASSETS, output));
}

const waveCutout = await sharp(resolve(ASSETS, "roamie-brand-mascot-cutout.png")).png().toBuffer();
await writeSplashAssets(waveCutout);
