import { Loader2 } from "lucide-react";
import defaultCover from "@/assets/roamie-default-cover.png";

type Props = {
  coverUrl: string | null;
  busy?: boolean;
  onPress?: () => void;
};

export function ProfileCover({ coverUrl, busy = false, onPress }: Props) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      className="group relative block w-full overflow-hidden rounded-t-[2rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-90"
      aria-label={coverUrl ? "更換封面" : "設定封面"}
    >
      <div className="relative aspect-[3/2] w-full min-h-[11rem] max-h-[16rem] shrink-0 overflow-hidden bg-gradient-to-br from-[hsl(var(--accent))] via-secondary to-[hsl(38_42%_94%)]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover object-center transition duration-300 ${
              busy ? "opacity-80" : ""
            }`}
          />
        ) : (
          <img src={defaultCover} alt="" className="h-full w-full object-cover" />
        )}

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
      </div>
    </button>
  );
}
