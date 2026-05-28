import type { KeyboardEvent, MouseEvent } from "react";
import { useState } from "react";
import {
  MapPin,
  Clock,
  Sparkles,
  Heart,
  Loader2,
  Star,
  Plus,
  Navigation,
} from "lucide-react";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { DayOutfitCard } from "@/components/DayOutfitCard";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import { PlaceCardCover } from "@/components/media/PlaceCardCover";
import { resolveGooglePlacePhoto } from "@/services/placeImageService";
import { filterRecommendationItemsForDisplay } from "@/lib/recommend-place-ranking";
import { RecommendationDebugPanel } from "@/components/debug/RecommendationDebugPanel";
import { RecommendationDiagnosticsToolbar } from "@/components/debug/RecommendationDiagnosticsToolbar";
import {
  isDiagnosticsModeEnabled,
  type RecommendationDiagnosticSnapshot,
} from "@/lib/debug/recommendation-diagnostics";

function buildChatRecommendationSnapshots(
  recs: RoamieRecommendationItem[],
  imageSourceByKey: Record<string, string>,
): RecommendationDiagnosticSnapshot[] {
  return recs.map((r, i) => {
    const ext = r as RoamieRecommendationItem & {
      photoName?: string | null;
      placeId?: string | null;
      googlePlaceId?: string | null;
    };
    const key = `${r.name}-${i}`;
    const isMock = /附近.*散步|附近.*咖啡/i.test(r.name);
    const imageSource = imageSourceByKey[key] ?? null;
    return {
      card_id: key,
      title: r.placeName ?? r.name,
      place_id: ext.placeId ?? ext.googlePlaceId ?? null,
      source_type: isMock ? "mock" : r.fallbackReason ? "fallback" : "google_places",
      is_verified_real_place: !isMock && r.lat != null && r.lng != null,
      location_source: "device_location",
      photo_source: imageSource,
      photo_url: resolveGooglePlacePhoto(ext.photoName, 400),
      photo_reference: ext.photoName ?? null,
      photo_fallback_reason:
        imageSource === "unsplash" || imageSource === "fallback"
          ? (r.fallbackReason ?? "google_photo_unavailable")
          : null,
      opening_hours_source:
        r.openStatusLabel || r.todayHoursLabel ? "google_opening_hours" : "unknown_hours",
      opening_hours_status: r.openStatusLabel ?? null,
      business_status: null,
      distance_source: r.lat != null ? "coordinates_distance" : null,
      recommendation_source: r.recommendationSource ?? "chat_recommendation",
      fallback_triggered: Boolean(r.fallbackReason),
      fallback_reason: r.fallbackReason ?? null,
      api_error: null,
      created_at: new Date().toISOString(),
    };
  });
}

