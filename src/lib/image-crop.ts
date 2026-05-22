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

  return canvasToJpegBlob(canvas, 0.88);
}

/** 正方形裁切（大頭照） */
export async function cropImageToSquare(file: File, size = 512): Promise<Blob> {
  return cropImageToAspect(file, 1, 1, size);
}

/** 手機封面比例（寬幅） */
export async function cropImageToCover(file: File): Promise<Blob> {
  return cropImageToAspect(file, 5, 2, 1200);
}

export type CropTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

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
  const aspect = aspectWidth / aspectHeight;
  let cropW = viewportW;
  let cropH = viewportH;
  if (viewportW / viewportH > aspect) {
    cropW = viewportH * aspect;
  } else {
    cropH = viewportW / aspect;
  }
  const cropLeft = (viewportW - cropW) / 2;
  const cropTop = (viewportH - cropH) / 2;

  const outW = Math.min(maxWidth, Math.round(cropW));
  const outH = Math.round(outW / aspect);

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

  const sx = ((cropLeft - imgLeft) / scale) * (outW / cropW);
  const sy = ((cropTop - imgTop) / scale) * (outH / cropH);
  const sWidth = (cropW / scale) * (outW / cropW);
  const sHeight = (cropH / scale) * (outH / cropH);

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outW, outH);
  return canvasToJpegBlob(canvas, 0.88);
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
