import { Loader2, Plus, Trash2 } from "lucide-react";
import { PlaceCardCover } from "@/components/media/PlaceCardCover";
import { resolveSavedPlaceImageUrl } from "@/lib/saved-places-image";
import type { SavedPlace } from "@/lib/places-storage";

type Props = {
  place: SavedPlace;
  addLabel: string;
  removeLabel: string;
  opening?: boolean;
  onOpen: (place: SavedPlace) => void;
  onAddToTrip: (place: SavedPlace) => void;
  onDelete: (place: SavedPlace) => void;
};

/**
 * 收藏 → 地點 tab：名稱 + 縮圖 + 加入行程 + 刪除（無類別／地址／距離）
 */
export function SavedPlaceCard({
  place,
  addLabel,
  removeLabel,
  opening = false,
  onOpen,
  onAddToTrip,
  onDelete,
}: Props) {
  const openDetail = () => {
    if (opening) return;
    onOpen(place);
  };

  return (
    <article
      className="flex cursor-pointer touch-manipulation items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft transition active:scale-[0.99] active:bg-secondary/30"
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      }}
      aria-label={`查看 ${place.name}`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-secondary">
        <PlaceCardCover
          placeId={place.place_id}
          name={place.name}
          categoryId={place.category}
          primaryType={place.category}
          coverImageUrl={resolveSavedPlaceImageUrl(place)}
          alt=""
          className="h-full w-full"
          imgClassName="h-full w-full object-cover"
        />
        {opening ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/60">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] font-medium leading-snug text-foreground">{place.name}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAddToTrip(place);
          }}
          className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-full bg-foreground text-background active:scale-95"
          aria-label={addLabel}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(place);
          }}
          className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-full text-muted-foreground hover:bg-secondary active:scale-95"
          aria-label={removeLabel}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
