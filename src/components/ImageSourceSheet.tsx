import { useI18n } from "@/hooks/use-i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  pickImageWithCapacitorCamera,
  shouldUseCapacitorImagePicker,
  type ImagePickSource,
} from "@/lib/capacitor-image-picker";
import { isImagePickFile, normalizeImageFileForUpload } from "@/lib/image-crop";
import { NATIVE_IMAGE_PICKER_DELAY_MS, safeTriggerFileInput } from "@/lib/native-image-picker";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPickFile: (file: File) => void;
  onRemove?: () => void;
  removing?: boolean;
  showRemove?: boolean;
  removeLabel?: string;
  disabled?: boolean;
  onPickerBusyChange?: (busy: boolean) => void;
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
 * iOS Capacitor：關閉 Sheet → 延遲 300ms → Camera.getPhoto。
 * Web：關閉 Sheet → file input。
 */
export function ImageSourceSheet({
  open,
  onOpenChange,
  title,
  onPickFile,
  onRemove,
  removing = false,
  showRemove = false,
  removeLabel,
  disabled = false,
  onPickerBusyChange,
  cameraFacing = "environment",
  albumLabel,
  cameraLabel,
  sheetClassName,
  overlayClassName,
  sheetLogPrefix,
  pickLogPrefix,
}: Props) {
  const { t: uiT } = useI18n();
  const resolvedAlbumLabel = albumLabel ?? uiT("productionUi.p30784c6dd2");
  const resolvedCameraLabel = cameraLabel ?? uiT("productionUi.p6e3a10ade7");
  const resolvedRemoveLabel = removeLabel ?? uiT("profile.removeAvatar");
  const resolvedCloseLabel = uiT("productionUi.pc7fdddf79e");

  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pendingSourceRef = useRef<ImagePickSource | null>(null);
  const preparingRef = useRef(false);
  const pickerOpeningRef = useRef(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (open && sheetLogPrefix) {
      console.info(`${sheetLogPrefix} open`);
    }
  }, [open, sheetLogPrefix]);

  const deliverFile = useCallback(
    async (file: File, source: ImagePickSource) => {
      if (!isImagePickFile(file)) {
        if (pickLogPrefix === "[TRIP_COVER_PICK]") {
          console.info("[TRIP_COVER_PICK_ERROR]", "invalid file type");
        }
        toast.error(uiT("productionUi.pdbef31bc6b"));
        return;
      }
      if (preparingRef.current) return;

      preparingRef.current = true;
      setPreparing(true);
      try {
        const normalized = await normalizeImageFileForUpload(file, { logPrefix: pickLogPrefix });
        if (!normalized?.size) {
          throw new Error("圖片轉換失敗，請改選 JPG 或 PNG");
        }
        onPickFile(normalized);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "圖片格式不支援，請改選 JPG 或 PNG";
        if (pickLogPrefix === "[TRIP_COVER_PICK]") {
          console.info("[TRIP_COVER_PICK_ERROR]", msg);
        }
        toast.error(msg);
      } finally {
        preparingRef.current = false;
        setPreparing(false);
      }
    },
    [uiT, onPickFile, pickLogPrefix],
  );

  const openCapacitorPicker = useCallback(
    async (source: ImagePickSource) => {
      if (pickerOpeningRef.current) return;
      pickerOpeningRef.current = true;
      try {
        const result = await pickImageWithCapacitorCamera(source, {
          cameraFacing,
          pickLogPrefix,
        });
        if (result.ok) {
          await deliverFile(result.file, source);
          return;
        }
        if (result.cancelled) return;
        if (result.error) {
          toast.error(result.error);
        }
      } finally {
        pickerOpeningRef.current = false;
        onPickerBusyChange?.(false);
      }
    },
    [cameraFacing, deliverFile, pickLogPrefix, onPickerBusyChange],
  );

  const openWebFileInput = useCallback(
    (source: ImagePickSource) => {
      const input = source === "library" ? albumRef.current : cameraRef.current;
      if (!input) {
        if (pickLogPrefix === "[TRIP_COVER_PICK]") {
          console.info("[TRIP_COVER_PICK_ERROR]", "picker input missing");
        }
        onPickerBusyChange?.(false);
        toast.error(uiT("productionUi.p7c548b9128"));
        return;
      }
      if (pickLogPrefix === "[TRIP_COVER_PICK]") {
        console.info("[TRIP_COVER_PICKER_OPEN]");
      }
      safeTriggerFileInput(input, (error) => {
        const msg = error instanceof Error ? error.message : "無法開啟圖片選擇器";
        if (pickLogPrefix === "[TRIP_COVER_PICK]") {
          console.info("[TRIP_COVER_PICK_ERROR]", msg);
        }
        onPickerBusyChange?.(false);
        toast.error(uiT("productionUi.pd4ac493f15"));
      });
    },
    [uiT, pickLogPrefix, onPickerBusyChange],
  );

  useEffect(() => {
    if (open || !pendingSourceRef.current) return;

    const source = pendingSourceRef.current;
    pendingSourceRef.current = null;

    const timer = window.setTimeout(() => {
      if (shouldUseCapacitorImagePicker()) {
        void openCapacitorPicker(source);
        return;
      }
      openWebFileInput(source);
    }, NATIVE_IMAGE_PICKER_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [open, openCapacitorPicker, openWebFileInput]);

  const queuePick = (source: ImagePickSource) => {
    if (disabled || preparingRef.current || pickerOpeningRef.current) return;
    if (pickLogPrefix) {
      console.info(`${pickLogPrefix} source=${source}`);
    }
    onPickerBusyChange?.(true);
    pendingSourceRef.current = source;
    onOpenChange(false);
  };

  const handleWebFile = async (file: File | undefined, source: ImagePickSource) => {
    if (!file) {
      onPickerBusyChange?.(false);
      if (pickLogPrefix === "[TRIP_COVER_PICK]") {
        console.info("[TRIP_COVER_PICK_CANCELLED]");
      }
      return;
    }
    if (!file.name?.trim() && file.size <= 0) {
      onPickerBusyChange?.(false);
      if (pickLogPrefix === "[TRIP_COVER_PICK]") {
        console.info("[TRIP_COVER_PICK_ERROR]", "empty file");
      }
      return;
    }
    if (pickLogPrefix === "[TRIP_COVER_PICK]") {
      console.info("[TRIP_COVER_PICK_SUCCESS]");
    }
    try {
      await deliverFile(file, source);
    } finally {
      onPickerBusyChange?.(false);
    }
  };

  return (
    <>
      {!shouldUseCapacitorImagePicker() ? (
        <>
          <input
            ref={albumRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/*"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
            onCancel={() => onPickerBusyChange?.(false)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void handleWebFile(file, "library");
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/*"
            capture={cameraFacing}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
            onCancel={() => onPickerBusyChange?.(false)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void handleWebFile(file, "camera");
            }}
          />
        </>
      ) : null}

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          overlayClassName={overlayClassName}
          closeLabel={resolvedCloseLabel}
          className={
            sheetClassName ??
            "rounded-t-[1.75rem] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
          }
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="pr-8 text-left font-display text-base leading-snug">
              {title}
            </SheetTitle>
          </SheetHeader>

          <div className="media-action-grid">
            <button
              type="button"
              disabled={preparing || disabled}
              onClick={() => queuePick("library")}
              className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-4 text-center text-sm leading-snug disabled:opacity-50"
            >
              {preparing ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-clay" />
              ) : (
                <ImageIcon className="h-5 w-5 shrink-0 text-clay" />
              )}
              <span className="w-full min-w-0 whitespace-normal break-words">
                {preparing ? uiT("productionUi.p90486f8748") : resolvedAlbumLabel}
              </span>
            </button>
            <button
              type="button"
              disabled={preparing || disabled}
              onClick={() => queuePick("camera")}
              className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-4 text-center text-sm leading-snug disabled:opacity-50"
            >
              {preparing ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-clay" />
              ) : (
                <Camera className="h-5 w-5 shrink-0 text-clay" />
              )}
              <span className="w-full min-w-0 whitespace-normal break-words">
                {resolvedCameraLabel}
              </span>
            </button>
          </div>

          {showRemove && onRemove && (
            <button
              type="button"
              onClick={() => {
                if (!disabled && !removing) onRemove();
              }}
              disabled={removing || disabled}
              className="mt-3 flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-full border border-border px-4 py-3 text-center text-sm leading-snug text-muted-foreground disabled:opacity-50"
            >
              {removing ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 whitespace-normal break-words">{resolvedRemoveLabel}</span>
            </button>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
