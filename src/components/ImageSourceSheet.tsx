import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { isImagePickFile, normalizeImageFileForUpload } from "@/lib/image-crop";
import { unlockDocumentScrollForNativePicker } from "@/lib/native-image-picker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type PickSource = "library" | "camera";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPickFile: (file: File) => void;
  onRemove?: () => void;
  removing?: boolean;
  showRemove?: boolean;
  cameraFacing?: "user" | "environment";
  albumLabel?: string;
  cameraLabel?: string;
  sheetClassName?: string;
  overlayClassName?: string;
  sheetLogPrefix?: string;
  pickLogPrefix?: string;
};

/**
 * 圖片來源選擇（相簿 / 拍照）。
 * iOS：file input 掛在 body、先關閉 Sheet 再開原生選擇器。
 */
export function ImageSourceSheet({
  open,
  onOpenChange,
  title,
  onPickFile,
  onRemove,
  removing = false,
  showRemove = false,
  cameraFacing = "environment",
  albumLabel = "從相簿選取",
  cameraLabel = "拍照",
  sheetClassName,
  overlayClassName,
  sheetLogPrefix,
  pickLogPrefix,
}: Props) {
  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pendingSourceRef = useRef<PickSource | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (open && sheetLogPrefix) {
      console.info(`${sheetLogPrefix} open`);
    }
  }, [open, sheetLogPrefix]);

  useEffect(() => {
    if (open || !pendingSourceRef.current) return;

    const source = pendingSourceRef.current;
    pendingSourceRef.current = null;
    const input = source === "library" ? albumRef.current : cameraRef.current;

    const timer = window.setTimeout(() => {
      if (!input) {
        if (pickLogPrefix) {
          console.info(`${pickLogPrefix} input missing source=${source}`);
        }
        return;
      }
      const restoreScroll = unlockDocumentScrollForNativePicker();
      input.click();
      window.setTimeout(restoreScroll, 2000);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [open, pickLogPrefix]);

  const queuePick = (source: PickSource) => {
    if (pickLogPrefix) {
      console.info(`${pickLogPrefix} source=${source}`);
    }
    pendingSourceRef.current = source;
    onOpenChange(false);
  };

  const handleFile = async (file: File | undefined, source: PickSource) => {
    if (!file) {
      if (pickLogPrefix) {
        console.info(`${pickLogPrefix} cancelled source=${source}`);
      }
      return;
    }
    if (!isImagePickFile(file)) {
      toast.error("請選擇圖片檔案");
      return;
    }
    if (pickLogPrefix) {
      console.info(
        `${pickLogPrefix} selected source=${source}`,
        `image=${file.name}`,
        `bytes=${file.size}`,
      );
    }
    setPreparing(true);
    try {
      const normalized = await normalizeImageFileForUpload(file, { logPrefix: pickLogPrefix });
      onPickFile(normalized);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "圖片格式不支援，請改選 JPG 或 PNG";
      if (pickLogPrefix) {
        console.info(`${pickLogPrefix} normalize failed`, msg);
      }
      toast.error(msg);
    } finally {
      setPreparing(false);
    }
  };

  const pickerInputs =
    typeof document !== "undefined"
      ? createPortal(
          <>
            <input
              ref={albumRef}
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
              onChange={(e) => {
                void handleFile(e.target.files?.[0], "library");
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture={cameraFacing}
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
              onChange={(e) => {
                void handleFile(e.target.files?.[0], "camera");
                e.target.value = "";
              }}
            />
          </>,
          document.body,
        )
      : null;

  return (
    <>
      {pickerInputs}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          overlayClassName={overlayClassName}
          className={sheetClassName ?? "rounded-t-[1.75rem] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="font-display text-left text-base">{title}</SheetTitle>
          </SheetHeader>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={preparing}
              onClick={() => queuePick("library")}
              className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm disabled:opacity-50"
            >
              {preparing ? (
                <Loader2 className="h-5 w-5 animate-spin text-clay" />
              ) : (
                <ImageIcon className="h-5 w-5 text-clay" />
              )}
              {preparing ? "處理圖片中…" : albumLabel}
            </button>
            <button
              type="button"
              disabled={preparing}
              onClick={() => queuePick("camera")}
              className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm disabled:opacity-50"
            >
              {preparing ? (
                <Loader2 className="h-5 w-5 animate-spin text-clay" />
              ) : (
                <Camera className="h-5 w-5 text-clay" />
              )}
              {cameraLabel}
            </button>
          </div>

          {showRemove && onRemove && (
            <button
              type="button"
              onClick={() => onRemove()}
              disabled={removing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-border py-3 text-sm text-muted-foreground disabled:opacity-50"
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              刪除
            </button>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
