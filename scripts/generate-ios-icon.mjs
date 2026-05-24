/**
 * Generate iOS App Icon + Launch Splash assets from the official Roamie icon source.
 *
 * The source export includes outer white padding and an inset cream rounded-rect card.
 * This script trims to the peach mascot, scales it near full-bleed, and fills a flat
 * 1024×1024 cream canvas (no inset card, no baked corner radius).
 *
 * Usage: node scripts/generate-ios-icon.mjs
 */
import { mkdir, copyFile, access, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCE = resolve(ROOT, "assets/roamie-app-icon-source.jpg");

const CURSOR_SOURCE = resolve(
  "/Users/shuo/.cursor/projects/Users-shuo-Documents-Projects-Roamie/assets/4BCBD017-0931-4366-8B0A-E691EE5A02D3-68ab1d21-562a-4ce9-9ae7-c7abeca197bc.png",
);

/** Sampled from icon interior — uniform full-bleed background */
const CREAM = { r: 253, g: 245, b: 234 };

/** Mascot scaled to fill the canvas after background isolation */
const MASCOT_FILL = 0.99;

const SPLASH_MASCOT_SCALE = 0.38;

const APP_ICON_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const SPLASH_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");
const SPLASH_LOGO_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/SplashLogo.imageset");

const MASTER_ICON_SIZE = 1024;

/** Full iOS AppIcon.appiconset matrix derived from the 1024 master */
const APP_ICON_ENTRIES = [
  { filename: "AppIcon-20@2x.png", idiom: "iphone", scale: "2x", size: "20x20", px: 40 },
  { filename: "AppIcon-20@3x.png", idiom: "iphone", scale: "3x", size: "20x20", px: 60 },
  { filename: "AppIcon-29@2x.png", idiom: "iphone", scale: "2x", size: "29x29", px: 58 },
  { filename: "AppIcon-29@3x.png", idiom: "iphone", scale: "3x", size: "29x29", px: 87 },
  { filename: "AppIcon-40@2x.png", idiom: "iphone", scale: "2x", size: "40x40", px: 80 },
  { filename: "AppIcon-40@3x.png", idiom: "iphone", scale: "3x", size: "40x40", px: 120 },
  { filename: "AppIcon-60@2x.png", idiom: "iphone", scale: "2x", size: "60x60", px: 120 },
  { filename: "AppIcon-60@3x.png", idiom: "iphone", scale: "3x", size: "60x60", px: 180 },
  { filename: "AppIcon-20@1x.png", idiom: "ipad", scale: "1x", size: "20x20", px: 20 },
  { filename: "AppIcon-20@2x-ipad.png", idiom: "ipad", scale: "2x", size: "20x20", px: 40 },
  { filename: "AppIcon-29@1x.png", idiom: "ipad", scale: "1x", size: "29x29", px: 29 },
  { filename: "AppIcon-29@2x-ipad.png", idiom: "ipad", scale: "2x", size: "29x29", px: 58 },
  { filename: "AppIcon-40@1x.png", idiom: "ipad", scale: "1x", size: "40x40", px: 40 },
  { filename: "AppIcon-40@2x-ipad.png", idiom: "ipad", scale: "2x", size: "40x40", px: 80 },
  { filename: "AppIcon-76.png", idiom: "ipad", scale: "1x", size: "76x76", px: 76 },
  { filename: "AppIcon-76@2x.png", idiom: "ipad", scale: "2x", size: "76x76", px: 152 },
  { filename: "AppIcon-83.5@2x.png", idiom: "ipad", scale: "2x", size: "83.5x83.5", px: 167 },
  {
    filename: "AppIcon-1024.png",
    idiom: "ios-marketing",
    scale: "1x",
    size: "1024x1024",
    px: 1024,
  },
];

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isNearWhite(r, g, b) {
  return r > 248 && g > 248 && b > 248;
}

/** Peach suitcase body — excludes flat cream card and outer white export margin */
function isPeachMascot(r, g, b) {
  return (
    r > 195 &&
    g > 140 &&
    g < 235 &&
    b > 90 &&
    b < 210 &&
    chroma(r, g, b) > 12
  );
}

async function readRgba(source) {
  return sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function isTraversableBackground(r, g, b) {
  if (isPeachMascot(r, g, b)) return false;
  return isNearWhite(r, g, b) || chroma(r, g, b) < 28;
}

/** Flood-fill from image edges through cream/white — card + shadow become background; eyes stay foreground */
function buildBackgroundMask(data, width, height) {
  const bg = new Uint8Array(width * height);
  const queue = [];

  function trySeed(x, y) {
    const idx = y * width + x;
    const i = idx * 4;
    if (bg[idx] || !isTraversableBackground(data[i], data[i + 1], data[i + 2])) return;
    bg[idx] = 1;
    queue.push(idx);
  }

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (bg[nidx]) continue;
      const i = nidx * 4;
      if (!isTraversableBackground(data[i], data[i + 1], data[i + 2])) continue;
      bg[nidx] = 1;
      queue.push(nidx);
    }
  }

  return bg;
}

