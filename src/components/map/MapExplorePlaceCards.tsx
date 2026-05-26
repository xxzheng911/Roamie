import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent,
} from "react";
import { Heart, Loader2, Plus, Star } from "lucide-react";
import { pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import { cn } from "@/lib/utils";
import type { PlaceResult } from "@/lib/place-result";

export type MapPlaceCard = PlaceResult & {
  reason: string;
  googleMapsUrl?: string;
  isSavedFavorite?: boolean;
  displayCategory?: string;
  coverImageUrl?: string;
  distanceLabel?: string;
};

export type MapExploreCardsHandle = {
  scrollToIndex: (index: number) => void;
};

type Props = {
  places: MapPlaceCard[];
  loading: boolean;
  highlightIndex: number | null;
  busyId: string | null;
  savedNames: Set<string>;
  userLocation: { lat: number; lng: number };
  formatDistance: (meters: number) => string;
  distanceMeters: (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ) => number;
  imageUrl: (photoName: string | null) => string | null;
  categoryKey: string;
  emptyMessage?: string | null;
  onSelect: (index: number) => void;
  onToggleSave: (place: MapPlaceCard) => void;
  onAddToTrip?: (place: MapPlaceCard) => void;
  addToTripLabel?: string;
};

const DRAG_SCROLL_THRESHOLD_PX = 10;

export const MapExplorePlaceCards = forwardRef<MapExploreCardsHandle, Props>(
  function MapExplorePlaceCards(
    {
      places,
      loading,
      highlightIndex,
      busyId,
      savedNames,
      userLocation,
      formatDistance,
      distanceMeters: distFn,
      imageUrl,
      categoryKey,
      emptyMessage,
      onSelect,
      onToggleSave,
      onAddToTrip,
      addToTripLabel = "加入行程",
    },
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragScrollRef = useRef<{
      active: boolean;
      moved: boolean;
      startX: number;
      scrollLeft: number;
      pointerId: number;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToIndex(index: number) {
        const el = scrollRef.current;
        if (!el) return;
        const card = el.querySelector<HTMLElement>(`[data-place-index="${index}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      },
    }));

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = 0;
    }, [categoryKey]);

    const onCarouselPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      e.stopPropagation();
      const el = scrollRef.current;
      if (!el) return;
      dragScrollRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        scrollLeft: el.scrollLeft,
        pointerId: e.pointerId,
      };
    };

    const onCarouselPointerMove = (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragScrollRef.current;
      if (!drag?.active || drag.pointerId !== e.pointerId) return;
      const el = scrollRef.current;
      if (!el) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(dx) < DRAG_SCROLL_THRESHOLD_PX) return;
        drag.moved = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft = drag.scrollLeft - dx;
    };

    const endCarouselPointer = (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragScrollRef.current;
      if (!drag?.active || drag.pointerId !== e.pointerId) return;
      const el = scrollRef.current;
      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      dragScrollRef.current = null;
    };

    const showEmpty = !loading && places.length === 0;

    return (
      <div className="relative min-w-0 w-full">
        {loading && (
          <div className="pointer-events-none absolute inset-x-6 top-0 z-10 flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {showEmpty ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {emptyMessage ?? "附近暫時沒有適合的推薦"}
            </p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={cn("map-explore-cards", loading && "opacity-60")}
            data-sheet-cards-scroll
            data-no-sheet-drag
            role="list"
            aria-label="推薦地點卡片"
            onPointerDown={onCarouselPointerDown}
            onPointerMove={onCarouselPointerMove}
            onPointerUp={endCarouselPointer}
            onPointerCancel={endCarouselPointer}
          >
            {places.map((p, i) => {
              const isSaved = savedNames.has(p.name);
              const isBusy = busyId === p.id;
              const img =
                p.coverImageUrl ??
                imageUrl(p.photoName) ??
                pickPlaceSceneFallback(p.name, {
                  primaryType: p.primaryType,
                  types: p.types,
                  categoryId: categoryKey,
                });
              const distLabel =
                p.distanceLabel ??
                (p.lat != null && p.lng != null
                  ? formatDistance(distFn(userLocation, { lat: p.lat, lng: p.lng }))
                  : "");
              const typeLabel = p.displayCategory ?? identityDisplayLabel(resolvePlaceIdentity(p));
              const isLast = i === places.length - 1;
              return (
                <article
                  key={p.id}
                  data-place-card
                  data-place-index={i}
                  role="listitem"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    onSelect(i);
                  }}
                  className={cn(
                    "map-place-card map-explore-card-item flex cursor-pointer flex-col overflow-hidden rounded-3xl border bg-card shadow-soft transition-colors",
                    isLast && "map-explore-card-item--last",
                    highlightIndex === i
                      ? "border-foreground"
                      : "border-border hover:border-foreground/30",
                  )}
                >
                  <div className="relative h-[170px] w-full shrink-0 overflow-hidden rounded-t-[1.4rem] bg-secondary">
                    {img ? (
                      <img
                        src={img}
                        alt={p.name}
                        loading="lazy"
                        draggable={false}
                        className="pointer-events-none h-full w-full object-cover"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSave(p);
                      }}
                      disabled={isBusy}
                      className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft disabled:opacity-60"
                      aria-label={isSaved ? "移除收藏" : "收藏"}
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Heart
                          className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`}
                        />
                      )}
                    </button>
                    <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {typeLabel}
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col p-3">
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
                      <div className="flex shrink-0 items-start justify-between gap-2">
                        <h3 className="line-clamp-2 min-h-[2.5rem] flex-1 text-sm font-medium leading-snug">
                          {p.name}
                        </h3>
                        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                          {distLabel ? <span className="whitespace-nowrap">{distLabel}</span> : null}
                          {p.rating !== null && (
                            <span className="flex items-center gap-0.5 whitespace-nowrap">
                              <Star className="h-3 w-3 fill-clay text-clay" />
                              {p.rating.toFixed(1)}
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="line-clamp-1 min-h-[1rem] shrink-0 text-[11px] leading-snug text-muted-foreground">
                        {p.address || "—"}
                      </p>
                      <p className="line-clamp-2 min-h-[2.25rem] shrink-0 text-[11px] leading-snug text-foreground/80">
                        {p.reason}
                      </p>
                      <div className="min-h-[1rem] shrink-0">
                        <PlaceHoursBadge
                          compact
                          statusLabel={p.openStatusLabel}
                          todayHoursLabel={p.todayHoursLabel}
                          closingSoonNote={p.closingSoonNote}
                          nextOpenHint={p.nextOpenHint}
                        />
                      </div>
                    </div>
                    {onAddToTrip ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToTrip(p);
                        }}
                        className="mt-2 flex h-9 w-full shrink-0 items-center justify-center gap-1 rounded-full bg-foreground text-[11px] font-medium text-background"
                      >
                        <Plus className="h-3 w-3" />
                        {addToTripLabel}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);