function ItineraryByDate({
  items,
  outfitAdvice,
}: {
  items: RoamieItineraryItem[];
  outfitAdvice?: OutfitAdvicePayload;
}) {
  const groups = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const key = item.date?.trim() || "未指定日期";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const sortedKeys = [...groups.keys()].sort();
  const outfitByDate = new Map((outfitAdvice?.days ?? []).map((d) => [d.date, d]));

  const allCoords: LatLng[] = items
    .filter((i) => i.lat != null && i.lng != null)
    .map((i) => ({ lat: i.lat!, lng: i.lng! }));

  const routeUrl =
    allCoords.length >= 2
      ? buildDirectionsUrl(allCoords[allCoords.length - 1], {
          origin: allCoords[0],
          waypoints: allCoords.length > 2 ? allCoords.slice(1, -1) : undefined,
        })
      : null;

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">行程</p>
        {routeUrl && (
          <button
            type="button"
            onClick={() => openExternal(routeUrl)}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px]"
          >
            查看整段路線
          </button>
        )}
      </div>
      {sortedKeys.map((dateKey) => {
        const outfit =
          outfitByDate.get(dateKey) ??
          (outfitAdvice?.days.length === 1 ? outfitAdvice.days[0] : undefined);
        return (
          <section key={dateKey}>
            <p className="mb-2 font-display text-sm text-foreground/90">{dateKey}</p>
            {outfit && <DayOutfitCard advice={outfit} className="mb-3" compact />}
            <div className="space-y-2">
              {groups.get(dateKey)!.map((item, i) => (
                <article
                  key={`${dateKey}-${item.time}-${i}`}
                  className="rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium">{item.time}</span>
                    <span>{item.placeName}</span>
                  </div>
                  <h4 className="mt-1 text-[15px] font-medium">{item.title}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                  <PlaceNavButtons
                    lat={item.lat}
                    lng={item.lng}
                    placeName={item.placeName}
                    compact
                    className="mt-2"
                  />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type Props = {
  data: Partial<import("@/lib/ai/types").RoamieResponse>;
  compact?: boolean;
  showItinerary?: boolean;
  /** 行程頁：隱藏推薦區塊 */
  hideRecommendations?: boolean;
  onSavePlace?: (rec: RoamieRecommendationItem) => void | Promise<void>;
  onSelectPlace?: (rec: RoamieRecommendationItem) => void;
  /** 加入已儲存／草稿行程（sheet） */
  onAddToTrip?: (rec: RoamieRecommendationItem) => void;
  /** 卡片點擊：開啟地點詳情 */
  onOpenPlaceDetail?: (rec: RoamieRecommendationItem) => void;
  /** 與 Roamie 討論此地點 */
  onDiscussPlace?: (rec: RoamieRecommendationItem) => void;
  /** 開啟導航（Google Maps → Apple Maps → 瀏覽器） */
  onNavigatePlace?: (rec: RoamieRecommendationItem) => void;
  /** 聊天推薦卡：僅保留加入行程／聊這裡／導航三按鈕 */
  simplifiedPlaceActions?: boolean;
  /** 推薦頁：勾選想去（不觸發聊天） */
  pickMode?: boolean;
  pickedPlaceNames?: Set<string>;
  onTogglePick?: (rec: RoamieRecommendationItem) => void;
  selectedPlaceNames?: Set<string>;
  savingPlaceName?: string | null;
  savedPlaceNames?: Set<string>;
  outfitAdvice?: OutfitAdvicePayload;
  addToTripLabel?: string;
  discussPlaceLabel?: string;
  viewMapLabel?: string;
};

export function RoamieResponseView({
  data,
  compact,
  showItinerary = true,
  hideRecommendations = false,
  onSavePlace,
  onSelectPlace,
  onAddToTrip,
  onOpenPlaceDetail,
  onDiscussPlace,
  onNavigatePlace,
  simplifiedPlaceActions = false,
  pickMode,
  pickedPlaceNames,
  onTogglePick,
  selectedPlaceNames,
  savingPlaceName,
  savedPlaceNames,
  outfitAdvice,
  addToTripLabel = "加入行程",
  discussPlaceLabel = "跟 Roamie 聊這裡",
  viewMapLabel = "查看地圖",
}: Props) {
  const summary = data.summary?.trim();
  const recs = filterRecommendationItemsForDisplay(data.recommendations ?? []);
  const itinerary = data.itinerary ?? [];
  const [imageSourceByKey, setImageSourceByKey] = useState<Record<string, string>>({});
  const showDiagnostics = isDiagnosticsModeEnabled();
  const chatDiagnosticItems = buildChatRecommendationSnapshots(recs, imageSourceByKey);
  const rawRecCount = data.recommendations?.length ?? 0;
  const exportMeta = {
    scope: "聊聊推薦",
    note:
      recs.length === 0
        ? rawRecCount > 0
          ? "有 AI recommendations 但皆未通過真實地點驗證"
          : "此則回覆無地點卡（可能僅 summary 或上游 Places 為空）"
        : undefined,
    summary_excerpt: (summary ?? data.summary ?? "").slice(0, 800) || undefined,
    raw_recommendation_count: rawRecCount,
    filtered_recommendation_count: recs.length,
    response_kind:
      recs.length > 0
        ? ("roamie_cards" as const)
        : rawRecCount > 0
          ? ("empty_roamie" as const)
          : ("empty_roamie" as const),
  };

  return (
    <div className="space-y-3">
      {showDiagnostics ? (
        <RecommendationDiagnosticsToolbar
          scope="聊聊推薦"
          items={chatDiagnosticItems}
          downloadPayload={{ chat_recommendation_cards: chatDiagnosticItems }}
          exportMeta={exportMeta}
        />
      ) : null}
      {data.moodTag && (
        <span className="inline-block rounded-full bg-sage/15 px-2.5 py-0.5 text-[11px] text-foreground/80">
          {data.moodTag}
        </span>
      )}
      {summary && (
        <p className={`leading-relaxed ${compact ? "text-[15px]" : "text-sm"}`}>{summary}</p>
      )}
      {!summary && recs.length === 0 && itinerary.length === 0 && (
        <span className="inline-flex gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
        </span>
      )}

      {!hideRecommendations && recs.length > 0 && (
        <div className="space-y-2">
          {!compact && (
            <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3 text-clay" /> 推薦
            </p>
          )}
          {recs.map((r, i) => {
            const key = `${r.name}-${i}`;
            const isPicked = pickMode
              ? (pickedPlaceNames?.has(r.name) ?? false)
              : (selectedPlaceNames?.has(r.name) ?? false);
            const clickable = pickMode
              ? !!onTogglePick
              : !!(onOpenPlaceDetail ?? onDiscussPlace ?? onSelectPlace);
            const handleCardClick = pickMode
              ? () => onTogglePick?.(r)
              : onOpenPlaceDetail
                ? () => onOpenPlaceDetail(r)
                : onDiscussPlace
                  ? () => onDiscussPlace(r)
                  : onSelectPlace
                    ? () => onSelectPlace(r)
                    : undefined;
            const stopBubble = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

            const ext = r as RoamieRecommendationItem & {
              photoName?: string | null;
              primaryType?: string | null;
              types?: string[] | null;
              placeId?: string | null;
              rating?: number | null;
            };

            return (
              <article
                key={key}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-pressed={clickable ? isPicked : undefined}
                onClick={handleCardClick}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardClick?.();
                        }
                      }
                    : undefined
                }
                className={`flex min-h-[280px] flex-col rounded-2xl border p-3 animate-rise transition overflow-hidden ${
                  isPicked
                    ? "border-foreground bg-secondary shadow-soft"
                    : "border-border bg-secondary/40"
                } ${
                  clickable && !isPicked
                    ? "hover:border-foreground/30 hover:bg-secondary/55 hover:shadow-soft"
                    : ""
                } ${clickable ? "cursor-pointer active:scale-[0.99]" : ""}`}
              >
                <div className="relative -mx-3 -mt-3 mb-3 aspect-[16/10] shrink-0 overflow-hidden bg-secondary">
                  <div className="absolute right-2 top-2 z-10 flex max-w-[55%] flex-wrap justify-end gap-1">
                    {ext.rating != null ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
                        <Star className="h-3 w-3 fill-clay text-clay" />
                        {ext.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {r.type ? (
                      <span className="rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
                        {r.type}
                      </span>
                    ) : null}
                  </div>
                  <PlaceCardCover
                    placeId={ext.placeId}
                    name={r.name}
                    photoName={ext.photoName}
                    primaryType={ext.primaryType ?? r.type}
                    types={ext.types}
                    categoryId={r.type}
                    coverImageUrl={resolveGooglePlacePhoto(ext.photoName, 400)}
                    alt={r.name}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-cover"
                    onImageSourceChange={(source) =>
                      setImageSourceByKey((prev) =>
                        prev[key] === source ? prev : { ...prev, [key]: source },
                      )
                    }
                  />
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <h4
                    className={`line-clamp-2 text-[15px] font-medium leading-snug ${
                      isPicked ? "text-foreground" : ""
                    }`}
                  >
                    {r.placeName ?? r.name}
                  </h4>
                  <div
                    className="mt-auto flex items-center justify-end gap-1"
                    onClick={stopBubble}
                    onKeyDown={stopBubble}
                  >
                    {onSavePlace && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSavePlace(r);
                        }}
                        disabled={savingPlaceName === r.name}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-card disabled:opacity-50"
                        aria-label={savedPlaceNames?.has(r.name) ? "已收藏" : "收藏"}
                      >
                        {savingPlaceName === r.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Heart
                            className={`h-3.5 w-3.5 ${
                              savedPlaceNames?.has(r.name)
                                ? "fill-clay text-clay"
                                : "text-muted-foreground"
                            }`}
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                <p className="mt-1.5 text-xs text-foreground/75">{r.reason}</p>
                <PlaceHoursBadge
                  className="mt-1.5"
                  statusLabel={r.openStatusLabel}
                  todayHoursLabel={r.todayHoursLabel}
                  closingSoonNote={r.closingSoonNote}
                  nextOpenHint={r.nextOpenHint}
                />
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" /> {r.estimatedTime}
                  </span>
                  {r.address && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {r.address}
                    </span>
                  )}
                </div>
                <RecommendationDebugPanel
                  dataSource={r.fallbackReason ? "fallback_chain" : "recommendation"}
                  imageSource={imageSourceByKey[key] ?? null}
                  verified={
                    r.lat != null && r.lng != null && !/附近.*散步|附近.*咖啡/i.test(r.name)
                      ? "verified"
                      : "mock_or_generic"
                  }
                  openingHoursSource={
                    r.openStatusLabel || r.todayHoursLabel
                      ? "google_opening_hours"
                      : "unknown_hours"
                  }
                  placeId={ext.placeId ?? ext.googlePlaceId ?? null}
                  fallbackReason={r.fallbackReason ?? null}
                  recommendationSource={r.recommendationSource ?? null}
                  nearbyPlacesSource={r.nearbyPlacesSource ?? null}
                  aiFallbackSource={r.aiFallbackSource ?? null}
                />
                <div
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onClick={stopBubble}
                  onKeyDown={stopBubble}
                >
                  {onAddToTrip && (
                    <button
                      type="button"
                      onClick={() => onAddToTrip(r)}
                      className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-[11px] font-medium text-background"
                    >
                      <Plus className="h-3 w-3" />
                      {addToTripLabel}
                    </button>
                  )}
                  {onSelectPlace && !pickMode && !onAddToTrip && (
                    <button
                      type="button"
                      onClick={() => onSelectPlace(r)}
                      className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-[11px] font-medium text-background"
                    >
                      <Plus className="h-3 w-3" />
                      {addToTripLabel}
                    </button>
                  )}
                  {onOpenPlaceDetail && !simplifiedPlaceActions && (
                    <button
                      type="button"
                      onClick={() => onOpenPlaceDetail(r)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium"
                    >
                      <MapPin className="h-3 w-3" />
                      {viewMapLabel}
                    </button>
                  )}
                  {onDiscussPlace && !pickMode && !simplifiedPlaceActions && (
                    <button
                      type="button"
                      onClick={() => onDiscussPlace(r)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium"
                    >
                      {discussPlaceLabel}
                    </button>
                  )}
                  {simplifiedPlaceActions && onNavigatePlace ? (
                    <button
                      type="button"
                      onClick={() => onNavigatePlace(r)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium"
                    >
                      <Navigation className="h-3 w-3" />
                      查看路線
                    </button>
                  ) : !simplifiedPlaceActions ? (
                    <PlaceNavButtons
                      lat={r.lat}
                      lng={r.lng}
                      address={r.address}
                      placeName={r.placeName ?? r.name}
                      compact
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showItinerary && itinerary.length > 0 && (
        <ItineraryByDate items={itinerary} outfitAdvice={outfitAdvice} />
      )}
    </div>
  );
}