/** Flat cream canvas with mascot only (peach body + cream eye/mouth cutouts) */
async function isolateMascotLayer(source) {
  const { data, info } = await readRgba(source);
  const { width, height } = info;
  const bg = buildBackgroundMask(data, width, height);
  const out = Buffer.alloc(data.length);

  for (let idx = 0; idx < width * height; idx++) {
    const i = idx * 4;
    if (bg[idx]) {
      out[i] = CREAM.r;
      out[i + 1] = CREAM.g;
      out[i + 2] = CREAM.b;
      out[i + 3] = 255;
      continue;
    }

    if (isPeachMascot(data[i], data[i + 1], data[i + 2])) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = 255;
      continue;
    }

    // Interior cream holes (eyes, smile)
    out[i] = CREAM.r;
    out[i + 1] = CREAM.g;
    out[i + 2] = CREAM.b;
    out[i + 3] = 255;
  }

  return { out, info, bg };
}

function boundsFromMask(bg, width, height, padRatio = 0.04) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bg[y * width + x]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    throw new Error("Could not detect mascot foreground in source icon");
  }

  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  const pad = Math.round(Math.max(contentW, contentH) * padRatio);
  const side = Math.max(contentW, contentH) + pad * 2;
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;

  let left = Math.round(cx - side / 2);
  let top = Math.round(cy - side / 2);
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + side > width) left = Math.max(0, width - side);
  if (top + side > height) top = Math.max(0, height - side);

  const cropSide = Math.min(side, width - left, height - top);

  return { left, top, width: cropSide, height: cropSide };
}

/**
 * Full-bleed 1024×1024: flat cream to all edges, mascot scaled up (no inset card artwork).
 */
