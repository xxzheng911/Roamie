import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ImageCropErrorFallback } from "@/components/ImageCropErrorFallback";
import {
  blobToDataUrl,
  exportCropFromTransform,
  prepareImageForCropEditor,
  loadImageFromUrl,
  fileToObjectUrl,
  computeCoverMinimumCropScale,
  computeInitialCropScale,
  resolveCropRect,
  type CenteredCropRect,
  type CropInitialFit,
  type CropTransform,
} from "@/lib/image-crop";

export type InlineImageCropHandle = {
  exportCrop: () => Promise<{
    blob: Blob;
    previewUrl: string;
    transform: CropTransform;
  } | null>;
  getTransform: () => CropTransform;
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
  exportQuality?: number;
  showCropGuide?: boolean;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
  /** 還原先前儲存的裁切構圖 */
  initialTransform?: CropTransform | null;
  /** 與 SharedImageCropEditor 遮罩對齊的裁切框（螢幕座標相對 viewport） */
  cropFrame?: CenteredCropRect | null;
  /** 為 true 時須等 cropFrame 量測完成再套用初始構圖 */
  measureCropFrame?: boolean;
  /** 例如 [TRIP_COVER_EDITOR]，輸出手勢 debug log */
  gestureLogPrefix?: string;
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
      exportQuality = 0.82,
      showCropGuide = true,
      className = "",
      onReadyChange,
      initialTransform = null,
      cropFrame = null,
      measureCropFrame = false,
      gestureLogPrefix,
    },
    ref,
  ) {
    const initialTransformRef = useRef(initialTransform);
    initialTransformRef.current = initialTransform;
    const cropFrameRef = useRef(cropFrame);
    cropFrameRef.current = cropFrame;
    const measureCropFrameRef = useRef(measureCropFrame);
    measureCropFrameRef.current = measureCropFrame;
    const gestureLogPrefixRef = useRef(gestureLogPrefix);
    gestureLogPrefixRef.current = gestureLogPrefix;
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
    const pointerGestureRef = useRef(false);
    const onReadyChangeRef = useRef(onReadyChange);
    onReadyChangeRef.current = onReadyChange;

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [preparing, setPreparing] = useState(true);
    const [ready, setReady] = useState(false);
    const [transform, setTransform] = useState<CropTransform>({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(minScaleRef.current, s));

    const getActiveCropRect = useCallback(
      (vpW: number, vpH: number): CenteredCropRect =>
        resolveCropRect(vpW, vpH, aspectWidth, aspectHeight, cropFrameRef.current),
      [aspectWidth, aspectHeight],
    );

    const clampTransformToBounds = useCallback(
      (next: CropTransform): CropTransform => {
        if (initialFit !== "cover-line") return next;
        const vp = viewportSizeRef.current;
        const imgNat = imgNatSizeRef.current;
        if (!vp || !imgNat) return next;

        const { cropW, cropH, cropLeft, cropTop } = getActiveCropRect(vp.w, vp.h);

        const scale = clampScale(next.scale);
        const imgW = imgNat.w * scale;
        const imgH = imgNat.h * scale;
        const baseLeft = (vp.w - imgW) / 2;
        const baseTop = (vp.h - imgH) / 2;

        // Ensure crop rect always covered by image (no black edges)
        const minOffsetX = cropLeft + cropW - (baseLeft + imgW);
        const maxOffsetX = cropLeft - baseLeft;
        const minOffsetY = cropTop + cropH - (baseTop + imgH);
        const maxOffsetY = cropTop - baseTop;

        const clampedX = Math.min(maxOffsetX, Math.max(minOffsetX, next.offsetX));
        const clampedY = Math.min(maxOffsetY, Math.max(minOffsetY, next.offsetY));

        if (clampedX !== next.offsetX || clampedY !== next.offsetY) {
          console.info("[Cover Black Edge Prevented]", {
            crop: { cropW, cropH, cropLeft, cropTop },
            img: { imgW, imgH, scale },
            offset: {
              before: { x: next.offsetX, y: next.offsetY },
              after: { x: clampedX, y: clampedY },
            },
          });
        }

        return { scale, offsetX: clampedX, offsetY: clampedY };
      },
      [initialFit, getActiveCropRect, clampScale],
    );

    const commitTransform = useCallback(
      (next: CropTransform, gesture?: "pan" | "pinch" | "wheel") => {
        const prev = transformRef.current;
        const clamped = clampTransformToBounds(next);
        transformRef.current = clamped;
        setTransform(clamped);
        const prefix = gestureLogPrefixRef.current;
        if (!prefix || !gesture) return;
        if (
          gesture === "pan" &&
          (clamped.offsetX !== prev.offsetX || clamped.offsetY !== prev.offsetY)
        ) {
          console.info(`${prefix} pan x=${clamped.offsetX} y=${clamped.offsetY}`);
        }
        if (gesture === "pinch" && clamped.scale !== prev.scale) {
          console.info(`${prefix} scale=${clamped.scale}`);
        }
        if (gesture === "wheel" && clamped.scale !== prev.scale) {
          console.info(`${prefix} scale=${clamped.scale}`);
        }
      },
      [clampTransformToBounds],
    );

    const computeInitialScale = useCallback(
      (img: HTMLImageElement, vpW: number, vpH: number) => {
        const { cropW, cropH } = getActiveCropRect(vpW, vpH);
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
      [initialFit, fitPadding, getActiveCropRect, clampScale],
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
        if (gestureLogPrefixRef.current) {
          console.info(`${gestureLogPrefixRef.current} viewport ready scale=${next.scale}`);
        }
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
        const saved = initialTransformRef.current;
        if (saved && !readyRef.current) {
          userAdjustedRef.current = true;
          commitTransform(saved);
          readyRef.current = true;
          setReady(true);
          onReadyChangeRef.current?.(true);
        } else {
          applyFitTransform(img, w, h);
        }
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
      pointerGestureRef.current = false;
      setPreparing(true);
      setReady(false);
      setLoadError(null);
      setImgSize(null);
      setPreviewUrl(null);
      onReadyChangeRef.current?.(false);

      let resizeObserver: ResizeObserver | undefined;
      let cancelled = false;
      let previewObjectUrl: string | null = null;

      const loadPrepared = async () => {
        const prefix = gestureLogPrefixRef.current;
        if (file.type === "image/jpeg" && file.size > 0) {
          const url = fileToObjectUrl(file);
          try {
            const img = await loadImageFromUrl(url);
            return {
              file,
              objectUrl: url,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };
          } catch {
            URL.revokeObjectURL(url);
          }
        }
        return { ...(await prepareImageForCropEditor(file, { logPrefix: prefix })) };
      };

      void loadPrepared()
        .then(async (prepared) => {
          if (cancelled) {
            URL.revokeObjectURL(prepared.objectUrl);
            return;
          }
          previewObjectUrl = prepared.objectUrl;
          setPreviewUrl(prepared.objectUrl);
          const img = await loadImageFromUrl(prepared.objectUrl);
          if (cancelled) return;
          imgRef.current = img;
          imgNatSizeRef.current = { w: prepared.width, h: prepared.height };
          setImgSize({ w: prepared.width, h: prepared.height });
          setPreparing(false);
          if (gestureLogPrefixRef.current) {
            console.info(`${gestureLogPrefixRef.current} ready w=${prepared.width} h=${prepared.height}`);
          }

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
          if (gestureLogPrefixRef.current) {
            console.info(`${gestureLogPrefixRef.current} decode failed`, msg);
          }
          setLoadError(msg);
          setPreparing(false);
          readyRef.current = false;
          setReady(false);
          onReadyChangeRef.current?.(false);
        });

      return () => {
        cancelled = true;
        resizeObserver?.disconnect();
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        imgRef.current = null;
        imgNatSizeRef.current = null;
      };
    }, [file]);

    useEffect(() => {
      const vp = viewportRef.current;
      const img = imgRef.current;
      if (!vp || !img) return;
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w < 8 || h < 8) return;
      viewportSizeRef.current = { w, h };

      if (userAdjustedRef.current) {
        commitTransform(transformRef.current, undefined);
        return;
      }

      if (!readyRef.current) {
        const saved = initialTransformRef.current;
        if (saved) {
          userAdjustedRef.current = true;
          commitTransform(saved, undefined);
          readyRef.current = true;
          setReady(true);
          onReadyChangeRef.current?.(true);
          return;
        }
        applyFitTransform(img, w, h);
        return;
      }

      if (cropFrame) {
        commitTransform(transformRef.current, undefined);
      }
    }, [cropFrame, imgSize, applyFitTransform, commitTransform]);

    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;

      const blockNativeGestures = (event: TouchEvent) => {
        if (event.touches.length >= 2) {
          event.preventDefault();
        }
      };

      el.addEventListener("touchmove", blockNativeGestures, { passive: false });
      return () => el.removeEventListener("touchmove", blockNativeGestures);
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
      pointerGestureRef.current = true;
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
        commitTransform(
          {
            ...transformRef.current,
            scale: clampScale(pinchRef.current.scale * ratio),
          },
          "pinch",
        );
        return;
      }

      const drag = dragRef.current;
      if (!drag || pointersRef.current.size !== 1) return;

      e.preventDefault();
      commitTransform(
        {
          ...transformRef.current,
          offsetX: drag.ox + (e.clientX - drag.x),
          offsetY: drag.oy + (e.clientY - drag.y),
        },
        "pan",
      );
    };

    const onPointerUp = (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);

      if (pointersRef.current.size === 0) {
        pointerGestureRef.current = false;
      }

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
      commitTransform(
        {
          ...transformRef.current,
          scale: clampScale(transformRef.current.scale * (1 + delta)),
        },
        "wheel",
      );
    };

    const touchDistance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const supportsPointerEvents =
      typeof window !== "undefined" && "PointerEvent" in window;

    const onTouchStart = (e: React.TouchEvent) => {
      if (supportsPointerEvents && pointerGestureRef.current) return;
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
      if (supportsPointerEvents && pointerGestureRef.current) return;
      if (!readyRef.current || loadError) return;
      if (e.touches.length >= 2 && touchPinchRef.current) {
        e.preventDefault();
        const dist = touchDistance(e.touches[0], e.touches[1]);
        if (dist < 1) return;
        const ratio = dist / touchPinchRef.current.dist;
        commitTransform(
          {
            ...transformRef.current,
            scale: clampScale(touchPinchRef.current.scale * ratio),
          },
          "pinch",
        );
        return;
      }
      if (e.touches.length === 1 && touchDragRef.current) {
        e.preventDefault();
        const t = e.touches[0];
        const drag = touchDragRef.current;
        commitTransform(
          {
            ...transformRef.current,
            offsetX: drag.ox + (t.clientX - drag.x),
            offsetY: drag.oy + (t.clientY - drag.y),
          },
          "pan",
        );
      }
    };

    const onTouchEnd = (e: React.TouchEvent) => {
      if (supportsPointerEvents && pointerGestureRef.current) return;
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
          cropFrameRef.current,
          exportQuality,
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
        return { blob, previewUrl: preview, transform: { ...transformRef.current } };
      } catch (e) {
        console.error("[Avatar Crop] export failed", e);
        return null;
      }
    }, [aspectWidth, aspectHeight, exportMaxWidth, exportQuality, loadError]);

    useImperativeHandle(ref, () => ({
      exportCrop,
      getTransform: () => ({ ...transformRef.current }),
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="h-5 w-5 animate-pulse rounded-full bg-muted-foreground/30" />
            {preparing ? (
              <span className="text-xs text-muted-foreground/80">準備圖片中…</span>
            ) : null}
          </div>
        ) : null}

        {showCropGuide && !loadError ? (
          <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80" />
        ) : null}
      </div>
    );
  },
);
