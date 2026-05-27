import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logAvatarApplyPressed, logAvatarCropResult } from "@/lib/avatar-upload-log";
import {
  InlineImageCropViewport,
  type InlineImageCropHandle,
} from "@/components/InlineImageCropViewport";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

export type ProfileImageCropVariant = "avatar" | "cover";

type Props = {
  open: boolean;
  file: File | null;
  variant: ProfileImageCropVariant;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
  applying?: boolean;
  cancelLabel?: string;
  doneLabel?: string;
};

const VARIANT_CONFIG: Record<
  ProfileImageCropVariant,
  {
    title: string;
    hint: string;
    aspectWidth: number;
    aspectHeight: number;
    initialFit: "contain" | "cover-line";
    fitPadding: number;
    exportMaxWidth: number;
    maskClass: string;
  }
> = {
  avatar: {
    title: "移動與縮放",
    hint: "單指拖曳、雙指縮放",
    aspectWidth: 1,
    aspectHeight: 1,
    /** 完整顯示主體 + 四周留白（勿用 cover，會一進場就過度放大） */
    initialFit: "contain",
    fitPadding: 0.86,
    exportMaxWidth: 512,
    maskClass:
      "aspect-square w-[min(92vw,34rem)] max-h-[min(78dvh,34rem)] rounded-full ring-2 ring-white/90",
  },
  cover: {
    title: "調整封面",
    hint: "單指拖曳、雙指縮放",
    /** 與 ProfileCover aspect-[3/2] 一致 */
    aspectWidth: 3,
    aspectHeight: 2,
    /** LINE 風格：fit-to-width / contain，勿用 cover 填滿 */
    initialFit: "cover-line",
    fitPadding: 0.94,
    exportMaxWidth: 1024,
    maskClass:
      "aspect-[3/2] w-[min(calc(100vw-2rem),40rem)] max-h-[min(42dvh,18rem)] rounded-md ring-2 ring-white/90",
  },
};

/** LINE / Instagram 風格：全螢幕大區域拖曳縮放，遮罩標示裁切範圍 */
export function ProfileImageCropSheet({
  open,
  file,
  variant,
  onOpenChange,
  onConfirm,
  applying = false,
  cancelLabel = "取消",
  doneLabel = "完成",
}: Props) {
  const cropRef = useRef<InlineImageCropHandle>(null);
  const config = VARIANT_CONFIG[variant];

  const handleDone = async () => {
    if (variant === "avatar") {
      logAvatarApplyPressed();
    }
    try {
      if (!cropRef.current?.isReady()) {
        toast.error("圖片尚未載入完成，請稍候再按套用");
        return;
      }
      const result = await cropRef.current?.exportCrop();
      if (!result?.blob?.size) {
        logAvatarCropResult({ ok: false, reason: "empty_crop" });
        toast.error(
          variant === "avatar"
            ? "無法產生裁切圖片，請調整後再試"
            : "無法產生裁切圖片，請調整後再試",
        );
        return;
      }
      logAvatarCropResult({
        ok: true,
        bytes: result.blob.size,
        type: result.blob.type,
        previewLength: result.previewUrl?.length ?? 0,
      });
      await onConfirm(result.blob);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知錯誤";
      console.error("[ProfileImageCropSheet] confirm failed", e);
      toast.error(
        variant === "avatar" ? `頭像更新失敗：${msg}` : `封面更新失敗：${msg}`,
      );
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
        className="flex h-[92dvh] max-h-[92dvh] flex-col gap-0 rounded-t-[1.75rem] border-0 bg-[#121110] p-0 text-white [&>button]:hidden"
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

        <div className="relative min-h-0 flex-1 basis-0 overflow-hidden">
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
              showCropGuide={false}
              className="h-full w-full bg-[#121110]"
            />
          ) : null}

          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4"
            aria-hidden
          >
            <div
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
