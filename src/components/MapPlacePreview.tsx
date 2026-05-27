import { Heart, Loader2, MessageCircle, Star, X } from "lucide-react";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import type { PlaceResult } from "@/lib/place-result";
import { resolvePlaceCardOpeningDisplay } from "@/lib/place-card-opening";

type PlaceCard = PlaceResult & { reason: string };

type Props = {
  place: PlaceCard;
  imageUrl: string | null;
  isSaved: boolean;
  isBusy: boolean;
  onClose: () => void;
  onToggleSave: () => void;
  onOpenChat: () => void;
};

export function MapPlacePreview({
  place,
  imageUrl,
  isSaved,
  isBusy,
  onClose,
  onToggleSave,
  onOpenChat,
}: Props) {
  return (
    <div className="pointer-events-auto absolute left-4 right-4 z-20 mx-auto max-w-[408px] animate-in slide-in-from-bottom-4 duration-200">
      <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
        <div className="relative aspect-[16/9] bg-secondary">
          {imageUrl ? (
            <img src={imageUrl} alt={place.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              無預覽圖
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-card/95 shadow-soft"
            aria-label="關閉"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleSave}
            disabled={isBusy}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft disabled:opacity-60"
            aria-label={isSaved ? "移除收藏" : "收藏"}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Heart className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`} />
            )}
          </button>
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-lg leading-tight">{place.name}</h3>
            {place.rating !== null && (
              <span className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground">
                <Star className="h-3.5 w-3.5 fill-clay text-clay" />
                {place.rating.toFixed(1)}
              </span>
            )}
          </div>
          {place.address && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{place.address}</p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">{place.reason}</p>
          <PlaceHoursBadge
            className="mt-2"
            statusLabel={
              resolvePlaceCardOpeningDisplay({
                id: place.id,
                name: place.name,
                openStatus: place.openStatus,
                todayHoursLabel: place.todayHoursLabel,
                closingSoonNote: place.closingSoonNote,
                nextOpenHint: place.nextOpenHint,
              }).statusLabel ||
              (place.openStatus === "unknown" ? "營業資訊未知" : "")
            }
            todayHoursLabel={place.todayHoursLabel}
            closingSoonNote={place.closingSoonNote}
            nextOpenHint={place.nextOpenHint}
          />
          <PlaceNavButtons
            lat={place.lat}
            lng={place.lng}
            address={place.address}
            placeName={place.name}
            className="mt-3"
          />
          <button
            type="button"
            onClick={onOpenChat}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 text-sm text-primary-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            和 Roamie 聊這裡
          </button>
        </div>
      </article>
    </div>
  );
}
