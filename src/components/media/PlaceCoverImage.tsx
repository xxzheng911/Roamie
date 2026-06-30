import { useRef, type ImgHTMLAttributes } from "react";
import { useInViewport } from "@/hooks/use-in-viewport";
import { usePlaceCoverImage } from "@/hooks/use-place-cover-image";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import type { PlaceImageInput } from "@/services/placeImageService";
import { cn } from "@/lib/utils";

type Props = PlaceImageInput &
  ImgHTMLAttributes<HTMLImageElement> & {
    url?: string | null;
    maxWidth?: number;
    imgClassName?: string;
    /** 跳過 viewport 偵測，立即載入（例如第一張卡） */
    priority?: boolean;
    /** 進入 viewport 才開始載入遠端圖（預設 true） */
    lazy?: boolean;
  };

/** 探索／首頁／收藏共用地點封面：Google URL 直載 + viewport lazy + onError fallback */
export function PlaceCoverImage({
  url,
  photoName,
  maxWidth,
  priority = false,
  lazy = true,
  className,
  imgClassName,
  alt = "",
  ...placeInput
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInViewport(containerRef, {
    disabled: priority || !lazy,
    rootMargin: "80px",
  });
  const shouldLoad = priority || !lazy || inView;
  const placeholder = getRoamieDefaultImage(placeInput.categoryId ?? placeInput.category);

  const { src, onError, loading } = usePlaceCoverImage({
    url,
    photoName,
    maxWidth,
    enabled: shouldLoad,
    ...placeInput,
  });

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden bg-secondary", className)}>
      {!shouldLoad ? (
        <img
          src={placeholder}
          alt=""
          aria-hidden
          draggable={false}
          className={cn("h-full w-full object-cover opacity-70", imgClassName)}
        />
      ) : (
        <>
          {loading ? (
            <div className="absolute inset-0 animate-pulse bg-secondary/80" aria-hidden />
          ) : null}
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={onError}
            className={cn("h-full w-full object-cover", loading && "opacity-0", imgClassName)}
          />
        </>
      )}
    </div>
  );
}
