/**
 * Export iOS App Icon assets from the official Roamie icon artwork.
 *
 * Uses the provided master artwork as-is (no card layer, no synthetic shadow).
 * Optionally normalizes background to brand cream and fits within Apple safe zone.
 *
 * Usage: node scripts/generate-ios-icon.mjs
 *        npm run ios:icons
 */
import { mkdir, copyFile, access, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Canonical app icon source — user-provided artwork */
const SOURCE = resolve(ROOT, "assets/roamie-app-icon-source.png");
const MASTER_OUT = resolve(ROOT, "assets/app-icon-master-1024.png");

/** Fallback: Cursor attachment path (first-time copy) */
const CURSOR_ATTACHMENT = resolve(
  "/Users/shuo/.cursor/projects/Users-shuo-Documents-Projects-Roamie/assets/icon-a5de1390-2ea7-45cf-890a-8fbc8415b17a.png",
);

/** Brand cream — matches LaunchScreen.storyboard & Capacitor splash */
const CREAM = { r: 253, g: 245, b: 234 };

const APP_ICON_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");

const CANVAS = 1024;
/** Apple HIG safe zone — 896×896 px centered (squircle mask) */
const SAFE_ZONE = 896;
/**
 * Scale mascot vs detected bounds (~17.5% = middle of 15–20% brief).
 * Override: ROAMIE_ICON_SUBJECT_SCALE=1.15|1.20
 */
const SUBJECT_SCALE = Number(process.env.ROAMIE_ICON_SUBJECT_SCALE) || 1.175;
/** Padding around detected bounds before extract (anti-alias) */
const EXTRACT_PAD_PX = 8;

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

function isBrandCream(r, g, b) {
  return (
    Math.abs(r - CREAM.r) <= 24 &&
    Math.abs(g - CREAM.g) <= 24 &&
    Math.abs(b - CREAM.b) <= 24
  );
}

function isPeachMascot(r, g, b) {
  return r > 195 && g > 140 && g < 235 && b > 90 && b < 210 && chroma(r, g, b) > 12;
}

/**
 * Bounding box of non-cream artwork (mascot + handle).
 */
async function detectSubjectBounds(imageBuf) {
  const { data, info } = await sharp(imageBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const a = ch === 4 ? data[i + 3] : 255;
      if (a < 8) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isBrandCream(r, g, b)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function clampExtractRegion(bounds, pad) {
  const left = Math.max(0, bounds.left - pad);
  const top = Math.max(0, bounds.top - pad);
  const right = Math.min(CANVAS - 1, bounds.left + bounds.width - 1 + pad);
  const bottom = Math.min(CANVAS - 1, bounds.top + bounds.height - 1 + pad);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * 1024×1024 master: flatten to cream, enlarge subject in-place, stay inside safe zone.
 */
async function composeMasterIcon1024(source) {
  const flat = await sharp(source)
    .flatten({ background: CREAM })
    .resize(CANVAS, CANVAS, { fit: "contain", background: CREAM, kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const bounds = await detectSubjectBounds(flat);
  if (!bounds) {
    return sharp(flat).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  }

  const region = clampExtractRegion(bounds, EXTRACT_PAD_PX);
  let targetW = Math.round(region.width * SUBJECT_SCALE);
  let targetH = Math.round(region.height * SUBJECT_SCALE);

  const maxDim = Math.max(targetW, targetH);
  if (maxDim > SAFE_ZONE) {
    const cap = SAFE_ZONE / maxDim;
    targetW = Math.round(targetW * cap);
    targetH = Math.round(targetH * cap);
  }

  const subject = await sharp(flat)
    .extract(region)
    .resize(targetW, targetH, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const left = Math.round((CANVAS - targetW) / 2);
  const top = Math.round((CANVAS - targetH) / 2);

  return sharp({
    create: { width: CANVAS, height: CANVAS, channels: 3, background: CREAM },
  })
    .composite([{ input: subject, left, top }])
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
  await writeFile(
    resolve(APP_ICON_DIR, "Contents.json"),
    `${JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2)}\n`,
  );
  console.log("✓ AppIcon Contents.json (full size matrix)");
}

async function cleanAppIconSetDir() {
  await mkdir(APP_ICON_DIR, { recursive: true });
  const keep = new Set(APP_ICON_ENTRIES.map((e) => e.filename));
  for (const name of await readdir(APP_ICON_DIR)) {
    if (name.endsWith(".png") && !keep.has(name)) {
      await unlink(resolve(APP_ICON_DIR, name));
    }
  }
}

async function exportAppIconSizes(masterBuf) {
  await cleanAppIconSetDir();
  for (const { filename, px } of APP_ICON_ENTRIES) {
    await sharp(masterBuf)
      .resize(px, px, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png({ force: true })
      .toFile(resolve(APP_ICON_DIR, filename));
    console.log("✓", filename, `${px}×${px}`);
  }
  await writeContentsJson();
}

async function resolveSource() {
  await mkdir(resolve(ROOT, "assets"), { recursive: true });
  try {
    await access(SOURCE);
    return SOURCE;
  } catch {
    await copyFile(CURSOR_ATTACHMENT, SOURCE);
    console.log("✓ Source copied to assets/roamie-app-icon-source.png");
    return SOURCE;
  }
}

async function reportMasterStats(masterBuf) {
  const { data, info } = await sharp(masterBuf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let minX = w;
  let minY = w;
  let maxX = 0;
  let maxY = 0;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let outsideCircle = 0;
  const safeR = SAFE_ZONE / 2;

  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (!isPeachMascot(data[i], data[i + 1], data[i + 2])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      count += 1;
      const dx = x - (w / 2 - 0.5);
      const dy = y - (w / 2 - 0.5);
      if (dx * dx + dy * dy > safeR * safeR) outsideCircle += 1;
    }
  }

  console.log("\nMaster stats (subject scale", SUBJECT_SCALE + "):");
  console.log(
    `  peach ${maxX - minX + 1}×${maxY - minY + 1}px, centroid (${(sumX / count).toFixed(1)}, ${(sumY / count).toFixed(1)})`,
  );
  console.log(
    `  margins top ${minY}px · bottom ${w - 1 - maxY}px · left ${minX}px · right ${w - 1 - maxX}px`,
  );
  console.log(`  outside safe circle: ${outsideCircle}px`);
}

async function main() {
  const source = await resolveSource();
  const masterBuf = await composeMasterIcon1024(source);

  await sharp(masterBuf).toFile(MASTER_OUT);
  console.log("✓ Master icon", MASTER_OUT);

  await reportMasterStats(masterBuf);
  await exportAppIconSizes(masterBuf);

  const { writeBrandSplashAssets } = await import("./generate-brand-splash.mjs");
  await writeBrandSplashAssets();
  console.log("\nBrand splash uses src/assets/roamie-traveler.jpg (not app icon).");
  console.log("\nNext: npm run cap:sync:ios:dev → Xcode Clean → delete app → reinstall");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { composeMasterIcon1024, CREAM, CANVAS, SAFE_ZONE, SUBJECT_SCALE };
