import { useRef, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { normalizeImageFileForUpload } from "@/lib/image-crop";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickFile: (file: File) => void;
  onRegenerate: () => void;
  regenerating?: boolean;
};

/** 行程封面更換：相簿選擇 + 重新生成推薦封面 */
export function TripCoverSheet({
  open,
  onOpenChange,
  onPickFile,
  onRegenerate,
  regenerating = false,
}: Props) {
  const albumRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    console.info("[IMAGE_PICKER] result=", file ? `${file.name}|${file.type}|${file.size}` : "empty");
    if (!file?.type.startsWith("image/")) return;
    try {
      const normalized = await normalizeImageFileForUpload(file);
      onOpenChange(false);
      onPickFile(normalized);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "圖片格式不支援，請改選 JPG 或 PNG");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[1.75rem] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="font-display text-left text-base">更換封面</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => albumRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm"
          >
            <ImageIcon className="h-5 w-5 text-clay" />
            從相簿選擇
          </button>
          <button
            type="button"
            disabled={regenerating}
            onClick={() => {
              onRegenerate();
            }}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm disabled:opacity-50"
          >
            {regenerating ? (
              <Loader2 className="h-5 w-5 animate-spin text-clay" />
            ) : (
              <RefreshCw className="h-5 w-5 text-clay" />
            )}
            重新生成推薦封面
          </button>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 shrink-0" />
          推薦封面依目的地與心情，從 Unsplash 搜尋柔和旅行風格照片
        </p>

        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
