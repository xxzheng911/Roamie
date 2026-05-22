import { useRef } from "react";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPickFile: (file: File) => void;
  onRemove?: () => void;
  removing?: boolean;
  showRemove?: boolean;
  cameraFacing?: "user" | "environment";
};

/** 僅選擇圖片來源，不含裁切（裁切在個人頁原位進行） */
export function ImageSourceSheet({
  open,
  onOpenChange,
  title,
  onPickFile,
  onRemove,
  removing = false,
  showRemove = false,
  cameraFacing = "environment",
}: Props) {
  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file?.type.startsWith("image/")) return;
    onOpenChange(false);
    onPickFile(file);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[1.75rem] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="font-display text-left text-base">{title}</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => albumRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm"
          >
            <ImageIcon className="h-5 w-5 text-clay" />
            從相簿選取
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm"
          >
            <Camera className="h-5 w-5 text-clay" />
            拍照
          </button>
        </div>

        {showRemove && onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove();
            }}
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

        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture={cameraFacing}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
