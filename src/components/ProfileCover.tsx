import { Camera, Loader2 } from "lucide-react";
import type { RefObject } from "react";
import { CropEditActions } from "@/components/CropEditActions";
import {
  InlineImageCropViewport,
  type InlineImageCropHandle,
} from "@/components/InlineImageCropViewport";

type Props = {
  coverUrl: string | null;
  cropFile?: File | null;
  cropRef?: RefObject<InlineImageCropHandle | null>;
  editing?: boolean;
  uploading?: boolean;
  applying?: boolean;
  onPress?: () => void;
  onCancelEdit?: () => void;
  onApplyEdit?: () => void;
  cancelLabel?: string;
  applyLabel?: string;
};

function DefaultCoverArt() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-6 -top-4 h-32 w-32 rounded-full bg-clay/10 blur-2xl" />
      <div className="absolute -bottom-6 left-8 h-28 w-40 rounded-full bg-sage/15 blur-2xl" />
      <svg
        className="absolute bottom-0 left-0 right-0 h-[55%] w-full text-foreground/[0.06]"
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M0 48 C80 28 120 62 200 40 S320 20 400 36 L400 80 L0 80 Z"
        />
        <path
          fill="currentColor"
          opacity="0.7"
          d="M0 58 C100 42 160 70 260 52 S340 44 400 54 L400 80 L0 80 Z"
        />
      </svg>
      <svg
        className="absolute right-6 top-5 h-8 w-8 text-clay/25"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
      >
        <circle cx="22" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M4 24c6-10 14-12 24-8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ProfileCover({
  coverUrl,
  cropFile,
  cropRef,
  editing = false,
  uploading = false,
  applying = false,
  onPress,
  onCancelEdit,
  onApplyEdit,
  cancelLabel = "取消",
  applyLabel = "套用",
}: Props) {
  const frame = (
    <div className="relative aspect-[5/2] w-full min-h-[7.5rem] max-h-[10.5rem] bg-gradient-to-br from-[hsl(var(--accent))] via-secondary to-[hsl(38_42%_94%)]">
      {cropFile && editing ? (
        <InlineImageCropViewport
          ref={cropRef}
          file={cropFile}
          aspectWidth={5}
          aspectHeight={2}
          className="absolute inset-0 h-full w-full"
        />
      ) : coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className={`h-full w-full object-cover transition duration-500 ${
            uploading ? "scale-[1.02] opacity-70" : ""
          }`}
        />
      ) : (
        <DefaultCoverArt />
      )}

      {editing ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-foreground/10" />
          <div className="absolute right-3 top-3 z-20">
            <CropEditActions
              placement="overlay"
              onCancel={() => onCancelEdit?.()}
              onApply={() => onApplyEdit?.()}
              applying={applying}
              cancelLabel={cancelLabel}
              applyLabel={applyLabel}
            />
          </div>
          <p className="absolute bottom-2 left-0 right-0 z-10 text-center text-[10px] text-white/90 drop-shadow">
            拖曳與雙指縮放調整封面
          </p>
        </>
      ) : (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 transition ${
            uploading
              ? "bg-background/50"
              : "bg-foreground/0 group-hover:bg-foreground/25 group-active:bg-foreground/30"
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-foreground/80" />
              <span className="text-xs font-medium text-foreground/80">上傳中…</span>
            </>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-card/90 shadow-soft backdrop-blur-sm transition group-hover:scale-105">
                <Camera className="h-5 w-5 text-foreground/75" />
              </span>
              <span className="rounded-full bg-card/80 px-3 py-1 text-xs font-medium text-foreground/80 opacity-0 shadow-soft backdrop-blur-sm transition group-hover:opacity-100">
                更換封面
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (editing) {
    return (
      <div className="relative block w-full overflow-hidden rounded-t-[2rem]">{frame}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={uploading}
      className="group relative block w-full overflow-hidden rounded-t-[2rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
      aria-label={coverUrl ? "更換封面" : "設定封面"}
    >
      {frame}
    </button>
  );
}
