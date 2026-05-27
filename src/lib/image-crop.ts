/** 將圖片裁切為指定比例（置中裁切），輸出 JPEG */
export async function cropImageToAspect(
  file: File,
  aspectWidth: number,
  aspectHeight: number,
  maxWidth = 1400,
): Promise<Blob> {
  const bitmap = await loadImageSource(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const targetAspect = aspectWidth / aspectHeight;
  const srcAspect = srcW / srcH;

  let cropW = srcW;
  let cropH = srcH;
  let sx = 0;
  let sy = 0;

  if (srcAspect > targetAspect) {
    cropW = Math.round(srcH * targetAspect);
    sx = Math.round((srcW - cropW) / 2);
  } else {
    cropH = Math.round(srcW / targetAspect);
    sy = Math.round((srcH - cropH) / 2);
  }

  const outW = Math.min(maxWidth, cropW);
  const outH = Math.round(outW * (aspectHeight / aspectWidth));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法處理圖片");

  ctx.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, outW, outH);

  return canvasToJpegBlob(canvas, 0.82);
}

/** 正方形裁切（大頭照） */
export async function cropImageToSquare(file: File, size = 512): Promise<Blob> {
  return cropImageToAspect(file, 1, 1, size);
}

/** 手機封面比例（與 ProfileCover 3:2 一致） */
export async function cropImageToCover(file: File): Promise<Blob> {
  return cropImageToAspect(file, 3, 2, 1024);
}

export type CropTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type CenteredCropRect = {
  cropW: number;
  cropH: number;
  cropLeft: number;
  cropTop: number;
};

/** 視窗內置中、符合比例的裁切框（大頭照／封面 overlay 與 export 共用） */
export type CropOrientation = "portrait" | "landscape" | "square";

export function getImageOrientation(imgW: number, imgH: number): CropOrientation {
  if (imgH <= 0 || imgW <= 0) return "square";
  const ratio = imgW / imgH;
  if (ratio < 0.92) return "portrait";
  if (ratio > 1.08) return "landscape";
  return "square";
}

export type CropInitialFit = "contain" | "cover" | "cover-line";

/**
 * 封面裁切允許縮放到的最小倍率（相對於 fit-to-width / contain），方便使用者縮小看全圖。
 */
export function computeCoverMinimumCropScale(
  imgW: number,
  imgH: number,
  cropW: number,
  cropH: number,
): number {
  // 封面必須永遠覆蓋裁切框（避免黑邊）→ minimum 必須 >= cover scale
  const wScale = cropW / imgW;
  const hScale = cropH / imgH;
  return Math.max(wScale, hScale);
}

/**
 * 初始縮放：
 * - contain：頭像（完整顯示 + 留白）
 * - cover：填滿裁切框（舊行為，勿用於封面）
 * - cover-line：橫向封面，優先 fit-to-width，橫圖/方圖用 contain，避免一進場過度放大
 */
export function computeInitialCropScale(
  imgW: number,
  imgH: number,
  cropW: number,
  cropH: number,
  options: {
    fit: CropInitialFit;
    padding?: number;
  },
): number {
  const wScale = cropW / imgW;
  const hScale = cropH / imgH;
  const containScale = Math.min(wScale, hScale);
  const pad = options.padding ?? 1;

  if (options.fit === "cover-line") {
    const coverScale = Math.max(wScale, hScale);
    const orientation = getImageOrientation(imgW, imgH);
    if (orientation === "portrait") {
      /** 直式：寬度對齊裁切框寬，上下可拖曳（LINE 封面） */
      const widthFit = wScale * (options.padding ?? 0.96);
      // 仍需覆蓋裁切框高度，避免黑邊
      return Math.max(coverScale, widthFit);
    }
    if (orientation === "landscape") {
      /** 橫式：以 cover scale 為下限，略偏向「看更多」但不可露黑邊 */
      return coverScale * (options.padding ?? 1);
    }
    /** 方形：置中顯示，但仍必須覆蓋裁切框 */
    return coverScale * (options.padding ?? 1);
  }

  const base =
    options.fit === "contain" ? containScale : Math.max(wScale, hScale);

  if (options.padding != null && options.fit !== "contain") {
    return base * pad;
  }

  if (options.fit === "cover") {
    return base;
  }

  const orientation = getImageOrientation(imgW, imgH);
  const paddingByOrientation: Record<CropOrientation, number> = {
    portrait: 0.82,
    landscape: 0.86,
    square: 0.88,
  };
  return base * paddingByOrientation[orientation];
}

