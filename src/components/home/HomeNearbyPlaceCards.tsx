import { memo, useMemo } from "react";
import { Heart, Loader2, Plus, Star } from "lucide-react";
import { PlaceCoverImage } from "@/components/media/PlaceCoverImage";
import { PlaceImage } from "@/components/media/PlaceImage";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";
import { placeOpeningStatusLabel } from "@/lib/normalized-opening-status";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { HomeNearbyRenderState } from "@/lib/home-nearby-log";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import type { Locale } from "@/lib/i18n/types";

const HOME_NEARBY_IMAGE_PRIORITY_COUNT = 3;

/** 首頁附近地點卡 — 獨立於行程／探索／聊天推薦卡片 */
type Props = {
  places: HomeNearbyPick[];
  renderState: HomeNearbyRenderState;
  loading?: boolean;
  showSlowEmpty?: boolean;
  userLocation: { lat: number; lng: number } | null;
  emptyMessage?: string;
  slowEmptyMessage?: string;
  retryLabel?: string;
  onRetry?: () => void;
  savedNames: Set<string>;
  busyId: string | null;
  navigatingPlaceId?: string | null;
  onSelect: (place: HomeNearbyPick) => void;
  onAddToTrip?: (place: HomeNearbyPick) => void;
  onToggleSave?: (place: HomeNearbyPick) => void;
  addToTripLabel?: string;
};

type CardDisplay = {
  place: HomeNearbyPick;
  index: number;
  isLast: boolean;
  safeCover: string | null;
  distance: string;
  typeName: string;
  rating: string | null;
  hours: string;
  vibe: string;
  isSaved: boolean;
  isBusy: boolean;
  isNavigating: boolean;
  loadImage: boolean;
};

function buildCardDisplay(
  place: HomeNearbyPick,
  index: number,
  total: number,
  anchor: { lat: number; lng: number },
  canShowDistance: boolean,
  locale: Locale,
  savedNames: Set<string>,
  goodForNow: string,
  busyId: string | null,
  navigatingPlaceId: string | null,
): CardDisplay {
  const img = place.coverImageUrl ?? place.generatedImageUrl ?? place.fallbackImageUrl;
  const safeCover = img ? resolvePlaceImageUrl(img, { maxWidth: 480 }) : null;
  let distance = "";
  if (canShowDistance) {
    distance =
      place.distanceLabel ??
      (place.lat != null && place.lng != null
        ? formatDistanceLabel(distanceMeters(anchor, { lat: place.lat, lng: place.lng }))
        : "");
  }
  const typeName = place.displayCategory ?? getExploreCategoryDisplayLabel(place);
  let rating: string | null = null;
  if (place.rating != null && place.rating > 0) {
    const count =
      place.userRatingCount != null && place.userRatingCount > 0
        ? ` · ${place.userRatingCount.toLocaleString()}`
        : "";
    rating = `${place.rating.toFixed(1)}${count}`;
  }
  const hours = placeOpeningStatusLabel(place, locale);
  const vibe = place.reason?.trim() || typeName || goodForNow;

  return {
    place,
    index,
    isLast: index === total - 1,
    safeCover,
    distance,
    typeName,
    rating,
    hours,
    vibe,
    isSaved: savedNames.has(place.name) || Boolean(place.isSavedFavorite),
    isBusy: busyId === place.id,
    isNavigating: navigatingPlaceId === place.id,
    loadImage: index < HOME_NEARBY_IMAGE_PRIORITY_COUNT,
  };
}

const HomeNearbyCardItem = memo(function HomeNearbyCardItem({
  display,
  addToTripLabel,
  onSelect,
  onAddToTrip,
  onToggleSave,
}: {
  display: CardDisplay;
  addToTripLabel: string;
  onSelect: (place: HomeNearbyPick) => void;
  onAddToTrip?: (place: HomeNearbyPick) => void;
  onToggleSave?: (place: HomeNearbyPick) => void;
}) {
  const { place: p, isLast, safeCover, distance, typeName, rating, hours, vibe } = display;
  const { isSaved, isBusy, isNavigating, loadImage } = display;

  return (
    <article
      role="listitem"
      className={cn("home-nearby-card-item relative text-left", isLast && "home-nearby-card-item--last")}
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
          {safeCover || p.photoName ? (
            <PlaceCoverImage
              url={safeCover}
              photoName={p.photoName}
              placeId={p.id}
              name={p.name}
              primaryType={p.primaryType}
              types={p.types}
              categoryId={p.categoryId}
              maxWidth={480}
              priority={loadImage}
              lazy={!loadImage}
              alt=""
              className="absolute inset-0"
            />
          ) : (
            <PlaceImage
              placeId={p.id}
              name={p.name}
              photoName={p.photoName}
              primaryType={p.primaryType}
              types={p.types}
              categoryId={p.categoryId}
              priority={loadImage}
              lazy={!loadImage}
              perfPage="home"
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
          <p className="line-clamp-1 font-display text-[15px] leading-snug text-foreground">{p.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {[typeName, distance].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/80">{vibe}</p>
        </div>
      </div>
    </article>
  );
});

export function HomeNearbyPlaceCards({
  places,
  renderState,
  loading,
  showSlowEmpty,
  userLocation,
  emptyMessage,
  slowEmptyMessage,
  retryLabel,
  onRetry,
  savedNames,
  busyId,
  navigatingPlaceId,
  onSelect,
  onAddToTrip,
  onToggleSave,
  addToTripLabel = "加入行程",
}: Props) {
  const { t, locale } = useI18n();
  const anchor = userLocation ?? { lat: 0, lng: 0 };
  const canShowDistance = userLocation != null;
  const goodForNow = t("place.goodForNow");
  const showSkeleton =
    places.length === 0 &&
    !showSlowEmpty &&
    (loading || renderState === "loading");
  const showEmpty =
    places.length === 0 &&
    !showSkeleton &&
    (renderState === "empty" || renderState === "error" || Boolean(showSlowEmpty));

  const cardDisplays = useMemo(() => {
    return places.map((place, index) =>
      buildCardDisplay(
        place,
        index,
        places.length,
        anchor,
        canShowDistance,
        locale,
        savedNames,
        goodForNow,
        busyId,
        navigatingPlaceId ?? null,
      ),
    );
  }, [places, anchor, canShowDistance, locale, savedNames, goodForNow, busyId, navigatingPlaceId]);

  if (showSkeleton) {
    return (
      <div className="home-nearby-cards home-nearby-cards--loading" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="home-nearby-card-item">
            <div className="home-nearby-card-square animate-pulse bg-secondary/80" />
          </div>
        ))}
      </div>
    );
  }

  if (showEmpty) {
    return (
      <div className="space-y-2 text-center">
        <p className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          {showSlowEmpty
            ? (slowEmptyMessage ?? t("home.nearbySlowEmpty"))
            : (emptyMessage ?? t("home.nearbyEmpty"))}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {retryLabel ?? t("home.nearbyRetry")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="home-nearby-cards" role="list" aria-label={t("place.nearbyListAria")}>
      {cardDisplays.map((display) => (
        <HomeNearbyCardItem
          key={display.place.id}
          display={display}
          addToTripLabel={addToTripLabel}
          onSelect={onSelect}
          onAddToTrip={onAddToTrip}
          onToggleSave={onToggleSave}
        />
      ))}
    </div>
  );
}
