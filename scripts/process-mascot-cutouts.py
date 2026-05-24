#!/usr/bin/env python3
"""Generate transparent mascot cutouts: rembg + edge-flood matte union."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("U2NET_HOME", str(ROOT / ".u2net"))

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove

ASSETS = ROOT / "src/assets"
SPLASH = ROOT / "ios/App/App/Assets.xcassets/SplashLogo.imageset"

SOURCES = [
    ("roamie-brand-mascot.png", "roamie-brand-mascot-cutout.png"),
    ("roamie-mascot-walk.png", "roamie-mascot-walk-cutout.png"),
    ("roamie-mascot-map.png", "roamie-mascot-map-cutout.png"),
    ("roamie-mascot-camera.png", "roamie-mascot-camera-cutout.png"),
]


def color_distance(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    diff = rgb.astype(np.float32) - bg.astype(np.float32)
    return np.linalg.norm(diff, axis=-1)


def sample_bg_rgb(img: Image.Image) -> np.ndarray:
    arr = np.asarray(img.convert("RGB"))
    h, w, _ = arr.shape
    patches = [
        arr[:24, :24],
        arr[:24, w - 24 : w],
        arr[h - 24 : h, :24],
        arr[h - 24 : h, w - 24 : w],
    ]
    sample = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    return sample.mean(axis=0)


def is_backdrop(rgb: np.ndarray, bg: np.ndarray, tolerance: float = 36) -> np.ndarray:
    dist = color_distance(rgb, bg)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm = (r > 232) & (g > 222) & (b > 205) & ((r - b) < 48) & (dist < tolerance + 16)
    return (dist < tolerance) | warm


def is_protected(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    mx = np.max(rgb, axis=-1).astype(np.float32)
    mn = np.min(rgb, axis=-1).astype(np.float32)
    sat = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 0)
    green_hat = (g > r + 12) & (g > b + 8) & (g > 90)
    return (sat > 0.14) | (mx < 145) | green_hat


def is_character_cream(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    dist = color_distance(rgb, bg)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (dist < 58) & (r > 208) & (g > 192) & (b > 168)


def flood_from_border(allowed: np.ndarray) -> np.ndarray:
    h, w = allowed.shape
    visited = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        for y in (0, h - 1):
            if allowed[y, x] and not visited[y, x]:
                visited[y, x] = True
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if allowed[y, x] and not visited[y, x]:
                visited[y, x] = True
                stack.append((x, y))
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and allowed[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                stack.append((nx, ny))
    return visited


def build_flood_alpha(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    backdrop = is_backdrop(rgb, bg, 40)
    edge_backdrop = flood_from_border(backdrop)
    protected = is_protected(rgb)
    cream = is_character_cream(rgb, bg)

    fg = protected.copy()
    stack = list(zip(*np.nonzero(fg)))
    while stack:
        y, x = stack.pop()
        for ny in range(max(0, y - 1), min(h, y + 2)):
            for nx in range(max(0, x - 1), min(w, x + 2)):
                if fg[ny, nx] or edge_backdrop[ny, nx]:
                    continue
                px = rgb[ny, nx]
                if cream[ny, nx] or not is_backdrop(px[None, None, :], bg, 46)[0, 0]:
                    fg[ny, nx] = True
                    stack.append((ny, nx))

    # Remove small interior backdrop pockets-.g. between legs
    is_bg = edge_backdrop & ~fg
    interior = backdrop & ~is_bg & ~fg
    visited = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            if not interior[y, x] or visited[y, x]:
                continue
            component: list[tuple[int, int]] = []
            q = [(y, x)]
            visited[y, x] = True
            while q:
                cy, cx = q.pop()
                component.append((cy, cx))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and interior[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
            if len(component) < 15000:
                for cy, cx in component:
                    is_bg[cy, cx] = True

    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    return alpha


def close_alpha(alpha: np.ndarray, size: int = 3) -> np.ndarray:
    img = Image.fromarray(alpha, mode="L")
    closed = img.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size))
    return np.asarray(closed)


def defringe_rgb(rgba: np.ndarray, bg: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    rgb = out[..., :3].astype(np.float32)
    alpha = out[..., 3].astype(np.float32)
    dist = color_distance(rgb, bg)
    fringe = (alpha > 0) & (alpha < 255) & (dist < 24)
    out[fringe, 3] = 0
    return out


def fill_cream_holes(rgba: np.ndarray, bg: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    rgb = out[..., :3]
    cream = is_character_cream(rgb, bg)
    for _ in range(10):
        alpha = out[..., 3]
        hole = (alpha == 0) & cream
        if not hole.any():
            break
        padded = np.pad(alpha, 1, mode="constant")
        counts = np.zeros(alpha.shape, dtype=np.int32)
        for dy in range(3):
            for dx in range(3):
                if dx == 1 and dy == 1:
                    continue
                counts += (padded[dy : dy + alpha.shape[0], dx : dx + alpha.shape[1]] > 180).astype(
                    np.int32
                )
        restore = hole & (counts >= 4)
        out[restore, 3] = 255
    return out


def trim_transparent(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def process_one(src_name: str, out_name: str) -> None:
    src = ASSETS / src_name
    out = ASSETS / out_name
    with Image.open(src) as im:
        rgb_src = np.asarray(im.convert("RGB"))
        bg = sample_bg_rgb(im)

        rembg_img = remove(im.convert("RGBA"))
        if not isinstance(rembg_img, Image.Image):
            rembg_img = Image.open(rembg_img)
        rembg_arr = np.asarray(rembg_img.convert("RGBA"))
        rembg_alpha = rembg_arr[..., 3]

        flood_alpha = build_flood_alpha(rgb_src, bg)
        merged_alpha = np.maximum(rembg_alpha, flood_alpha)
        merged_alpha = close_alpha(merged_alpha, size=3)

        rgba = np.dstack([rgb_src, merged_alpha])
        rgba = defringe_rgb(rgba, bg)
        rgba = fill_cream_holes(rgba, bg)

        result = trim_transparent(Image.fromarray(rgba))
        result.save(out, format="PNG", optimize=True)
        print(f"✓ {out.relative_to(ROOT)} ({result.size[0]}×{result.size[1]})")


def write_splash(wave_path: Path) -> None:
    SPLASH.mkdir(parents=True, exist_ok=True)
    with Image.open(wave_path) as im:
        for name, width in [
            ("splash-logo.png", 512),
            ("splash-logo@2x.png", 768),
            ("splash-logo@3x.png", 1024),
        ]:
            resized = im.copy()
            resized.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
            resized.save(SPLASH / name, format="PNG", optimize=True)
    contents = {
        "images": [
            {"filename": "splash-logo.png", "idiom": "universal", "scale": "1x"},
            {"filename": "splash-logo@2x.png", "idiom": "universal", "scale": "2x"},
            {"filename": "splash-logo@3x.png", "idiom": "universal", "scale": "3x"},
        ],
        "info": {"author": "xcode", "version": 1},
    }
    (SPLASH / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    print("✓ iOS SplashLogo.imageset")


def main() -> int:
    for src, out in SOURCES:
        process_one(src, out)
    write_splash(ASSETS / "roamie-brand-mascot-cutout.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
