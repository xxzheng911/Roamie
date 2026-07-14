/**
 * Downscale blobs for display cache — keep originals for remote/upload separately.
 */

const AVATAR_MAX_EDGE = 320;
const COVER_MAX_EDGE = 1200;

function loadImageBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

export async function downscaleImageBlob(
  blob: Blob,
  maxEdge: number,
  quality = 0.85,
): Promise<Blob> {
  try {
    const source = await loadImageBitmap(blob);
    const w =
      "width" in source ? source.width : (source as HTMLImageElement).naturalWidth;
    const h =
      "height" in source ? source.height : (source as HTMLImageElement).naturalHeight;
    if (!w || !h || Math.max(w, h) <= maxEdge) {
      if ("close" in source && typeof source.close === "function") source.close();
      return blob;
    }
    const scale = maxEdge / Math.max(w, h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if ("close" in source && typeof source.close === "function") source.close();
      return blob;
    }
    ctx.drawImage(source as CanvasImageSource, 0, 0, tw, th);
    if ("close" in source && typeof source.close === "function") source.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    return out && out.size > 0 ? out : blob;
  } catch {
    return blob;
  }
}

export function displayMaxEdgeForKind(kind: "avatar" | "cover" | "trip-cover"): number {
  if (kind === "avatar") return AVATAR_MAX_EDGE;
  return COVER_MAX_EDGE;
}