export function getCenteredCropRect(
  viewportW: number,
  viewportH: number,
  aspectWidth: number,
  aspectHeight: number,
): CenteredCropRect {
  const aspect = aspectWidth / aspectHeight;
  let cropW = viewportW;
  let cropH = viewportH;
  if (viewportW / viewportH > aspect) {
    cropW = viewportH * aspect;
  } else {
    cropH = viewportW / aspect;
  }
  return {
    cropW,
    cropH,
    cropLeft: (viewportW - cropW) / 2,
    cropTop: (viewportH - cropH) / 2,
  };
}

/** 依預覽視窗的平移／縮放輸出裁切結果 */
export async function exportCropFromTransform(
  img: HTMLImageElement,
  viewportW: number,
  viewportH: number,
  transform: CropTransform,
  aspectWidth: number,
  aspectHeight: number,
  maxWidth = 1200,
): Promise<Blob> {
  const { cropW, cropH, cropLeft, cropTop } = getCenteredCropRect(
    viewportW,
    viewportH,
    aspectWidth,
    aspectHeight,
  );

  const aspect = aspectWidth / aspectHeight;
  const outW = Math.max(1, Math.min(maxWidth, Math.round(cropW)));
  const outH = Math.max(1, Math.round(outW / aspect));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法處理圖片");

  const { scale, offsetX, offsetY } = transform;
  const imgW = img.naturalWidth * scale;
  const imgH = img.naturalHeight * scale;
  const imgLeft = (viewportW - imgW) / 2 + offsetX;
  const imgTop = (viewportH - imgH) / 2 + offsetY;

  const rawSx = ((cropLeft - imgLeft) / scale) * (outW / cropW);
  const rawSy = ((cropTop - imgTop) / scale) * (outH / cropH);
  const sWidth = (cropW / scale) * (outW / cropW);
  const sHeight = (cropH / scale) * (outH / cropH);

  // Clamp crop area to image bounds (avoid black edges even if UI clamp misses)
  const maxSx = Math.max(0, img.naturalWidth - sWidth);
  const maxSy = Math.max(0, img.naturalHeight - sHeight);
  const sx = Math.min(maxSx, Math.max(0, rawSx));
  const sy = Math.min(maxSy, Math.max(0, rawSy));
  if (sx !== rawSx || sy !== rawSy) {
    console.info("[Cover Crop Clamped]", {
      raw: { sx: rawSx, sy: rawSy, sWidth, sHeight },
      clamped: { sx, sy },
      img: { w: img.naturalWidth, h: img.naturalHeight },
    });
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outW, outH);
  console.info("[Cover Crop Output Size]", { outW, outH });
  return canvasToJpegBlob(canvas, 0.82);
}

function loadImageSource(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("圖片載入失敗"));
    };
    img.src = url;
  });
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("圖片轉換失敗"))),
      "image/jpeg",
      quality,
    );
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("預覽失敗"));
    reader.readAsDataURL(blob);
  });
}

export function fileToObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * iOS 實機可能拿到 HEIC/HDR/HJPG；先轉成標準 JPEG，避免 WebKit decode / HJPG err=-39。
 * 透過 canvas 重新編碼可移除大部分 HDR / metadata。
 */
export async function normalizeImageFileForUpload(
  file: File,
  options?: { maxSide?: number; quality?: number },
): Promise<File> {
  const maxSide = options?.maxSide ?? 2048;
  const quality = options?.quality ?? 0.86;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(objectUrl);
    const srcW = Math.max(1, img.naturalWidth);
    const srcH = Math.max(1, img.naturalHeight);
    const ratio = Math.min(1, maxSide / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * ratio));
    const outH = Math.max(1, Math.round(srcH * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立圖片處理畫布");
    ctx.drawImage(img, 0, 0, outW, outH);
    const blob = await canvasToJpegBlob(canvas, quality);
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    throw new Error("這張圖片格式目前不支援，請改選一般照片（JPG/PNG）");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
