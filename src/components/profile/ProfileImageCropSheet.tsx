import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
    initialFit: "contain" | "cover";
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
    initialFit: "cover",
    fitPadding: 1.02,
    exportMaxWidth: 512,
    maskClass:
      "aspect-square w-[min(100%,72dvh)] max-w-[min(100vw-2rem,22rem)] rounded-full ring-2 ring-white/90",
  },
  cover: {
    title: "調整封面",
    hint: "單指拖曳、雙指縮放",
    aspectWidth: 3,
    aspectHeight: 2,
    initialFit: "cover",
    fitPadding: 1.02,
    exportMaxWidth: 1024,
    maskClass:
      "aspect-[3/2] w-[min(100%,72dvh)] max-w-[min(100vw-2rem,26rem)] rounded-md ring-2 ring-white/90",
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
    try {
      const result = await cropRef.current?.exportCrop();
      if (!result) {
        toast.error(
          variant === "avatar" ? "頭像暫時更新失敗，請稍後再試。" : "封面暫時更新失敗，請稍後再試。",
        );
        return;
      }
      await onConfirm(result.blob);
    } catch {
      toast.error(
        variant === "avatar" ? "頭像暫時更新失敗，請稍後再試。" : "封面暫時更新失敗，請稍後再試。",
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
