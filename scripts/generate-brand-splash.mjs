/**
 * Brand splash assets — traveler character (hat + backpack), NOT app icon.
 * Called from generate-ios-icon.mjs
 */
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export const TRAVELER = resolve(ROOT, "src/assets/roamie-traveler.jpg");
export const CREAM = { r: 253, g: 245, b: 234 };
const INK = "#2a2520";
const MUTED = "#6b635c";

const SPLASH_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");
const SPLASH_LOGO_DIR = resolve(ROOT, "ios/App/App/Assets.xcassets/SplashLogo.imageset");

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Cream field in traveler illustration → transparent for overlay compositing */
function isTravelerBackground(r, g, b) {
  return r > 236 && g > 226 && b > 200 && chroma(r, g, b) < 22;
}

export async function extractTravelerCharacterPng() {
  const { data, info } = await sharp(TRAVELER).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isTravelerBackground(r, g, b)) {
      out[i] = CREAM.r;
      out[i + 1] = CREAM.g;
      out[i + 2] = CREAM.b;
      out[i + 3] = 0;
    } else {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }

  const trimmed = await sharp(out, {
    raw: { width, height, channels: 4 },
  })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();

  return trimmed;
}

function gradientSvg(w, h) {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdf8f0"/>
          <stop offset="45%" stop-color="#fdf5ea"/>
          <stop offset="100%" stop-color="#f3ebe2"/>
        </linearGradient>
        <radialGradient id="glow" cx="30%" cy="18%" r="55%">
          <stop offset="0%" stop-color="#fde8d4" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#fde8d4" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glow2" cx="78%" cy="82%" r="50%">
          <stop offset="0%" stop-color="#dfe8f0" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#dfe8f0" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      <rect width="100%" height="100%" fill="url(#glow2)"/>
    </svg>`,
  );
}

function wordmarkSvg(w) {
  return Buffer.from(
    `<svg width="${w}" height="120" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="42" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica Neue,sans-serif" font-size="42" font-weight="600" fill="${INK}" letter-spacing="1">Roamie</text>
      <text x="50%" y="88" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica Neue,sans-serif" font-size="22" font-weight="400" fill="${MUTED}" letter-spacing="0.3">Less planning, more wandering.</text>
    </svg>`,
  );
}

/** Character-only asset for LaunchScreen.storyboard (transparent PNG) */
export async function composeTravelerMark(size) {
  const character = await extractTravelerCharacterPng();
  const charH = Math.round(size * 0.82);
  const resized = await sharp(character).resize({ height: charH, fit: "inside" }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const charW = meta.width ?? charH;

  const shadowW = Math.round(charW * 0.55);
  const shadowH = Math.round(charH * 0.06);
  const shadowSvg = Buffer.from(
    `<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW / 2}" ry="${shadowH / 2}" fill="rgba(42,37,32,0.1)"/>
    </svg>`,
  );
  const shadow = await sharp(shadowSvg).png().toBuffer();

  const left = Math.floor((size - charW) / 2);
  const top = Math.floor((size - charH) / 2) - 8;
  const shadowLeft = Math.floor((size - shadowW) / 2);
  const shadowTop = top + charH - Math.round(shadowH * 0.2);

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: shadow, left: shadowLeft, top: shadowTop },
      { input: resized, left, top },
    ])
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

/** Full-frame static splash for Capacitor (matches in-app splash layout) */
export async function composeBrandSplashFrame(width, height) {
  const character = await extractTravelerCharacterPng();
  const charH = Math.round(height * 0.22);
  const resized = await sharp(character).resize({ height: charH, fit: "inside" }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const charW = meta.width ?? charH;

  const charLeft = Math.floor((width - charW) / 2);
  const charTop = Math.round(height * 0.28);

  const shadowW = Math.round(charW * 0.5);
  const shadowH = Math.round(charH * 0.05);
  const shadowSvg = Buffer.from(
    `<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW / 2}" ry="${shadowH / 2}" fill="rgba(42,37,32,0.09)"/>
    </svg>`,
  );
  const shadow = await sharp(shadowSvg).png().toBuffer();

  const textW = Math.min(width, 900);
  const text = wordmarkSvg(textW);
  const textTop = charTop + charH + Math.round(height * 0.04);

  const dotsSvg = Buffer.from(
    `<svg width="80" height="16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="5" fill="${MUTED}" opacity="0.35"/>
      <circle cx="40" cy="8" r="5" fill="${MUTED}" opacity="0.55"/>
      <circle cx="72" cy="8" r="5" fill="${MUTED}" opacity="0.35"/>
    </svg>`,
  );

  return sharp(gradientSvg(width, height))
    .composite([
      { input: shadow, left: Math.floor((width - shadowW) / 2), top: charTop + charH - 4 },
      { input: resized, left: charLeft, top: charTop },
      { input: text, left: Math.floor((width - textW) / 2), top: textTop },
      { input: dotsSvg, left: Math.floor((width - 80) / 2), top: textTop + 110 },
    ])
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

export async function writeBrandSplashAssets() {
  await mkdir(SPLASH_DIR, { recursive: true });
  await mkdir(SPLASH_LOGO_DIR, { recursive: true });

  const frame = await composeBrandSplashFrame(2732, 2732);
  for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    await sharp(frame).toFile(resolve(SPLASH_DIR, name));
  }
  console.log("✓ Splash.imageset (traveler brand frame, Capacitor)");

  const logoSizes = [
    { name: "splash-logo.png", px: 512 },
    { name: "splash-logo@2x.png", px: 1024 },
    { name: "splash-logo@3x.png", px: 1536 },
  ];
  for (const { name, px } of logoSizes) {
    await composeTravelerMark(px).then((buf) => sharp(buf).toFile(resolve(SPLASH_LOGO_DIR, name)));
  }
  console.log("✓ SplashLogo.imageset (traveler character, LaunchScreen)");
}
