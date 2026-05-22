import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  blobToDataUrl,
  exportCropFromTransform,
  fileToObjectUrl,
  loadImageFromUrl,
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
  className?: string;
  onReadyChange?: (ready: boolean) => void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export const InlineImageCropViewport = forwardRef<InlineImageCropHandle, Props>(
  function InlineImageCropViewport(
    { file, aspectWidth, aspectHeight, className = "", onReadyChange },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [ready, setReady] = useState(false);
    const [transform, setTransform] = useState<CropTransform>({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

    useEffect(() => {
      setReady(false);
      onReadyChange?.(false);
      const url = fileToObjectUrl(file);
      loadImageFromUrl(url)
        .then((img) => {
          imgRef.current = img;
          const vp = viewportRef.current;
          if (vp && vp.clientWidth > 0 && vp.clientHeight > 0) {
            const aspect = aspectWidth / aspectHeight;
            const vpAspect = vp.clientWidth / vp.clientHeight;
            const baseScale =
              vpAspect > aspect
                ? vp.clientHeight / img.naturalHeight
                : vp.clientWidth / img.naturalWidth;
            setTransform({
              scale: Math.max(baseScale * 1.05, MIN_SCALE),
              offsetX: 0,
              offsetY: 0,
            });
          }
          setReady(true);
          onReadyChange?.(true);
        })
        .catch(() => {
          setReady(false);
          onReadyChange?.(false);
        });
      return () => URL.revokeObjectURL(url);
    }, [file, aspectWidth, aspectHeight, onReadyChange]);

    const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

    const onPointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: transform.offsetX,
        oy: transform.offsetY,
      };
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      setTransform((t) => ({
        ...t,
        offsetX: dragRef.current!.ox + (e.clientX - dragRef.current!.x),
        offsetY: dragRef.current!.oy + (e.clientY - dragRef.current!.y),
      }));
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    const onWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setTransform((t) => ({ ...t, scale: clampScale(t.scale * (1 + delta)) }));
    };

    const onTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { dist: Math.hypot(dx, dy), scale: transform.scale };
      }
    };

    const onTouchMove = (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchRef.current.dist;
        setTransform((t) => ({
          ...t,
          scale: clampScale(pinchRef.current!.scale * ratio),
        }));
      }
    };

    const onTouchEnd = () => {
      pinchRef.current = null;
    };

    const exportCrop = useCallback(async () => {
      const img = imgRef.current;
      const vp = viewportRef.current;
      if (!img || !vp || !ready) return null;
      const blob = await exportCropFromTransform(
        img,
        vp.clientWidth,
        vp.clientHeight,
        transform,
        aspectWidth,
        aspectHeight,
      );
      const previewUrl = await blobToDataUrl(blob);
      return { blob, previewUrl };
    }, [transform, aspectWidth, aspectHeight, ready]);

    useImperativeHandle(ref, () => ({
      exportCrop,
      isReady: () => ready,
    }));

    return (
      <div
        ref={viewportRef}
        className={`overflow-hidden bg-black touch-none ${className}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {ready && imgRef.current && (
          <img
            src={imgRef.current.src}
            alt=""
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              transform: `translate(calc(-50% + ${transform.offsetX}px), calc(-50% + ${transform.offsetY}px)) scale(${transform.scale})`,
              transformOrigin: "center center",
            }}
            draggable={false}
          />
        )}
        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80" />
      </div>
    );
  },
);
