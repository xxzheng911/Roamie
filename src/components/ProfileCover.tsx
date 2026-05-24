import { Loader2 } from "lucide-react";
import type { RefObject } from "react";
import defaultCover from "@/assets/roamie-default-cover.png";
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
  busy?: boolean;
  applying?: boolean;
  onPress?: () => void;
  onCancelEdit?: () => void;
  onApplyEdit?: () => void;
  cancelLabel?: string;
  applyLabel?: string;
};

function CoverFrame({
  coverUrl,
  cropFile,
  cropRef,
  editing,
  busy,
}: {
  coverUrl: string | null;
  cropFile?: File | null;
  cropRef?: RefObject<InlineImageCropHandle | null>;
  editing?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="relative aspect-[5/2] w-full min-h-[7.5rem] max-h-[10.5rem] overflow-hidden bg-gradient-to-br from-[hsl(var(--accent))] via-secondary to-[hsl(38_42%_94%)]">
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
          className={`h-full w-full object-cover transition duration-300 ${
            busy ? "opacity-80" : ""
          }`}
        />
      ) : (
        <img src={defaultCover} alt="" className="h-full w-full object-cover" />
      )}

      {editing ? (
        <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-foreground/10" />
      ) : (
        <>
          <div
            className={`pointer-events-none absolute inset-0 transition duration-200 ${
              busy
                ? "bg-card/40"
                : "bg-foreground/0 group-hover:bg-foreground/12 group-active:bg-foreground/18"
            }`}
          />
          {busy && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card/90 shadow-soft backdrop-blur-sm">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProfileCover({
  coverUrl,
  cropFile,
  cropRef,
  editing = false,
  busy = false,
  applying = false,
  onPress,
  onCancelEdit,
  onApplyEdit,
  cancelLabel = "取消",
  applyLabel = "套用",
}: Props) {
  const frame = <CoverFrame coverUrl={coverUrl} cropFile={cropFile} cropRef={cropRef} editing={editing} busy={busy} />;

  if (editing) {
    return (
      <div className="relative rounded-t-[2rem]">
        <div className="overflow-hidden rounded-t-[2rem]">{frame}</div>
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 px-4">
          <div className="pointer-events-auto">
            <CropEditActions
              onCancel={() => onCancelEdit?.()}
              onApply={() => onApplyEdit?.()}
              applying={applying}
              cancelLabel={cancelLabel}
              applyLabel={applyLabel}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      className="group relative block w-full overflow-hidden rounded-t-[2rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-90"
      aria-label={coverUrl ? "更換封面" : "設定封面"}
    >
      {frame}
    </button>
  );
}
