import { Heart, Loader2, Plus, Star } from "lucide-react";
import { PlaceCardCover } from "@/components/media/PlaceCardCover";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { resolvePlaceCardOpeningDisplay } from "@/lib/place-card-opening";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { useRef, useState, type PointerEvent } from "react";
import { RecommendationDebugPanel } from "@/components/debug/RecommendationDebugPanel";
import { RecommendationDiagnosticsToolbar } from "@/components/debug/RecommendationDiagnosticsToolbar";
import {
  isDiagnosticsModeEnabled,
  type RecommendationDiagnosticSnapshot,
} from "@/lib/debug/recommendation-diagnostics";

type Props = {
  places: HomeNearbyPick[];
  loading?: boolean;
  userLocation: { lat: number; lng: number; source?: "capacitor" | "browser" | "fallback" } | null;
  emptyMessage?: string;
  savedNames: Set<string>;
  busyId: string | null;
  navigatingPlaceId?: string | null;
  onSelect: (place: HomeNearbyPick) => void;
  onAddToTrip?: (place: HomeNearbyPick) => void;
  onToggleSave?: (place: HomeNearbyPick) => void;
  addToTripLabel?: string;
  fallbackReason?: string | null;
  apiError?: string | null;
};

const DRAG_SCROLL_THRESHOLD_PX = 10;

