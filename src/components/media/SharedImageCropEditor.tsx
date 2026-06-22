import { useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logAvatarApplyPressed, logAvatarCropResult } from "@/lib/avatar-upload-log";
import {
  InlineImageCropViewport,
  type InlineImageCropHandle,
} from "@/components/InlineImageCropViewport";
import type { CenteredCropRect, CropTransform } from "@/lib/image-crop";
import {
  IMAGE_CROP_VARIANTS,
  type ImageCropVariant,
} from "@/lib/image-crop-variants";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

export type { ImageCropVariant };

type Props = {
  open: boolean;
  file: File | null;
  variant: ImageCropVariant;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob, transform?: CropTransform) => void | Promise<void>;
  applying?: boolean;
  cancelLabel?: string;
  doneLabel?: string;
  initialTransform?: CropTransform | null;
  sheetClassName?: string;
  overlayClassName?: string;
  gestureLogPrefix?: string;
};

/**
 * 共用圖片裁切編輯器：個人頁頭像、個人頁封面、行程封面。
 * LINE 風格全螢幕拖曳縮放 + 遮罩標示裁切範圍。
 */
export function SharedImageCropEditor({
  open,
  file,
  variant,
  onOpenChange,
  onConfirm,
  applying = false,
  cancelLabel = "取消",
  doneLabel = "完成",
  initialTransform = null,
  sheetClassName,
  overlayClassName,
  gestureLogPrefix,
}: Props) {
  const cropRef = useRef<InlineImageCropHandle>(null);
  const viewportWrapRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const [cropFrame, setCropFrame] = useState<CenteredCropRect | null>(null);
  const config = IMAGE_CROP_VARIANTS[variant];

  useLayoutEffect(() => {
    if (!open || !file) {
      setCropFrame(null);
      return;
    }

    let observer: ResizeObserver | undefined;
    let rafId = 0;
    let cancelled = false;

    const bind = () => {
      if (cancelled) return;
      const viewport = viewportWrapRef.current;
      const mask = maskRef.current;
      if (!viewport || !mask) {
        rafId = requestAnimationFrame(bind);
        return;
      }

      const sync = () => {
        const vpRect = viewport.getBoundingClientRect();
        const maskRect = mask.getBoundingClientRect();
        if (maskRect.width < 8 || maskRect.height < 8) return;
        setCropFrame({
          cropW: maskRect.width,
          cropH: maskRect.height,
          cropLeft: maskRect.left - vpRect.left,
          cropTop: maskRect.top - vpRect.top,
        });
      };

      sync();
      observer = new ResizeObserver(sync);
      observer.observe(viewport);
      observer.observe(mask);
    };

    bind();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [open, file, variant]);

  const handleDone = async () => {
    if (variant === "avatar") {
      logAvatarApplyPressed();
    }
    try {
      if (!cropRef.current?.isReady()) {
        toast.error("圖片尚未載入完成，請稍候再按套用");
        return;
      }
      const result = await cropRef.current.exportCrop();
      if (!result?.blob?.size) {
        logAvatarCropResult({ ok: false, reason: "empty_crop" });
        toast.error("無法產生裁切圖片，請調整後再試");
        return;
      }
      logAvatarCropResult({
        ok: true,
        bytes: result.blob.size,
        type: result.blob.type,
        previewLength: result.previewUrl?.length ?? 0,
      });
      if (gestureLogPrefix && result.transform) {
        const t = result.transform;
        console.info(`${gestureLogPrefix} scale=${t.scale} x=${t.offsetX} y=${t.offsetY}`);
      }
      await onConfirm(result.blob, result.transform);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知錯誤";
      console.error("[SharedImageCropEditor] confirm failed", e);
      toast.error(variant === "avatar" ? `頭像更新失敗：${msg}` : `封面更新失敗：${msg}`);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!applying) onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        overlayClassName={overlayClassName}
        className={cn(
          "flex h-[92dvh] max-h-[92dvh] flex-col gap-0 rounded-t-[1.75rem] border-0 bg-[#121110] p-0 text-white [&>button]:hidden",
          sheetClassName,
        )}
      >
        <SheetTitle className="sr-only">{config.title}</SheetTitle>
        <SheetDescription className="sr-only">{config.hint}</SheetDescription>

        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <button
            type="button"
            disabled={applying}
            onClick={() => onOpenChange(false)}
            className="min-w-[3rem] text-left text-[15px] text-white/90 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <p className="font-display text-[15px] text-white">{config.title}</p>
          <button
            type="button"
            disabled={applying}
            onClick={() => void handleDone()}
            className="flex min-w-[3rem] items-center justify-end text-[15px] font-semibold text-white disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : doneLabel}
          </button>
        </header>

        <div
          ref={viewportWrapRef}
          className="relative min-h-[min(52dvh,28rem)] flex-1 basis-0 overflow-hidden"
        >
          {file && open ? (
            <InlineImageCropViewport
              key={`${variant}-${file.name}-${file.lastModified}`}
              ref={cropRef}
              file={file}
              aspectWidth={config.aspectWidth}
              aspectHeight={config.aspectHeight}
              initialFit={config.initialFit}
              fitPadding={config.fitPadding}
              exportMaxWidth={config.exportMaxWidth}
              exportQuality={config.exportQuality}
              showCropGuide={false}
              initialTransform={initialTransform}
              cropFrame={cropFrame}
              gestureLogPrefix={gestureLogPrefix}
              className="h-full w-full bg-[#121110]"
            />
          ) : null}

          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4"
            aria-hidden
          >
            <div
              ref={maskRef}
              className={`${config.maskClass} shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]`}
            />
          </div>

          <p className="pointer-events-none absolute inset-x-0 bottom-5 z-20 text-center text-[13px] text-white/55">
            {config.hint}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
