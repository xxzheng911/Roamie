/**
 * Remove cream square background from Roamie brand mascot.
 * Outputs transparent PNG for Splash / Onboarding / iOS LaunchScreen.
 *
 * Usage: node scripts/process-brand-mascot.mjs
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCE = resolve(ROOT, "src/assets/roamie-brand-mascot.png");
const CUTOUT = resolve(ROOT, "src/assets/roamie-brand-mascot-cutout.png");
const SPLASH_SET = resolve(ROOT, "ios/App/App/Assets.xcassets/SplashLogo.imageset");

/** Brand cream background tones in source JPEG */
const CREAM = { r: 253, g: 245, b: 234 };

function colorDistance(r, g, b, target) {
  return Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2);
}

function isBackground(r, g, b, a) {
  if (a < 16) return true;
  if (colorDistance(r, g, b, CREAM) < 42) return true;
  // Warm off-white / light peach backdrop
  if (r > 230 && g > 220 && b > 200 && r - b < 55) return true;
  return false;
}

async function buildCutout() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isBackground(r, g, b, a)) {
      data[i + 3] = 0;
    }
  }

  const cutout = await sharp(data, { raw: { width, height, channels } })
    .trim({ threshold: 10 })
    .png({ compressionLevel: 9, force: true })
    .toBuffer();

  await sharp(cutout).toFile(CUTOUT);
  console.log("✓ Cutout mascot", CUTOUT);

  return cutout;
}

async function writeSplashAssets(cutoutBuffer) {
  await mkdir(SPLASH_SET, { recursive: true });

  const sizes = [
    { name: "splash-logo.png", width: 512 },
    { name: "splash-logo@2x.png", width: 768 },
    { name: "splash-logo@3x.png", width: 1024 },
  ];

  for (const { name, width } of sizes) {
    await sharp(cutoutBuffer)
      .resize(width, null, { fit: "inside", withoutEnlargement: false })
      .png({ compressionLevel: 9, force: true })
      .toFile(resolve(SPLASH_SET, name));
    console.log("✓", name);
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
  console.log("✓ SplashLogo Contents.json");
}

const cutout = await buildCutout();
await writeSplashAssets(cutout);
