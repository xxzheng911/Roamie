import { Link } from "@tanstack/react-router";
import { Bookmark, MapPin, Calendar, Route as RouteIcon } from "lucide-react";
import cafe from "@/assets/scene-cafe.jpg";
import {
  formatSavedTripDateRange,
  type SavedTripView,
} from "@/lib/saved-trip/normalize";

type Props = {
  trip: SavedTripView;
  deleteSlot?: React.ReactNode;
};

export function SavedTripCard({ trip, deleteSlot }: Props) {
  const dateLabel = formatSavedTripDateRange(trip);

  return (
    <div className="relative rounded-3xl border border-border bg-card shadow-soft transition active:scale-[0.99]">
      {deleteSlot ? (
        <div className="absolute right-3 top-3 z-10">{deleteSlot}</div>
      ) : null}
      <Link
        to="/saved/$tripId"
        params={{ tripId: trip.id }}
        className="block p-4"
      >
      <div className="flex gap-3">
        <div className="h-[5.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-2xl bg-secondary">
          <img
            src={trip.coverImage || cafe}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 pr-8">
          <p className="line-clamp-2 font-display text-[17px] leading-snug">{trip.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{trip.destination}</span>
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="truncate">{dateLabel}</span>
            <span>·</span>
            <span>{trip.dayCount} 天</span>
          </p>
          {trip.summary ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/75">
              {trip.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2 py-0.5 text-[10px] text-muted-foreground">
              <RouteIcon className="h-3 w-3" />
              {trip.transportMode}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-[10px] text-clay">
              <Bookmark className="h-3 w-3 fill-current" />
              已收藏
            </span>
            {trip.mood ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {trip.mood}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      </Link>
    </div>
  );
}