function distLabel(place: HomeNearbyPick, userLocation: { lat: number; lng: number }): string {
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
  const opening = resolvePlaceCardOpeningDisplay({
    id: place.id,
    name: place.name,
    openStatus: place.openStatus,
    todayHoursLabel: place.todayHoursLabel,
  });
  if (opening.statusLabel) return opening.statusLabel;
  if (opening.hoursLabel === "暫時無法確認營業時間") return "暫時無法確認營業時間";
  if (opening.hoursLabel) return opening.hoursLabel;
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
  fallbackReason,
  apiError,
}: Props) {
  const { t } = useI18n();
  const anchor = userLocation ?? { lat: 0, lng: 0 };
  const canShowDistance = userLocation != null;
  const [imageSourceById, setImageSourceById] = useState<Record<string, string>>({});
  const showDiagnostics = isDiagnosticsModeEnabled();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragScrollRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    scrollLeft: number;
    pointerId: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const onCarouselPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
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
    if (drag.moved) suppressNextClickRef.current = true;
    dragScrollRef.current = null;
  };

  const buildSnapshot = (p: HomeNearbyPick): RecommendationDiagnosticSnapshot => {
    const imageSource = imageSourceById[p.id] ?? null;
    const isMock = p.id.startsWith("mock-");
    const fallbackTriggered = isMock || Boolean(fallbackReason);
    return {
      card_id: p.id,
      title: p.name,
      place_id: p.id || null,
      source_type: isMock ? "mock" : fallbackTriggered ? "fallback" : "google_places",
      is_verified_real_place: !isMock && p.lat != null && p.lng != null,
      location_source: isMock
        ? "mock_location"
        : userLocation?.source === "fallback"
          ? "fallback_location"
          : "device_location",
      photo_source: imageSource,
      photo_url: p.coverImageUrl ?? null,
      photo_reference: p.photoName ?? null,
      photo_fallback_reason:
        imageSource === "unsplash" || imageSource === "fallback"
          ? (fallbackReason ?? "google_photo_unavailable")
          : null,
      opening_hours_source: p.openStatus === "unknown" ? "unknown_hours" : "google_opening_hours",
      opening_hours_status: p.openStatus ?? null,
      business_status: p.businessStatus ?? null,
      distance_source: p.distanceLabel
        ? "precomputed_distance"
        : p.lat != null
          ? "computed_distance"
          : null,
      recommendation_source: isMock ? "mock_home_nearby" : "home_nearby_places",
      fallback_triggered: fallbackTriggered,
      fallback_reason: fallbackReason ?? null,
      api_error: apiError ?? null,
      created_at: new Date().toISOString(),
    };
  };

  const diagnosticItems = places.map((p) => buildSnapshot(p));

  if (loading && places.length === 0) {
    return (
      <div>
        {showDiagnostics ? (
          <RecommendationDiagnosticsToolbar
            scope="首頁附近推薦"
            items={[]}
            downloadPayload={{ homepage_recommendation_cards: [] }}
            emptyHint="推薦卡載入中…"
            exportMeta={{
              scope: "首頁附近推薦",
              note: "載入中",
              response_kind: "empty_roamie",
            }}
          />
        ) : null}
        <div className="home-nearby-cards home-nearby-cards--loading" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="home-nearby-card-item">
            <div className="home-nearby-card-square animate-pulse bg-secondary/80" />
          </div>
        ))}
        </div>
      </div>
    );
  }

  if (!loading && places.length === 0) {
    return (
      <div>
        {showDiagnostics ? (
          <RecommendationDiagnosticsToolbar
            scope="首頁附近推薦"
            items={[]}
            downloadPayload={{ homepage_recommendation_cards: [] }}
            exportMeta={{
              scope: "首頁附近推薦",
              note: apiError ?? fallbackReason ?? "附近推薦列表為空",
              response_kind: "empty_roamie",
            }}
          />
        ) : null}
        <p className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyMessage ?? t("home.nearbyEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div>
      {showDiagnostics ? (
        <RecommendationDiagnosticsToolbar
          scope="首頁附近推薦"
          items={diagnosticItems}
          downloadPayload={{ homepage_recommendation_cards: diagnosticItems }}
          exportMeta={{
            scope: "首頁附近推薦",
            note: fallbackReason ?? apiError ?? undefined,
            filtered_recommendation_count: diagnosticItems.length,
          }}
        />
      ) : null}
      <div
        ref={scrollRef}
        className={cn("home-nearby-cards", loading && "opacity-60")}
        role="list"
        aria-label="附近推薦地點"
        onPointerDown={onCarouselPointerDown}
        onPointerMove={onCarouselPointerMove}
        onPointerUp={endCarouselPointer}
        onPointerCancel={endCarouselPointer}
      >
        {places.map((p, i) => {
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
              data-place-card
              onClick={(e) => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }
                if ((e.target as HTMLElement).closest("button")) return;
                if (isNavigating) return;
                onSelect(p);
              }}
              className={cn(
                "home-nearby-card-item relative cursor-pointer text-left transition active:scale-[0.98]",
                isLast && "home-nearby-card-item--last",
                isNavigating && "opacity-80",
              )}
              aria-busy={isNavigating}
            >
              <div className="relative">
                <div className="home-nearby-card-square relative overflow-hidden rounded-[1.35rem] bg-secondary shadow-soft">
                  {isNavigating ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/25 backdrop-blur-[1px]">
                      <Loader2 className="h-6 w-6 animate-spin text-cream" aria-hidden />
                    </div>
                  ) : null}
                  <PlaceCardCover
                    placeId={p.id}
                    name={p.name}
                    photoName={p.photoName}
                    primaryType={p.primaryType}
                    types={p.types}
                    categoryId={p.categoryId}
                    coverImageUrl={p.coverImageUrl}
                    className="absolute inset-0"
                    imgClassName="absolute inset-0 h-full w-full object-cover"
                    onImageSourceChange={(source) =>
                      setImageSourceById((prev) =>
                        prev[p.id] === source ? prev : { ...prev, [p.id]: source },
                      )
                    }
                  />
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
                      className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-full bg-cream/95 px-2.5 py-1 text-[10px] font-medium text-ink shadow-soft"
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
                      className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft disabled:opacity-60"
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
                  <RecommendationDebugPanel
                    dataSource={p.id.startsWith("mock-") ? "mock" : "google_places"}
                    imageSource={imageSourceById[p.id] ?? null}
                    verified={p.id.startsWith("mock-") ? "mock" : "verified"}
                    openingHoursSource={
                      p.openStatus === "unknown" ? "unknown_hours" : "google_opening_hours"
                    }
                    placeId={p.id}
                    fallbackReason={fallbackReason}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
