import { useRef, type ImgHTMLAttributes } from "react";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import { usePlaceImage } from "@/hooks/use-place-image";
import { useInViewport } from "@/hooks/use-in-viewport";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";

type Props = PlaceImageInput &
  ImgHTMLAttributes<HTMLImageElement> & {
    initialUrl?: string | null;
    className?: string;
    imgClassName?: string;
    alt?: string;
    /** 跳過 viewport 偵測，立即載入 */
    priority?: boolean;
    /** 進入 viewport 才載入（預設 true） */
    lazy?: boolean;
    perfPage?: string;
  };

/** 附近地點卡片圖：Google → Unsplash → Roamie 預設；viewport lazy */
export function PlaceImage({
  initialUrl,
  className,
  imgClassName,
  alt = "",
  priority = false,
  lazy = true,
  perfPage,
  ...input
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInViewport(containerRef, {
    disabled: priority || !lazy,
    rootMargin: "80px",
  });
  const shouldLoad = priority || !lazy || inView;
  const fallbackSrc = getRoamieDefaultImage(input.categoryId ?? input.category);

  const { url, loading } = usePlaceImage({
    ...input,
    initialUrl,
    enabled: shouldLoad,
    perfPage,
  });
  const safeUrl = preferJpegPngImageUrl(url);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full", className)}>
      {!shouldLoad ? (
        <FadeInImage
          src={null}
          fallbackSrc={fallbackSrc}
          alt={alt}
          loading={false}
          className="h-full w-full"
          imgClassName={imgClassName}
        />
      ) : (
        <FadeInImage
          src={safeUrl}
          fallbackSrc={fallbackSrc}
          alt={alt}
          loading={loading}
          className="h-full w-full"
          imgClassName={imgClassName}
        />
      )}
    </div>
  );
}
