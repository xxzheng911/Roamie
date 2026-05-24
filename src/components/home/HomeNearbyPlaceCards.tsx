import { Heart, Star } from "lucide-react";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";

type Props = {
  places: HomeNearbyPick[];
  loading?: boolean;
  userLocation: { lat: number; lng: number };
  emptyMessage?: string;
  onSelect: (place: HomeNearbyPick) => void;
};

function distLabel(
  place: HomeNearbyPick,
  userLocation: { lat: number; lng: number },
): string {
  if (place.lat == null || place.lng == null) return "";
  return formatDistanceLabel(distanceMeters(userLocation, { lat: place.lat, lng: place.lng }));
}

function areaLabel(place: HomeNearbyPick): string {
  const cat = getExploreCategoryDisplayLabel(place);
  if (place.address?.trim()) {
    const short = place.address.split(/[,，]/)[0]?.trim();
    if (short && short.length <= 12) return short;
  }
  return cat || "附近";
}

function ratingLabel(place: HomeNearbyPick): string | null {
  if (place.rating == null) return null;
  const count =
    place.userRatingCount != null && place.userRatingCount > 0
      ? ` · ${place.userRatingCount.toLocaleString()}`
      : "";
  return `${place.rating.toFixed(1)}${count}`;
}

export function HomeNearbyPlaceCards({
  places,
  loading,
  userLocation,
  emptyMessage,
  onSelect,
}: Props) {
  const { t } = useI18n();

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
        const img = p.photoName ? buildPlacePhotoUrl(p.photoName, 480) : null;
        const isLast = i === places.length - 1;
        const distance = distLabel(p, userLocation);
        const area = areaLabel(p);
        const rating = ratingLabel(p);
        const vibe = p.reason?.trim() || "適合現在去走走";

        return (
          <button
            key={p.id}
            type="button"
            role="listitem"
            onClick={() => onSelect(p)}
            className={cn(
              "home-nearby-card-item group text-left",
              isLast && "home-nearby-card-item--last",
            )}
          >
            <div className="home-nearby-card-square overflow-hidden rounded-[1.35rem] bg-secondary shadow-soft transition-transform duration-300 ease-out active:scale-[0.97] group-hover:scale-[1.02]">
              {img ? (
                <img
                  src={img}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary via-cream to-[#e8eef5]/60 text-xs text-muted-foreground">
                  {getExploreCategoryDisplayLabel(p)}
                </div>
              )}
              <div
                className="absolute inset-0 bg-gradient-to-t from-ink/78 via-ink/18 to-transparent"
                aria-hidden
              />
              <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-ink/35 px-2 py-1 text-[10px] text-cream backdrop-blur-sm">
                {p.isSavedFavorite ? (
                  <Heart className="h-3 w-3 fill-current" aria-hidden />
                ) : rating ? (
                  <>
                    <Star className="h-3 w-3 fill-current text-amber-200/90" aria-hidden />
                    <span>{rating}</span>
                  </>
                ) : null}
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3 text-cream">
                <p className="text-[10px] tracking-wide opacity-85">
                  {[distance, area].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 line-clamp-2 font-display text-[15px] leading-snug">{p.name}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug opacity-90">{vibe}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
