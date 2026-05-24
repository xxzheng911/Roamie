/**
 * Remove cream backdrop from Roamie brand mascot (edge-connected flood fill).
 * Usage: node scripts/process-brand-mascot.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCE = resolve(ROOT, "src/assets/roamie-brand-mascot.png");
const CUTOUT = resolve(ROOT, "src/assets/roamie-brand-mascot-cutout.png");
const SPLASH_SET = resolve(ROOT, "ios/App/App/Assets.xcassets/SplashLogo.imageset");

function colorDistance(r, g, b, target) {
  return Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2);
}

function sampleCornerBackground(data, width, height, channels) {
  const samples = [];
  const radius = 24;
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  for (const [cx, cy] of corners) {
    for (let dy = 0; dy < radius; dy++) {
      for (let dx = 0; dx < radius; dx++) {
        const x = cx === 0 ? dx : width - 1 - dx;
        const y = cy === 0 ? dy : height - 1 - dy;
        const i = (y * width + x) * channels;
        samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
  }
  const n = samples.length;
  return {
    r: Math.round(samples.reduce((s, p) => s + p.r, 0) / n),
    g: Math.round(samples.reduce((s, p) => s + p.g, 0) / n),
    b: Math.round(samples.reduce((s, p) => s + p.b, 0) / n),
  };
}

function isBackdropPixel(r, g, b, bg) {
  if (colorDistance(r, g, b, bg) < 36) return true;
  if (r > 232 && g > 222 && b > 205 && r - b < 48 && colorDistance(r, g, b, bg) < 52) return true;
  return false;
}

function isProtectedForeground(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat > 0.14) return true;
  if (max < 145) return true;
  if (g > r + 12 && g > b + 8 && g > 90) return true;
  return false;
}

function buildBackgroundMask(data, width, height, channels, bg) {
  const total = width * height;
  const backdrop = new Uint8Array(total);
  const protectedFg = new Uint8Array(total);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isProtectedForeground(r, g, b)) protectedFg[p] = 1;
      if (isBackdropPixel(r, g, b, bg)) backdrop[p] = 1;
    }
  }

  const isBg = new Uint8Array(total);
  const queue = [];

  const trySeed = (x, y) => {
    const p = y * width + x;
    if (isBg[p] || !backdrop[p] || protectedFg[p]) return;
    isBg[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (queue.length > 0) {
    const p = queue.pop();
    const x = p % width;
    const y = (p - x) / width;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (isBg[np] || !backdrop[np] || protectedFg[np]) continue;
      isBg[np] = 1;
      queue.push(np);
    }
  }

  const visited = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || isBg[start] || !backdrop[start] || protectedFg[start]) continue;

      const component = [];
      const q = [start];
      visited[start] = 1;
      let touchesBorder = false;

      while (q.length > 0) {
        const p = q.pop();
        component.push(p);
        const px = p % width;
        const py = (p - px) / width;
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1) touchesBorder = true;

        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (visited[np] || isBg[np] || !backdrop[np] || protectedFg[np]) continue;
          visited[np] = 1;
          q.push(np);
        }
      }

      if (!touchesBorder && component.length < 12000) {
        for (const p of component) isBg[p] = 1;
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (!isBg[p] || protectedFg[p]) continue;
      let nearFg = false;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (protectedFg[(y + dy) * width + (x + dx)]) {
            nearFg = true;
            break;
          }
        }
        if (nearFg) break;
      }
      if (nearFg) isBg[p] = 0;
    }
  }

  return isBg;
}

function softenAlphaEdges(data, width, height, channels, isBg) {
  const alpha = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) alpha[p] = isBg[p] ? 0 : 255;

  const out = new Float32Array(alpha);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (alpha[p] === 0) continue;
      let sum = alpha[p];
      let n = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          sum += alpha[(y + dy) * width + (x + dx)];
          n++;
        }
      }
      const avg = sum / n;
      if (avg < 255) out[p] = Math.min(255, avg * 1.05);
    }
  }

  for (let p = 0; p < width * height; p++) {
    if (isBg[p]) continue;
    data[p * channels + 3] = Math.round(out[p]);
  }
}

async function buildCutout() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bg = sampleCornerBackground(data, width, height, channels);
  const isBg = buildBackgroundMask(data, width, height, channels, bg);

  for (let p = 0; p < width * height; p++) {
    if (isBg[p]) data[p * channels + 3] = 0;
  }

  softenAlphaEdges(data, width, height, channels, isBg);

  const cutout = await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9, force: true })
    .toBuffer();

  await sharp(cutout).toFile(CUTOUT);
  console.log("✓ Cutout mascot", CUTOUT);
  return cutout;
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
