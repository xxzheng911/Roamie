import { Link } from "@tanstack/react-router";
import { Calendar, ChevronRight } from "lucide-react";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { logTripNav, TRIP_DETAIL_ROUTE } from "@/lib/trip/trip-detail-nav";
import type { CoreTrip } from "@/lib/trip/core-trip";
import { resolveCoreTripCoverImage, resolveCoreTripTitle } from "@/lib/trip/core-trip";

type Props = {
  trip: CoreTrip;
};

/** 首頁「繼續你的行程」— 與收藏列表同一筆 trip、同一詳情頁 */
export function HomeTripCard({ trip }: Props) {
  return (
    <Link
      to={TRIP_DETAIL_ROUTE}
      params={{ tripId: trip.id }}
      onClick={() => logTripNav("HomeTripCard", trip.id)}
      className="mt-7 block overflow-hidden rounded-3xl border border-border bg-card shadow-soft"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <TripCoverImage
          displayCoverImage={resolveCoreTripCoverImage(trip)}
          coverImageUrl={null}
          customCoverImageUrl={trip.customCoverImageUrl}
          aiGeneratedCoverImageUrl={trip.aiGeneratedCoverImageUrl}
          isCoverCustomized={Boolean(trip.customCoverImageUrl)}
          mood="roamie"
          src={resolveCoreTripCoverImage(trip)}
          className="absolute inset-0"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-cream">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">繼續你的行程</p>
          <h3 className="mt-1 font-display text-xl">{resolveCoreTripTitle(trip)}</h3>
        </div>
      </div>
      <div className="flex items-center justify-between px-5 py-3.5 text-sm">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          {trip.days} 天
        </span>
        <span className="inline-flex items-center gap-1 text-foreground">
          繼續 <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
