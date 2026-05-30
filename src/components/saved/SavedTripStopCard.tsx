import { MapPin, Clock, Footprints } from "lucide-react";
import { toast } from "sonner";
import { PlaceAffiliateLinks } from "@/components/affiliate/PlaceAffiliateLinks";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import type { SavedTripDayItem } from "@/lib/saved-trip/types";

type Props = {
  item: SavedTripDayItem;
  isLast?: boolean;
};

export function SavedTripStopCard({ item, isLast }: Props) {
  const hasNav =
    (item.lat != null && item.lng != null) ||
    Boolean(item.address && item.address !== "尚未設定") ||
    Boolean(item.placeId);

  const onNavMissing = () => {
    toast.message("此地點暫時無法導航");
  };

  return (
    <article className="relative pb-6 last:pb-0">
      {!isLast ? (
        <span
          className="absolute -left-[1.35rem] top-8 bottom-0 w-px border-l border-dashed border-border"
          aria-hidden
        />
      ) : null}
      <span
        className="absolute -left-[1.35rem] top-2 h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground"
        aria-hidden
      />

      <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium tabular-nums text-muted-foreground">{item.time}</p>
        </div>
        <h3 className="mt-1.5 text-[16px] font-medium leading-snug">{item.placeName}</h3>
        {item.address && item.address !== "尚未設定" ? (
          <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            {item.address}
          </p>
        ) : null}

        <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt className="shrink-0 text-foreground/70">停留</dt>
            <dd className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.duration}
            </dd>
          </div>
          {item.transportMode && item.transportMode !== "尚未設定" ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-foreground/70">交通</dt>
              <dd>{item.transportMode}</dd>
            </div>
          ) : null}
          {item.travelTimeToNext ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-foreground/70">下一站</dt>
              <dd className="flex items-center gap-1">
                <Footprints className="h-3 w-3" />
                {item.travelTimeToNext}
              </dd>
            </div>
          ) : null}
        </dl>

        <PlaceAffiliateLinks
          placeName={item.placeName}
          source="trip_detail"
          placeTypeHints={{ typeLabel: item.category }}
          compact
          className="mt-3"
        />
        {hasNav ? (
          <PlaceNavButtons
            lat={item.lat}
            lng={item.lng}
            address={item.address !== "尚未設定" ? item.address : undefined}
            placeName={item.placeName}
            compact
            className="mt-2"
          />
        ) : (
          <button
            type="button"
            onClick={onNavMissing}
            className="mt-3 w-full rounded-full border border-dashed border-border py-2 text-xs text-muted-foreground"
          >
            此地點暫時無法導航
          </button>
        )}
      </div>
    </article>
  );
}
