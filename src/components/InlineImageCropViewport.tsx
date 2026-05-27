import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ImageCropErrorFallback } from "@/components/ImageCropErrorFallback";
import {
  blobToDataUrl,
  exportCropFromTransform,
  fileToObjectUrl,
  computeInitialCropScale,
  getCenteredCropRect,
  loadImageFromUrl,
  type CropTransform,
} from "@/lib/image-crop";

export type InlineImageCropHandle = {
  exportCrop: () => Promise<{ blob: Blob; previewUrl: string } | null>;
  isReady: () => boolean;
};

type InitialFit = "contain" | "cover";

type Props = {
  file: File;
  aspectWidth: number;
  aspectHeight: number;
  /** contain：完整顯示（大頭照）；cover：填滿裁切框（封面） */
  initialFit?: InitialFit;
  /** 初始縮放留白（contain 預設 0.95、cover 預設 1.0） */
  fitPadding?: number;
  exportMaxWidth?: number;
  showCropGuide?: boolean;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
};

const MIN_SCALE = 0.2;
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
    const pointersRef = useRef(new Map<number, PointerPoint>());
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [transform, setTransform] = useState<CropTransform>({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

    const commitTransform = useCallback((next: CropTransform) => {
      transformRef.current = next;
      setTransform(next);
    }, []);

    const computeInitialScale = useCallback(
      (img: HTMLImageElement, vpW: number, vpH: number) => {
        const { cropW, cropH } = getCenteredCropRect(vpW, vpH, aspectWidth, aspectHeight);
        const scale = computeInitialCropScale(img.naturalWidth, img.naturalHeight, cropW, cropH, {
          fit: initialFit,
          padding: fitPadding,
        });
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
        onReadyChange?.(true);
      },
      [computeInitialScale, commitTransform, onReadyChange],
    );

    const syncViewport = useCallback(() => {
      const vp = viewportRef.current;
      const img = imgRef.current;
      if (!vp || !img) return;

      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w < 8 || h < 8) return;

      const key = `${w}x${h}`;
      const sizeChanged = key !== lastViewportKeyRef.current;
      lastViewportKeyRef.current = key;

      if (!userAdjustedRef.current && (sizeChanged || !readyRef.current)) {
        applyFitTransform(img, w, h);
      }
    }, [applyFitTransform]);

    useEffect(() => {
      userAdjustedRef.current = false;
      readyRef.current = false;
      lastViewportKeyRef.current = "";
      pointersRef.current.clear();
      dragRef.current = null;
      pinchRef.current = null;
      setReady(false);
      setLoadError(null);
      setImgSize(null);
      onReadyChange?.(false);

      const url = fileToObjectUrl(file);
      setPreviewUrl(url);

      let resizeObserver: ResizeObserver | undefined;
      let cancelled = false;

      loadImageFromUrl(url)
        .then((img) => {
          if (cancelled) return;
          imgRef.current = img;
          setImgSize({ w: img.naturalWidth, h: img.naturalHeight });

          requestAnimationFrame(() => {
            requestAnimationFrame(syncViewport);
          });

          const vp = viewportRef.current;
          if (vp) {
            resizeObserver = new ResizeObserver(() => syncViewport());
            resizeObserver.observe(vp);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : "圖片載入失敗";
          setLoadError(msg);
          readyRef.current = false;
          setReady(false);
          onReadyChange?.(false);
        });

      return () => {
        cancelled = true;
        resizeObserver?.disconnect();
        URL.revokeObjectURL(url);
        imgRef.current = null;
      };
    }, [file, syncViewport, onReadyChange]);

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