async function composeAppIcon(source) {
  const { out, info, bg } = await isolateMascotLayer(source);
  const bounds = boundsFromMask(bg, info.width, info.height);

  const isolated = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  const targetSize = Math.round(MASTER_ICON_SIZE * MASCOT_FILL);
  const mascot = await sharp(isolated)
    .extract(bounds)
    .resize(targetSize, targetSize, {
      fit: "contain",
      background: CREAM,
    })
    .flatten({ background: CREAM })
    .removeAlpha()
    .png()
    .toBuffer();

  const offset = Math.floor((MASTER_ICON_SIZE - targetSize) / 2);

  return sharp({
    create: {
      width: MASTER_ICON_SIZE,
      height: MASTER_ICON_SIZE,
      channels: 3,
      background: CREAM,
    },
  })
    .composite([{ input: mascot, left: offset, top: offset }])
    .flatten({ background: CREAM })
    .removeAlpha()
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

async function writeContentsJson() {
  const images = APP_ICON_ENTRIES.map(({ filename, idiom, scale, size }) => ({
    filename,
    idiom,
    scale,
    size,
  }));

  const contents = {
    images,
    info: { author: "xcode", version: 1 },
  };

  await writeFile(resolve(APP_ICON_DIR, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
  console.log("✓ AppIcon Contents.json (full size matrix)");
}

async function cleanAppIconSetDir() {
  await mkdir(APP_ICON_DIR, { recursive: true });
  const keep = new Set(APP_ICON_ENTRIES.map((e) => e.filename));
  const entries = await readdir(APP_ICON_DIR);
  for (const name of entries) {
    if (name.endsWith(".png") && !keep.has(name)) {
      await unlink(resolve(APP_ICON_DIR, name));
    }
  }
}

async function writeAppIcon(source) {
  await cleanAppIconSetDir();
  const masterBuf = await composeAppIcon(source);

  for (const { filename, px } of APP_ICON_ENTRIES) {
    const out = resolve(APP_ICON_DIR, filename);
    await sharp(masterBuf).resize(px, px, { fit: "fill" }).png({ force: true }).toFile(out);
    console.log("✓", filename, `${px}×${px}`);
  }

  await writeContentsJson();
}

async function writeSplashCanvas(source, size) {
  const iconBuf = await composeAppIcon(source);
  const iconSize = Math.round(size * SPLASH_MASCOT_SCALE);
  const icon = await sharp(iconBuf).resize(iconSize, iconSize, { fit: "fill" }).png().toBuffer();
  const left = Math.floor((size - iconSize) / 2);
  const top = Math.floor((size - iconSize) / 2);

  return sharp({
    create: { width: size, height: size, channels: 3, background: CREAM },
  })
    .composite([{ input: icon, left, top }])
    .flatten({ background: CREAM })
    .removeAlpha()
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

async function writeSplashAssets(source) {
  await mkdir(SPLASH_DIR, { recursive: true });
  const size = 2732;
  const buf = await writeSplashCanvas(source, size);
  const names = ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"];
  for (const name of names) {
    await sharp(buf).toFile(resolve(SPLASH_DIR, name));
  }
  console.log("✓ Splash images:", SPLASH_DIR);
}

async function writeSplashLogo(source) {
  await mkdir(SPLASH_LOGO_DIR, { recursive: true });
  const iconBuf = await composeAppIcon(source);
  const sizes = [
    { name: "splash-logo.png", px: 512 },
    { name: "splash-logo@2x.png", px: 1024 },
    { name: "splash-logo@3x.png", px: 1536 },
  ];
  for (const { name, px } of sizes) {
    await sharp(iconBuf)
      .resize(px, px, { fit: "fill" })
      .png({ compressionLevel: 9, force: true })
      .toFile(resolve(SPLASH_LOGO_DIR, name));
  }
  console.log("✓ Splash logo:", SPLASH_LOGO_DIR);
}

async function resolveSource() {
  await mkdir(resolve(ROOT, "assets"), { recursive: true });
  try {
    await access(SOURCE);
    return SOURCE;
  } catch {
    await copyFile(CURSOR_SOURCE, SOURCE);
    console.log("✓ Source copied to assets/roamie-app-icon-source.jpg");
    return SOURCE;
  }
}

async function reportIconStats(masterBuf) {
  const { data, info } = await sharp(masterBuf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let white = 0;
  let peachMinX = w;
  let peachMaxX = 0;

  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isNearWhite(r, g, b)) white++;
      if (isPeachMascot(r, g, b)) {
        peachMinX = Math.min(peachMinX, x);
        peachMaxX = Math.max(peachMaxX, x);
      }
    }
  }

  const peachW = peachMaxX - peachMinX + 1;
  console.log(
    `\nStats: white pixels ${((white / (w * w)) * 100).toFixed(3)}%, mascot width ${peachW}px (${((peachW / w) * 100).toFixed(1)}% of canvas)`,
  );
}

async function main() {
  const source = await resolveSource();
  const masterBuf = await composeAppIcon(source);
  await reportIconStats(masterBuf);
  await writeAppIcon(source);
  await writeSplashAssets(source);
  await writeSplashLogo(source);
  console.log("\nNext steps:");
  console.log("  1. cd ios/App && xcodebuild clean -workspace App.xcworkspace -scheme App");
  console.log("  2. Delete Roamie from Simulator/device (clears icon cache)");
  console.log("  3. npx cap run ios  (or build & run from Xcode)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
