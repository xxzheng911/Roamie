import type { KeyboardEvent, MouseEvent } from "react";
import { MapPin, Clock, Sparkles, Heart, Loader2 } from "lucide-react";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { DayOutfitCard } from "@/components/DayOutfitCard";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import { filterRecommendationItemsForDisplay } from "@/lib/recommend-place-ranking";

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
  /** 推薦頁：勾選想去（不觸發聊天） */
  pickMode?: boolean;
  pickedPlaceNames?: Set<string>;
  onTogglePick?: (rec: RoamieRecommendationItem) => void;
  selectedPlaceNames?: Set<string>;
  savingPlaceName?: string | null;
  savedPlaceNames?: Set<string>;
  outfitAdvice?: OutfitAdvicePayload;
};

export function RoamieResponseView({
  data,
  compact,
  showItinerary = true,
  hideRecommendations = false,
  onSavePlace,
  onSelectPlace,
  pickMode,
  pickedPlaceNames,
  onTogglePick,
  selectedPlaceNames,
  savingPlaceName,
  savedPlaceNames,
  outfitAdvice,
}: Props) {
  const summary = data.summary?.trim();
  const recs = filterRecommendationItemsForDisplay(data.recommendations ?? []);
  const itinerary = data.itinerary ?? [];

  return (
    <div className="space-y-3">
      {data.moodTag && (
        <span className="inline-block rounded-full bg-sage/15 px-2.5 py-0.5 text-[11px] text-foreground/80">
          {data.moodTag}
        </span>
      )}
      {summary && (
        <p className={`leading-relaxed ${compact ? "text-[15px]" : "text-sm"}`}>{summary}</p>
      )}
      {!summary && (
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
            const isPicked = pickMode
              ? (pickedPlaceNames?.has(r.name) ?? false)
              : (selectedPlaceNames?.has(r.name) ?? false);
            const clickable = pickMode ? !!onTogglePick : !!onSelectPlace;
            const handleCardClick = pickMode
              ? () => onTogglePick?.(r)
              : onSelectPlace
                ? () => onSelectPlace(r)
                : undefined;
            const stopBubble = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

            return (
              <article
                key={`${r.name}-${i}`}
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
                className={`rounded-2xl border p-3 animate-rise transition ${
                  isPicked
                    ? "border-foreground bg-secondary shadow-soft"
                    : "border-border bg-secondary/40"
                } ${
                  clickable && !isPicked
                    ? "hover:border-foreground/30 hover:bg-secondary/55 hover:shadow-soft"
                    : ""
                } ${clickable ? "cursor-pointer active:scale-[0.99]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4
                    className={`text-[15px] font-medium leading-snug ${
                      isPicked ? "text-foreground" : ""
                    }`}
                  >
                    {r.placeName ?? r.name}
                  </h4>
                  <div className="flex shrink-0 items-center gap-1" onClick={stopBubble} onKeyDown={stopBubble}>
                    <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                      {r.type}
                    </span>
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
                              savedPlaceNames?.has(r.name) ? "fill-clay text-clay" : "text-muted-foreground"
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
                <div className="mt-2" onClick={stopBubble} onKeyDown={stopBubble}>
                  <PlaceNavButtons
                    lat={r.lat}
                    lng={r.lng}
                    address={r.address}
                    placeName={r.placeName ?? r.name}
                    compact
                  />
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
