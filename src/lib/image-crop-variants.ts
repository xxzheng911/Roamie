import type { CropInitialFit } from "@/lib/image-crop";

export type ImageCropVariant = "avatar" | "cover" | "tripCover";

export type ImageCropVariantConfig = {
  title: string;
  hint: string;
  aspectWidth: number;
  aspectHeight: number;
  initialFit: CropInitialFit;
  fitPadding: number;
  exportMaxWidth: number;
  exportQuality: number;
  maskClass: string;
};

/** 個人頁頭像 / 個人頁封面 / 行程封面共用裁切設定 */
export const IMAGE_CROP_VARIANTS: Record<ImageCropVariant, ImageCropVariantConfig> = {
  avatar: {
    title: "移動與縮放",
    hint: "單指拖曳、雙指縮放",
    aspectWidth: 1,
    aspectHeight: 1,
    initialFit: "contain",
    fitPadding: 0.86,
    exportMaxWidth: 512,
    exportQuality: 0.82,
    maskClass:
      "aspect-square w-[min(92vw,34rem)] max-h-[min(78dvh,34rem)] rounded-full ring-2 ring-white/90",
  },
  cover: {
    title: "調整封面",
    hint: "單指拖曳、雙指縮放",
    aspectWidth: 3,
    aspectHeight: 2,
    initialFit: "cover-line",
    fitPadding: 0.94,
    exportMaxWidth: 1024,
    exportQuality: 0.82,
    maskClass:
      "aspect-[3/2] w-[min(calc(100vw-2rem),40rem)] max-h-[min(42dvh,18rem)] rounded-md ring-2 ring-white/90",
  },
  tripCover: {
    title: "調整封面",
    hint: "單指拖曳、雙指縮放",
    aspectWidth: 3,
    aspectHeight: 2,
    initialFit: "cover-line",
    fitPadding: 0.94,
    exportMaxWidth: 1920,
    exportQuality: 0.92,
    maskClass:
      "aspect-[3/2] w-[min(calc(100vw-2rem),40rem)] max-h-[min(42dvh,18rem)] rounded-md ring-2 ring-white/90",
  },
};
