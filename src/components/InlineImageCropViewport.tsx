import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ImageCropErrorFallback } from "@/components/ImageCropErrorFallback";
import {
  blobToDataUrl,
  exportCropFromTransform,
  fileToObjectUrl,
  computeCoverMinimumCropScale,
  computeInitialCropScale,
  getCenteredCropRect,
  loadImageFromUrl,
  type CropInitialFit,
  type CropTransform,
} from "@/lib/image-crop";

export type InlineImageCropHandle = {
  exportCrop: () => Promise<{ blob: Blob; previewUrl: string } | null>;
  isReady: () => boolean;
};

type Props = {
  file: File;
  aspectWidth: number;
  aspectHeight: number;
  /** contain：頭像；cover-line：橫向封面（LINE 邏輯） */
  initialFit?: CropInitialFit;
  /** 初始縮放留白（contain 預設 0.95、cover 預設 1.0） */
  fitPadding?: number;
  exportMaxWidth?: number;
  showCropGuide?: boolean;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
};

const DEFAULT_MIN_SCALE = 0.2;
const MAX_SCALE = 5;

type PointerPoint = { x: number; y: number };

export const InlineImageCropViewport = forwardRef<InlineImageCropHandle, Props>(
  function InlineImageCropViewport(
    {
      file,
      aspectWidth,
      aspectHeight,
      initialFit = "contain",
      fitPadding,
      exportMaxWidth = 1200,
      showCropGuide = true,
      className = "",
      onReadyChange,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const userAdjustedRef = useRef(false);
    const readyRef = useRef(false);
    const lastViewportKeyRef = useRef("");
    const transformRef = useRef<CropTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
    const minScaleRef = useRef(DEFAULT_MIN_SCALE);
    const viewportSizeRef = useRef<{ w: number; h: number } | null>(null);
    const imgNatSizeRef = useRef<{ w: number; h: number } | null>(null);
    const pointersRef = useRef(new Map<number, PointerPoint>());
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
    const touchDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const touchPinchRef = useRef<{ dist: number; scale: number } | null>(null);
    const onReadyChangeRef = useRef(onReadyChange);
    onReadyChangeRef.current = onReadyChange;

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [transform, setTransform] = useState<CropTransform>({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(minScaleRef.current, s));

    const clampTransformToBounds = useCallback(
      (next: CropTransform): CropTransform => {
        if (initialFit !== "cover-line") return next;
        const vp = viewportSizeRef.current;
        const imgNat = imgNatSizeRef.current;
        if (!vp || !imgNat) return next;

        const { cropW, cropH, cropLeft, cropTop } = getCenteredCropRect(
          vp.w,
          vp.h,
          aspectWidth,
          aspectHeight,
        );

        let scale = clampScale(next.scale);
        let offsetX = next.offsetX;
        let offsetY = next.offsetY;

        const panBounds = (s: number) => {
          const imgW = imgNat.w * s;
          const imgH = imgNat.h * s;
          const baseLeft = (vp.w - imgW) / 2;
          const baseTop = (vp.h - imgH) / 2;
          return {
            minOffsetX: cropLeft + cropW - (baseLeft + imgW),
            maxOffsetX: cropLeft - baseLeft,
            minOffsetY: cropTop + cropH - (baseTop + imgH),
            maxOffsetY: cropTop - baseTop,
          };
        };

        // 縮放剛好貼齊裁切框時無法平移；略放大以保留單指拖曳空間
        for (let i = 0; i < 14; i++) {
          const { minOffsetX, maxOffsetX, minOffsetY, maxOffsetY } = panBounds(scale);
          const xOk = minOffsetX <= maxOffsetX;
          const yOk = minOffsetY <= maxOffsetY;
          if (xOk && yOk) {
            const clampedX = Math.min(maxOffsetX, Math.max(minOffsetX, offsetX));
            const clampedY = Math.min(maxOffsetY, Math.max(minOffsetY, offsetY));
            if (
              import.meta.env.DEV &&
              (clampedX !== offsetX || clampedY !== offsetY) &&
              i === 0
            ) {
              console.info("[Cover Black Edge Prevented]", {
                offset: {
                  before: { x: offsetX, y: offsetY },
                  after: { x: clampedX, y: clampedY },
                },
              });
            }
            return { scale, offsetX: clampedX, offsetY: clampedY };
          }
          scale = clampScale(scale * 1.04);
        }

        const { minOffsetX, maxOffsetX, minOffsetY, maxOffsetY } = panBounds(scale);
        return {
          scale,
          offsetX: Math.min(maxOffsetX, Math.max(minOffsetX, offsetX)),
          offsetY: Math.min(maxOffsetY, Math.max(minOffsetY, offsetY)),
        };
      },
      [initialFit, aspectWidth, aspectHeight, clampScale],
    );

    const commitTransform = useCallback(
      (next: CropTransform) => {
        const clamped = clampTransformToBounds(next);
        transformRef.current = clamped;
        setTransform(clamped);
      },
      [clampTransformToBounds],
    );

    const computeInitialScale = useCallback(
      (img: HTMLImageElement, vpW: number, vpH: number) => {
        const { cropW, cropH } = getCenteredCropRect(vpW, vpH, aspectWidth, aspectHeight);
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const scale = computeInitialCropScale(imgW, imgH, cropW, cropH, {
          fit: initialFit,
          padding: fitPadding,
        });
        if (initialFit === "cover-line") {
          minScaleRef.current = computeCoverMinimumCropScale(imgW, imgH, cropW, cropH);
          console.info("[Cover Min Zoom]", {
            minScale: minScaleRef.current,
            cropW,
            cropH,
            imgW,
            imgH,
          });
        } else {
          minScaleRef.current = DEFAULT_MIN_SCALE;
        }
        return clampScale(scale);
      },
      [initialFit, fitPadding, aspectWidth, aspectHeight],
    );

    const applyFitTransform = useCallback(
      (img: HTMLImageElement, vpW: number, vpH: number) => {
        const next = {
          scale: computeInitialScale(img, vpW, vpH),
          offsetX: 0,
          offsetY: 0,
        };
        commitTransform(next);
        readyRef.current = true;
        setReady(true);
        onReadyChangeRef.current?.(true);
      },
      [computeInitialScale, commitTransform],
    );

    const syncViewport = useCallback(() => {
      const vp = viewportRef.current;
      const img = imgRef.current;
      if (!vp || !img) return;

      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w < 8 || h < 8) return;
      viewportSizeRef.current = { w, h };

      const key = `${w}x${h}`;
      const sizeChanged = key !== lastViewportKeyRef.current;
      lastViewportKeyRef.current = key;

      if (!userAdjustedRef.current && (sizeChanged || !readyRef.current)) {
        applyFitTransform(img, w, h);
      }
    }, [applyFitTransform]);

    const syncViewportRef = useRef(syncViewport);
    syncViewportRef.current = syncViewport;

    useEffect(() => {
      userAdjustedRef.current = false;
      readyRef.current = false;
      minScaleRef.current = DEFAULT_MIN_SCALE;
      lastViewportKeyRef.current = "";
      pointersRef.current.clear();
      dragRef.current = null;
      pinchRef.current = null;
      touchDragRef.current = null;
      touchPinchRef.current = null;
      setReady(false);
      setLoadError(null);
      setImgSize(null);
      onReadyChangeRef.current?.(false);

      const url = fileToObjectUrl(file);

      let resizeObserver: ResizeObserver | undefined;
      let cancelled = false;

      loadImageFromUrl(url)
        .then((img) => {
          if (cancelled) return;
          imgRef.current = img;
          imgNatSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
          setImgSize({ w: img.naturalWidth, h: img.naturalHeight });

          let displayUrl = url;
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              displayUrl = canvas.toDataURL("image/jpeg", 0.92);
            }
          } catch {
            displayUrl = url;
          }
          setPreviewUrl(displayUrl);

          requestAnimationFrame(() => {
            requestAnimationFrame(() => syncViewportRef.current());
          });

          const vp = viewportRef.current;
          if (vp) {
            resizeObserver = new ResizeObserver(() => syncViewportRef.current());
            resizeObserver.observe(vp);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : "圖片載入失敗";
          setLoadError(msg);
          readyRef.current = false;
          setReady(false);
          onReadyChangeRef.current?.(false);
        });

      return () => {
        cancelled = true;
        resizeObserver?.disconnect();
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 400);
        imgRef.current = null;
        imgNatSizeRef.current = null;
        setPreviewUrl(null);
      };
    }, [file]);

    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;

      const blockNativeGestures = (event: TouchEvent) => {
        if (!readyRef.current) return;
        if (event.touches.length >= 1) {
          event.preventDefault();
        }
      };

      el.addEventListener("touchstart", blockNativeGestures, { passive: false });
      el.addEventListener("touchmove", blockNativeGestures, { passive: false });
      return () => {
        el.removeEventListener("touchstart", blockNativeGestures);
        el.removeEventListener("touchmove", blockNativeGestures);
      };
    }, []);

    const markUserAdjusted = () => {
      userAdjustedRef.current = true;
    };

    const pointerDistance = (points: Map<number, PointerPoint>) => {
      const pts = [...points.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const onPointerDown = (e: React.PointerEvent) => {
      if (!readyRef.current || loadError) return;
      e.preventDefault();
      markUserAdjusted();

      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 1) {
        pinchRef.current = null;
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          ox: transformRef.current.offsetX,
          oy: transformRef.current.offsetY,
        };
        return;
      }

      if (pointersRef.current.size === 2) {
        dragRef.current = null;
        pinchRef.current = {
          dist: pointerDistance(pointersRef.current),
          scale: transformRef.current.scale,
        };
      }
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size >= 2 && pinchRef.current) {
        e.preventDefault();
        const dist = pointerDistance(pointersRef.current);
        if (dist < 1) return;
        const ratio = dist / pinchRef.current.dist;
        commitTransform({
          ...transformRef.current,
          scale: clampScale(pinchRef.current.scale * ratio),
        });
        return;
      }

      const drag = dragRef.current;
      if (!drag || pointersRef.current.size !== 1) return;

      e.preventDefault();
      commitTransform({
        ...transformRef.current,
        offsetX: drag.ox + (e.clientX - drag.x),
        offsetY: drag.oy + (e.clientY - drag.y),
      });
    };

    const onPointerUp = (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);

      if (pointersRef.current.size === 1) {
        const point = [...pointersRef.current.values()][0];
        pinchRef.current = null;
        dragRef.current = {
          x: point.x,
          y: point.y,
          ox: transformRef.current.offsetX,
          oy: transformRef.current.offsetY,
        };
        return;
      }

      dragRef.current = null;
      pinchRef.current = null;
    };

    const onWheel = (e: React.WheelEvent) => {
      if (!readyRef.current || loadError) return;
      e.preventDefault();
      markUserAdjusted();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      commitTransform({
        ...transformRef.current,
        scale: clampScale(transformRef.current.scale * (1 + delta)),
      });
    };

    const touchDistance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onTouchStart = (e: React.TouchEvent) => {
      if (!readyRef.current || loadError) return;
      if (e.touches.length === 1) {
        markUserAdjusted();
        touchPinchRef.current = null;
        touchDragRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          ox: transformRef.current.offsetX,
          oy: transformRef.current.offsetY,
        };
        return;
      }
      if (e.touches.length >= 2) {
        e.preventDefault();
        markUserAdjusted();
        touchDragRef.current = null;
        touchPinchRef.current = {
          dist: touchDistance(e.touches[0], e.touches[1]),
          scale: transformRef.current.scale,
        };
      }
    };

    const onTouchMove = (e: React.TouchEvent) => {
      if (!readyRef.current || loadError) return;
      if (e.touches.length >= 2 && touchPinchRef.current) {
        e.preventDefault();
        const dist = touchDistance(e.touches[0], e.touches[1]);
        if (dist < 1) return;
        const ratio = dist / touchPinchRef.current.dist;
        commitTransform({
          ...transformRef.current,
          scale: clampScale(touchPinchRef.current.scale * ratio),
        });
        return;
      }
      if (e.touches.length === 1 && touchDragRef.current) {
        e.preventDefault();
        const t = e.touches[0];
        const drag = touchDragRef.current;
        commitTransform({
          ...transformRef.current,
          offsetX: drag.ox + (t.clientX - drag.x),
          offsetY: drag.oy + (t.clientY - drag.y),
        });
      }
    };

    const onTouchEnd = (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchPinchRef.current = null;
        touchDragRef.current = {
          x: t.clientX,
          y: t.clientY,
          ox: transformRef.current.offsetX,
          oy: transformRef.current.offsetY,
        };
        return;
      }
      touchDragRef.current = null;
      touchPinchRef.current = null;
    };

    const exportCrop = useCallback(async () => {
      const img = imgRef.current;
      const vp = viewportRef.current;
      if (!img || !vp) {
        console.warn("[Avatar Crop] export skipped — missing img or viewport");
        return null;
      }
      if (loadError) {
        console.warn("[Avatar Crop] export skipped — load error", loadError);
        return null;
      }
      if (!readyRef.current) {
        console.warn("[Avatar Crop] export skipped — viewport not ready");
        return null;
      }
      const vpW = vp.clientWidth;
      const vpH = vp.clientHeight;
      if (vpW < 8 || vpH < 8) {
        console.warn("[Avatar Crop] export skipped — viewport too small", { vpW, vpH });
        return null;
      }
      try {
        const blob = await exportCropFromTransform(
          img,
          vpW,
          vpH,
          transformRef.current,
          aspectWidth,
          aspectHeight,
          exportMaxWidth,
        );
        if (!blob.size) {
          console.warn("[Avatar Crop] export produced empty blob");
          return null;
        }
        let preview = "";
        try {
          preview = await blobToDataUrl(blob);
        } catch (e) {
          console.warn("[Avatar Crop] preview data url failed (non-fatal)", e);
        }
        return { blob, previewUrl: preview };
      } catch (e) {
        console.error("[Avatar Crop] export failed", e);
        return null;
      }
    }, [aspectWidth, aspectHeight, exportMaxWidth, loadError]);

    useImperativeHandle(ref, () => ({
      exportCrop,
      isReady: () => readyRef.current && !loadError,
    }));

    return (
      <div
        ref={viewportRef}
        className={`relative overflow-hidden touch-none select-none bg-secondary/80 ${className}`}
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {previewUrl && !loadError && imgSize ? (
          <img
            src={previewUrl}
            alt=""
            width={imgSize.w}
            height={imgSize.h}
            className={`pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none ${
              ready ? "opacity-100" : "opacity-70"
            }`}
            style={{
              transform: `translate(calc(-50% + ${transform.offsetX}px), calc(-50% + ${transform.offsetY}px)) scale(${transform.scale})`,
              transformOrigin: "center center",
            }}
            draggable={false}
          />
        ) : null}

        {loadError ? (
          <ImageCropErrorFallback message={loadError} className="absolute inset-0" />
        ) : null}

        {!ready && !loadError ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="h-5 w-5 animate-pulse rounded-full bg-muted-foreground/30" />
          </div>
        ) : null}

        {showCropGuide && !loadError ? (
          <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80" />
        ) : null}
      </div>
    );
  },
);
