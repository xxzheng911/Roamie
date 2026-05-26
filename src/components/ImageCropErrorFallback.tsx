import { ImageOff } from "lucide-react";

type Props = {
  message?: string;
  className?: string;
};

/** 裁切載入失敗時的內嵌提示（不觸發整頁 error boundary） */
export function ImageCropErrorFallback({
  message = "無法載入這張圖片，請換一張再試",
  className = "",
}: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-4 text-center ${className}`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary/90">
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="font-display text-sm text-foreground/90">Roamie 沒讀到這張圖</p>
      <p className="max-w-[14rem] text-[12px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}
