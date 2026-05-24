import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/assets");
const files = [
  "roamie-brand-mascot-cutout.png",
  "roamie-mascot-walk-cutout.png",
  "roamie-mascot-map-cutout.png",
  "roamie-mascot-camera-cutout.png",
];

for (const name of files) {
  const path = resolve(ASSETS, name);
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let semi = 0;
  let opaque = 0;
  let holes = 0;
  const { width, height, channels } = info;
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const a = data[p * channels + 3];
    alpha[p] = a;
    if (a === 0) transparent++;
    else if (a < 250) semi++;
    else opaque++;
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (alpha[p] !== 0) continue;
      let opaqueN = 0;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (alpha[ny * width + nx] > 200) opaqueN++;
      }
      if (opaqueN >= 3) holes++;
    }
  }
  console.log(name, `${width}x${height}`, { transparent, semi, opaque, internalHoles: holes });
}
