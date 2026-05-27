import { Heart, Loader2, Plus, Star } from "lucide-react";
import { PlaceImage } from "@/components/media/PlaceImage";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";

type Props = {
  places: HomeNearbyPick[];
  loading?: boolean;
  userLocation: { lat: number; lng: number } | null;
  emptyMessage?: string;
  savedNames: Set<string>;
  busyId: string | null;
  navigatingPlaceId?: string | null;
  onSelect: (place: HomeNearbyPick) => void;
  onAddToTrip?: (place: HomeNearbyPick) => void;
  onToggleSave?: (place: HomeNearbyPick) => void;
  addToTripLabel?: string;
};

function distLabel(
  place: HomeNearbyPick,
  userLocation: { lat: number; lng: number },
): string {
  if (place.distanceLabel) return place.distanceLabel;
  if (place.lat == null || place.lng == null) return "";
  return formatDistanceLabel(distanceMeters(userLocation, { lat: place.lat, lng: place.lng }));
}

function ratingLabel(place: HomeNearbyPick): string | null {
  if (place.rating == null) return null;
  const count =
    place.userRatingCount != null && place.userRatingCount > 0
      ? ` · ${place.userRatingCount.toLocaleString()}`
      : "";
  return `${place.rating.toFixed(1)}${count}`;
}

function statusLabel(place: HomeNearbyPick): string | null {
  if (place.openStatusLabel?.trim()) return place.openStatusLabel.trim();
  if (place.openStatus === "open") return "營業中";
  if (place.openStatus === "closed") return "休息中";
  return null;
}

export function HomeNearbyPlaceCards({
  places,
  loading,
  userLocation,
  emptyMessage,
  savedNames,
  busyId,
  navigatingPlaceId,
  onSelect,
  onAddToTrip,
  onToggleSave,
  addToTripLabel = "加入行程",
}: Props) {
  const { t } = useI18n();
  const anchor = userLocation ?? { lat: 0, lng: 0 };
  const canShowDistance = userLocation != null;

  if (loading && places.length === 0) {
    return (
      <div className="home-nearby-cards home-nearby-cards--loading" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="home-nearby-card-item">
            <div className="home-nearby-card-square animate-pulse bg-secondary/80" />
          </div>
        ))}
      </div>
    );
  }

  if (!loading && places.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t("home.nearbyEmpty")}
      </p>
    );
  }

  return (
    <div
      className={cn("home-nearby-cards", loading && "opacity-60")}
      role="list"
      aria-label="附近推薦地點"
    >
      {places.map((p, i) => {
        const img = p.coverImageUrl;
        const googlePhoto = img;
        const isLast = i === places.length - 1;
        const distance = canShowDistance ? distLabel(p, anchor) : "";
        const typeName = p.displayCategory ?? getExploreCategoryDisplayLabel(p);
        const rating = ratingLabel(p);
        const hours = statusLabel(p);
        const vibe = p.reason?.trim() || typeName || "適合現在去走走";
        const isSaved = savedNames.has(p.name) || Boolean(p.isSavedFavorite);
        const isBusy = busyId === p.id;
        const isNavigating = navigatingPlaceId === p.id;

        return (
          <article
            key={p.id}
            role="listitem"
            className={cn(
              "home-nearby-card-item relative text-left",
              isLast && "home-nearby-card-item--last",
            )}
          >
            <button
              type="button"
              disabled={isNavigating}
              aria-busy={isNavigating}
              onClick={() => onSelect(p)}
              className="absolute inset-0 z-0 rounded-[1.35rem] transition active:scale-[0.98] disabled:cursor-wait"
              aria-label={`查看 ${p.name}`}
            />

            <div className="relative z-[1] pointer-events-none">
              <div className="home-nearby-card-square relative overflow-hidden rounded-[1.35rem] bg-secondary shadow-soft">
                {isNavigating ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/25 backdrop-blur-[1px]">
                    <Loader2 className="h-6 w-6 animate-spin text-cream" aria-hidden />
                  </div>
                ) : null}
                {googlePhoto ? (
                  <img
                    src={googlePhoto}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <PlaceImage
                    name={p.name}
                    photoName={p.photoName}
                    primaryType={p.primaryType}
                    types={p.types}
                    categoryId={p.categoryId}
                    className="absolute inset-0"
                  />
                )}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-ink/78 via-ink/18 to-transparent"
                  aria-hidden
                />
                {rating ? (
                  <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-ink/35 px-2 py-1 text-[10px] text-cream backdrop-blur-sm">
                    <Star className="h-3 w-3 fill-current text-amber-200/90" aria-hidden />
                    {rating}
                  </span>
                ) : null}
                {hours ? (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-ink/40 px-2 py-0.5 text-[10px] text-cream backdrop-blur-sm">
                    {hours}
                  </span>
                ) : null}

                {onAddToTrip ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToTrip(p);
                    }}
                    className="pointer-events-auto absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-full bg-cream/95 px-2.5 py-1 text-[10px] font-medium text-ink shadow-soft"
                  >
                    <Plus className="h-3 w-3" />
                    {addToTripLabel}
                  </button>
                ) : null}

                {onToggleSave ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSave(p);
                    }}
                    disabled={isBusy}
                    className="pointer-events-auto absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft disabled:opacity-60"
                    aria-label={isSaved ? "移除收藏" : "收藏"}
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Heart
                        className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`}
                      />
                    )}
                  </button>
                ) : null}
              </div>

              <div className="mt-2 px-0.5">
                <p className="line-clamp-1 font-display text-[15px] leading-snug text-foreground">
                  {p.name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {[typeName, distance].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/80">
                  {vibe}
                </p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
