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

/** 封面編輯初始縮放略大於最小 cover，讓 X/Y 軸都有拖曳空間 */
export const COVER_CROP_INITIAL_HEADROOM = 1.05;

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
    let scale: number;
    if (orientation === "portrait") {
      /** 直式：寬度對齊裁切框寬，上下可拖曳（LINE 封面） */
      const widthFit = wScale * (options.padding ?? 0.96);
      scale = Math.max(coverScale, widthFit);
    } else if (orientation === "landscape") {
      /** 橫式：以 cover scale 為下限，略偏向「看更多」但不可露黑邊 */
      scale = coverScale * (options.padding ?? 1);
    } else {
      /** 方形：置中顯示，但仍必須覆蓋裁切框 */
      scale = coverScale * (options.padding ?? 1);
    }
    /** 略大於最小 cover，避免寬/高剛好貼齊時單軸無法拖曳 */
    return Math.max(scale, coverScale) * COVER_CROP_INITIAL_HEADROOM;
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

export function resolveCropRect(
  viewportW: number,
  viewportH: number,
  aspectWidth: number,
  aspectHeight: number,
  cropFrame?: CenteredCropRect | null,
): CenteredCropRect {
  if (cropFrame && cropFrame.cropW >= 8 && cropFrame.cropH >= 8) {
    return cropFrame;
  }
  return getCenteredCropRect(viewportW, viewportH, aspectWidth, aspectHeight);
}

/** 依預覽視窗的平移／縮放輸出裁切結果（以原圖裁切區解析度為準，上限 maxWidth） */
export async function exportCropFromTransform(
  img: HTMLImageElement,
  viewportW: number,
  viewportH: number,
  transform: CropTransform,
  aspectWidth: number,
  aspectHeight: number,
  maxWidth = 1200,
  cropFrame?: CenteredCropRect | null,
  quality = 0.82,
): Promise<Blob> {
  const { cropW, cropH, cropLeft, cropTop } = resolveCropRect(
    viewportW,
    viewportH,
    aspectWidth,
    aspectHeight,
    cropFrame,
  );

  const aspect = aspectWidth / aspectHeight;
  const { scale, offsetX, offsetY } = transform;
  const imgW = img.naturalWidth * scale;
  const imgH = img.naturalHeight * scale;
  const imgLeft = (viewportW - imgW) / 2 + offsetX;
  const imgTop = (viewportH - imgH) / 2 + offsetY;

  let sx = (cropLeft - imgLeft) / scale;
  let sy = (cropTop - imgTop) / scale;
  let sw = cropW / scale;
  let sh = cropH / scale;

  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  if (sx + sw > img.naturalWidth) sw = Math.max(1, img.naturalWidth - sx);
  if (sy + sh > img.naturalHeight) sh = Math.max(1, img.naturalHeight - sy);

  const outW = Math.max(1, Math.min(maxWidth, Math.round(sw)));
  const outH = Math.max(1, Math.round(outW / aspect));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法處理圖片");

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  console.info("[Cover Crop Output Size]", { outW, outH, quality, sourceCropW: Math.round(sw) });
  return canvasToJpegBlob(canvas, quality);
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
    img.onload = () => {
      const finish = () => {
        if (img.naturalWidth < 1 || img.naturalHeight < 1) {
          reject(new Error("圖片尺寸無效"));
          return;
        }
        resolve(img);
      };
      if (typeof img.decode === "function") {
        void img.decode().then(finish).catch(finish);
        return;
      }
      finish();
    };
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = url;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.readAsDataURL(file);
  });
}

type DecodedDrawable = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/**
 * iOS 相簿常見 HEIC / HDR JPEG（HJPG）；WebKit 用 <img> 直接 decode 會失敗 (err=-39)。
 * 依序嘗試 createImageBitmap → blob URL → data URL，再經 canvas 轉成標準 JPEG。
 */
async function decodeDrawableFromFile(file: File, logPrefix?: string): Promise<DecodedDrawable> {
  const log = (message: string, extra?: unknown) => {
    const tag = logPrefix ?? "[image-decode]";
    if (extra !== undefined) console.info(tag, message, extra);
    else console.info(tag, message);
  };

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        log("decode createImageBitmap ok", { w: bitmap.width, h: bitmap.height });
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch (error) {
      log("decode createImageBitmap failed", error);
    }
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(blobUrl);
    log("decode blob url ok", { w: img.naturalWidth, h: img.naturalHeight });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(blobUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    log("decode blob url failed", error);
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImageFromUrl(dataUrl);
    log("decode data url ok", { w: img.naturalWidth, h: img.naturalHeight });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => {},
    };
  } catch (error) {
    log("decode data url failed", error);
    throw new Error("這張圖片格式目前不支援，請改選一般照片（JPG/PNG）");
  }
}

async function encodeDrawableToJpegFile(
  file: File,
  drawable: DecodedDrawable,
  options?: { maxSide?: number; quality?: number },
): Promise<File> {
  const maxSide = options?.maxSide ?? 2048;
  const quality = options?.quality ?? 0.86;
  const ratio = Math.min(1, maxSide / Math.max(drawable.width, drawable.height));
  const outW = Math.max(1, Math.round(drawable.width * ratio));
  const outH = Math.max(1, Math.round(drawable.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立圖片處理畫布");
  ctx.drawImage(drawable.source, 0, 0, outW, outH);
  const blob = await canvasToJpegBlob(canvas, quality);
  if (!blob.size) throw new Error("圖片轉換失敗");
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

/** 裁切編輯器用：解碼並轉成 WebKit 可穩定顯示的 JPEG */
export async function prepareImageForCropEditor(
  file: File,
  options?: { maxSide?: number; quality?: number; logPrefix?: string },
): Promise<{ file: File; objectUrl: string; width: number; height: number }> {
  const drawable = await decodeDrawableFromFile(file, options?.logPrefix);
  try {
    const outFile = await encodeDrawableToJpegFile(file, drawable, {
      maxSide: options?.maxSide ?? 4096,
      quality: options?.quality ?? 0.92,
    });
    const objectUrl = URL.createObjectURL(outFile);
    const img = await loadImageFromUrl(objectUrl);
    if (options?.logPrefix) {
      console.info(
        `${options.logPrefix} decode ready`,
        `w=${img.naturalWidth}`,
        `h=${img.naturalHeight}`,
        `bytes=${outFile.size}`,
      );
    }
    return {
      file: outFile,
      objectUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } finally {
    drawable.release();
  }
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

export async function readFileImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = fileToObjectUrl(file);
  try {
    const img = await loadImageFromUrl(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readBlobImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** iOS 相簿有時 type 為空，用副檔名補判斷 */
export function isImagePickFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(file.name);
}

/**
 * iOS 實機可能拿到 HEIC/HDR/HJPG；先轉成標準 JPEG，避免 WebKit decode / HJPG err=-39。
 * 透過 canvas 重新編碼可移除大部分 HDR / metadata。
 */
export async function normalizeImageFileForUpload(
  file: File,
  options?: { maxSide?: number; quality?: number; logPrefix?: string },
): Promise<File> {
  const drawable = await decodeDrawableFromFile(file, options?.logPrefix);
  try {
    return await encodeDrawableToJpegFile(file, drawable, options);
  } finally {
    drawable.release();
  }
}
