import { useRef, useState } from "react";
import { Camera, ImageIcon, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { saveUserProfile } from "@/lib/profile-storage";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSrc: string;
  onPreview?: (url: string) => void;
};

export function AvatarPickerSheet({ open, onOpenChange, currentSrc, onPreview }: Props) {
  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const displaySrc = preview ?? currentSrc;

  const readFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("圖片請小於 3MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setPreview(url);
      onPreview?.(url);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!preview) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await saveUserProfile({ avatarUrl: preview });
      broadcastAvatarUpdate(preview);
      toast.success("頭像已更新");
      setPreview(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      setPreview(null);
      onPreview?.(currentSrc);
    }
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-[2rem] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="font-display text-left">更換頭像</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex justify-center">
          <div className="h-28 w-28 overflow-hidden rounded-[1.75rem] border-4 border-border bg-secondary shadow-soft">
            <img src={displaySrc} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">即時預覽 · 確認後同步至各頁面</p>

        <div className="mt-6 grid grid-cols-2 gap-3">
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

        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={!preview || saving}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {preview ? "確認使用這張照片" : "請先選擇或拍攝照片"}
        </button>
      </SheetContent>
    </Sheet>
  );
}
